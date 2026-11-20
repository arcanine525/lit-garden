import { createHash } from 'node:crypto';
import { database } from '../db';
import { connectedDrive } from './connection';
import { ensureFolder } from './folders';
import { DriveError, DriveFiles } from './provider';

type FolderKind = 'class' | 'assignment' | 'student';
type Address = { classId: string; assignmentId?: string; studentId?: string };
type ObjectRow = { id: string; teacher_id: string; operation_id: string; slot: string;
  drive_file_id: string; parent_drive_id: string; mime_type: string; expected_sha256: string; byte_size: string };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

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

export async function prepareWorkspace(teacher: string, { classId, assignmentId, studentId }: Address) {
  const { row, files } = await connectedDrive(teacher);
  const target = await database().query<{ recipient: string | null }>(`
    SELECT r.id AS recipient FROM garden.classes c JOIN garden.users owner ON owner.id=c.teacher_id
    LEFT JOIN garden.assignments a ON a.id=$3 AND a.class_id=c.id AND a.teacher_id=c.teacher_id
    LEFT JOIN garden.recipients r ON r.assignment_id=a.id AND r.student_id=$4
    LEFT JOIN garden.memberships m ON m.class_id=c.id AND m.student_id=$4 AND m.state='active'
    WHERE c.id=$2 AND c.teacher_id=$1 AND c.state='active' AND owner.status='active'
      AND ($3::uuid IS NULL OR a.id IS NOT NULL) AND ($4::uuid IS NULL OR (r.id IS NOT NULL AND m.student_id IS NOT NULL))
  `, [teacher,classId,assignmentId ?? null,studentId ?? null]);
  if (!target.rowCount) throw new DriveError('FORBIDDEN', 403);
  await ensureFolder(files,row.app_folder_id,row.parent_folder_id,'Vườn Văn','app',teacher,false);
  const latched = await database().query(`UPDATE garden.drive_connections SET data_started_at=COALESCE(data_started_at,now())
    WHERE teacher_id=$1 AND generation=$2 AND state='ready'`, [teacher,row.generation]);
  if (!latched.rowCount) throw new DriveError('DRIVE_SETUP_CHANGED', 409);
  const classFolder = await pathFolder(files,teacher,'class',classId,row.app_folder_id);
  if (!assignmentId) return { files, generation: row.generation, folderId: classFolder, teacher };
  const assignmentFolder = await pathFolder(files,teacher,'assignment',assignmentId,classFolder);
  const recipient = target.rows[0].recipient;
  const folderId = studentId && recipient ? await pathFolder(files,teacher,'student',recipient,assignmentFolder,studentId) : assignmentFolder;
  return { files, generation: row.generation, folderId, teacher };
}

type Workspace = Awaited<ReturnType<typeof prepareWorkspace>>;
type Candidate = { operationId: string; slot: 'document' | 'prompt' | 'reference' | 'rubric' | 'asset' | 'message';
  slotIndex?: number; name: string; mimeType: string; bytes: Buffer };

// Reserves immutable Drive bytes against an existing operation. The caller commits
// a resource pointer in a separate transaction after checking that operation's policy.
export async function storeCandidate(workspace: Workspace, input: Candidate) {
  const { files, folderId, teacher, generation } = workspace;
  const { operationId, slot, slotIndex = 0, mimeType, bytes, name } = input;
  const checksum = hash(bytes);
  const key = [operationId,slot,slotIndex,teacher];
  const select = `SELECT * FROM garden.drive_objects WHERE operation_id=$1 AND slot=$2 AND slot_index=$3 AND teacher_id=$4`;
  let object = (await database().query<ObjectRow>(select,key)).rows[0];
  if (!object) {
    const driveId = await files.generateId();
    await database().query(`INSERT INTO garden.drive_objects(teacher_id,operation_id,slot,slot_index,drive_file_id,
      parent_drive_id,mime_type,expected_sha256,byte_size)
      SELECT op.teacher_id,op.id,$2,$3,$5,$6,$7,$8,$9 FROM garden.operations op
      JOIN garden.drive_connections dc ON dc.teacher_id=op.teacher_id
      WHERE op.id=$1 AND op.teacher_id=$4 AND op.state IN ('reserved','writing','unknown','needs_client')
      AND dc.state='ready' AND dc.generation=$10 ON CONFLICT (operation_id,slot,slot_index) DO NOTHING`,
      [...key,driveId,folderId,mimeType,checksum,bytes.length,generation]);
    object = (await database().query<ObjectRow>(select,key)).rows[0];
  }
  if (!object) throw new DriveError('DRIVE_SETUP_CHANGED', 409);
  if (object.parent_drive_id !== folderId || object.expected_sha256 !== checksum ||
      Number(object.byte_size) !== bytes.length || object.mime_type !== mimeType) throw new DriveError('DRIVE_INTEGRITY', 409);
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

async function verifiedBytes(files: DriveFiles, object: ObjectRow) {
  const file = await files.inspect(object.drive_file_id);
  if (file.id !== object.drive_file_id || !file.ownedByMe || file.trashed || file.driveId ||
      file.mimeType !== object.mime_type || file.parents?.length !== 1 || file.parents[0] !== object.parent_drive_id ||
      file.appProperties?.schema !== 'garden-blob-1' || file.appProperties.resource !== object.id ||
      file.appProperties.operation !== object.operation_id ||
      file.permissions?.some(permission => permission.type === 'anyone' || permission.type === 'domain')) {
    throw new DriveError('DRIVE_INTEGRITY', 409);
  }
  const bytes = await files.download(file.id, Number(object.byte_size));
  if (hash(bytes) !== object.expected_sha256) throw new DriveError('DRIVE_INTEGRITY', 409);
  return { bytes, version: file.version ?? null };
}

async function submissionObject(actor: string, id: string, asset?: string) {
  const { rows } = await database().query<ObjectRow>(`
    SELECT object.* FROM garden.submissions sub
    LEFT JOIN garden.submission_assets link ON link.submission_id=sub.id AND link.asset_id=$3
    JOIN garden.drive_objects object ON object.teacher_id=sub.teacher_id AND
      (($3::uuid IS NULL AND object.id=sub.object_id AND object.slot='document' AND object.mime_type='text/markdown') OR
       ($3::uuid IS NOT NULL AND object.id=link.asset_id AND object.slot='asset' AND object.mime_type IN ('image/png','image/jpeg','image/webp')))
    WHERE sub.id=$2 AND object.lifecycle='referenced' AND garden.can_read_submission($1,sub.id)
  `, [actor,id,asset ?? null]);
  return rows[0];
}

export async function readSubmissionFile(actor: string, id: string, asset?: string) {
  const object = await submissionObject(actor,id,asset);
  if (!object) throw new DriveError('NOT_FOUND', 404);
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
  const after = await submissionObject(actor,id,asset);
  if (after?.id !== object.id) throw new DriveError('NOT_FOUND', 404);
  return { bytes: result.bytes, mimeType: object.mime_type };
}
