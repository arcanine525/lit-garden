import type { PoolClient } from 'pg';

type ReplyScope = { teacher: string; classId?: string; student?: string } | { student: string };

export async function fenceReplyWrites(db: PoolClient, scope: ReplyScope) {
  const { teacher,classId } = 'teacher' in scope ? scope : { teacher:null,classId:null };
  await db.query(`WITH target AS (
    SELECT c.id,c.pending_reply_operation FROM garden.review_comments c JOIN garden.submissions s ON s.id=c.submission_id
    JOIN garden.recipients r ON r.id=s.recipient_id
    WHERE ($1::uuid IS NULL OR s.teacher_id=$1) AND ($2::uuid IS NULL OR r.class_id=$2)
      AND ($3::uuid IS NULL OR r.student_id=$3) AND c.pending_reply_operation IS NOT NULL
    ORDER BY c.id FOR UPDATE OF c
  ), rejected AS (
    UPDATE garden.operations op SET state='rejected',error_code='POLICY' FROM target
    WHERE op.id=target.pending_reply_operation AND op.kind='reply'
      AND op.state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING op.id
  ), unpinned AS (
    UPDATE garden.review_comments SET pending_reply_operation=NULL WHERE pending_reply_operation IN (SELECT id FROM rejected)
  ) UPDATE garden.drive_objects SET lifecycle='orphan'
    WHERE operation_id IN (SELECT id FROM rejected) AND lifecycle='candidate'`,[teacher,classId ?? null,scope.student ?? null]);
}

export async function fenceReviewWrites(db: PoolClient, teacher: string, classId?: string) {
  const values = [teacher,classId ?? null];
  const targets = `SELECT d.stream_id,s.id AS submission FROM garden.submissions s JOIN garden.recipients r ON r.id=s.recipient_id
    LEFT JOIN garden.review_drafts d ON d.submission_id=s.id WHERE s.teacher_id=$1 AND ($2::uuid IS NULL OR r.class_id=$2)`;
  await db.query(`WITH target AS (${targets}) UPDATE garden.document_streams SET lease_epoch=lease_epoch+1,
    lease_actor_id=NULL,lease_session_id=NULL,lease_until=NULL
    WHERE id IN (SELECT stream_id FROM target) AND lease_session_id IS NOT NULL`,values);
  await db.query(`WITH target AS (${targets}), rejected AS (
    UPDATE garden.operations SET state='rejected',error_code='POLICY'
    WHERE ((target_kind='stream' AND target_id IN (SELECT stream_id FROM target) AND kind IN ('autosave','publish_review')) OR
      (target_kind='submission' AND target_id IN (SELECT submission FROM target) AND kind='publish_review'))
    AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
  ) UPDATE garden.drive_objects SET lifecycle='orphan'
    WHERE operation_id IN (SELECT id FROM rejected) AND lifecycle='candidate'`,values);
  await fenceReplyWrites(db,{ teacher,classId });
}
