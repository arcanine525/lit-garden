import type { PoolClient } from 'pg';
import { database } from '../db';
import { DriveError } from './provider';
import { DriveObjectReadError, readVerifiedObject, type DriveObject } from './storage';

type Integrity = 'ok' | 'conflict' | 'missing' | 'unavailable';
type Source = DriveObject & { inspection_started_at: string };
class SubmissionReadError extends DriveError {
  constructor(public readonly integrity: Exclude<Integrity,'ok'>, error: unknown) {
    // A bare provider 404 may mean Drive no longer grants the app access.
    const mapped = error instanceof DriveError && error.code !== 'DRIVE_MISSING' ? error :
      integrity === 'missing' ? new DriveError('DRIVE_MISSING',404) : new DriveError('DRIVE_UNAVAILABLE',503);
    super(mapped.code,mapped.status);
  }
}

async function submissionObject(actor: string, id: string, asset?: string) {
  const { rows } = await database().query<Source>(`
    SELECT object.*,clock_timestamp()::text AS inspection_started_at FROM garden.submissions sub
    LEFT JOIN garden.submission_assets link ON link.submission_id=sub.id AND link.asset_id=$3
    JOIN garden.drive_objects object ON object.teacher_id=sub.teacher_id AND
      (($3::uuid IS NULL AND object.id=sub.object_id AND object.slot='document' AND object.mime_type='text/markdown') OR
       ($3::uuid IS NOT NULL AND object.id=link.asset_id AND object.slot='asset' AND object.mime_type IN ('image/png','image/jpeg','image/webp')))
    WHERE sub.id=$2 AND object.lifecycle='referenced' AND garden.can_read_submission($1,sub.id)
  `,[actor,id,asset ?? null]);
  return rows[0];
}

async function observeIntegrity(actor: string, submission: string, object: Source, integrity: Integrity, version?: string | null) {
  await database().query(`WITH prior AS (
    SELECT o.id,o.integrity FROM garden.drive_objects o JOIN garden.submissions s ON s.object_id=o.id
    WHERE o.id=$1 AND s.id=$2 AND o.lifecycle='referenced' AND garden.can_read_submission($3,s.id)
      AND (o.checked_at IS NULL OR o.checked_at <= $4::timestamptz) FOR UPDATE OF o
  ), updated AS (
    UPDATE garden.drive_objects o SET integrity=$5,checked_at=$4::timestamptz,
      verified_drive_version=CASE WHEN $5='ok' THEN $6 ELSE o.verified_drive_version END
    FROM prior WHERE o.id=prior.id RETURNING prior.integrity AS previous
  ) INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,outcome)
    SELECT $3,'INTEGRITY','submission',$2,
      CASE WHEN $5='ok' THEN 'success' WHEN $5='unavailable' THEN 'unknown' ELSE 'failure' END
    FROM updated WHERE previous IS DISTINCT FROM $5`,[object.id,submission,actor,object.inspection_started_at,integrity,version ?? null]);
}

export async function readSubmissionFile(actor: string, id: string, asset?: string) {
  const object = await submissionObject(actor,id,asset);
  if (!object) throw new DriveError('NOT_FOUND',404);
  let file;
  try { file = await readVerifiedObject(object); }
  catch (error) {
    if (asset) throw error;
    if ((await submissionObject(actor,id))?.id !== object.id) throw new DriveError('NOT_FOUND',404);
    const integrity = error instanceof DriveObjectReadError ? error.integrity : 'unavailable';
    await observeIntegrity(actor,id,object,integrity);
    throw new SubmissionReadError(integrity,error);
  }
  if (!asset) await observeIntegrity(actor,id,object,'ok',file.version);
  if ((await submissionObject(actor,id,asset))?.id !== object.id) throw new DriveError('NOT_FOUND',404);
  return { ...file, objectId:object.id, submissionSha256:object.expected_sha256 };
}

export async function assertReviewSource(db: PoolClient | ReturnType<typeof database>, teacher: string, id: string, sha256: string) {
  const { rowCount } = await db.query(`SELECT o.id FROM garden.submissions s
    JOIN garden.drive_objects o ON o.id=s.object_id AND o.teacher_id=s.teacher_id
    WHERE s.id=$1 AND s.teacher_id=$2 AND o.expected_sha256=$3 AND o.integrity='ok'
      AND garden.can_review_submission($2,s.id) FOR UPDATE OF o`,[id,teacher,sha256]);
  if (!rowCount) throw new DriveError('SOURCE_UNVERIFIED',409);
}

export async function verifyReviewSource(teacher: string, id: string) {
  const { rows } = await database().query<{ state: string }>(`SELECT c.state FROM garden.submissions s
    JOIN garden.recipients r ON r.id=s.recipient_id JOIN garden.classes c ON c.id=r.class_id
    WHERE s.id=$1 AND s.teacher_id=$2 AND garden.can_read_submission($2,s.id)`,[id,teacher]);
  if (!rows[0]) throw new DriveError('NOT_FOUND',404);
  if (rows[0].state !== 'active') throw new DriveError('CLASS_INACTIVE',409);
  try {
    const file = await readSubmissionFile(teacher,id);
    await assertReviewSource(database(),teacher,id,file.submissionSha256);
    return file;
  } catch (error) {
    if (!(error instanceof SubmissionReadError)) throw error;
    if (error.integrity === 'conflict') throw new DriveError('SUBMISSION_CONFLICT',409);
    if (error.integrity === 'missing') throw new DriveError('SUBMISSION_MISSING',404);
    throw new DriveError('SUBMISSION_UNAVAILABLE',503);
  }
}
