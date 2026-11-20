import { assignmentForActor, assignmentReviewContext } from '../assignments/access';
import { database } from '../db';
import { DriveError } from '../drive/provider';
import { readSubmissionFile } from '../drive/submission-integrity';
import { verifiedPublication } from './publications';
import type { submissionForReader } from './source';

type GradeRow = Awaited<ReturnType<typeof submissionForReader>> & { submitted_at: Date };

async function gradeRows(teacher: string, assignment?: string) {
  const { rows } = await database().query<GradeRow>(`
    SELECT s.id,s.teacher_id,s.submission_no,s.submitted_at,s.current_publication_id,r.assignment_id,r.student_id,r.class_id,
      r.id AS recipient_id,c.name AS class_name,student.display_name AS student_name
    FROM garden.submissions s JOIN garden.recipients r ON r.id=s.recipient_id
    JOIN garden.classes c ON c.id=r.class_id JOIN garden.users student ON student.id=r.student_id
    WHERE s.teacher_id=$1 AND garden.can_read_submission($1,s.id) AND ($2::uuid IS NULL OR r.assignment_id=$2)
    ORDER BY c.name,r.assignment_id,student.display_name,r.student_id,s.submission_no`,[teacher,assignment ?? null]);
  return rows;
}

function csvCell(value: string) {
  const safe = /^[\t\r\n]|^[\s\u200B-\u200D]*[=+@\-＝＋＠－]/u.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"','""') + '"';
}

export async function gradebook(teacher: string, assignment?: string) {
  if (assignment) await assignmentForActor(teacher,assignment);
  const snapshot = await gradeRows(teacher,assignment);
  const table = [['Học sinh','Lớp','Bài giao','Lần nộp','Thời điểm nộp','Trạng thái','Điểm','Thang điểm']];
  const assignments = new Map<string,Awaited<ReturnType<typeof assignmentReviewContext>>>();
  for (const row of snapshot) {
    let context = assignments.get(row.assignment_id);
    const returned = row.current_publication_id ? await verifiedPublication(teacher,row) : null;
    if (!returned) {
      await readSubmissionFile(teacher,row.id);
      context ??= await assignmentReviewContext(teacher,row.assignment_id);
      assignments.set(row.assignment_id,context);
    }
    const { title,rubric } = returned?.publication ?? context!;
    table.push([row.student_name,row.class_name,title,String(row.submission_no),row.submitted_at.toISOString(),
      returned ? 'Đã trả' : 'Chờ chấm',returned ? returned.publication.total.toFixed(2) : '',rubric.scale]);
  }
  const current = await gradeRows(teacher,assignment);
  if (JSON.stringify(current) !== JSON.stringify(snapshot)) throw new DriveError('GRADEBOOK_CHANGED',409);
  return '\uFEFF' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
