import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { lockAssignment, transaction } from '../assignments/access';
import { database } from '../db';
import { decodeDocument, encodeDocument } from '../drive/envelope';
import { DriveError } from '../drive/provider';
import { prepareWorkspace, readVerifiedObject, storeCandidate, type DriveObject } from '../drive/storage';
import { inspectMarkdown } from '../../shared/editor-markdown';
import { submissionForReader } from './source';

type Actor = { id: string; sessionDigest: string };
type Db = PoolClient | ReturnType<typeof database>;
export type ReplySnapshot = { key: string; publicationId: string; commentDigest: string; body: string };
type Operation = { id: string; target_kind: string; target_id: string; kind: string; request_digest: string;
  state: string; result_id: string | null; accepted_at: Date };
const receipt = (id: string) => ({ state:'committed' as const,id });
const rejected = (op: Operation) => op.state === 'rejected' || op.state === 'cleanup';

async function threadContext(db: Db, actor: string, id: string, comment: string) {
  const submission = await submissionForReader(db,actor,id);
  const { rows } = await db.query<{ publication_id: string; comment_digest: string; frozen_digest: string | null;
    pending_reply_operation: string | null; writable: boolean }>(`SELECT p.publication_id,p.comment_digest,c.frozen_digest,c.pending_reply_operation,
      garden.can_reply_submission($3,s.id) AS writable FROM garden.submissions s
    JOIN garden.publication_comments p ON p.publication_id=s.current_publication_id AND p.submission_id=s.id
    JOIN garden.review_comments c ON c.id=p.comment_id AND c.submission_id=s.id
    WHERE s.id=$1 AND c.id=$2 AND garden.can_read_submission($3,s.id)`,[id,comment,actor]);
  if (!rows[0]) throw new DriveError('NOT_FOUND',404);
  return { ...rows[0],submission };
}

async function lockThread(db: PoolClient, actor: Actor, id: string, comment: string) {
  const source = await submissionForReader(db,actor.id,id);
  await lockAssignment(db,source.teacher_id,source.assignment_id);
  if (actor.id !== source.teacher_id) await db.query('SELECT id FROM garden.users WHERE id=$1 FOR UPDATE',[actor.id]);
  const authenticated = await db.query(`SELECT 1 FROM garden.app_sessions s JOIN garden.users u ON u.id=s.user_id
    WHERE s.handle_digest=$1 AND s.user_id=$2 AND s.auth_epoch=u.auth_epoch AND s.expires_at>now()`,[actor.sessionDigest,actor.id]);
  if (!authenticated.rowCount) throw new DriveError('UNAUTHENTICATED',401);
  await db.query('SELECT 1 FROM garden.memberships WHERE class_id=$1 AND student_id=$2 FOR UPDATE',[source.class_id,source.student_id]);
  await db.query('SELECT id FROM garden.recipients WHERE id=$1 FOR UPDATE',[source.recipient_id]);
  await db.query('SELECT id FROM garden.submissions WHERE id=$1 FOR UPDATE',[id]);
  await db.query('SELECT id FROM garden.review_comments WHERE id=$1 AND submission_id=$2 FOR UPDATE',[comment,id]);
  return threadContext(db,actor.id,id,comment);
}

async function lookupOperation(db: Db, actor: string, comment: string, key: string, fingerprint?: string) {
  const { rows:[op] } = await db.query<Operation>('SELECT * FROM garden.operations WHERE actor_id=$1 AND idempotency_key=$2',[actor,key]);
  if (op && (op.kind !== 'reply' || op.target_kind !== 'comment' || op.target_id !== comment ||
      (fingerprint && fingerprint !== op.request_digest))) throw new DriveError('KEY_REUSED',409);
  return op;
}

async function rejectReply(db: PoolClient, operation: string, comment: string, reason: 'POLICY' | 'STALE' | 'INTEGRITY') {
  await db.query(`WITH rejected AS (UPDATE garden.operations SET state='rejected',error_code=$3
    WHERE id=$1 AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
  ), unpinned AS (UPDATE garden.review_comments SET pending_reply_operation=NULL WHERE id=$2
    AND pending_reply_operation IN (SELECT id FROM rejected))
  UPDATE garden.drive_objects SET lifecycle='orphan' WHERE operation_id IN (SELECT id FROM rejected) AND lifecycle='candidate'`,
    [operation,comment,reason]);
}

