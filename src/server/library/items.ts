import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { inspectMarkdown } from '../../shared/editor-markdown';
import { transaction } from '../assignments/access';
import { database } from '../db';
import { decodeDocument, encodeDocument } from '../drive/envelope';
import { DriveError } from '../drive/provider';
import { pinCandidates, prepareLibraryWorkspace, readVerifiedObject, storeCandidate, type DriveObject } from '../drive/storage';
import { libraryFormats, type LibraryFields, type LibraryInput } from './format';

export type LibraryActor = { teacher: string; sessionDigest: string };
export type ItemRow = { id: string; teacher_id: string; draft_stream_id: string; current_object_id: string | null; state: string; version: string };
type Operation = { id: string; kind: string; state: string; target_kind: string; target_id: string; request_digest: string; result_id: string | null };
type ImageReference = { id: string; sha256: string; mimeType: string };
type Manifest = LibraryFields & { blobId: string | null; blobSha256: string | null; assets: ImageReference[] };
const editable = (item: ItemRow, version: string) => (item.state === 'active' || item.state === 'draft') && item.version === version;
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function lockLibraryOwner(db: PoolClient, actor: LibraryActor) {
  const account = await db.query(`SELECT 1 FROM garden.users u JOIN garden.app_sessions s ON s.user_id=u.id
    WHERE u.id=$1 AND u.role='teacher' AND u.status='active' AND s.handle_digest=$2 AND s.auth_epoch=u.auth_epoch AND s.expires_at>now()
    FOR UPDATE OF u`,[actor.teacher,actor.sessionDigest]);
  if (!account.rowCount) throw new DriveError('FORBIDDEN',403);
}

export async function lockLibraryItem(db: PoolClient, actor: LibraryActor, id: string) {
  await lockLibraryOwner(db,actor);
  const { rows } = await db.query<ItemRow>('SELECT * FROM garden.library_items WHERE id=$1 AND teacher_id=$2 FOR UPDATE',[id,actor.teacher]);
  if (!rows[0]) throw new DriveError('NOT_FOUND',404);
  return rows[0];
}

export async function createLibraryItem(actor: LibraryActor, id: string) {
  return transaction(async db => {
    await lockLibraryOwner(db,actor);
    const chosen = await db.query<ItemRow>('SELECT * FROM garden.library_items WHERE id=$1',[id]);
    if (chosen.rows[0]) {
      if (chosen.rows[0].teacher_id !== actor.teacher || chosen.rows[0].state !== 'draft') throw new DriveError('NOT_FOUND',404);
      return { id };
    }
    const stream = await db.query<{ id: string }>("INSERT INTO garden.document_streams(teacher_id,kind) VALUES($1,'library') RETURNING id",[actor.teacher]);
    await db.query('INSERT INTO garden.library_items(id,teacher_id,draft_stream_id) VALUES($1,$2,$3)',[id,actor.teacher,stream.rows[0].id]);
    return { id };
  });
}

export async function ownedLibraryItem(teacher: string, id: string) {
  const { rows } = await database().query<ItemRow>(`SELECT i.* FROM garden.library_items i JOIN garden.users u ON u.id=i.teacher_id
    WHERE i.id=$1 AND i.teacher_id=$2 AND u.role='teacher' AND u.status='active' AND i.state IN ('draft','active')`,[id,teacher]);
  if (!rows[0]) throw new DriveError('NOT_FOUND',404);
  return rows[0];
}

async function operation(db: PoolClient, teacher: string, id: string, kind: string, key: string, fingerprint: string) {
  const { rows:[prior] } = await db.query<Operation>('SELECT * FROM garden.operations WHERE actor_id=$1 AND idempotency_key=$2',[teacher,key]);
  if (!prior) return undefined;
  if (prior.target_kind !== 'library' || prior.target_id !== id || prior.kind !== kind || prior.request_digest !== fingerprint) {
    throw new DriveError('KEY_REUSED',409);
  }
  if (prior.state === 'rejected' || prior.state === 'cleanup') throw new DriveError('STALE',409);
  return prior;
}

