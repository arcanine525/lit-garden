import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { reviewTotal, type ReviewDraft } from '../../shared/review';
import { transaction } from '../assignments/access';
import { database } from '../db';
import { decodeDocument, encodeDocument } from '../drive/envelope';
import { DriveError } from '../drive/provider';
import { prepareWorkspace, readVerifiedObject, storeCandidate, type DriveObject } from '../drive/storage';
import { assertReviewSource, verifyReviewSource } from '../drive/submission-integrity';
import type { Snapshot } from '../student-drafts/writer';
import { assertPinnedComments, commentDigest } from './comments';
import { reviewDraftInput, reviewMetadata } from './draft-format';
import { assertReviewWriter, lockReview, readReviewDraft, type ReviewActor } from './drafts';
import { publicationSource, reviewSource, reviewSubmission, submissionForReader, type ReviewSource } from './source';

export type PublicationSnapshot = Snapshot & { basePublication: string | null; draftHash: string; submissionSha256: string };
type Intent = { id: string; state: string; request_digest: string; kind: string; target_kind: string; target_id: string; result_id: string | null };
type Db = PoolClient | ReturnType<typeof database>;
const receipt = (id: string) => ({ state:'committed' as const,id });
const rejected = (state: string) => state === 'rejected' || state === 'cleanup';
const terminal = (error: unknown) => error instanceof DriveError && error.status < 500 &&
  !['DRIVE_RECONNECT','DRIVE_SETUP_REQUIRED','DRIVE_FORBIDDEN'].includes(error.code);

async function rejectPublication(id: string) {
  await database().query(`WITH rejected AS (
    UPDATE garden.operations SET state='rejected',error_code='STALE' WHERE id=$1
      AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
  ) UPDATE garden.drive_objects SET lifecycle='orphan' WHERE lifecycle='candidate' AND operation_id IN (SELECT id FROM rejected)`,[id]);
}

async function publicationIntent(db: Db, teacher: string, submission: string, key: string, digest: string) {
  const { rows } = await db.query<Intent & { stream_id: string | null }>(`SELECT op.*,d.stream_id
    FROM garden.operations op LEFT JOIN garden.review_drafts d ON d.submission_id=$3 AND d.teacher_id=$1
    WHERE op.actor_id=$1 AND op.idempotency_key=$2`,[teacher,key,submission]);
  const op = rows[0];
  if (!op) return undefined;
  if (op.kind !== 'publish_review' || op.target_kind !== 'stream' || op.stream_id !== op.target_id || op.request_digest !== digest) {
    throw new DriveError('KEY_REUSED',409);
  }
  if (rejected(op.state)) throw new DriveError('REVIEW_REJECTED',409);
  return op;
}

function complete(draft: ReviewDraft, source: ReviewSource) {
  if (draft.scores.length !== source.rubric.criteria.length) throw new DriveError('RUBRIC_INCOMPLETE',422);
}

async function reserve(actor: ReviewActor, source: ReviewSource, snapshot: PublicationSnapshot, draft: ReviewDraft, fingerprint: string) {
  const id = source.submission.id;
  return transaction(async db => {
    const stream = await lockReview(db,actor,id);
    const prior = await publicationIntent(db,actor.teacher,id,snapshot.key,fingerprint);
    if (prior?.state === 'committed' && prior.result_id) return { stream,op:prior,revision:0 };
    await assertReviewSource(db,actor.teacher,id,snapshot.submissionSha256);
    assertReviewWriter(stream,actor.teacher,snapshot,!prior);
    if (stream.currentPublicationId !== snapshot.basePublication || stream.version !== snapshot.baseVersion) throw new DriveError('DRAFT_CHANGED',409);
    await assertPinnedComments(db,id,stream.currentPublicationId,draft.comments);
    const { rows:[{ revision }] } = await db.query<{ revision: number }>(`SELECT COALESCE(MAX(revision),0)+1 AS revision
      FROM garden.review_publications WHERE submission_id=$1`,[id]);
    if (prior) return { stream,op:prior,revision };
    const { rows } = await db.query<Intent>(`INSERT INTO garden.operations
      (actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version,lease_epoch,client_session_id)
      VALUES($1,$1,'publish_review','stream',$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *`,
      [actor.teacher,stream.id,snapshot.key,fingerprint,snapshot.baseVersion,snapshot.epoch,snapshot.clientId]);
    if (!rows[0]) throw new DriveError('OP_IN_PROGRESS',409);
    return { stream,op:rows[0],revision };
  });
}

