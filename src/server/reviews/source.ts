import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { projectMarkdown } from '../../../prototypes/editor/src/markdown.js';
import { assignmentReviewContext } from '../assignments/access';
import { database } from '../db';
import { decodeDocument } from '../drive/envelope';
import { DriveError } from '../drive/provider';
import { readSubmissionFile, verifyReviewSource } from '../drive/submission-integrity';

type Submission = { id: string; teacher_id: string; assignment_id: string; class_id: string; class_name: string; student_id: string; student_name: string;
  recipient_id: string; submission_no: number; current_publication_id: string | null };

export async function submissionForReader(db: PoolClient | ReturnType<typeof database>, actor: string, id: string) {
  const { rows } = await db.query<Submission>(`SELECT s.id,s.teacher_id,r.assignment_id,r.class_id,c.name AS class_name,r.student_id,
    student.display_name AS student_name,r.id AS recipient_id,s.submission_no,s.current_publication_id FROM garden.submissions s
    JOIN garden.recipients r ON r.id=s.recipient_id JOIN garden.classes c ON c.id=r.class_id
    JOIN garden.users student ON student.id=r.student_id
    WHERE s.id=$1 AND garden.can_read_submission($2,s.id)`,[id,actor]);
  if (!rows[0]) throw new DriveError('NOT_FOUND',404);
  return rows[0];
}

export async function reviewSubmission(db: PoolClient | ReturnType<typeof database>, teacher: string, id: string) {
  const submission = await submissionForReader(db,teacher,id);
  if (submission.teacher_id !== teacher) throw new DriveError('NOT_FOUND',404);
  return submission;
}

async function loadSource(actor: string, submission: Submission, verified: ReturnType<typeof readSubmissionFile>) {
  const id = submission.id;
  const [file,assignment] = await Promise.all([verified,assignmentReviewContext(actor,submission.assignment_id)]);
  const { fields,body:markdown } = decodeDocument<{ assignmentId: string; recipientId: string; explanation: string }>(file.bytes,'garden.submission/1',id);
  if (fields.assignmentId !== submission.assignment_id || fields.recipientId !== submission.recipient_id || typeof fields.explanation !== 'string') {
    throw new DriveError('DRIVE_INTEGRITY',409);
  }
  const { text, projection } = projectMarkdown(markdown);
  return { submission,...assignment,markdown,explanation:fields.explanation,textProjection:projection,text,
    submissionSha256:file.submissionSha256,projectionSha256:createHash('sha256').update(text).digest('hex') };
}

export async function reviewSource(teacher: string, id: string) {
  const submission = await reviewSubmission(database(),teacher,id);
  return loadSource(teacher,submission,verifyReviewSource(teacher,id));
}

export async function publicationSource(actor: string, submission: Submission) {
  return loadSource(actor,submission,readSubmissionFile(actor,submission.id));
}

export type ReviewSource = Awaited<ReturnType<typeof reviewSource>>;

export async function reviewQueue(teacher: string, waitingOnly = false, limit?: number) {
  const { rows } = await database().query<{ id: string; assignment_id: string; class_name: string; student_name: string;
    submission_no: number; latest: boolean; grading: boolean; returned: boolean; integrity: string }>(`
    SELECT s.id,r.assignment_id,c.name AS class_name,student.display_name AS student_name,s.submission_no,
      s.id=latest.id AS latest,stream.head_object_id IS NOT NULL AS grading,s.current_publication_id IS NOT NULL AS returned,o.integrity
    FROM garden.submissions s JOIN garden.recipients r ON r.id=s.recipient_id
    JOIN garden.latest_submission_metadata latest ON latest.recipient_id=r.id
    JOIN garden.classes c ON c.id=r.class_id JOIN garden.users student ON student.id=r.student_id
    JOIN garden.drive_objects o ON o.id=s.object_id
    LEFT JOIN garden.review_drafts draft ON draft.submission_id=s.id
    LEFT JOIN garden.document_streams stream ON stream.id=draft.stream_id
    WHERE s.teacher_id=$1 AND garden.can_read_submission($1,s.id)
      AND (NOT $2::boolean OR (c.state='active' AND s.id=latest.id AND s.current_publication_id IS NULL))
    ORDER BY (s.current_publication_id IS NULL) DESC, (s.id=latest.id) DESC,s.submitted_at DESC,s.id LIMIT $3`,[teacher,waitingOnly,limit ?? null]);
  return rows;
}
