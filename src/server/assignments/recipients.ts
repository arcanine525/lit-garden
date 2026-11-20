import type { PoolClient } from 'pg';

// The caller holds the owner and class locks for the membership transition.
export async function grantOpenAssignments(db: PoolClient, teacher: string, classId: string, student: string) {
  await db.query(`WITH granted AS (
    INSERT INTO garden.recipients(assignment_id,teacher_id,class_id,student_id)
    SELECT a.id,a.teacher_id,a.class_id,$3 FROM garden.assignments a
    JOIN garden.memberships m ON m.class_id=a.class_id AND m.student_id=$3 AND m.state='active'
    JOIN garden.users student ON student.id=m.student_id AND student.status='active'
    WHERE a.teacher_id=$1 AND a.class_id=$2 AND a.state='published' AND a.accepting
    ON CONFLICT (assignment_id,student_id) DO NOTHING RETURNING assignment_id,teacher_id,student_id
  ) INSERT INTO garden.notifications(user_id,teacher_id,event_operation_id,event_kind,target_kind,target_id)
    SELECT g.student_id,g.teacher_id,prompt.operation_id,'assigned','assignment',g.assignment_id FROM granted g
    JOIN garden.assignments a ON a.id=g.assignment_id
    JOIN garden.drive_objects prompt ON prompt.id=a.prompt_object_id AND prompt.teacher_id=g.teacher_id
    ON CONFLICT DO NOTHING`,[teacher,classId,student]);
}