export async function publishReview(actor: ReviewActor, id: string, snapshot: PublicationSnapshot) {
  await reviewSubmission(database(),actor.teacher,id);
  const fingerprint = createHash('sha256').update(JSON.stringify([id,snapshot])).digest('hex');
  const already = await publicationIntent(database(),actor.teacher,id,snapshot.key,fingerprint);
  if (already?.state === 'committed' && already.result_id) return receipt(already.result_id);
  const source = await reviewSource(actor.teacher,id).catch(async error => {
    if (already && terminal(error)) await rejectPublication(already.id);
    throw error;
  });
  if (source.submissionSha256 !== snapshot.submissionSha256) throw new DriveError('SUBMISSION_CONFLICT',409);
  const saved = await readReviewDraft(actor.teacher,source);
  if (saved.version !== snapshot.baseVersion || saved.hash !== snapshot.draftHash) throw new DriveError('DRAFT_CHANGED',409);
  complete(saved.draft,source);
  const { stream,op,revision } = await reserve(actor,source,snapshot,saved.draft,fingerprint);
  if (op.state === 'committed' && op.result_id) return receipt(op.result_id);
  const bytes = encodeDocument('garden.review-publication/1',op.id,{ ...reviewMetadata(source),revision,...saved.draft });
  try {
    const target = source.submission;
    const workspace = await prepareWorkspace(actor.teacher,{ classId:target.class_id,assignmentId:target.assignment_id,
      studentId:target.student_id,reviewSubmission:id });
    const candidate = await storeCandidate(workspace,{ operationId:op.id,slot:'document',name:`review-pub-${op.id}.md`,mimeType:'text/markdown',bytes });
    await verifyReviewSource(actor.teacher,id);
    return await transaction(async db => {
      const current = await lockReview(db,actor,id);
      const intent = await publicationIntent(db,actor.teacher,id,snapshot.key,fingerprint);
      if (intent?.state === 'committed' && intent.result_id) return receipt(intent.result_id);
      if (!intent || current.id !== stream.id) throw new DriveError('REVIEW_REJECTED',409);
      await assertReviewSource(db,actor.teacher,id,snapshot.submissionSha256);
      assertReviewWriter(current,actor.teacher,snapshot,false);
      if (current.currentPublicationId !== snapshot.basePublication || current.version !== snapshot.baseVersion) throw new DriveError('DRAFT_CHANGED',409);
      await assertPinnedComments(db,id,current.currentPublicationId,saved.draft.comments);
      const verified = await db.query(`UPDATE garden.drive_objects SET lifecycle='referenced'
        WHERE id=$1 AND operation_id=$2 AND integrity='ok' AND lifecycle='candidate'`,[candidate,op.id]);
      if (!verified.rowCount) throw new DriveError('REVIEW_REJECTED',409);
      await db.query(`INSERT INTO garden.review_publications(id,submission_id,teacher_id,revision,operation_id,object_id)
        VALUES($1,$2,$3,$4,$1,$5)`,[op.id,id,actor.teacher,revision,candidate]);
      const ids = saved.draft.comments.map(comment => comment.id);
      await db.query(`INSERT INTO garden.review_comments(id,submission_id) SELECT unnest($1::uuid[]),$2
        ON CONFLICT (id) DO NOTHING`,[ids,id]);
      await db.query(`INSERT INTO garden.publication_comments(publication_id,submission_id,comment_id,comment_digest)
        SELECT $1,$2,comment_id,digest FROM unnest($3::uuid[],$4::text[]) AS entry(comment_id,digest)`,
        [op.id,id,ids,saved.draft.comments.map(commentDigest)]);
      await db.query('UPDATE garden.submissions SET current_publication_id=$2 WHERE id=$1',[id,op.id]);
      await db.query('UPDATE garden.review_drafts SET based_on_publication_id=$2 WHERE submission_id=$1',[id,op.id]);
      await db.query(`INSERT INTO garden.notifications(user_id,teacher_id,event_operation_id,event_kind,target_kind,target_id)
        VALUES($1,$2,$3,'returned','submission',$4)`,[target.student_id,actor.teacher,op.id,id]);
      await db.query("UPDATE garden.operations SET state='committed',result_id=id,error_code=NULL WHERE id=$1",[op.id]);
      return receipt(op.id);
    });
  } catch (error) {
    const sql = (error as { code?: string }).code;
    if (sql === '23503' || terminal(error)) {
      await rejectPublication(op.id);
      if (sql === '23503') throw new DriveError('REVIEW_REJECTED',409);
      throw error;
    }
    const previous = await publicationIntent(database(),actor.teacher,id,snapshot.key,fingerprint).catch(failure => {
      if (failure instanceof DriveError) throw failure;
    });
    if (previous?.state === 'committed' && previous.result_id) return receipt(previous.result_id);
    await database().query("UPDATE garden.operations SET state='unknown',error_code='TIMEOUT' WHERE id=$1 AND state IN ('reserved','unknown')",[op.id]).catch(() => {});
    return { state:'unknown' as const };
  }
}