function messageBody(input: string) {
  if (!input.trim() || input.length > 3000 || input.includes('\u0000')) throw new DriveError('INVALID_REPLY',422);
  try { inspectMarkdown(input,'student'); }
  catch { throw new DriveError('INVALID_REPLY',422); }
  return input;
}

export async function sendReply(actor: Actor, id: string, comment: string, snapshot: ReplySnapshot) {
  const body = messageBody(snapshot.body);
  const fingerprint = createHash('sha256').update(JSON.stringify([id,comment,snapshot.publicationId,snapshot.commentDigest,body])).digest('hex');
  await threadContext(database(),actor.id,id,comment);
  const previous = await lookupOperation(database(),actor.id,comment,snapshot.key,fingerprint);
  if (previous?.state === 'committed' && previous.result_id) return receipt(previous.result_id);
  if (previous && rejected(previous)) throw new DriveError('REPLY_REJECTED',409);
  const { target,op } = await transaction(async db => {
    const current = await lockThread(db,actor,id,comment);
    const existing = await lookupOperation(db,actor.id,comment,snapshot.key,fingerprint);
    if (existing?.state === 'committed' && existing.result_id) return { target:current.submission,op:existing };
    if (existing && rejected(existing)) throw new DriveError('REPLY_REJECTED',409);
    if (!current.writable) throw new DriveError('REPLY_READ_ONLY',409);
    if (current.comment_digest !== snapshot.commentDigest || (!existing && current.publication_id !== snapshot.publicationId)) {
      throw new DriveError('PUBLICATION_CHANGED',409);
    }
    if (existing && current.pending_reply_operation === existing.id) return { target:current.submission,op:existing };
    if (existing || current.pending_reply_operation) throw new DriveError('OP_IN_PROGRESS',409);
    const { rows } = await db.query<Operation>(`INSERT INTO garden.operations
      (actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version)
      VALUES($1,$2,'reply','comment',$3,$4,$5,0) ON CONFLICT DO NOTHING RETURNING *`,
      [actor.id,current.submission.teacher_id,comment,snapshot.key,fingerprint]);
    if (!rows[0]) throw new DriveError('OP_IN_PROGRESS',409);
    await db.query('UPDATE garden.review_comments SET pending_reply_operation=$2 WHERE id=$1',[comment,rows[0].id]);
    return { target:current.submission,op:rows[0] };
  });
  if (op.state === 'committed' && op.result_id) return receipt(op.result_id);
  const bytes = encodeDocument('garden.message/1',op.id,{ submissionId:id,commentId:comment,authorId:actor.id,
    acceptedAt:op.accepted_at.toISOString() },body);
  try {
    const workspace = await prepareWorkspace(target.teacher_id,{ classId:target.class_id,assignmentId:target.assignment_id,
      studentId:target.student_id,reviewSubmission:id });
    const candidate = await storeCandidate(workspace,{ operationId:op.id,slot:'message',name:`message-${op.id}.md`,mimeType:'text/markdown',bytes });
    return await transaction(async db => {
      const current = await lockThread(db,actor,id,comment);
      const again = await lookupOperation(db,actor.id,comment,snapshot.key,fingerprint);
      if (again?.state === 'committed' && again.result_id) return receipt(again.result_id);
      if (!again || rejected(again) || current.pending_reply_operation !== again.id) throw new DriveError('REPLY_REJECTED',409);
      if (!current.writable) throw new DriveError('REPLY_READ_ONLY',409);
      if (current.comment_digest !== snapshot.commentDigest || (current.frozen_digest && current.frozen_digest !== snapshot.commentDigest)) {
        throw new DriveError('PUBLICATION_CHANGED',409);
      }
      const ready = await db.query(`UPDATE garden.drive_objects SET lifecycle='referenced' WHERE id=$1 AND operation_id=$2
        AND integrity='ok' AND lifecycle='candidate'`,[candidate,op.id]);
      if (!ready.rowCount) throw new DriveError('REPLY_REJECTED',409);
      await db.query(`INSERT INTO garden.conversation_messages(id,comment_id,submission_id,teacher_id,author_id,operation_id,object_id,message_no,sent_at)
        SELECT op.id,$2,$3,op.teacher_id,op.actor_id,op.id,$4,
          (SELECT COALESCE(max(message_no),0)+1 FROM garden.conversation_messages WHERE comment_id=$2),op.accepted_at
        FROM garden.operations op WHERE op.id=$1`,[op.id,comment,id,candidate]);
      await db.query('UPDATE garden.review_comments SET frozen_digest=$2,pending_reply_operation=NULL WHERE id=$1',[comment,snapshot.commentDigest]);
      await db.query(`INSERT INTO garden.notifications(user_id,teacher_id,event_operation_id,event_kind,target_kind,target_id)
        VALUES($1,$2,$3,'reply','comment',$4)`,[actor.id === target.student_id ? target.teacher_id : target.student_id,target.teacher_id,op.id,comment]);
      await db.query("UPDATE garden.operations SET state='committed',result_id=id,error_code=NULL WHERE id=$1",[op.id]);
      return receipt(op.id);
    });
  } catch (error) {
    if (error instanceof DriveError && error.status < 500 && !['DRIVE_RECONNECT','DRIVE_SETUP_REQUIRED','DRIVE_FORBIDDEN'].includes(error.code)) {
      await transaction(async db => {
        await db.query('SELECT id FROM garden.review_comments WHERE id=$1 FOR UPDATE',[comment]);
        await rejectReply(db,op.id,comment,error.code === 'DRIVE_INTEGRITY' ? 'INTEGRITY' : 'POLICY');
      });
      throw error;
    }
    const current = await lookupOperation(database(),actor.id,comment,snapshot.key,fingerprint).catch(() => undefined);
    if (current?.state === 'committed' && current.result_id) return receipt(current.result_id);
    if (current && rejected(current)) throw new DriveError('REPLY_REJECTED',409);
    await database().query("UPDATE garden.operations SET state='unknown',error_code='TIMEOUT' WHERE id=$1 AND state IN ('reserved','unknown')",[op.id]).catch(() => {});
    return { state:'unknown' as const };
  }
}

