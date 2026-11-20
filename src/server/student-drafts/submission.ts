import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from '../assignments/access';
import { submissionTimings } from '../assignments/lifecycle';
import { database } from '../db';
import { validateEditorDraft } from '../drive/assignment-assets';
import { encodeDocument } from '../drive/envelope';
import { DriveError } from '../drive/provider';
import { DriveObjectReadError, prepareWorkspace, readVerifiedObject, storeCandidate, type DriveObject } from '../drive/storage';
import { draftVisible, lockDraft, type DraftActor, type DraftBody } from './access';
import { assertWritable, assertWriter, type Snapshot } from './writer';

type Operation = { id: string; state: string; target_kind: string; kind: string; target_id: string;
  request_digest: string; accepted_at: Date; result_id: string | null; client_session_id: string | null; lease_epoch: string | null;
  error_code: string | null };
const columns = 'id,state,target_kind,kind,target_id,request_digest,accepted_at,result_id,client_session_id,lease_epoch,error_code';
const terminal = (state: string) => state === 'rejected' || state === 'cleanup';

async function findIntent(db: PoolClient | ReturnType<typeof database>, recipient: string, student: string, key: string, digest?: string) {
  const op = (await db.query<Operation>(`SELECT ${columns} FROM garden.operations WHERE actor_id=$1 AND idempotency_key=$2`,
    [student,key])).rows[0];
  if (op && (op.kind !== 'submit' || op.target_kind !== 'recipient' || op.target_id !== recipient || (digest && digest !== op.request_digest))) {
    throw new DriveError('KEY_REUSED',409);
  }
  return op;
}

async function verifyPinnedSubmission(teacher: string, operation: string) {
  const { rows:[object] } = await database().query<DriveObject>(`SELECT * FROM garden.drive_objects
    WHERE operation_id=$1 AND teacher_id=$2 AND slot='document' AND slot_index=0 AND lifecycle='candidate'`,[operation,teacher]);
  if (!object) return null;
  try {
    const file = await readVerifiedObject(object);
    return { id:object.id,version:file.version };
  } catch (error) {
    // A Drive 404 can hide a late upload or temporarily inaccessible file.
    if (error instanceof DriveError && error.code === 'DRIVE_MISSING') return null;
    throw error;
  }
}

