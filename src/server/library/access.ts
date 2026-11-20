import { transaction } from '../assignments/access';
import { database } from '../db';
import { DriveError } from '../drive/provider';
import { accessibleLibraryItem, lockLibraryItem, type LibraryActor } from './items';

export async function librarySharing(teacher: string, id: string) {
  const [classes, shares] = await Promise.all([
    database().query<{ id: string; name: string }>("SELECT id,name FROM garden.classes WHERE teacher_id=$1 AND state='active' ORDER BY name,id",[teacher]),
    database().query<{ class_id: string }>('SELECT class_id FROM garden.library_shares WHERE item_id=$1 AND teacher_id=$2',[id,teacher])
  ]);
  return { classes:classes.rows, shared:shares.rows.map(row => row.class_id) };
}

export async function shareLibraryItem(actor: LibraryActor, id: string, classIds: string[]) {
  return transaction(async db => {
    const item = await lockLibraryItem(db,actor,id);
    if (item.state !== 'active') throw new DriveError('NOT_FOUND',404);
    const permitted = await db.query(`SELECT id FROM garden.classes WHERE id=ANY($1::uuid[]) AND teacher_id=$2
      AND state='active' ORDER BY id FOR UPDATE`,[classIds,actor.teacher]);
    if (permitted.rowCount !== classIds.length) throw new DriveError('CLASS_FORBIDDEN',403);
    await db.query('DELETE FROM garden.library_featured WHERE item_id=$1 AND NOT (class_id=ANY($2::uuid[]))',[id,classIds]);
    await db.query('DELETE FROM garden.library_shares WHERE item_id=$1 AND NOT (class_id=ANY($2::uuid[]))',[id,classIds]);
    await db.query(`INSERT INTO garden.library_shares(item_id,class_id,teacher_id)
      SELECT $1,unnest($2::uuid[]),$3 ON CONFLICT DO NOTHING`,[id,classIds,actor.teacher]);
    return { shared:classIds };
  });
}

export async function favoriteLibraryItem(student: string, id: string, favorite: boolean) {
  const row = await accessibleLibraryItem(student,id);
  return transaction(async db => {
    await db.query('SELECT id FROM garden.users WHERE id=$1 FOR UPDATE',[row.teacher_id]);
    const allowed = await db.query(`SELECT 1 FROM garden.users WHERE id=$1 AND role='student' AND garden.can_read_library($1,$2)`,[student,id]);
    if (!allowed.rowCount) throw new DriveError('NOT_FOUND',404);
    if (favorite) await db.query('INSERT INTO garden.library_favorites(item_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,student]);
    else await db.query('DELETE FROM garden.library_favorites WHERE item_id=$1 AND user_id=$2',[id,student]);
    return { favorite };
  });
}
