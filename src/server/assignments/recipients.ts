import type { PoolClient } from 'pg';

// Publication, reopening and roster changes use the same owner and class locks.
export async function grantRecipients(db: PoolClient, { teacher, classId, assignment, student }: {
  teacher: string; classId: string; assignment?: string; student?: string;
}) {
  await db.query(`WITH granted AS (
    INSERT INTO garden.recipients(assignment_id,teacher_id,class_id,student_id)
    SELECT a.id,a.teacher_id,a.class_id,m.student_id FROM garden.assignments a
    JOIN garden.memberships m ON m.class_id=a.class_id AND m.state='active'
    JOIN garden.users account ON account.id=m.student_id AND account.status='active'
    WHERE a.teacher_id=$1 AND a.class_id=$2 AND a.state='published' AND a.accepting
      AND ($3::uuid IS NULL OR a.id=$3) AND ($4::uuid IS NULL OR m.student_id=$4)
    ON CONFLICT (assignment_id,student_id) DO NOTHING RETURNING assignment_id,teacher_id,student_id
  ) INSERT INTO garden.notifications(user_id,teacher_id,event_operation_id,event_kind,target_kind,target_id)
    SELECT g.student_id,g.teacher_id,prompt.operation_id,'assigned','assignment',g.assignment_id FROM granted g
    JOIN garden.assignments a ON a.id=g.assignment_id
    JOIN garden.drive_objects prompt ON prompt.id=a.prompt_object_id AND prompt.teacher_id=g.teacher_id
    ON CONFLICT DO NOTHING`,[teacher,classId,assignment ?? null,student ?? null]);
}