export async function cancelReply(actor: Actor, id: string, comment: string, key: string) {
  await threadContext(database(),actor.id,id,comment);
  return transaction(async db => {
    await lockThread(db,actor,id,comment);
    const op = await lookupOperation(db,actor.id,comment,key);
    if (!op) return { state:'missing' as const };
    if (op.state === 'committed' && op.result_id) return receipt(op.result_id);
    if (!rejected(op)) await rejectReply(db,op.id,comment,'STALE');
    return { state:'rejected' as const };
  });
}

type Message = DriveObject & { message_id: string; author_id: string; author_name: string; author_role: string; sent_at: Date };

export async function readThread(actor: string, id: string, comment: string) {
  await threadContext(database(),actor,id,comment);
  const { rows } = await database().query<Message>(`SELECT o.*,m.id AS message_id,m.author_id,u.display_name AS author_name,u.role AS author_role,m.sent_at
    FROM garden.conversation_messages m JOIN garden.drive_objects o ON o.id=m.object_id AND o.teacher_id=m.teacher_id
    JOIN garden.users u ON u.id=m.author_id WHERE m.submission_id=$1 AND m.comment_id=$2
      AND o.lifecycle='referenced' AND o.slot='message' AND o.mime_type='text/markdown' ORDER BY m.message_no`,[id,comment]);
  const messages = [];
  for (const row of rows) {
    const metadata = { id:row.message_id,author:row.author_name,role:row.author_role,sentAt:row.sent_at.toISOString() };
    try {
      const file = await readVerifiedObject(row);
      const { fields,body } = decodeDocument<Record<string,unknown>>(file.bytes,'garden.message/1',row.message_id);
      if (fields.submissionId !== id || fields.commentId !== comment || fields.authorId !== row.author_id || fields.acceptedAt !== metadata.sentAt) {
        throw new DriveError('DRIVE_INTEGRITY',409);
      }
      messages.push({ ...metadata,body:messageBody(body) });
    } catch { messages.push({ ...metadata,body:null }); }
  }
  const current = await threadContext(database(),actor,id,comment);
  return { publicationId:current.publication_id,commentDigest:current.comment_digest,writable:current.writable,
    locked:!!current.frozen_digest,pending:!!current.pending_reply_operation,messages };
}