async function finalizeSubmission(actor: DraftActor, assignment: string, key: string, operation: string, candidate: string,
  readBack?: { version: string | null }) {
  return transaction(async db => {
    const current = await lockDraft(db,actor,assignment);
    const intent = await findIntent(db,current.recipient_id,actor.student,key);
    if (intent?.state === 'committed' && intent.result_id) return receipt(intent.result_id);
    if (!intent || intent.id !== operation || terminal(intent.state) || !intent.client_session_id || intent.lease_epoch === null) {
      throw new DriveError('SUBMISSION_REJECTED',409);
    }
    assertWritable(current);
    assertWriter(current,actor.student,{ clientId:intent.client_session_id,epoch:intent.lease_epoch },false);
    const verified = await db.query(`UPDATE garden.drive_objects SET lifecycle='referenced',integrity='ok',
      verified_drive_version=CASE WHEN $3 THEN $4 ELSE verified_drive_version END,
      checked_at=CASE WHEN $3 THEN now() ELSE checked_at END
      WHERE id=$1 AND operation_id=$2 AND lifecycle='candidate' AND ($3 OR integrity='ok')`,
    [candidate,operation,Boolean(readBack),readBack?.version ?? null]);
    if (!verified.rowCount) throw new DriveError('DRIVE_INTEGRITY',409);
    await db.query(`INSERT INTO garden.submissions(id,recipient_id,teacher_id,submission_no,operation_id,object_id,submitted_at)
      SELECT op.id,r.id,r.teacher_id,r.next_submission_no,op.id,$2,op.accepted_at FROM garden.operations op
      JOIN garden.recipients r ON r.id=op.target_id AND r.teacher_id=op.teacher_id WHERE op.id=$1`,[operation,candidate]);
    await db.query('UPDATE garden.recipients SET next_submission_no=next_submission_no+1 WHERE id=$1',[current.recipient_id]);
    await db.query("UPDATE garden.operations SET state='committed',result_id=id,error_code=NULL WHERE id=$1",[operation]);
    return receipt(operation);
  });
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
    const readBack = await verifyPinnedSubmission(row.teacher_id,op.id);
    if (readBack) return await finalizeSubmission(actor,assignment,snapshot.key,op.id,readBack.id,readBack);
    const workspace = await prepareWorkspace(row.teacher_id,{ classId:row.class_id,assignmentId:assignment,studentId:actor.student });
    const object = await storeCandidate(workspace,{ operationId:op.id,slot:'document',name:`submission-${op.id}.md`,mimeType:'text/markdown',bytes });
    return await finalizeSubmission(actor,assignment,snapshot.key,op.id,object);
  } catch (error) {
    const code = (error as { code?: string }).code;
    const integrity = code === 'DRIVE_INTEGRITY' && !(error instanceof DriveObjectReadError && error.integrity === 'unavailable');
    if (integrity || ['SUBMISSION_REJECTED','STALE_WRITER','DRAFT_NOT_FOUND','DRAFT_READ_ONLY','FORBIDDEN'].includes(code ?? '')) {
      await rejectIntent(database(),op.id,integrity ? 'INTEGRITY' : 'STALE').catch(() => {});
      throw new DriveError(integrity ? 'DRIVE_INTEGRITY' : 'SUBMISSION_REJECTED',409);
    }
    const prior = await database().query<Operation>(`SELECT ${columns} FROM garden.operations WHERE id=$1`,[op.id])
      .then(result => result.rows[0],() => undefined);
    if (prior?.state === 'committed' && prior.result_id) return receipt(prior.result_id);
    if (prior && terminal(prior.state)) throw new DriveError('SUBMISSION_REJECTED',409);
    const issue = code === 'DRIVE_QUOTA' ? 'QUOTA' : code === 'DRIVE_RECONNECT' || code === 'DRIVE_SETUP_REQUIRED' ? 'AUTH' :
      code === 'DRIVE_FORBIDDEN' || error instanceof DriveObjectReadError ? 'FORBIDDEN' : null;
    if (!issue && error instanceof DriveError && error.status < 500) throw error;
    await database().query(`UPDATE garden.operations SET state='unknown',error_code=$2
      WHERE id=$1 AND state IN ('reserved','unknown','needs_client')`,[op.id,issue ?? 'TIMEOUT']).catch(() => {});
    if (issue) return { state:'unknown' as const,issue };
    return { state:'unknown' as const };
  }
}

export async function submissionIntent(actor: DraftActor, assignment: string, key: string, cancel = false) {
  const located = await transaction(async db => {
    const row = await lockDraft(db,actor,assignment);
    const op = await findIntent(db,row.recipient_id,actor.student,key);
    if (!op) return { state:'missing' as const };
    if (op.state === 'committed' && op.result_id) return receipt(op.result_id);
    if (terminal(op.state)) return { state:'rejected' as const };
    if (!cancel) return { state:'pending' as const,op,row };
    await rejectIntent(db,op.id,'STALE');
    return { state:'rejected' as const };
  });
  if (located.state !== 'pending') return located;
  const { op,row } = located;
  try {
    const verified = await verifyPinnedSubmission(row.teacher_id,op.id);
    if (verified) return await finalizeSubmission(actor,assignment,key,op.id,verified.id,verified);
  } catch (error) {
    if (error instanceof DriveObjectReadError && error.integrity === 'conflict') await rejectIntent(database(),op.id,'INTEGRITY');
    if (error instanceof DriveError && ['DRAFT_NOT_FOUND','DRAFT_READ_ONLY','STALE_WRITER'].includes(error.code)) {
      await rejectIntent(database(),op.id,'STALE');
    }
  }
  await draftVisible(actor,assignment);
  const current = await findIntent(database(),row.recipient_id,actor.student,key);
  if (current?.state === 'committed' && current.result_id) return receipt(current.result_id);
  if (!current || terminal(current.state)) return { state:'rejected' as const };
  const issue = current.error_code;
  return issue && ['AUTH','QUOTA','FORBIDDEN'].includes(issue) ? { state:'pending' as const,issue } : { state:'pending' as const };
}

export async function submissionHistory(actor: DraftActor, assignment: string) {
  await draftVisible(actor,assignment);
  const submissions = await submissionTimings(actor.student,assignment);
  await draftVisible(actor,assignment);
  return { submissions };
}
