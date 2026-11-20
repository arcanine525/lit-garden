import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database } from '../db';
import { transaction } from '../assignments/access';
import { validateEditorDraft } from '../drive/assignment-assets';
import { encodeDocument } from '../drive/envelope';
import { DriveError } from '../drive/provider';
import { prepareWorkspace, storeCandidate } from '../drive/storage';
import { maxMarkdownBytes } from '../../shared/editor-markdown';
import { lockDraft, type Context, type DraftActor, type DraftBody } from './access';

export type Writer = { clientId: string; epoch: string };
export type Snapshot = Writer & { key: string; baseVersion: string };
type Operation = { id: string; state: string; kind: string; target_id: string; request_digest: string };
const checksum = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function studentDraftInput(input: unknown) {
  if (!input || typeof input !== 'object') throw new DriveError('INVALID_DRAFT',422);
  const body = input as Record<string,unknown>;
  if (Object.keys(body).some(key => key !== 'markdown' && key !== 'explanation') || typeof body.markdown !== 'string' ||
      typeof body.explanation !== 'string' || body.explanation.includes('\u0000')) throw new DriveError('INVALID_DRAFT',422);
  if (Buffer.byteLength(body.markdown) + Buffer.byteLength(JSON.stringify(body.explanation)) > maxMarkdownBytes) {
    throw new DriveError('MARKDOWN_SIZE',422);
  }
  return { markdown:body.markdown, explanation:body.explanation };
}

export function assertWritable(row: Context): asserts row is Context & { stream_id: string; version: string } {
  if (!row.can_write || !row.stream_id || !row.version) throw new DriveError('DRAFT_READ_ONLY',409);
}

export function assertWriter(row: Context, actor: string, writer: Writer, live = true) {
  if (row.lease_actor_id !== actor || row.lease_session_id !== writer.clientId ||
      row.lease_epoch !== writer.epoch || (live && !row.lease_live)) throw new DriveError('STALE_WRITER',409);
}

async function fencePending(db: PoolClient, row: Context) {
  await db.query(`WITH obsolete AS (
    UPDATE garden.operations SET state='rejected',error_code='STALE'
    WHERE ((kind='autosave' AND target_kind='stream' AND target_id=$1) OR
           (kind='submit' AND target_kind='recipient' AND target_id=$2))
       AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
  ) UPDATE garden.drive_objects SET lifecycle='orphan' WHERE lifecycle='candidate' AND operation_id IN (SELECT id FROM obsolete)`,
  [row.stream_id,row.recipient_id]);
}

export async function studentLease(actor: DraftActor, assignment: string, action: 'acquire' | 'renew' | 'release' | 'takeover',
  clientId: string, epoch?: string) {
  return transaction(async db => {
    const row = await lockDraft(db,actor,assignment,action === 'acquire' || action === 'takeover');
    if (action === 'release') {
      assertWriter(row,actor.student,{ clientId,epoch:epoch ?? '' },false);
      await fencePending(db,row);
      await db.query(`UPDATE garden.document_streams SET lease_epoch=lease_epoch+1,lease_actor_id=NULL,
        lease_session_id=NULL,lease_until=NULL WHERE id=$1`,[row.stream_id]);
      return { released:true };
    }
    assertWritable(row);
    const owns = row.lease_actor_id === actor.student && row.lease_session_id === clientId;
    if (action === 'renew') assertWriter(row,actor.student,{ clientId,epoch:epoch ?? '' });
    if (action === 'acquire' && row.lease_live && !owns) throw new DriveError('LEASE_HELD',423);
    const advance = !row.lease_live || !owns;
    if (advance) await fencePending(db,row);
    const { rows } = await db.query<{ epoch: string; until: Date }>(`
      UPDATE garden.document_streams SET lease_actor_id=$2,lease_session_id=$3,
        lease_epoch=lease_epoch+CASE WHEN $4 THEN 1 ELSE 0 END,lease_until=clock_timestamp()+interval '60 seconds'
      WHERE id=$1 RETURNING lease_epoch AS epoch,lease_until AS until`,[row.stream_id,actor.student,clientId,advance]);
    if (action === 'takeover' && advance) await db.query(`INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,outcome)
      VALUES($1,'LEASE_TAKEOVER','stream',$2,'success')`,[actor.student,row.stream_id]);
    return { epoch:rows[0].epoch, until:rows[0].until.toISOString(), version:row.version };
  });
}

async function findOperation(db: PoolClient, actor: string, stream: string, key: string, fingerprint: string) {
  const { rows } = await db.query<Operation>(`SELECT id,state,kind,target_id,request_digest FROM garden.operations
    WHERE actor_id=$1 AND idempotency_key=$2`,[actor,key]);
  const found = rows[0];
  if (!found) return null;
  if (found.kind !== 'autosave' || found.target_id !== stream || found.request_digest !== fingerprint) throw new DriveError('KEY_REUSED',409);
  if (found.state === 'rejected' || found.state === 'cleanup') throw new DriveError('STALE_WRITER',409);
  return found;
}

