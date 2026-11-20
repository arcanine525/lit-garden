import type { PoolClient } from 'pg';

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
}
