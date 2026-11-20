import type { PoolClient } from 'pg';
import { database } from '../db';
import { DriveError } from '../drive/provider';
import { readVerifiedObject, type DriveObject } from '../drive/storage';
import { decodeDocument } from '../drive/envelope';

export type DraftActor = { student: string; sessionDigest: string };
export type DraftBody = { markdown: string; explanation: string };
export type Context = {
  assignment_id: string; recipient_id: string; class_id: string; teacher_id: string;
  can_write: boolean; stream_id: string | null; head_object_id: string | null; version: string | null;
  lease_actor_id: string | null; lease_session_id: string | null; lease_epoch: string | null;
  lease_live: boolean;
};

async function queryContext(db: PoolClient | ReturnType<typeof database>, actor: DraftActor, assignment: string) {
  const { rows } = await db.query<Context>(`SELECT r.assignment_id,r.id AS recipient_id,r.class_id,r.teacher_id,
    garden.can_write_recipient(r.student_id,r.id) AS can_write,d.stream_id,ds.head_object_id,ds.version,
    ds.lease_actor_id,ds.lease_session_id,ds.lease_epoch,COALESCE(ds.lease_until>clock_timestamp(),false) AS lease_live
    FROM garden.recipients r JOIN garden.memberships m ON m.class_id=r.class_id AND m.student_id=r.student_id AND m.state='active'
    JOIN garden.app_sessions session ON session.user_id=r.student_id JOIN garden.users student ON student.id=r.student_id
    LEFT JOIN garden.student_drafts d ON d.recipient_id=r.id LEFT JOIN garden.document_streams ds ON ds.id=d.stream_id
    WHERE r.assignment_id=$1 AND r.student_id=$2 AND student.role='student' AND student.status='active'
      AND session.handle_digest=$3 AND session.auth_epoch=student.auth_epoch AND session.expires_at>now()
      AND garden.can_read_assignment($2,r.assignment_id)`,[assignment,actor.student,actor.sessionDigest]);
  if (!rows[0]) throw new DriveError('DRAFT_NOT_FOUND',404);
  return rows[0];
}

export async function draftVisible(actor: DraftActor, assignment: string) {
  await queryContext(database(),actor,assignment);
}

export async function lockDraft(db: PoolClient, actor: DraftActor, assignment: string, initialize = false) {
  const located = await queryContext(db,actor,assignment);
  await db.query('SELECT id FROM garden.users WHERE id=$1 FOR UPDATE',[located.teacher_id]);
  await db.query('SELECT id FROM garden.classes WHERE id=$1 FOR UPDATE',[located.class_id]);
  await db.query('SELECT id FROM garden.assignments WHERE id=$1 FOR UPDATE',[assignment]);
  await db.query('SELECT 1 FROM garden.memberships WHERE class_id=$1 AND student_id=$2 FOR UPDATE',[located.class_id,actor.student]);
  await db.query('SELECT id FROM garden.recipients WHERE id=$1 FOR UPDATE',[located.recipient_id]);
  let current = await queryContext(db,actor,assignment);
  if (initialize && !current.stream_id && current.can_write) {
    const made = await db.query<{ id: string }>("INSERT INTO garden.document_streams(teacher_id,kind) VALUES($1,'student') RETURNING id",[located.teacher_id]);
    await db.query('INSERT INTO garden.student_drafts(recipient_id,teacher_id,stream_id) VALUES($1,$2,$3)',
      [located.recipient_id,located.teacher_id,made.rows[0].id]);
    current = await queryContext(db,actor,assignment);
  }
  if (current.stream_id) {
    await db.query('SELECT id FROM garden.document_streams WHERE id=$1 FOR UPDATE',[current.stream_id]);
    return queryContext(db,actor,assignment);
  }
  return current;
}

export async function readDraft(actor: DraftActor, assignment: string) {
  const row = await queryContext(database(),actor,assignment);
  let draft: DraftBody = { markdown:'', explanation:'' };
  let hash = null;
  if (row.head_object_id) {
    const { rows } = await database().query<DriveObject>(`SELECT * FROM garden.drive_objects WHERE id=$1 AND teacher_id=$2
      AND slot='document' AND mime_type='text/markdown' AND lifecycle='referenced'`,[row.head_object_id,row.teacher_id]);
    if (!rows[0]) throw new DriveError('DRIVE_MISSING',404);
    const file = await readVerifiedObject(rows[0]);
    const { fields, body } = decodeDocument<{ generation: string; explanation: string; assignmentId: string }>(
      file.bytes,'garden.student-draft/1',row.recipient_id);
    if (fields.generation !== row.version || fields.assignmentId !== assignment || typeof fields.explanation !== 'string') {
      throw new DriveError('DRIVE_INTEGRITY',409);
    }
    draft = { markdown:body, explanation:fields.explanation };
    hash = rows[0].expected_sha256;
  }
  const current = await queryContext(database(),actor,assignment);
  if (current.head_object_id !== row.head_object_id) throw new DriveError('DRAFT_CHANGED',409);
  return { draft, hash, version:current.version ?? '0', writable:current.can_write, leased:current.lease_live };
}