async function reserve(db: PoolClient, actor: DraftActor, assignment: string, snapshot: Snapshot, body: DraftBody) {
  const row = await lockDraft(db,actor,assignment);
  if (!row.stream_id) throw new DriveError('DRAFT_READ_ONLY',409);
  const fingerprint = checksum(JSON.stringify([assignment,snapshot.clientId,snapshot.epoch,snapshot.baseVersion,body]));
  const previous = await findOperation(db,actor.student,row.stream_id,snapshot.key,fingerprint);
  if (previous?.state === 'committed') return { row,op:previous,fingerprint };
  assertWritable(row);
  assertWriter(row,actor.student,snapshot);
  if (row.version !== snapshot.baseVersion) throw new DriveError('DRAFT_CHANGED',409);
  if (previous) return { row,op:previous,fingerprint };
  const { rows } = await db.query<Operation>(`
    INSERT INTO garden.operations(actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version,lease_epoch,client_session_id)
    VALUES($1,$2,'autosave','stream',$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id,state,kind,target_id,request_digest`,
    [actor.student,row.teacher_id,row.stream_id,snapshot.key,fingerprint,snapshot.baseVersion,snapshot.epoch,snapshot.clientId]);
  if (!rows[0]) throw new DriveError('OP_IN_PROGRESS',409);
  return { row,op:rows[0],fingerprint };
}

export async function saveStudentDraft(actor: DraftActor, assignment: string, snapshot: Snapshot, body: DraftBody) {
  await validateEditorDraft(actor.student,'student',body.markdown);
  const { row,op,fingerprint } = await transaction(db => reserve(db,actor,assignment,snapshot,body));
  const generation = (BigInt(snapshot.baseVersion)+1n).toString();
  const bytes = encodeDocument('garden.student-draft/1',row.recipient_id,{ assignmentId:assignment,generation,explanation:body.explanation },body.markdown);
  const result = { state:'committed' as const, version:generation, hash:checksum(bytes) };
  if (op.state === 'committed') return result;
  try {
    const workspace = await prepareWorkspace(row.teacher_id,{ classId:row.class_id,assignmentId:assignment,studentId:actor.student });
    const candidate = await storeCandidate(workspace,{ operationId:op.id,slot:'document',name:
      `draft-g${generation}-${op.id}.md`,mimeType:'text/markdown',bytes });
    return await transaction(async db => {
      const current = await lockDraft(db,actor,assignment);
      if (current.stream_id !== row.stream_id) throw new DriveError('DRAFT_CHANGED',409);
      const pending = await findOperation(db,actor.student,current.stream_id!,snapshot.key,fingerprint);
      if (pending?.state === 'committed') return result;
      assertWritable(current);
      assertWriter(current,actor.student,snapshot);
      if (current.version !== snapshot.baseVersion) throw new DriveError('DRAFT_CHANGED',409);
      await db.query('SELECT garden.commit_draft_head($1,$2,$3,$4,$5,$6)',
        [current.stream_id,actor.student,snapshot.clientId,snapshot.epoch,snapshot.baseVersion,candidate]);
      await db.query("UPDATE garden.operations SET state='committed',result_id=$2,error_code=NULL WHERE id=$1",[op.id,candidate]);
      return result;
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (['DRAFT_CHANGED','DRAFT_READ_ONLY','DRAFT_NOT_FOUND','STALE_WRITER','DRIVE_INTEGRITY','40001'].includes(code ?? '')) {
      await database().query(`WITH rejected AS (
        UPDATE garden.operations SET state='rejected',error_code=$2
          WHERE id=$1 AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
      ) UPDATE garden.drive_objects SET lifecycle='orphan'
        WHERE lifecycle='candidate' AND operation_id IN (SELECT id FROM rejected)`,
      [op.id,code === 'DRIVE_INTEGRITY' ? 'INTEGRITY' : 'STALE']).catch(() => {});
      throw new DriveError(code === 'DRIVE_INTEGRITY' ? code : 'STALE_WRITER',409);
    }
    if (error instanceof DriveError && error.status < 500) throw error;
    const state = await database().query<{ state: string }>(`WITH waiting AS (
      UPDATE garden.operations SET state='unknown',error_code='TIMEOUT' WHERE id=$1 AND state IN ('reserved','unknown') RETURNING state
    ) SELECT state FROM waiting UNION ALL SELECT state FROM garden.operations WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM waiting)`,
    [op.id]).then(query => query.rows[0]?.state,() => undefined);
    if (state === 'committed') return result;
    if (state === 'rejected' || state === 'cleanup') throw new DriveError('STALE_WRITER',409);
    return { state:'unknown' as const,operationId:op.id };
  }
}