async function stageLibraryOperation(db: PoolClient, item: ItemRow, kind: 'asset_upload' | 'library_save', key: string, fingerprint: string) {
  const { rows } = await db.query<Operation>(`INSERT INTO garden.operations(actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,
    request_digest,expected_version) VALUES($1,$1,$2,'library',$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,
  [item.teacher_id,kind,item.id,key,fingerprint,item.version]);
  if (!rows[0]) throw new DriveError('OP_IN_PROGRESS',409);
  return rows[0];
}

export async function uploadLibraryImage(actor: LibraryActor, id: string, key: string,
  image: { bytes: Buffer; mimeType: string; format: string }) {
  const fingerprint = sha256(JSON.stringify([id,image.mimeType,sha256(image.bytes)]));
  const intent = await transaction(async db => {
    const item = await lockLibraryItem(db,actor,id);
    if (item.state !== 'draft' && item.state !== 'active') throw new DriveError('NOT_FOUND',404);
    return await operation(db,actor.teacher,id,'asset_upload',key,fingerprint) ?? await stageLibraryOperation(db,item,'asset_upload',key,fingerprint);
  });
  if (intent.state === 'committed' && intent.result_id) return intent.result_id;
  const workspace = await prepareLibraryWorkspace(actor.teacher,id);
  const object = await storeCandidate(workspace,{ operationId:intent.id,slot:'asset',name:`image-${intent.id}.${image.format}`,
    mimeType:image.mimeType,bytes:image.bytes });
  return transaction(async db => {
    const item = await lockLibraryItem(db,actor,id);
    const current = await operation(db,actor.teacher,id,'asset_upload',key,fingerprint);
    if (current?.state === 'committed' && current.result_id) return current.result_id;
    if (item.state !== 'draft' && item.state !== 'active') throw new DriveError('NOT_FOUND',404);
    const ready = await db.query(`UPDATE garden.drive_objects SET lifecycle='referenced' WHERE id=$1 AND operation_id=$2
      AND lifecycle='candidate' AND integrity='ok'`,[object,intent.id]);
    if (!ready.rowCount) throw new DriveError('DRIVE_INTEGRITY',409);
    await db.query('INSERT INTO garden.library_assets(item_id,asset_id,teacher_id) VALUES($1,$2,$3)',[id,object,actor.teacher]);
    await db.query("UPDATE garden.operations SET state='committed',result_id=$2 WHERE id=$1",[intent.id,object]);
    return object;
  });
}

async function verifyLibraryAssets(db: PoolClient, id: string, teacher: string, assets: string[]) {
  if (!assets.length) return [];
  const owned = await db.query<ImageReference>(`SELECT o.id,o.expected_sha256 AS sha256,o.mime_type AS "mimeType"
    FROM garden.library_assets a JOIN garden.drive_objects o ON o.id=a.asset_id
    WHERE a.item_id=$1 AND a.teacher_id=$2 AND o.id=ANY($3::uuid[]) AND o.slot='asset' AND o.lifecycle='referenced' AND o.integrity='ok'
    ORDER BY o.id`,
  [id,teacher,assets]);
  if (owned.rowCount !== assets.length) throw new DriveError('ASSET_SCOPE',422);
  return owned.rows;
}

export async function saveLibraryItem(actor: LibraryActor, id: string, key: string, expected: string, input: LibraryInput) {
  const { markdown,upload,...fields } = input;
  let assets: string[] = [];
  if (markdown) {
    try { assets = inspectMarkdown(markdown,'teacher').assets; }
    catch (error) { throw new DriveError((error as Error).message,422); }
  }
  const fileHash = upload ? sha256(upload.bytes) : null;
  const fingerprint = sha256(JSON.stringify([id,expected,fields,markdown,fileHash]));
  const result = { state:'committed' as const,id,version:(BigInt(expected)+1n).toString() };
  const { intent,manifestAssets } = await transaction(async db => {
    const row = await lockLibraryItem(db,actor,id);
    const prior = await operation(db,actor.teacher,id,'library_save',key,fingerprint);
    if (prior?.state === 'committed') return { intent:prior,manifestAssets:[] };
    if (!editable(row,expected)) throw new DriveError('LIBRARY_CHANGED',409);
    const manifestAssets = await verifyLibraryAssets(db,id,actor.teacher,assets);
    return { intent:prior ?? await stageLibraryOperation(db,row,'library_save',key,fingerprint),manifestAssets };
  });
  if (intent.state === 'committed') return result;
  try {
    const workspace = await prepareLibraryWorkspace(actor.teacher,id);
    const blob = upload && { operationId:intent.id,slot:'document' as const,name:`document-${intent.id}.${upload.mimeType === 'application/pdf' ? 'pdf' : 'txt'}`,
      bytes:upload.bytes,mimeType:upload.mimeType };
    const blobObject = blob ? (await pinCandidates(workspace,[blob]))[0] : null;
    const bytes = encodeDocument('garden.library/1',id,{ ...fields,blobId:blobObject?.id ?? null,blobSha256:fileHash,assets:manifestAssets },markdown);
    const manifest = { operationId:intent.id,slot:'prompt' as const,name:`library-${intent.id}.md`,mimeType:'text/markdown',bytes };
    await pinCandidates(workspace,[manifest]);
    if (blob) await storeCandidate(workspace,blob);
    const currentObject = await storeCandidate(workspace,manifest);
    return await transaction(async db => {
      const row = await lockLibraryItem(db,actor,id);
      const current = await operation(db,actor.teacher,id,'library_save',key,fingerprint);
      if (current?.state === 'committed') return result;
      if (!current || !editable(row,expected)) throw new DriveError('LIBRARY_CHANGED',409);
      await verifyLibraryAssets(db,id,actor.teacher,assets);
      const targets = blobObject ? [currentObject,blobObject.id] : [currentObject];
      const updated = await db.query(`UPDATE garden.drive_objects SET lifecycle='referenced' WHERE id=ANY($1::uuid[])
        AND operation_id=$2 AND lifecycle='candidate' AND integrity='ok'`,[targets,intent.id]);
      if (updated.rowCount !== targets.length) throw new DriveError('DRIVE_INTEGRITY',409);
      await db.query('UPDATE garden.library_assets SET visible=asset_id=ANY($2::uuid[]) WHERE item_id=$1',[id,assets]);
      await db.query("UPDATE garden.library_items SET state='active',current_object_id=$2,version=version+1 WHERE id=$1",[id,currentObject]);
      await db.query("UPDATE garden.operations SET state='committed',result_id=$2,error_code=NULL WHERE id=$1",[intent.id,currentObject]);
      return result;
    });
  } catch (error) {
    if (error instanceof DriveError && error.status < 500) throw error;
    await database().query("UPDATE garden.operations SET state='unknown',error_code='TIMEOUT' WHERE id=$1 AND state IN ('reserved','unknown')",[intent.id]).catch(() => {});
    return { state:'unknown' as const };
  }
}

export async function accessibleLibraryItem(actor: string, id: string) {
  const { rows } = await database().query<ItemRow>(`SELECT * FROM garden.library_items WHERE id=$1 AND garden.can_read_library($2,id)`,[id,actor]);
  if (!rows[0]) throw new DriveError('NOT_FOUND',404);
  return rows[0];
}

export async function confirmLibraryVersion(actor: string, item: ItemRow) {
  if ((await accessibleLibraryItem(actor,item.id)).current_object_id !== item.current_object_id) throw new DriveError('LIBRARY_CHANGED',409);
}

export async function readLibraryItem(actor: string, id: string) {
  const row = await accessibleLibraryItem(actor,id);
  const { rows:[object] } = await database().query<DriveObject>(`SELECT o.* FROM garden.drive_objects o JOIN garden.operations op ON op.id=o.operation_id
    WHERE o.id=$1 AND o.teacher_id=$2 AND o.slot='prompt' AND o.mime_type='text/markdown' AND o.lifecycle='referenced'
    AND op.target_kind='library' AND op.target_id=$3 AND op.kind='library_save'`,[row.current_object_id,row.teacher_id,id]);
  if (!object) throw new DriveError('DRIVE_MISSING',404);
  const file = await readVerifiedObject(object);
  const { fields,body } = decodeDocument<Manifest>(file.bytes,'garden.library/1',id);
  if (!libraryFormats.includes(fields.format) || typeof fields.title !== 'string' || !Array.isArray(fields.assets) ||
      (fields.format === 'markdown' ? fields.blobId !== null || fields.blobSha256 !== null : !fields.blobId || !fields.blobSha256 || body)) {
    throw new DriveError('DRIVE_INTEGRITY',409);
  }
  await confirmLibraryVersion(actor,row);
  return { row,manifest:fields,markdown:body,object };
}

export async function readLibraryFile(actor: string, id: string, loaded?: Awaited<ReturnType<typeof readLibraryItem>>) {
  const { row,manifest,markdown,object } = loaded ?? await readLibraryItem(actor,id);
  if (manifest.format === 'markdown') {
    if (loaded) await confirmLibraryVersion(actor,row);
    return { bytes:Buffer.from(markdown),mimeType:'text/markdown; charset=utf-8',extension:'md' };
  }
  const mime = manifest.format === 'pdf' ? 'application/pdf' : 'text/plain';
  const { rows:[blob] } = await database().query<DriveObject>(`SELECT * FROM garden.drive_objects WHERE id=$1 AND teacher_id=$2
    AND operation_id=$3 AND expected_sha256=$4 AND slot='document' AND mime_type=$5 AND lifecycle='referenced'`,
  [manifest.blobId,row.teacher_id,object.operation_id,manifest.blobSha256,mime]);
  if (!blob) throw new DriveError('DRIVE_MISSING',404);
  const file = await readVerifiedObject(blob);
  await confirmLibraryVersion(actor,row);
  return { bytes:file.bytes,mimeType:manifest.format === 'pdf' ? mime : 'text/plain; charset=utf-8',extension:manifest.format === 'pdf' ? 'pdf' : 'txt' };
}

export async function listLibrary(actor: string, favorites: boolean) {
  const { rows } = await database().query<{ id: string; favorite: boolean }>(`SELECT i.id,f.item_id IS NOT NULL AS favorite FROM garden.library_items i
    LEFT JOIN garden.library_favorites f ON f.item_id=i.id AND f.user_id=$1 WHERE garden.can_read_library($1,i.id)
      AND (NOT $2::boolean OR f.item_id IS NOT NULL) ORDER BY i.id`,[actor,favorites]);
  const items = [];
  for (const entry of rows) {
    try {
      const { manifest } = await readLibraryItem(actor,entry.id);
      items.push({ ...entry,title:manifest.title,format:manifest.format,sourceLabel:manifest.sourceLabel });
    } catch (error) {
      if (error instanceof DriveError && error.code === 'NOT_FOUND') continue;
      items.push({ ...entry,title:'Chưa đọc được tài liệu',format:null,sourceLabel:'' });
    }
  }
  if (!items.length) return items;
  const { rows:permitted } = await database().query<{ id: string }>(`SELECT id FROM garden.library_items
    WHERE id=ANY($2::uuid[]) AND garden.can_read_library($1,id)`,[actor,items.map(item => item.id)]);
  const visible = new Set(permitted.map(item => item.id));
  return items.filter(item => visible.has(item.id));
}

export async function featuredLibrary(actor: string, classId?: string) {
  const { rows } = await database().query<{ id: string; classId: string; slot: number; className: string }>(`SELECT i.id,
    c.id AS "classId",f.slot,c.name AS "className" FROM garden.library_featured f JOIN garden.library_items i ON i.id=f.item_id
    JOIN garden.classes c ON c.id=f.class_id AND c.state='active'
    JOIN garden.memberships m ON m.class_id=c.id AND m.student_id=$1 AND m.state='active'
    WHERE ($2::uuid IS NULL OR c.id=$2) AND garden.can_read_library($1,i.id) ORDER BY c.name,c.id,f.slot`,[actor,classId ?? null]);
  const featured = [];
  for (const entry of rows) {
    try {
      const { manifest } = await readLibraryItem(actor,entry.id);
      const stillShared = await database().query(`SELECT 1 FROM garden.library_featured f
        JOIN garden.classes c ON c.id=f.class_id AND c.state='active'
        JOIN garden.memberships m ON m.class_id=c.id AND m.student_id=$1 AND m.state='active'
        WHERE f.class_id=$2 AND f.item_id=$3 AND f.slot=$4 AND garden.can_read_library($1,f.item_id)`,[actor,entry.classId,entry.id,entry.slot]);
      if (stillShared.rowCount) featured.push({ ...entry,title:manifest.title });
    } catch (error) {
      if (!(error instanceof DriveError)) throw error;
    }
  }
  return featured;
}

export async function copyLibraryBlob(actor: string, id: string, key: string, version: string, format: 'pdf' | 'text') {
  const row = await ownedLibraryItem(actor,id);
  const mimeType: 'application/pdf' | 'text/plain' = format === 'pdf' ? 'application/pdf' : 'text/plain';
  if (row.version === version) {
    const current = await readLibraryItem(actor,id);
    if (current.row.version !== version || current.manifest.format !== format) throw new DriveError('LIBRARY_CHANGED',409);
    return { bytes:(await readLibraryFile(actor,id,current)).bytes,mimeType };
  }
  // A successful metadata-only replay reconstructs the original fingerprint from that intent's blob.
  const { rows:[object] } = await database().query<DriveObject>(`SELECT o.* FROM garden.operations op
    JOIN garden.drive_objects o ON o.operation_id=op.id AND o.teacher_id=op.teacher_id
    WHERE op.actor_id=$1 AND op.target_id=$2 AND op.target_kind='library' AND op.kind='library_save'
      AND op.idempotency_key=$3 AND op.expected_version=$4 AND op.state='committed'
      AND o.slot='document' AND o.mime_type=$5 AND o.lifecycle='referenced'`,[actor,id,key,version,mimeType]);
  if (!object) throw new DriveError('LIBRARY_CHANGED',409);
  return { bytes:(await readVerifiedObject(object)).bytes,mimeType };
}
