import type { PoolClient } from 'pg';

type Scope = { teacher: string; classId?: string; assignment?: string; student?: string } | { student: string };

export async function fenceStudentWrites(db: PoolClient, scope: Scope) {
  const { teacher, classId, assignment } = 'teacher' in scope ? scope : { teacher:null,classId:null,assignment:null };
  const values = [teacher,classId ?? null,assignment ?? null,scope.student ?? null];
  const targets = `SELECT r.id AS recipient,d.stream_id FROM garden.recipients r
    LEFT JOIN garden.student_drafts d ON d.recipient_id=r.id
    WHERE ($1::uuid IS NULL OR r.teacher_id=$1) AND ($2::uuid IS NULL OR r.class_id=$2)
      AND ($3::uuid IS NULL OR r.assignment_id=$3) AND ($4::uuid IS NULL OR r.student_id=$4)`;
  await db.query(`WITH target AS (${targets}), locked AS (
      SELECT ds.id FROM garden.document_streams ds JOIN target ON target.stream_id=ds.id
      WHERE ds.lease_session_id IS NOT NULL ORDER BY ds.id FOR UPDATE OF ds
    ) UPDATE garden.document_streams SET lease_epoch=lease_epoch+1,lease_actor_id=NULL,lease_session_id=NULL,lease_until=NULL
      WHERE id IN (SELECT id FROM locked)`,values);
  await db.query(`WITH target AS (${targets}), rejected AS (
    UPDATE garden.operations SET state='rejected',error_code='POLICY'
    WHERE ((kind='submit' AND target_kind='recipient' AND target_id IN (SELECT recipient FROM target)) OR
      (kind='autosave' AND target_kind='stream' AND target_id IN (SELECT stream_id FROM target)))
    AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
  ) UPDATE garden.drive_objects SET lifecycle='orphan'
    WHERE operation_id IN (SELECT id FROM rejected) AND lifecycle='candidate'`,values);
}
