import type { PoolClient } from 'pg';
import { database } from '../db';
import { DriveError } from '../drive/provider';
import { readVerifiedObject, type DriveObject } from '../drive/storage';
import { decodeAssignment, draftInput, type AssignmentDraft, type AssignmentPrompt, type RubricSnapshot } from './bundle';

export type AssignmentRow = {
  id: string; teacher_id: string; class_id: string; class_name: string; teacher_name: string;
  class_state: 'active' | 'archived';
  state: 'draft' | 'published'; accepting: boolean; due_at: Date | null; reference_public_at: Date | null;
  rubric_template_id: string; rubric_template_revision: number; draft_stream_id: string;
  prompt_object_id: string | null; reference_object_id: string | null; rubric_object_id: string | null;
  head_object_id: string | null; draft_version: string; lease_actor_id: string | null; lease_session_id: string | null;
  lease_epoch: string; lease_live: boolean; version: string;
};

const overview = `SELECT a.*, c.name AS class_name, c.state AS class_state, t.display_name AS teacher_name,
  ds.head_object_id,ds.version AS draft_version,ds.lease_actor_id,ds.lease_session_id,ds.lease_epoch,
  COALESCE(ds.lease_until>clock_timestamp(),false) AS lease_live
  FROM garden.assignments a JOIN garden.classes c ON c.id=a.class_id
  JOIN garden.users t ON t.id=a.teacher_id JOIN garden.document_streams ds ON ds.id=a.draft_stream_id`;

export async function assignmentForActor(actor: string, id: string) {
  const { rows } = await database().query<AssignmentRow>(`${overview} WHERE a.id=$1 AND garden.can_read_assignment($2,a.id)`, [id,actor]);
  if (!rows[0]) throw new DriveError('ASSIGNMENT_NOT_FOUND',404);
  return rows[0];
}

export async function listAssignments(actor: string) {
  const { rows } = await database().query<AssignmentRow>(`${overview} WHERE garden.can_read_assignment($1,a.id)
    ORDER BY a.published_at DESC NULLS FIRST, a.id`,[actor]);
  const entries = [];
  for (const row of rows) {
    const objectId = row.state === 'draft' ? row.head_object_id : row.prompt_object_id;
    let title = '';
    let unavailable = false;
    if (objectId) {
      try {
        const file = await assignmentObject(row.teacher_id,objectId);
        const schema = row.state === 'draft' ? 'garden.assignment-draft/1' : 'garden.assignment-prompt/1';
        title = decodeAssignment<{ title: string }>(file.bytes,schema,row.id).title;
      } catch { unavailable = true; }
    }
    try { await assignmentForActor(actor,row.id); }
    catch (error) { if (error instanceof DriveError && error.status === 404) continue; throw error; }
    entries.push({ id: row.id, classId: row.class_id, className: row.class_name, teacherName: row.teacher_name,
      state: row.state, accepting: row.accepting, title, unavailable, dueAt: row.due_at?.toISOString() ?? null });
  }
  return entries;
}

async function assignmentObject(teacher: string, id: string) {
  const { rows } = await database().query<DriveObject>(`SELECT * FROM garden.drive_objects WHERE id=$1 AND teacher_id=$2
    AND mime_type='text/markdown' AND lifecycle='referenced'`,[id,teacher]);
  if (!rows[0]) throw new DriveError('DRIVE_MISSING',404);
  return { ...await readVerifiedObject(rows[0]), hash: rows[0].expected_sha256 };
}

export async function assignmentDraft(row: AssignmentRow) {
  if (row.state !== 'draft') throw new DriveError('ASSIGNMENT_PUBLISHED',409);
  if (!row.head_object_id) return { hash: null, draft: { title: '', prompt: '', material: '', reference: '', scale: '2.00',
    rubricId: row.rubric_template_id, rubricRevision: row.rubric_template_revision } satisfies AssignmentDraft };
  const file = await assignmentObject(row.teacher_id,row.head_object_id);
  const { draft, generation } = decodeAssignment<{ draft: unknown; generation: string }>(file.bytes,'garden.assignment-draft/1',row.id);
  if (generation !== row.draft_version) throw new DriveError('DRIVE_INTEGRITY',409);
  return { hash: file.hash, draft: draftInput(draft) };
}

