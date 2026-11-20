import { createHash } from 'node:crypto';
import { database } from '../db';
import { connectedDrive } from './connection';
import { ensureFolder } from './folders';
import { DriveError, DriveFiles, type DriveFile } from './provider';

type FolderKind = 'class' | 'assignment' | 'student' | 'assets' | 'library' | 'library_item';
type Address = { classId: string; assignmentId?: string; studentId?: string; assets?: boolean; reviewSubmission?: string };
export type DriveObject = { id: string; teacher_id: string; operation_id: string; slot: string; slot_index: number;
  drive_file_id: string; parent_drive_id: string; mime_type: string; expected_sha256: string; byte_size: string };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export class DriveObjectReadError extends DriveError {
  constructor(public readonly integrity: 'missing' | 'conflict' | 'unavailable') {
    super(integrity === 'missing' ? 'DRIVE_MISSING' : 'DRIVE_INTEGRITY',integrity === 'missing' ? 404 : 409);
  }
}

async function pathFolder(files: DriveFiles, teacher: string, kind: FolderKind, resource: string, parent: string, name = resource) {
  const query = `SELECT folder_id,parent_folder_id FROM garden.drive_folders WHERE teacher_id=$1 AND kind=$2 AND resource_id=$3`;
  const key = [teacher,kind,resource];
  const known = (await database().query(query,key)).rows[0];
  if (!known) {
    const id = await files.generateId();
    await database().query(`INSERT INTO garden.drive_folders(teacher_id,kind,resource_id,folder_id,parent_folder_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT (teacher_id,kind,resource_id) DO NOTHING`, [...key,id,parent]);
  }
  const pin = known ?? (await database().query(query,key)).rows[0];
  if (!pin || pin.parent_folder_id !== parent) throw new DriveError('DRIVE_INTEGRITY', 409);
  return ensureFolder(files,pin.folder_id,parent,name,kind,resource,true);
}

async function pinRoot(teacher: string, { row,files }: Awaited<ReturnType<typeof connectedDrive>>) {
  await ensureFolder(files,row.app_folder_id,row.parent_folder_id,'Vườn Văn','app',teacher,false);
  const latched = await database().query(`UPDATE garden.drive_connections SET data_started_at=COALESCE(data_started_at,now())
    WHERE teacher_id=$1 AND generation=$2 AND state='ready'`,[teacher,row.generation]);
  if (!latched.rowCount) throw new DriveError('DRIVE_SETUP_CHANGED',409);
}

export async function prepareLibraryWorkspace(teacher: string, item: string) {
  const connection = await connectedDrive(teacher);
  const policy = await database().query(`SELECT 1 FROM garden.library_items i JOIN garden.users u ON u.id=i.teacher_id
    WHERE i.teacher_id=$1 AND i.id=$2 AND u.role='teacher' AND u.status='active' AND i.state IN ('draft','active')`,[teacher,item]);
  if (!policy.rowCount) throw new DriveError('NOT_FOUND',404);
  const { row,files } = connection;
  await pinRoot(teacher,connection);
  const root = await pathFolder(files,teacher,'library',teacher,row.app_folder_id,'library');
  const folderId = await pathFolder(files,teacher,'library_item',item,root);
  return { files,generation:row.generation,folderId,teacher };
}

export async function prepareWorkspace(teacher: string, { classId, assignmentId, studentId, assets, reviewSubmission }: Address) {
  const { row, files } = await connectedDrive(teacher);
  const target = await database().query<{ recipient: string | null }>(`
    SELECT r.id AS recipient FROM garden.classes c JOIN garden.users owner ON owner.id=c.teacher_id
    LEFT JOIN garden.assignments a ON a.id=$3 AND a.class_id=c.id AND a.teacher_id=c.teacher_id
    LEFT JOIN garden.recipients r ON r.assignment_id=a.id AND r.student_id=$4
    LEFT JOIN garden.memberships m ON m.class_id=c.id AND m.student_id=$4 AND m.state='active'
    LEFT JOIN garden.submissions reviewed ON reviewed.id=$5 AND reviewed.recipient_id=r.id AND reviewed.teacher_id=c.teacher_id
    WHERE c.id=$2 AND c.teacher_id=$1 AND c.state='active' AND owner.status='active'
      AND ($3::uuid IS NULL OR a.id IS NOT NULL) AND ($5::uuid IS NULL OR reviewed.id IS NOT NULL)
      AND ($4::uuid IS NULL OR (r.id IS NOT NULL AND (m.student_id IS NOT NULL OR reviewed.id IS NOT NULL)))
  `, [teacher,classId,assignmentId ?? null,studentId ?? null,reviewSubmission ?? null]);
  if (!target.rowCount) throw new DriveError('FORBIDDEN', 403);
  await pinRoot(teacher,{ row,files });
  const classFolder = await pathFolder(files,teacher,'class',classId,row.app_folder_id);
  if (!assignmentId) return { files, generation: row.generation, folderId: classFolder, teacher };
  const assignmentFolder = await pathFolder(files,teacher,'assignment',assignmentId,classFolder);
  if (assets) {
    const folderId = await pathFolder(files,teacher,'assets',assignmentId,assignmentFolder,'assets');
    return { files, generation: row.generation, folderId, teacher };
  }
  const recipient = target.rows[0].recipient;
  const folderId = studentId && recipient ? await pathFolder(files,teacher,'student',recipient,assignmentFolder,studentId) : assignmentFolder;
  return { files, generation: row.generation, folderId, teacher };
}

type Workspace = Awaited<ReturnType<typeof prepareWorkspace>>;
type Candidate = { operationId: string; slot: 'document' | 'prompt' | 'reference' | 'rubric' | 'asset' | 'message';
  slotIndex?: number; name: string; mimeType: string; bytes: Buffer };

