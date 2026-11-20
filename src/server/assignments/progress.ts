import { database } from '../db';
import { uuidPattern } from '../auth/identity-operations';
import { featuredLibrary } from '../library/items';
import { listAssignments, type AssignmentFilters } from './access';

export type ProgressQuery = { class?: string | string[]; teacher?: string | string[] };
type Assignment = Awaited<ReturnType<typeof listAssignments>>[number];

export function progressFilters(query: ProgressQuery): AssignmentFilters {
  const readId = (value: string | string[] | undefined) =>
    typeof value === 'string' && uuidPattern.test(value) ? value.toLowerCase() : undefined;
  return { classId:readId(query.class),teacherId:readId(query.teacher) };
}

export function assignmentStage(item: Assignment) {
  if (item.submissionId) return item.returned ? 'fruit' : 'flower';
  return item.accepting && item.classState === 'active' ? 'sprout' : 'closed';
}

async function studentClasses(student: string) {
  const { rows } = await database().query<{ id: string; name: string; teacherId: string; teacherName: string }>(`
    SELECT c.id,c.name,t.id AS "teacherId",t.display_name AS "teacherName"
    FROM garden.memberships m JOIN garden.classes c ON c.id=m.class_id
    JOIN garden.users t ON t.id=c.teacher_id JOIN garden.users s ON s.id=m.student_id
    WHERE m.student_id=$1 AND s.role='student' AND s.status='active' AND m.state='active' AND c.state='active'
    ORDER BY c.name,c.id`,[student]);
  return rows;
}

export async function studentProgress(student: string, filters: AssignmentFilters, showFeatured: boolean) {
  const [items,featured] = await Promise.all([
    listAssignments(student,filters),showFeatured ? featuredLibrary(student,filters.classId,filters.teacherId) : []
  ]);
  const classes = await studentClasses(student);
  const current = new Set(classes.map(room => room.id));
  const assignments = items.filter(item => current.has(item.classId));
  const counts = { sprout:0,flower:0,fruit:0 };
  for (const item of assignments) {
    const stage = assignmentStage(item);
    if (stage !== 'closed') counts[stage]++;
  }
  return { classes,assignments,counts,featured:featured.filter(item => current.has(item.classId)) };
}
