import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database } from '../db';
import { DriveError } from '../drive/provider';
import { assignmentDetails, lockAssignment, transaction, type AssignmentRow } from './access';

function published(row: AssignmentRow) {
  if (row.state !== 'published') throw new DriveError('ASSIGNMENT_DRAFT',409);
}

async function stopStudentWrites(db: PoolClient, assignment: string) {
  await db.query(`UPDATE garden.document_streams SET lease_epoch=lease_epoch+1,lease_actor_id=NULL,lease_session_id=NULL,lease_until=NULL
    WHERE id IN (SELECT sd.stream_id FROM garden.student_drafts sd JOIN garden.recipients r ON r.id=sd.recipient_id WHERE r.assignment_id=$1)
      AND lease_session_id IS NOT NULL`,[assignment]);
  await db.query(`WITH target AS (
    SELECT r.id AS recipient, draft.stream_id FROM garden.recipients r
    LEFT JOIN garden.student_drafts draft ON draft.recipient_id=r.id WHERE r.assignment_id=$1
  ), rejected AS (
    UPDATE garden.operations SET state='rejected',error_code='POLICY'
    WHERE ((kind='submit' AND target_kind='recipient' AND target_id IN (SELECT recipient FROM target)) OR
      (kind='autosave' AND target_kind='stream' AND target_id IN (SELECT stream_id FROM target)))
    AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
  ) UPDATE garden.drive_objects SET lifecycle='orphan'
  WHERE operation_id IN (SELECT id FROM rejected) AND lifecycle='candidate'`,[assignment]);
}

export async function changeAccepting(teacher: string, id: string, accepting: boolean, expectedVersion: string) {
  return transaction(async db => {
    const row = await lockAssignment(db,teacher,id);
    published(row);
    if (accepting && row.reference_public_at) throw new DriveError('REFERENCE_ALREADY_PUBLIC',409);
    if (row.accepting === accepting) return { accepting,version:row.version };
    if (row.version !== expectedVersion) throw new DriveError('ASSIGNMENT_CHANGED',409);
    if (!accepting) await stopStudentWrites(db,id);
    const updated = await db.query<{ version: string }>('UPDATE garden.assignments SET accepting=$2,version=version+1 WHERE id=$1 RETURNING version',[id,accepting]);
    return { accepting,version:updated.rows[0].version };
  });
}

export async function publishReference(teacher: string, id: string, expectedVersion: string) {
  const detail = await assignmentDetails(teacher,id);
  if (detail.state !== 'published' || detail.accepting) throw new DriveError('ASSIGNMENT_OPEN',409);
  if (!detail.reference?.trim()) throw new DriveError('REFERENCE_REQUIRED',422);
  return transaction(async db => {
    const row = await lockAssignment(db,teacher,id);
    published(row);
    if (row.accepting) throw new DriveError('ASSIGNMENT_OPEN',409);
    if (row.reference_public_at) return { publicAt:row.reference_public_at.toISOString(),version:row.version };
    if (row.version !== expectedVersion) throw new DriveError('ASSIGNMENT_CHANGED',409);
    if (!row.reference_object_id) throw new DriveError('REFERENCE_REQUIRED',422);
    const { rows } = await db.query<{ reference_public_at: Date; version: string }>(`UPDATE garden.assignments
      SET reference_public_at=now(),version=version+1 WHERE id=$1 RETURNING reference_public_at,version`,[id]);
    return { publicAt:rows[0].reference_public_at.toISOString(),version:rows[0].version };
  });
}

export async function extendDeadline(teacher: string, id: string, key: string, expectedVersion: string, dueAt: string | null) {
  const digest = createHash('sha256').update(JSON.stringify([id,expectedVersion,dueAt])).digest('hex');
  return transaction(async db => {
    const row = await lockAssignment(db,teacher,id);
    published(row);
    const prior = (await db.query<{ kind: string; target_id: string; request_digest: string }>(`
      SELECT kind,target_id,request_digest FROM garden.operations WHERE actor_id=$1 AND idempotency_key=$2`,[teacher,key])).rows[0];
    if (prior) {
      if (prior.kind !== 'extend_deadline' || prior.target_id !== id || prior.request_digest !== digest) throw new DriveError('KEY_REUSED',409);
      return { dueAt,version:(BigInt(expectedVersion)+1n).toString() };
    }
    if (row.version !== expectedVersion) throw new DriveError('ASSIGNMENT_CHANGED',409);
    if (!row.due_at || (dueAt && new Date(dueAt) <= row.due_at)) throw new DriveError('DEADLINE_NOT_EXTENDED',409);
    const { rows } = await db.query<{ id: string }>(`
      INSERT INTO garden.operations(actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version,state,result_id)
      VALUES($1,$1,'extend_deadline','assignment',$2,$3,$4,$5,'committed',$2) RETURNING id`,[teacher,id,key,digest,expectedVersion]);
    const updated = await db.query<{ version: string }>('UPDATE garden.assignments SET due_at=$2,version=version+1 WHERE id=$1 RETURNING version',[id,dueAt]);
    await db.query(`INSERT INTO garden.assignment_deadlines(assignment_id,revision,old_due_at,new_due_at,changed_by)
      SELECT $1,COALESCE(max(revision),0)+1,$2,$3,$4 FROM garden.assignment_deadlines WHERE assignment_id=$1`,[id,row.due_at,dueAt,teacher]);
    await db.query(`INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,operation_id,outcome)
      VALUES($1,'DEADLINE','assignment',$2,$3,'success')`,[teacher,id,rows[0].id]);
    await db.query(`INSERT INTO garden.notifications(user_id,teacher_id,event_operation_id,event_kind,target_kind,target_id)
      SELECT student_id,$2,$3,'deadline_extended','assignment',$1 FROM garden.recipients
      WHERE assignment_id=$1 AND garden.can_read_assignment(student_id,$1) ON CONFLICT DO NOTHING`,[id,teacher,rows[0].id]);
    return { dueAt,version:updated.rows[0].version };
  });
}

export async function submissionTimings(actor: string, assignment: string) {
  const { rows } = await database().query<{ id: string; submission_no: number; student_name: string; submitted_at: Date; late: boolean }>(`
    SELECT s.id,s.submission_no,student.display_name AS student_name,s.submitted_at,
      COALESCE(s.submitted_at>a.due_at,false) AS late FROM garden.submissions s
      JOIN garden.recipients r ON r.id=s.recipient_id JOIN garden.assignments a ON a.id=r.assignment_id
      JOIN garden.users student ON student.id=r.student_id
    WHERE a.id=$2 AND garden.can_read_submission($1,s.id)
    ORDER BY s.submitted_at,s.id`,[actor,assignment]);
  return rows.map(row => ({ id:row.id, number:row.submission_no, student:row.student_name,
    submittedAt:row.submitted_at.toISOString(), late:row.late }));
}