export async function assignmentDetails(actor: string, id: string) {
  const row = await assignmentForActor(actor,id);
  const info = { id, classId: row.class_id, className: row.class_name, classState: row.class_state, teacherName: row.teacher_name,
    accepting: row.accepting, version: row.version, dueAt: row.due_at?.toISOString() ?? null,
    referencePublicAt: row.reference_public_at?.toISOString() ?? null };
  if (row.state === 'draft') {
    const draft = await assignmentDraft(row);
    const next = await assignmentForActor(actor,id);
    if (next.state !== 'draft' || next.draft_version !== row.draft_version) throw new DriveError('DRAFT_CHANGED',409);
    return { ...info, ...draft, state: 'draft' as const, draftVersion: row.draft_version };
  }
  if (!row.prompt_object_id || !row.rubric_object_id) throw new DriveError('DRIVE_MISSING',404);
  const readsReference = async () => Boolean((await database().query<{ allowed: boolean }>(
    'SELECT garden.can_read_reference($1,$2) AS allowed',[actor,id])).rows[0]?.allowed);
  const [prompt, snapshot, reference] = await Promise.all([
    assignmentObject(row.teacher_id,row.prompt_object_id), assignmentObject(row.teacher_id,row.rubric_object_id),
    row.reference_object_id && await readsReference() ? assignmentObject(row.teacher_id,row.reference_object_id) : null
  ]);
  const decoded = decodeAssignment<Omit<RubricSnapshot,'id'> & { assignmentId: string }>(snapshot.bytes,
    'garden.rubric-snapshot/1',row.rubric_template_id);
  if (decoded.assignmentId !== id || decoded.revision !== row.rubric_template_revision) throw new DriveError('DRIVE_INTEGRITY',409);
  const { assignmentId: _, ...rubric } = decoded;
  const final = await assignmentForActor(actor,id);
  return { ...info, accepting:final.accepting, version:final.version, classState:final.class_state,
    dueAt:final.due_at?.toISOString() ?? null, referencePublicAt:final.reference_public_at?.toISOString() ?? null,
    state: 'published' as const, prompt: decodeAssignment<AssignmentPrompt>(prompt.bytes,'garden.assignment-prompt/1',id),
    rubric: { id: row.rubric_template_id, ...rubric }, rubricHash: snapshot.hash,
    reference: reference && await readsReference() ? decodeAssignment<{ reference: string }>(reference.bytes,'garden.assignment-reference/1',id).reference : null };
}

export async function transaction<T>(run: (db: PoolClient) => Promise<T>) {
  const db = await database().connect();
  try {
    await db.query('BEGIN');
    const result = await run(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function lockTeacher(db: PoolClient, teacher: string) {
  const actor = await db.query("SELECT 1 FROM garden.users WHERE id=$1 AND role='teacher' AND status='active' FOR UPDATE",[teacher]);
  if (!actor.rowCount) throw new DriveError('FORBIDDEN',403);
}

async function lockClass(db: PoolClient, teacher: string, classId: string) {
  const classroom = await db.query("SELECT 1 FROM garden.classes WHERE id=$1 AND teacher_id=$2 AND state='active' FOR UPDATE",[classId,teacher]);
  if (!classroom.rowCount) throw new DriveError('CLASS_INACTIVE',409);
}

export async function lockNewAssignment(db: PoolClient, teacher: string, classId: string) {
  await lockTeacher(db,teacher);
  await lockClass(db,teacher,classId);
}

export async function lockAssignment(db: PoolClient, teacher: string, id: string) {
  await lockTeacher(db,teacher);
  const located = (await db.query<{ class_id: string }>('SELECT class_id FROM garden.assignments WHERE id=$1 AND teacher_id=$2',[id,teacher])).rows[0];
  if (!located) throw new DriveError('ASSIGNMENT_NOT_FOUND',404);
  await lockClass(db,teacher,located.class_id);
  const locked = (await db.query<AssignmentRow>(`${overview} WHERE a.id=$1 AND a.teacher_id=$2 FOR UPDATE OF a,ds`,[id,teacher])).rows[0];
  if (!locked) throw new DriveError('ASSIGNMENT_NOT_FOUND',404);
  return locked;
}

export async function assertDriveReady(db: PoolClient, teacher: string) {
  const result = await db.query("SELECT 1 FROM garden.drive_connections WHERE teacher_id=$1 AND state='ready'",[teacher]);
  if (!result.rowCount) throw new DriveError('DRIVE_SETUP_REQUIRED',409);
}