type Publication = DriveObject & { pid: string; revision: number; published_at: Date };

async function publicationForReader(actor: string, id: string, selected: string) {
  return (await database().query<Publication>(`SELECT o.*,p.id AS pid,p.revision,p.published_at FROM garden.review_publications p
    JOIN garden.submissions s ON s.id=p.submission_id JOIN garden.drive_objects o ON o.id=p.object_id AND o.teacher_id=p.teacher_id
    WHERE s.id=$1 AND p.id=$2 AND o.lifecycle='referenced' AND o.mime_type='text/markdown'
      AND garden.readable_review_object($3,s.id,p.id)=o.id`,[id,selected,actor])).rows[0];
}

export async function readPublication(actor: string, id: string, requested: string | null = null) {
  const submission = await submissionForReader(database(),actor,id);
  const teacher = submission.teacher_id === actor;
  const selected = requested ?? submission.current_publication_id;
  const history = teacher ? (await database().query<{ id: string; revision: number; published_at: Date }>(`
    SELECT id,revision,published_at FROM garden.review_publications WHERE submission_id=$1 AND teacher_id=$2 ORDER BY revision DESC`,[id,actor])).rows
      .map(row => ({ id:row.id,revision:row.revision,publishedAt:row.published_at.toISOString() })) : undefined;
  if (!selected) return { publication:null,...(history ? { history } : {}) };
  const object = await publicationForReader(actor,id,selected);
  if (!object) throw new DriveError('NOT_FOUND',404);
  const [file,source] = await Promise.all([readVerifiedObject(object),publicationSource(actor,submission)]);
  const { fields,body } = decodeDocument<Record<string,unknown>>(file.bytes,'garden.review-publication/1',selected);
  if (body || fields.revision !== object.revision || Object.entries(reviewMetadata(source)).some(([key,value]) => fields[key] !== value)) {
    throw new DriveError('DRIVE_INTEGRITY',409);
  }
  const { scores,comments,overallCommentId } = fields;
  const draft = reviewDraftInput({ scores,comments,overallCommentId },source);
  complete(draft,source);
  const final = await publicationForReader(actor,id,selected);
  if (final?.id !== object.id) throw new DriveError('NOT_FOUND',404);
  return { publication:{ id:selected,submissionId:id,revision:object.revision,publishedAt:object.published_at.toISOString(),
    title:source.title,studentName:submission.student_name,className:submission.class_name,submissionNo:submission.submission_no,
    markdown:source.markdown,explanation:source.explanation,rubric:source.rubric,total:reviewTotal(draft.scores,source.rubric),...draft },
    ...(history ? { history } : {}) };
}
