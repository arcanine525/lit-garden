import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { emptyReview } from '../../shared/review';
import { database } from '../db';
import { lockAssignment, transaction } from '../assignments/access';
import { DriveError } from '../drive/provider';
import { prepareWorkspace, readVerifiedObject, storeCandidate, type DriveObject } from '../drive/storage';
import { assertReviewSource, verifyReviewSource } from '../drive/submission-integrity';
import type { Snapshot, Writer } from '../student-drafts/writer';
import { decodeReviewDraft, encodeReviewDraft, reviewDraftInput } from './draft-format';
import { reviewSource, reviewSubmission, type ReviewSource } from './source';
import { assertPinnedComments } from './comments';

export type ReviewActor = { teacher: string; sessionDigest: string };
type Stream = { id: string; version: string; head_object_id: string | null; lease_actor_id: string | null;
  lease_session_id: string | null; lease_epoch: string; lease_live: boolean };
type Operation = { id: string; state: string; kind: string; target_id: string; request_digest: string };
const checksum = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');

async function streamFor(db: PoolClient | ReturnType<typeof database>, teacher: string, submission: string, lock = false) {
  const { rows } = await db.query<Stream>(`SELECT ds.*,COALESCE(ds.lease_until>clock_timestamp(),false) AS lease_live
    FROM garden.review_drafts draft JOIN garden.document_streams ds ON ds.id=draft.stream_id
    WHERE draft.submission_id=$1 AND draft.teacher_id=$2 ${lock ? 'FOR UPDATE OF ds' : ''}`,[submission,teacher]);
  return rows[0];
}

export async function lockReview(db: PoolClient, actor: ReviewActor, submissionId: string, initialize = false) {
  const first = await reviewSubmission(db,actor.teacher,submissionId);
  await lockAssignment(db,actor.teacher,first.assignment_id);
  const auth = await db.query(`SELECT 1 FROM garden.app_sessions s JOIN garden.users u ON u.id=s.user_id
    WHERE s.handle_digest=$1 AND s.user_id=$2 AND s.auth_epoch=u.auth_epoch AND s.expires_at>now()`,[actor.sessionDigest,actor.teacher]);
  if (!auth.rowCount) throw new DriveError('UNAUTHENTICATED',401);
  await db.query('SELECT id FROM garden.recipients WHERE id=$1 FOR UPDATE',[first.recipient_id]);
  let stream = await streamFor(db,actor.teacher,submissionId,true);
  const locked = await db.query<{ current_publication_id: string | null }>('SELECT current_publication_id FROM garden.submissions WHERE id=$1 FOR UPDATE',[submissionId]);
  if (initialize && !stream) {
    const made = await db.query<{ id: string }>(`INSERT INTO garden.document_streams(teacher_id,kind)
      VALUES($1,'review') RETURNING id`,[actor.teacher]);
    await db.query('INSERT INTO garden.review_drafts(submission_id,teacher_id,stream_id) VALUES($1,$2,$3)',[submissionId,actor.teacher,made.rows[0].id]);
    stream = await streamFor(db,actor.teacher,submissionId,true);
  }
  if (!stream) throw new DriveError('LEASE_REQUIRED',409);
  return { ...stream,currentPublicationId:locked.rows[0].current_publication_id };
}

export function assertReviewWriter(stream: Stream, teacher: string, writer: Writer, live = true) {
  if (stream.lease_actor_id !== teacher || stream.lease_session_id !== writer.clientId || stream.lease_epoch !== writer.epoch ||
      (live && !stream.lease_live)) throw new DriveError('STALE_WRITER',409);
}

async function rejectWrites(db: PoolClient | ReturnType<typeof database>, target: string, stream: boolean) {
  await db.query(`WITH rejected AS (
    UPDATE garden.operations SET state='rejected',error_code='STALE'
    WHERE ${stream ? "target_kind='stream' AND target_id=$1 AND kind IN ('autosave','publish_review')" : 'id=$1'}
      AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
  ) UPDATE garden.drive_objects SET lifecycle='orphan' WHERE lifecycle='candidate' AND operation_id IN (SELECT id FROM rejected)`,[target]);
}

export async function reviewLease(actor: ReviewActor, id: string, action: 'acquire' | 'takeover' | 'renew' | 'release', clientId: string, epoch?: string) {
  const opening = action === 'acquire' || action === 'takeover';
  const source = opening ? await verifyReviewSource(actor.teacher,id) : null;
  return transaction(async db => {
    const stream = await lockReview(db,actor,id,opening);
    if (source) await assertReviewSource(db,actor.teacher,id,source.submissionSha256);
    if (!opening) assertReviewWriter(stream,actor.teacher,{ clientId,epoch:epoch ?? '' },action === 'renew');
    if (action === 'release') {
      await rejectWrites(db,stream.id,true);
      await db.query(`UPDATE garden.document_streams SET lease_actor_id=NULL,lease_session_id=NULL,lease_until=NULL,
        lease_epoch=lease_epoch+1 WHERE id=$1`,[stream.id]);
      return { released:true };
    }
    const sameClient = stream.lease_actor_id === actor.teacher && stream.lease_session_id === clientId;
    if (action === 'acquire' && stream.lease_live && !sameClient) throw new DriveError('LEASE_HELD',423);
    const advance = !sameClient || !stream.lease_live;
    if (advance) await rejectWrites(db,stream.id,true);
    const { rows } = await db.query<{ epoch: string; version: string }>(`UPDATE garden.document_streams SET lease_actor_id=$2,
      lease_session_id=$3,lease_until=clock_timestamp()+interval '60 seconds',lease_epoch=lease_epoch+CASE WHEN $4 THEN 1 ELSE 0 END
      WHERE id=$1 RETURNING lease_epoch AS epoch,version`,[stream.id,actor.teacher,clientId,advance]);
    if (action === 'takeover' && advance) await db.query(`INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,outcome)
      VALUES($1,'LEASE_TAKEOVER','stream',$2,'success')`,[actor.teacher,stream.id]);
    return rows[0];
  });
}

