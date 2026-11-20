import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database } from '../db';
import { DriveError } from '../drive/provider';
import { pinCandidates, prepareWorkspace, storeCandidate } from '../drive/storage';
import { validateEditorDraft } from '../drive/assignment-assets';
import type { Rubric } from '../rubrics/definition';
import { assignmentDraft, assignmentForActor, assertDriveReady, lockAssignment, lockNewAssignment,
  transaction, type AssignmentRow } from './access';
import { assignmentFiles, encodeAssignment, type AssignmentDraft } from './bundle';
import { grantRecipients } from './recipients';

type Writer = { clientId: string; epoch: string };
type Snapshot = Writer & { key: string; baseVersion: string };
type Operation = { id: string; state: string; kind: string; target_id: string; request_digest: string };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function currentRubric(db: PoolClient, id: string, revision: number) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text,2155))',[id]);
  const { rows } = await db.query<Rubric>(`SELECT id,revision,label,definition,retired FROM garden.rubric_templates
    WHERE id=$1 ORDER BY revision DESC LIMIT 1`,[id]);
  if (!rows[0] || rows[0].retired || rows[0].revision !== revision) throw new DriveError('RUBRIC_CHANGED',409);
  return rows[0];
}

export async function createAssignment(teacher: string, id: string, classId: string, rubricId: string, revision: number) {
  return transaction(async db => {
    await lockNewAssignment(db,teacher,classId);
    await assertDriveReady(db,teacher);
    const current = await db.query(`SELECT 1 FROM garden.assignments WHERE id=$1 AND teacher_id=$2 AND class_id=$3`,[id,teacher,classId]);
    if (current.rowCount) return { id };
    await currentRubric(db,rubricId,revision);
    const stream = await db.query<{ id: string }>("INSERT INTO garden.document_streams(teacher_id,kind) VALUES($1,'assignment') RETURNING id",[teacher]);
    const created = await db.query(`INSERT INTO garden.assignments(id,teacher_id,class_id,draft_stream_id,rubric_template_id,rubric_template_revision)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,[id,teacher,classId,stream.rows[0].id,rubricId,revision]);
    if (!created.rowCount) throw new DriveError('DRAFT_CHANGED',409);
    return { id };
  });
}

function expectDraft(row: AssignmentRow) {
  if (row.state !== 'draft') throw new DriveError('ASSIGNMENT_PUBLISHED',409);
}

function actorOwnsLease(row: AssignmentRow, teacher: string, writer: Writer, needLive = true) {
  if (row.lease_actor_id !== teacher || row.lease_session_id !== writer.clientId ||
      row.lease_epoch !== writer.epoch || (needLive && !row.lease_live)) throw new DriveError('STALE_WRITER',409);
}

async function fenceDraft(db: PoolClient, id: string) {
  await db.query(`WITH rejected AS (
    UPDATE garden.operations SET state='rejected',error_code='STALE'
      WHERE target_kind='assignment' AND target_id=$1 AND kind IN ('autosave','assign')
      AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
    ) UPDATE garden.drive_objects SET lifecycle='orphan' WHERE operation_id IN (SELECT id FROM rejected) AND lifecycle='candidate'`,[id]);
}

export async function assignmentLease(teacher: string, id: string, clientId: string, action: 'acquire' | 'takeover' | 'renew' | 'release', epoch?: string) {
  return transaction(async db => {
    const row = await lockAssignment(db,teacher,id);
    expectDraft(row);
    const owned = row.lease_actor_id === teacher && row.lease_session_id === clientId;
    if (action === 'release') {
      actorOwnsLease(row,teacher,{ clientId,epoch: epoch ?? '' },false);
      await fenceDraft(db,id);
      await db.query(`UPDATE garden.document_streams SET lease_actor_id=NULL,lease_session_id=NULL,lease_until=NULL,
        lease_epoch=lease_epoch+1 WHERE id=$1`,[row.draft_stream_id]);
      return { released: true };
    }
    await assertDriveReady(db,teacher);
    if (action === 'renew') actorOwnsLease(row,teacher,{ clientId,epoch: epoch ?? '' });
    if (action === 'acquire' && row.lease_live && !owned) throw new DriveError('LEASE_HELD',423);
    const advance = !row.lease_live || !owned;
    if (advance) await fenceDraft(db,id);
    const { rows } = await db.query<{ epoch: string; until: Date }>(`UPDATE garden.document_streams SET lease_actor_id=$2,
      lease_session_id=$3,lease_epoch=lease_epoch + CASE WHEN $4 THEN 1 ELSE 0 END,lease_until=clock_timestamp()+interval '60 seconds'
      WHERE id=$1 RETURNING lease_epoch AS epoch, lease_until AS until`,[row.draft_stream_id,teacher,clientId,advance]);
    if (action === 'takeover' && advance) await db.query(`INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,outcome)
      VALUES($1,'LEASE_TAKEOVER','assignment',$2,'success')`,[teacher,id]);
    return { epoch: rows[0].epoch, until: rows[0].until.toISOString() };
  });
}

async function knownOperation(db: Pick<PoolClient,'query'>, teacher: string, id: string, kind: 'autosave' | 'assign', key: string, digest: string) {
  const { rows } = await db.query<Operation>(`SELECT id,state,kind,target_id,request_digest FROM garden.operations
    WHERE actor_id=$1 AND idempotency_key=$2`,[teacher,key]);
  const original = rows[0];
  if (!original) return null;
  if (original.kind !== kind || original.target_id !== id || original.request_digest !== digest) throw new DriveError('KEY_REUSED',409);
  if (original.state === 'rejected' || original.state === 'cleanup') throw new DriveError('STALE_WRITER',409);
  return original;
}

async function reserve(db: PoolClient, row: AssignmentRow, kind: 'autosave' | 'assign', data: Snapshot, digest: string) {
  const old = await knownOperation(db,row.teacher_id,row.id,kind,data.key,digest);
  if (old?.state === 'committed') return old;
  expectDraft(row);
  actorOwnsLease(row,row.teacher_id,data,!old || kind === 'autosave');
  if (row.draft_version !== data.baseVersion) throw new DriveError('DRAFT_CHANGED',409);
  await assertDriveReady(db,row.teacher_id);
  if (old) return old;
  const { rows } = await db.query<Operation>(`INSERT INTO garden.operations(actor_id,teacher_id,kind,target_kind,target_id,
      idempotency_key,request_digest,expected_version,lease_epoch,client_session_id)
    VALUES($1,$1,$2,'assignment',$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING
    RETURNING id,state,kind,target_id,request_digest`,[row.teacher_id,kind,row.id,data.key,digest,data.baseVersion,data.epoch,data.clientId]);
  if (!rows[0]) throw new DriveError('OP_IN_PROGRESS',409);
  return { ...rows[0], isNew: true as const };
}

async function uncertain(operation: Operation, error: unknown) {
  if (error instanceof DriveError && error.status < 500) {
    if (['FORBIDDEN','CLASS_INACTIVE','ASSIGNMENT_PUBLISHED','STALE_WRITER','DRAFT_CHANGED','DRIVE_INTEGRITY'].includes(error.code)) {
      await database().query(`WITH rejected AS (
        UPDATE garden.operations SET state='rejected',error_code=$2 WHERE id=$1
          AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
      ) UPDATE garden.drive_objects SET lifecycle='orphan' WHERE operation_id IN (SELECT id FROM rejected) AND lifecycle='candidate'`,
      [operation.id,error.code === 'DRIVE_INTEGRITY' ? 'INTEGRITY' : 'POLICY']).catch(() => {});
    }
    throw error;
  }
  await database().query(`UPDATE garden.operations SET state='unknown',error_code='TIMEOUT'
    WHERE id=$1 AND state IN ('reserved','writing','unknown')`,[operation.id]).catch(() => {});
  return { state: 'unknown' as const, operationId: operation.id };
}

export async function saveAssignment(teacher: string, id: string, snapshot: Snapshot, draft: AssignmentDraft) {
  await assignmentForActor(teacher,id);
  await Promise.all([draft.prompt,draft.material,draft.reference].map(markdown => validateEditorDraft(teacher,'teacher',markdown,id)));
  const digest = sha(JSON.stringify([snapshot.clientId,snapshot.epoch,snapshot.baseVersion,draft]));
  const generation = (BigInt(snapshot.baseVersion)+1n).toString();
  const bytes = encodeAssignment('garden.assignment-draft/1',id,{ draft,generation });
  const context = await transaction(async db => {
    const row = await lockAssignment(db,teacher,id);
    const op = await reserve(db,row,'autosave',snapshot,digest);
    if (op.state !== 'committed' && (row.rubric_template_id !== draft.rubricId || row.rubric_template_revision !== draft.rubricRevision)) {
      await currentRubric(db,draft.rubricId,draft.rubricRevision);
    }
    return { row,op };
  });
  const result = { state:'committed' as const, id, draftVersion:generation, hash: sha(bytes) };
  if (context.op.state === 'committed') return result;
  try {
    const workspace = await prepareWorkspace(teacher,{ classId: context.row.class_id, assignmentId:id });
    const candidate = await storeCandidate(workspace,{ operationId: context.op.id, slot:'document',
      name: `draft-g${generation}-${context.op.id}.md`, mimeType:'text/markdown', bytes });
    return await transaction(async db => {
      const row = await lockAssignment(db,teacher,id);
      const op = await knownOperation(db,teacher,id,'autosave',snapshot.key,digest);
      if (op?.state === 'committed') return result;
      expectDraft(row);
      actorOwnsLease(row,teacher,snapshot);
      await assertDriveReady(db,teacher);
      if (row.draft_version !== snapshot.baseVersion) throw new DriveError('DRAFT_CHANGED',409);
      await db.query("UPDATE garden.drive_objects SET lifecycle='referenced' WHERE id=$1 AND integrity='ok'",[candidate]);
      await db.query('UPDATE garden.document_streams SET version=$2,head_object_id=$3 WHERE id=$1',[row.draft_stream_id,generation,candidate]);
      await db.query(`UPDATE garden.assignments SET rubric_template_id=$2,rubric_template_revision=$3 WHERE id=$1`,[id,draft.rubricId,draft.rubricRevision]);
      await db.query("UPDATE garden.operations SET state='committed',result_id=$2,error_code=NULL WHERE id=$1",[context.op.id,candidate]);
      return result;
    });
  } catch (error) { return uncertain(context.op,error); }
}

export async function publishAssignment(teacher: string, id: string, snapshot: Snapshot, expectedHash: string) {
  const digest = sha(JSON.stringify([snapshot.clientId,snapshot.epoch,snapshot.baseVersion,expectedHash]));
  const result = { state:'committed' as const, id };
  const visible = await assignmentForActor(teacher,id);
  const existing = await knownOperation(database(),teacher,id,'assign',snapshot.key,digest);
  if (existing?.state === 'committed') return result;
  expectDraft(visible);
  const { draft, hash } = await assignmentDraft(visible);
  if (!hash || hash !== expectedHash || visible.draft_version !== snapshot.baseVersion) throw new DriveError('DRAFT_CHANGED',409);
  if (!draft.title || !draft.prompt.trim()) throw new DriveError('PROMPT_REQUIRED',422);
  const [prompt,material,reference] = await Promise.all([draft.prompt,draft.material,draft.reference].map(
    markdown => validateEditorDraft(teacher,'teacher',markdown,id)));
  const context = await transaction(async db => {
    const row = await lockAssignment(db,teacher,id);
    const op = await reserve(db,row,'assign',snapshot,digest);
    if (op.state === 'committed') return { row,op,rubric:null };
    if (row.head_object_id !== visible.head_object_id) throw new DriveError('DRAFT_CHANGED',409);
    const rubric = 'isNew' in op ? await currentRubric(db,draft.rubricId,draft.rubricRevision) :
      (await db.query<Rubric>(`SELECT * FROM garden.rubric_templates WHERE id=$1 AND revision=$2`,
        [draft.rubricId,draft.rubricRevision])).rows[0];
    if (!rubric) throw new DriveError('RUBRIC_CHANGED',409);
    return { row,op,rubric };
  });
  if (!context.rubric) return result;
  try {
    const workspace = await prepareWorkspace(teacher,{ classId:context.row.class_id, assignmentId:id });
    const files = assignmentFiles(id,context.op.id,draft,context.rubric);
    await pinCandidates(workspace,files);
    const written: Partial<Record<'prompt'|'reference'|'rubric',string>> = {};
    for (const file of files) written[file.slot] = await storeCandidate(workspace,file);
    return await transaction(async db => {
      const row = await lockAssignment(db,teacher,id);
      const op = await knownOperation(db,teacher,id,'assign',snapshot.key,digest);
      if (op?.state === 'committed') return result;
      expectDraft(row);
      actorOwnsLease(row,teacher,snapshot,false);
      await assertDriveReady(db,teacher);
      if (row.draft_version !== snapshot.baseVersion || row.head_object_id !== visible.head_object_id) throw new DriveError('DRAFT_CHANGED',409);
      await db.query(`UPDATE garden.drive_objects SET lifecycle='referenced' WHERE id=ANY($1::uuid[]) AND integrity='ok'`,[Object.values(written)]);
      await db.query(`UPDATE garden.assignment_assets SET document_part=CASE
        WHEN asset_id=ANY($2::uuid[]) AND asset_id=ANY($3::uuid[]) THEN 'both'
        WHEN asset_id=ANY($2::uuid[]) THEN 'prompt' WHEN asset_id=ANY($3::uuid[]) THEN 'reference' ELSE 'staged' END
        WHERE assignment_id=$1`,[id,[...new Set([...prompt.assets,...material.assets])],reference.assets]);
      await db.query(`UPDATE garden.assignments SET state='published',accepting=true,published_at=(SELECT accepted_at FROM garden.operations WHERE id=$2),
        prompt_object_id=$3,reference_object_id=$4,rubric_object_id=$5,due_at=$6,version=version+1 WHERE id=$1`,
        [id,context.op.id,written.prompt,written.reference ?? null,written.rubric,draft.dueAt ?? null]);
      await grantRecipients(db,{ teacher,classId:row.class_id,assignment:id });
      await db.query(`UPDATE garden.document_streams SET lease_actor_id=NULL,lease_session_id=NULL,lease_until=NULL,lease_epoch=lease_epoch+1 WHERE id=$1`,[row.draft_stream_id]);
      await db.query("UPDATE garden.operations SET state='committed',result_id=$2,error_code=NULL WHERE id=$1",[context.op.id,id]);
      return result;
    });
  } catch (error) { return uncertain(context.op,error); }
}