export async function pinCandidates(workspace: Workspace, inputs: Candidate[]) {
  const { files, folderId, teacher, generation } = workspace;
  if (!inputs.length) return [];
  const { operationId } = inputs[0];
  if (inputs.some(input => input.operationId !== operationId)) throw new DriveError('DRIVE_INTEGRITY',409);
  const specs = inputs.map(input => ({ ...input, slotIndex: input.slotIndex ?? 0, checksum: hash(input.bytes) }));
  const load = async () => (await database().query<DriveObject>(
    'SELECT * FROM garden.drive_objects WHERE operation_id=$1 AND teacher_id=$2',[operationId,teacher])).rows;
  let objects = await load();
  const missing = specs.filter(spec => !objects.some(object => object.slot === spec.slot && object.slot_index === spec.slotIndex));
  if (missing.length) {
    const ids = await Promise.all(missing.map(() => files.generateId()));
    await database().query(`WITH reservable AS (
      SELECT op.id,op.teacher_id FROM garden.operations op JOIN garden.drive_connections dc ON dc.teacher_id=op.teacher_id
      WHERE op.id=$1 AND op.teacher_id=$2 AND op.state IN ('reserved','writing','unknown','needs_client')
        AND dc.state='ready' AND dc.generation=$3 FOR UPDATE OF op
    ) INSERT INTO garden.drive_objects(teacher_id,operation_id,slot,slot_index,drive_file_id,
      parent_drive_id,mime_type,expected_sha256,byte_size)
      SELECT op.teacher_id,op.id,input.slot,input.index,input.id,$4,input.mime,input.hash,input.size
      FROM reservable op
      CROSS JOIN unnest($5::text[],$6::integer[],$7::text[],$8::text[],$9::text[],$10::bigint[])
        AS input(slot,index,id,mime,hash,size)
      ON CONFLICT (operation_id,slot,slot_index) DO NOTHING`,
      [operationId,teacher,generation,folderId,missing.map(spec => spec.slot),missing.map(spec => spec.slotIndex),ids,
        missing.map(spec => spec.mimeType),missing.map(spec => spec.checksum),missing.map(spec => spec.bytes.length)]);
    objects = await load();
  }
  return specs.map(spec => {
    const object = objects.find(item => item.slot === spec.slot && item.slot_index === spec.slotIndex);
    if (!object) throw new DriveError('DRIVE_SETUP_CHANGED',409);
    if (object.parent_drive_id !== folderId || object.expected_sha256 !== spec.checksum ||
        Number(object.byte_size) !== spec.bytes.length || object.mime_type !== spec.mimeType) throw new DriveError('DRIVE_INTEGRITY',409);
    return object;
  });
}

// The caller commits a resource pointer only after checking its own policy.
export async function storeCandidate(workspace: Workspace, input: Candidate) {
  const { files, folderId } = workspace;
  const { operationId, mimeType, bytes, name } = input;
  const [object] = await pinCandidates(workspace,[input]);
  const marker = { schema: 'garden-blob-1', resource: object.id, operation: operationId };
  try { await files.upload(object.drive_file_id,folderId,name,mimeType,bytes,marker); }
  catch (error) {
    if (!(error instanceof DriveError) || error.code !== 'DRIVE_CONFLICT') throw error;
  }
  const verified = await verifiedBytes(files, object);
  await database().query(`UPDATE garden.drive_objects SET integrity='ok',verified_drive_version=$2,checked_at=now()
    WHERE id=$1`, [object.id,verified.version]);
  return object.id;
}

function assertManagedFile(file: DriveFile, object: DriveObject) {
  if (file.id !== object.drive_file_id || !file.ownedByMe || file.driveId ||
      file.mimeType !== object.mime_type || file.parents?.length !== 1 || file.parents[0] !== object.parent_drive_id ||
      file.appProperties?.schema !== 'garden-blob-1' || file.appProperties.resource !== object.id ||
      file.appProperties.operation !== object.operation_id ||
      file.permissions?.some(permission => permission.type === 'anyone' || permission.type === 'domain')) {
    throw new DriveObjectReadError('unavailable');
  }
}

async function verifiedBytes(files: DriveFiles, object: DriveObject) {
  const file = await files.inspect(object.drive_file_id);
  if (file.trashed === true && file.id === object.drive_file_id) throw new DriveObjectReadError('missing');
  assertManagedFile(file,object);
  const bytes = await files.download(file.id, Number(object.byte_size)).catch(error => {
    if (error instanceof DriveError && error.code === 'DRIVE_INTEGRITY') throw new DriveObjectReadError('conflict');
    throw error;
  });
  if (hash(bytes) !== object.expected_sha256) throw new DriveObjectReadError('conflict');
  return { bytes, version: file.version ?? null };
}

export async function trashManagedFile(files: DriveFiles, object: DriveObject) {
  let file = await files.inspect(object.drive_file_id);
  assertManagedFile(file,object);
  if (!file.trashed) {
    await files.trash(object.drive_file_id);
    file = await files.inspect(object.drive_file_id);
    assertManagedFile(file,object);
  }
  if (!file.trashed) throw new DriveError('DRIVE_UNAVAILABLE',503);
}

export async function readVerifiedObject(object: DriveObject) {
  const { files, row } = await connectedDrive(object.teacher_id);
  let result;
  try { result = await verifiedBytes(files,object); }
  catch (error) {
    if (error instanceof DriveError && error.code === 'DRIVE_RECONNECT') {
      await database().query(`UPDATE garden.drive_connections SET state='reconnect_required', checked_at=now()
        WHERE teacher_id=$1 AND generation=$2`, [row.teacher_id,row.generation]);
    }
    throw error;
  }
  return { bytes:result.bytes,mimeType:object.mime_type,version:result.version };
}
