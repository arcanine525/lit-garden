import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from '../assignments/access';
import { submissionTimings } from '../assignments/lifecycle';
import { database } from '../db';
import { validateEditorDraft } from '../drive/assignment-assets';
import { encodeDocument } from '../drive/envelope';
import { DriveError } from '../drive/provider';
import { prepareWorkspace, storeCandidate } from '../drive/storage';
import { draftVisible, lockDraft, type DraftActor, type DraftBody } from './access';
import { assertWritable, assertWriter, type Snapshot } from './writer';

type Operation = { id: string; state: string; target_kind: string; kind: string; target_id: string;
  request_digest: string; accepted_at: Date; result_id: string | null };
const columns = 'id,state,target_kind,kind,target_id,request_digest,accepted_at,result_id';
const terminal = (state: string) => state === 'rejected' || state === 'cleanup';

async function findIntent(db: PoolClient, recipient: string, student: string, key: string, digest?: string) {
  const op = (await db.query<Operation>(`SELECT ${columns} FROM garden.operations WHERE actor_id=$1 AND idempotency_key=$2`,
    [student,key])).rows[0];
  if (op && (op.kind !== 'submit' || op.target_kind !== 'recipient' || op.target_id !== recipient || (digest && digest !== op.request_digest))) {
    throw new DriveError('KEY_REUSED',409);
  }
  return op;
}

function receipt(id: string) {
  return { state:'committed' as const,id };
}

async function rejectIntent(db: PoolClient | ReturnType<typeof database>, id: string, reason: string) {
  await db.query(`WITH rejected AS (
    UPDATE garden.operations SET state='rejected',error_code=$2 WHERE id=$1
      AND state IN ('reserved','writing','drive_verified','unknown','needs_client') RETURNING id
  ) UPDATE garden.drive_objects SET lifecycle='orphan'
    WHERE lifecycle='candidate' AND operation_id IN (SELECT id FROM rejected)`,[id,reason]);
}

async function admission(db: PoolClient, actor: DraftActor, assignment: string, snapshot: Snapshot, digest: string) {
  const row = await lockDraft(db,actor,assignment);
  let op = await findIntent(db,row.recipient_id,actor.student,snapshot.key,digest);
  if (op?.result_id && op.state === 'committed') return { row,op };
  if (op && terminal(op.state)) throw new DriveError('SUBMISSION_REJECTED',409);
  assertWritable(row);
  assertWriter(row,actor.student,snapshot,!op);
  if (op) return { row,op };
  if (row.version !== snapshot.baseVersion) throw new DriveError('DRAFT_CHANGED',409);
  op = (await db.query<Operation>(`INSERT INTO garden.operations
    (actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version,lease_epoch,client_session_id,accepted_at)
    VALUES($1,$2,'submit','recipient',$3,$4,$5,$6,$7,$8,clock_timestamp())
    ON CONFLICT DO NOTHING RETURNING ${columns}`,
    [actor.student,row.teacher_id,row.recipient_id,snapshot.key,digest,snapshot.baseVersion,snapshot.epoch,snapshot.clientId])).rows[0];
  if (!op) throw new DriveError('OP_IN_PROGRESS',409);
  return { row,op };
}