export async function readReviewDraft(teacher: string, source: ReviewSource) {
  const stream = await streamFor(database(),teacher,source.submission.id);
  const currentPublicationId = source.submission.current_publication_id;
  if (!stream?.head_object_id) return { version:stream?.version ?? '0',hash:null,draft:emptyReview,currentPublicationId };
  const { rows } = await database().query<DriveObject>(`SELECT * FROM garden.drive_objects
    WHERE id=$1 AND teacher_id=$2 AND lifecycle='referenced' AND slot='document' AND mime_type='text/markdown'`,[stream.head_object_id,teacher]);
  if (!rows[0]) throw new DriveError('DRIVE_MISSING',404);
  const file = await readVerifiedObject(rows[0]);
  const current = await streamFor(database(),teacher,source.submission.id);
  await assertReviewSource(database(),teacher,source.submission.id,source.submissionSha256);
  if (current?.head_object_id !== stream.head_object_id) throw new DriveError('DRAFT_CHANGED',409);
  return { version:stream.version,hash:rows[0].expected_sha256,draft:decodeReviewDraft(file.bytes,source,stream.id,stream.version),currentPublicationId };
}

async function known(db: PoolClient, actor: ReviewActor, stream: string, key: string, digest: string) {
  const { rows } = await db.query<Operation>(`SELECT id,state,kind,target_id,request_digest FROM garden.operations
    WHERE actor_id=$1 AND idempotency_key=$2`,[actor.teacher,key]);
  const op = rows[0];
  if (op && (op.kind !== 'autosave' || op.target_id !== stream || op.request_digest !== digest)) throw new DriveError('KEY_REUSED',409);
  if (op && ['rejected','cleanup'].includes(op.state)) throw new DriveError('STALE_WRITER',409);
  return op;
}

export async function saveReviewDraft(actor: ReviewActor, id: string, snapshot: Snapshot, input: unknown) {
  const source = await reviewSource(actor.teacher,id);
  const draft = reviewDraftInput(input,source);
  const digest = checksum(JSON.stringify([id,snapshot.clientId,snapshot.epoch,snapshot.baseVersion,source.submissionSha256,source.rubricHash,draft]));
  const { stream,op } = await transaction(async db => {
    const stream = await lockReview(db,actor,id);
    await assertReviewSource(db,actor.teacher,id,source.submissionSha256);
    const previous = await known(db,actor,stream.id,snapshot.key,digest);
    if (previous?.state === 'committed') return { stream,op:previous };
    assertReviewWriter(stream,actor.teacher,snapshot);
    if (stream.version !== snapshot.baseVersion) throw new DriveError('DRAFT_CHANGED',409);
    await assertPinnedComments(db,id,stream.currentPublicationId,draft.comments);
    if (previous) return { stream,op:previous };
    const { rows } = await db.query<Operation>(`INSERT INTO garden.operations
      (actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version,lease_epoch,client_session_id)
      VALUES($1,$1,'autosave','stream',$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id,state,kind,target_id,request_digest`,
      [actor.teacher,stream.id,snapshot.key,digest,snapshot.baseVersion,snapshot.epoch,snapshot.clientId]);
    if (!rows[0]) throw new DriveError('OP_IN_PROGRESS',409);
    return { stream,op:rows[0] };
  });
  const version = (BigInt(snapshot.baseVersion)+1n).toString();
  const bytes = encodeReviewDraft(source,stream.id,version,draft);
  const result = { state:'committed' as const,version,hash:checksum(bytes) };
  if (op.state === 'committed') return result;
  try {
    const target = source.submission;
    const workspace = await prepareWorkspace(actor.teacher,{ classId:target.class_id,assignmentId:target.assignment_id,
      studentId:target.student_id,reviewSubmission:id });
    const object = await storeCandidate(workspace,{ operationId:op.id,slot:'document',name:`review-draft-${op.id}.md`,mimeType:'text/markdown',bytes });
    await verifyReviewSource(actor.teacher,id);
    return await transaction(async db => {
      const current = await lockReview(db,actor,id);
      if (current.id !== stream.id) throw new DriveError('STALE_WRITER',409);
      if ((await known(db,actor,current.id,snapshot.key,digest))?.state === 'committed') return result;
      await assertReviewSource(db,actor.teacher,id,source.submissionSha256);
      assertReviewWriter(current,actor.teacher,snapshot);
      if (current.version !== snapshot.baseVersion) throw new DriveError('DRAFT_CHANGED',409);
      await assertPinnedComments(db,id,current.currentPublicationId,draft.comments);
      await db.query('SELECT garden.commit_draft_head($1,$2,$3,$4,$5,$6)',[stream.id,actor.teacher,snapshot.clientId,
        snapshot.epoch,snapshot.baseVersion,object]);
      await db.query("UPDATE garden.operations SET state='committed',result_id=$2,error_code=NULL WHERE id=$1",[op.id,object]);
      return result;
    });
  } catch (error) {
    const stale = (error as { code?: string }).code === '40001';
    if (stale || (error instanceof DriveError && error.status < 500)) {
      await rejectWrites(database(),op.id,false);
      if (stale) throw new DriveError('STALE_WRITER',409);
      throw error;
    }
    await database().query("UPDATE garden.operations SET state='unknown',error_code='TIMEOUT' WHERE id=$1 AND state IN ('reserved','unknown')",[op.id]).catch(() => {});
    return { state:'unknown' as const };
  }
}
