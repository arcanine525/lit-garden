import { DriveError, DriveFiles, folderMime, type DriveFile } from './provider';

export function validateParent(file: DriveFile, id: string) {
  if (file.id !== id || file.mimeType !== folderMime || file.trashed || file.driveId ||
      !file.ownedByMe || !file.capabilities?.canAddChildren || ['anyone','domain'].some(type => file.permissions?.some(permission => permission.type === type))) {
    throw new DriveError('DRIVE_PARENT_FORBIDDEN', 403);
  }
}

export async function ensureFolder(
  files: DriveFiles, id: string, parent: string, name: string, kind: string, resource: string, create: boolean
) {
  const marker = { schema: 'garden-folder-1', kind, resource };
  if (create) {
    try { await files.createFolder(id, parent, name, marker); }
    catch (error) {
      if (!(error instanceof DriveError) || error.code !== 'DRIVE_CONFLICT') throw error;
    }
  }
  const file = await files.inspect(id);
  validateParent(file, id);
  if (file.parents?.length !== 1 || file.parents[0] !== parent ||
      Object.entries(marker).some(([key,value]) => file.appProperties?.[key] !== value)) {
    throw new DriveError('DRIVE_INTEGRITY', 409);
  }
  return id;
}