export async function submitWork(actor: DraftActor, assignment: string, snapshot: Snapshot, draft: DraftBody) {
  if (!draft.markdown.trim()) throw new DriveError('SUBMISSION_EMPTY',422);
  await validateEditorDraft(actor.student,'student',draft.markdown);
  const digest = createHash('sha256').update(JSON.stringify([assignment,snapshot.clientId,snapshot.epoch,snapshot.baseVersion,draft])).digest('hex');
  const { row,op } = await transaction(db => admission(db,actor,assignment,snapshot,digest));
  if (op.state === 'committed' && op.result_id) return receipt(op.result_id);
  // The operation UUID also identifies its immutable submission, including on retry after a restart.
  const bytes = encodeDocument('garden.submission/1',op.id,{ assignmentId:assignment,recipientId:row.recipient_id,
    acceptedAt:op.accepted_at.toISOString(),explanation:draft.explanation },draft.markdown);
  try {
    const workspace = await prepareWorkspace(row.teacher_id,{ classId:row.class_id,assignmentId:assignment,studentId:actor.student });
    const object = await storeCandidate(workspace,{ operationId:op.id,slot:'document',name:`submission-${op.id}.md`,mimeType:'text/markdown',bytes });
    return await transaction(async db => {
      const current = await lockDraft(db,actor,assignment);
      const intent = await findIntent(db,current.recipient_id,actor.student,snapshot.key,digest);
      if (intent?.state === 'committed' && intent.result_id) return receipt(intent.result_id);
      if (!intent || terminal(intent.state)) throw new DriveError('SUBMISSION_REJECTED',409);
      assertWritable(current);
      assertWriter(current,actor.student,snapshot,false);
      const verified = await db.query(`UPDATE garden.drive_objects SET lifecycle='referenced'
        WHERE id=$1 AND operation_id=$2 AND integrity='ok' AND lifecycle='candidate'`,[object,op.id]);
      if (!verified.rowCount) throw new DriveError('DRIVE_INTEGRITY',409);
      await db.query(`INSERT INTO garden.submissions(id,recipient_id,teacher_id,submission_no,operation_id,object_id,submitted_at)
        SELECT op.id,r.id,r.teacher_id,r.next_submission_no,op.id,$2,op.accepted_at FROM garden.operations op
        JOIN garden.recipients r ON r.id=op.target_id AND r.teacher_id=op.teacher_id WHERE op.id=$1`,[op.id,object]);
      await db.query('UPDATE garden.recipients SET next_submission_no=next_submission_no+1 WHERE id=$1',[current.recipient_id]);
      await db.query("UPDATE garden.operations SET state='committed',result_id=id,error_code=NULL WHERE id=$1",[op.id]);
      return receipt(op.id);
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'DRIVE_INTEGRITY' || ['SUBMISSION_REJECTED','STALE_WRITER','DRAFT_NOT_FOUND','DRAFT_READ_ONLY','FORBIDDEN'].includes(code ?? '')) {
      await rejectIntent(database(),op.id,code === 'DRIVE_INTEGRITY' ? 'INTEGRITY' : 'STALE').catch(() => {});
      throw new DriveError(code === 'DRIVE_INTEGRITY' ? code : 'SUBMISSION_REJECTED',409);
    }
    const prior = await database().query<Operation>(`SELECT ${columns} FROM garden.operations WHERE id=$1`,[op.id])
      .then(result => result.rows[0],() => undefined);
    if (prior?.state === 'committed' && prior.result_id) return receipt(prior.result_id);
    if (prior && terminal(prior.state)) throw new DriveError('SUBMISSION_REJECTED',409);
    if (error instanceof DriveError && error.status < 500) throw error;
    await database().query("UPDATE garden.operations SET state='unknown',error_code='TIMEOUT' WHERE id=$1 AND state IN ('reserved','unknown')",
      [op.id]).catch(() => {});
    return { state:'unknown' as const };
  }
}

export async function submissionIntent(actor: DraftActor, assignment: string, key: string, cancel = false) {
  return transaction(async db => {
    const row = await lockDraft(db,actor,assignment);
    const op = await findIntent(db,row.recipient_id,actor.student,key);
    if (!op) return { state:'missing' as const };
    if (op.state === 'committed' && op.result_id) return receipt(op.result_id);
    if (terminal(op.state)) return { state:'rejected' as const };
    if (!cancel) return { state:'pending' as const };
    await rejectIntent(db,op.id,'STALE');
    return { state:'rejected' as const };
  });
}

export async function submissionHistory(actor: DraftActor, assignment: string) {
  await draftVisible(actor,assignment);
  const submissions = await submissionTimings(actor.student,assignment);
  await draftVisible(actor,assignment);
  return { submissions };
}
