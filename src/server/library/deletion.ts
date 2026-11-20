import type { PoolClient } from 'pg';
import { transaction } from '../assignments/access';
import { database } from '../db';
import { connectedDrive } from '../drive/connection';
import { DriveError } from '../drive/provider';
import { trashManagedFile, type DriveObject } from '../drive/storage';
import { lockLibraryItem, sha256, type LibraryActor } from './items';

async function captureFiles(db: PoolClient, teacher: string, item: string, operation: string) {
  await db.query(`INSERT INTO garden.library_delete_files(operation_id,object_id,teacher_id)
    SELECT $3,o.id,o.teacher_id FROM garden.drive_objects o JOIN garden.operations op ON op.id=o.operation_id
    WHERE o.teacher_id=$1 AND op.target_kind='library' AND op.target_id=$2 AND op.kind IN ('asset_upload','library_save')
    ON CONFLICT DO NOTHING`,[teacher,item,operation]);
}

async function begin(actor: LibraryActor, id: string, key: string, version: string) {
  return transaction(async db => {
    const item = await lockLibraryItem(db,actor,id);
    if (item.state === 'deleted') return null;
    if (item.state === 'deleting') {
      const { rows:[existing] } = await db.query<{ id: string }>(`SELECT id FROM garden.operations WHERE teacher_id=$1
        AND target_id=$2 AND target_kind='library' AND kind='library_delete' AND state<>'rejected'`,[actor.teacher,id]);
      if (!existing) throw new DriveError('LIBRARY_CHANGED',409);
      await captureFiles(db,actor.teacher,id,existing.id);
      return existing.id;
    }
    if (version !== item.version) throw new DriveError('LIBRARY_CHANGED',409);
    const used = await db.query('SELECT 1 FROM garden.operations WHERE actor_id=$1 AND idempotency_key=$2',[actor.teacher,key]);
    if (used.rowCount) throw new DriveError('KEY_REUSED',409);
    await db.query(`WITH rejected AS (
      UPDATE garden.operations SET state='rejected',error_code='POLICY' WHERE teacher_id=$1 AND target_kind='library'
        AND target_id=$2 AND kind IN ('library_save','asset_upload') AND state IN ('reserved','writing','unknown','needs_client','drive_verified') RETURNING id
    ) UPDATE garden.drive_objects SET lifecycle='orphan'
      WHERE operation_id IN (SELECT id FROM rejected) AND lifecycle='candidate'`,[actor.teacher,id]);
    await db.query("UPDATE garden.library_items SET state='deleting',version=version+1 WHERE id=$1",[id]);
    await db.query('DELETE FROM garden.library_featured WHERE item_id=$1',[id]);
    const result = await db.query<{ id: string }>(`INSERT INTO garden.operations(actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,
      request_digest,expected_version) VALUES($1,$1,'library_delete','library',$2,$3,$4,$5) RETURNING id`,
      [actor.teacher,id,key,sha256(JSON.stringify([id,version])),version]);
    await captureFiles(db,actor.teacher,id,result.rows[0].id);
    return result.rows[0].id;
  });
}

const complete = (id: string) => ({ state:'deleted' as const,id });

export async function deleteLibraryItem(actor: LibraryActor, id: string, key: string, version: string) {
  const operation = await begin(actor,id,key,version);
  if (!operation) return complete(id);
  const pending = { state:'deleting' as const,id };
  try {
    const { rows } = await database().query<DriveObject>(`SELECT o.* FROM garden.library_delete_files f JOIN garden.drive_objects o ON o.id=f.object_id
      WHERE f.operation_id=$1 AND f.state<>'trashed' AND o.teacher_id=$2 ORDER BY o.id`,[operation,actor.teacher]);
    if (rows.length) {
      const { files } = await connectedDrive(actor.teacher);
      for (const object of rows) {
        let state = 'trashed';
        try { await trashManagedFile(files,object); }
        catch (error) {
          state = error instanceof DriveError && ['DRIVE_MISSING','DRIVE_FORBIDDEN','DRIVE_INTEGRITY'].includes(error.code) ? 'inaccessible' : 'unknown';
        }
        await database().query(`WITH confirmed AS (UPDATE garden.library_delete_files SET state=$3
          WHERE operation_id=$1 AND object_id=$2 AND state<>'trashed' RETURNING object_id)
          UPDATE garden.drive_objects SET lifecycle='trashed',checked_at=now() WHERE $3='trashed' AND id IN (SELECT object_id FROM confirmed)`,
          [operation,object.id,state]);
      }
    }
    return await transaction(async db => {
      const item = await lockLibraryItem(db,actor,id);
      if (item.state === 'deleted') return complete(id);
      if (item.state !== 'deleting') throw new DriveError('LIBRARY_CHANGED',409);
      await captureFiles(db,actor.teacher,id,operation);
      const remaining = await db.query("SELECT 1 FROM garden.library_delete_files WHERE operation_id=$1 AND state<>'trashed' LIMIT 1",[operation]);
      if (remaining.rowCount) {
        await db.query("UPDATE garden.operations SET state='unknown' WHERE id=$1 AND state='reserved'",[operation]);
        return pending;
      }
      await db.query("UPDATE garden.library_items SET state='deleted',current_object_id=NULL WHERE id=$1",[id]);
      await db.query("UPDATE garden.operations SET state='committed',result_id=$2,error_code=NULL WHERE id=$1",[operation,id]);
      return complete(id);
    });
  } catch (error) {
    if (error instanceof DriveError && error.code === 'FORBIDDEN') throw error;
    return pending;
  }
}

export async function deletingLibraryItems(teacher: string) {
  const { rows } = await database().query<{ id: string; version: string }>(`SELECT id,version FROM garden.library_items
    WHERE teacher_id=$1 AND state='deleting' ORDER BY id`,[teacher]);
  return rows;
}
