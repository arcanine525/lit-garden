import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database } from '../db';
import { inspectMarkdown, type EditorRole } from '../../shared/editor-markdown';
import { DriveError } from './provider';
import { prepareWorkspace, storeCandidate, readVerifiedObject, type DriveObject } from './storage';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const leaseSeconds = 60;

async function transaction<T>(run: (db: PoolClient) => Promise<T>) {
  const db = await database().connect();
  try {
    await db.query('BEGIN');
    const output = await run(db);
    await db.query('COMMIT');
    return output;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function editableDraft(db: PoolClient, teacher: string, assignment: string) {
  const account = await db.query(`SELECT 1 FROM garden.users WHERE id=$1 AND role='teacher' AND status='active' FOR UPDATE`, [teacher]);
  if (!account.rowCount) throw new DriveError('FORBIDDEN',403);
  const { rows } = await db.query<{ class_id: string; version: string }>(`
    SELECT a.class_id,a.version FROM garden.assignments a JOIN garden.classes c ON c.id=a.class_id AND c.teacher_id=a.teacher_id
    WHERE a.id=$1 AND a.teacher_id=$2 AND a.state='draft' AND c.state='active' FOR UPDATE OF c,a
  `, [assignment,teacher]);
  if (!rows[0]) throw new DriveError('DRAFT_NOT_FOUND',404);
  return rows[0];
}

export async function uploadAssignmentAsset(teacher: string, assignment: string, key: string,
  image: { bytes: Buffer; mimeType: string; format: string }) {
  const fingerprint = digest(JSON.stringify([assignment,image.mimeType,digest(image.bytes)]));
  const reserved = await transaction(async db => {
    const draft = await editableDraft(db,teacher,assignment);
    const { rows } = await db.query<{ id: string; request_digest: string; state: string; result_id: string | null }>(`
      SELECT id,request_digest,state,result_id FROM garden.operations WHERE actor_id=$1 AND idempotency_key=$2
    `, [teacher,key]);
    if (rows[0]) {
      if (rows[0].request_digest !== fingerprint) throw new DriveError('KEY_REUSED',409);
      if (rows[0].state === 'rejected' || rows[0].state === 'cleanup') throw new DriveError('STALE',409);
      return { op: rows[0].id, asset: rows[0].result_id, classId: draft.class_id };
    }
    const ready = await db.query("SELECT 1 FROM garden.drive_connections WHERE teacher_id=$1 AND state='ready'",[teacher]);
    if (!ready.rowCount) throw new DriveError('DRIVE_SETUP_REQUIRED',409);
    const created = await db.query<{ id: string }>(`
      INSERT INTO garden.operations(actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version)
      VALUES($1,$1,'asset_upload','assignment',$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id
    `, [teacher,assignment,key,fingerprint,draft.version]);
    if (!created.rows[0]) throw new DriveError('OP_IN_PROGRESS',409);
    return { op: created.rows[0].id, asset: null, classId: draft.class_id };
  });
  if (reserved.asset) return reserved.asset;
  const workspace = await prepareWorkspace(teacher,{ classId: reserved.classId, assignmentId: assignment, assets: true });
  const id = await storeCandidate(workspace,{ operationId: reserved.op, slot: 'asset', name: `image-${reserved.op}.${image.format}`,
    mimeType: image.mimeType, bytes: image.bytes });
  return transaction(async db => {
    await editableDraft(db,teacher,assignment);
    const result = await db.query(`UPDATE garden.operations SET state='committed',result_id=$2
      WHERE id=$1 AND state='reserved' RETURNING id`, [reserved.op,id]);
    if (!result.rowCount) {
      const current = await db.query("SELECT 1 FROM garden.operations WHERE id=$1 AND state='committed' AND result_id=$2",[reserved.op,id]);
      if (!current.rowCount) throw new DriveError('STALE',409);
      return id;
    }
    await db.query(`INSERT INTO garden.assignment_assets(assignment_id,asset_id,teacher_id) VALUES($1,$2,$3)`,[assignment,id,teacher]);
    await db.query("UPDATE garden.drive_objects SET lifecycle='referenced' WHERE id=$1 AND integrity='ok'",[id]);
    return id;
  });
}

export async function validateEditorDraft(actor: string, role: EditorRole, input: unknown, assignment?: string) {
  let parsed: ReturnType<typeof inspectMarkdown>;
  try { parsed = inspectMarkdown(input,role); }
  catch (error) {
    const code = (error as Error).message;
    throw new DriveError(/^[A-Z_]+$/.test(code) ? code : 'UNSUPPORTED_MARKDOWN',422);
  }
  if (parsed.assets.length) {
    const authorized = await database().query<{ asset_id: string }>(`
      SELECT aa.asset_id FROM garden.assignment_assets aa JOIN garden.drive_objects obj ON obj.id=aa.asset_id
      WHERE aa.assignment_id=$1 AND aa.teacher_id=$2 AND aa.asset_id=ANY($3::uuid[]) AND obj.lifecycle='referenced'
      AND garden.can_read_assignment($2,aa.assignment_id)
    `, [assignment ?? null,actor,parsed.assets]);
    if (authorized.rowCount !== parsed.assets.length) throw new DriveError('ASSET_SCOPE',422);
  }
  return parsed;
}

async function authorizedAsset(actor: string, asset: string) {
  const { rows } = await database().query<DriveObject>(`
    SELECT obj.* FROM garden.drive_objects obj JOIN garden.users u ON u.id=$1 AND u.status='active'
    WHERE obj.id=$2 AND obj.slot='asset' AND obj.lifecycle='referenced' AND obj.mime_type IN ('image/png','image/jpeg','image/webp')
      AND (EXISTS (
        SELECT 1 FROM garden.assignment_assets aa JOIN garden.assignments a ON a.id=aa.assignment_id
        WHERE aa.asset_id=obj.id AND ((u.role='teacher' AND aa.teacher_id=u.id) OR (u.role='student' AND a.state='published' AND
          ((aa.document_part IN ('prompt','both') AND garden.can_read_assignment($1,a.id)) OR
           (aa.document_part IN ('reference','both') AND garden.can_read_reference($1,a.id)))))
      ) OR EXISTS (
        SELECT 1 FROM garden.library_assets la JOIN garden.library_items i ON i.id=la.item_id
        WHERE la.asset_id=obj.id AND ((u.role='teacher' AND i.teacher_id=u.id AND i.state IN ('draft','active')) OR
          (u.role='student' AND la.visible AND garden.can_read_library($1,i.id)))
      ))
  `,[actor,asset]);
  return rows[0];
}

export async function issueAssetView(actor: string, sessionDigest: string, asset: string) {
  if (!await authorizedAsset(actor,asset)) throw new DriveError('NOT_FOUND',404);
  const handle = randomBytes(32).toString('base64url');
  await database().query('DELETE FROM garden.asset_view_leases WHERE expires_at < now()-interval \'5 minutes\'');
  const { rows } = await database().query<{ expires_at: Date }>(`
    INSERT INTO garden.asset_view_leases(handle_digest,asset_id,session_digest,expires_at)
    VALUES($1,$2,$3,now()+$4*interval '1 second') RETURNING expires_at
  `,[digest(handle),asset,sessionDigest,leaseSeconds]);
  return { url: `/api/assets/${asset}/view?lease=${handle}`, expiresAt: rows[0].expires_at.toISOString() };
}

export async function viewPrivateAsset(actor: string, sessionDigest: string, asset: string, handle: string) {
  const { rows } = await database().query<{ session_digest: string; valid: boolean }>(`
    SELECT session_digest,expires_at>now() AS valid FROM garden.asset_view_leases WHERE asset_id=$1 AND handle_digest=$2
  `,[asset,digest(handle)]);
  const lease = rows[0];
  if (lease && lease.session_digest !== sessionDigest) throw new DriveError('FORBIDDEN',403);
  const object = await authorizedAsset(actor,asset);
  if (!object) throw new DriveError('NOT_FOUND',404);
  if (!lease?.valid) throw new DriveError('ASSET_VIEW_EXPIRED',410);
  const file = await readVerifiedObject(object);
  if (!(await authorizedAsset(actor,asset))) throw new DriveError('NOT_FOUND',404);
  return file;
}
