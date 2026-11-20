import { createHash, randomUUID } from 'node:crypto';
import * as oidc from 'openid-client';
import type { PoolClient } from 'pg';
import { database } from '../db';
import { requiredEnv } from '../config';
import { driveMode, driveFileId, authorizationUrl, exchangeCode, refreshAccess, DriveError, DriveFiles } from './provider';
import { ensureFolder, validateParent } from './folders';
import { openToken, sealToken } from './token-vault';

type Actor = { teacher: string; sessionDigest: string };
type TokenRow = {
  teacher_id: string; google_subject: string; refresh_token_ciphertext: Buffer; token_key_id: string;
  generation: string; granted_scopes: string[];
};
type Setup = TokenRow & { parent_folder_id: string | null; app_folder_id: string | null };
export type Connection = TokenRow & {
  parent_folder_id: string; app_folder_id: string; state: 'ready' | 'reconnect_required' | 'unavailable';
  data_started_at: Date | null;
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function teacherTransaction<T>(actor: Actor, work: (db: PoolClient) => Promise<T>) {
  const db = await database().connect();
  try {
    await db.query('BEGIN');
    const authorized = await db.query(`SELECT u.id FROM garden.users u JOIN garden.app_sessions s ON s.user_id=u.id
      WHERE u.id=$1 AND u.role='teacher' AND u.status='active' AND s.auth_epoch=u.auth_epoch
      AND s.handle_digest=$2 AND s.expires_at>now() FOR UPDATE OF u`, [actor.teacher, actor.sessionDigest]);
    if (!authorized.rowCount) throw new DriveError('FORBIDDEN', 403);
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

export async function startDrive(actor: Actor) {
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const verifier = oidc.randomPKCECodeVerifier();
  const url = await authorizationUrl(state, nonce, verifier);
  await teacherTransaction(actor, async db => {
    await db.query('DELETE FROM garden.drive_oauth_attempts WHERE expires_at<=now() OR teacher_id=$1', [actor.teacher]);
    await db.query(`INSERT INTO garden.drive_oauth_attempts(state_digest,session_digest,teacher_id,nonce,verifier,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`, [digest(state), actor.sessionDigest, actor.teacher, nonce, verifier]);
  });
  return url;
}

async function connection(db: PoolClient | ReturnType<typeof database>, teacher: string) {
  const { rows } = await db.query<Connection>('SELECT * FROM garden.drive_connections WHERE teacher_id=$1', [teacher]);
  return rows[0];
}

export async function captureDriveAuthorization(actor: Actor, state: string, search: string) {
  const { rows } = await database().query<{ nonce: string; verifier: string }>(`
    DELETE FROM garden.drive_oauth_attempts WHERE state_digest=$1 AND session_digest=$2 AND teacher_id=$3 AND expires_at>now()
    RETURNING nonce,verifier
  `, [digest(state),actor.sessionDigest,actor.teacher]);
  if (!rows[0]) throw new DriveError('DRIVE_CALLBACK_EXPIRED', 409);
  const authorized = await exchangeCode(search, state, rows[0].nonce, rows[0].verifier);
  const current = await connection(database(), actor.teacher);
  if (current?.data_started_at && current.google_subject !== authorized.subject) throw new DriveError('DRIVE_IDENTITY', 409);
  if (!authorized.refresh && current?.google_subject !== authorized.subject) throw new DriveError('DRIVE_RECONNECT', 409);
  const sealed = authorized.refresh ? await sealToken(authorized.refresh, { teacher: actor.teacher, subject: authorized.subject }) : undefined;
  await teacherTransaction(actor, async db => {
    const established = await connection(db, actor.teacher);
    const sameAccount = established?.google_subject === authorized.subject;
    if (established?.data_started_at && !sameAccount) throw new DriveError('DRIVE_IDENTITY', 409);
    if (!sealed && !sameAccount) throw new DriveError('DRIVE_RECONNECT', 409);
    await db.query(`INSERT INTO garden.drive_setups(
      teacher_id,session_digest,google_subject,refresh_token_ciphertext,token_key_id,granted_scopes,parent_folder_id,app_folder_id,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '20 minutes')
      ON CONFLICT (teacher_id) DO UPDATE SET session_digest=EXCLUDED.session_digest,generation=gen_random_uuid(),
        google_subject=EXCLUDED.google_subject,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,
        token_key_id=EXCLUDED.token_key_id,granted_scopes=EXCLUDED.granted_scopes,expires_at=EXCLUDED.expires_at,
        parent_folder_id=CASE WHEN drive_setups.google_subject=EXCLUDED.google_subject THEN COALESCE(drive_setups.parent_folder_id,EXCLUDED.parent_folder_id) ELSE EXCLUDED.parent_folder_id END,
        app_folder_id=CASE WHEN drive_setups.google_subject=EXCLUDED.google_subject THEN COALESCE(drive_setups.app_folder_id,EXCLUDED.app_folder_id) ELSE EXCLUDED.app_folder_id END
    `, [actor.teacher,actor.sessionDigest,authorized.subject,sealed?.ciphertext ?? established?.refresh_token_ciphertext,
      sealed?.keyId ?? established?.token_key_id,authorized.scopes,sameAccount ? established.parent_folder_id : null,
      sameAccount ? established.app_folder_id : null]);
  });
}

async function setup(db: PoolClient | ReturnType<typeof database>, actor: Actor) {
  const { rows } = await db.query<Setup>(`SELECT * FROM garden.drive_setups
    WHERE teacher_id=$1 AND session_digest=$2 AND expires_at>now()`, [actor.teacher,actor.sessionDigest]);
  return rows[0];
}

export async function driveStatus(actor: Actor) {
  const [established, pending] = await Promise.all([connection(database(), actor.teacher), setup(database(), actor)]);
  return { state: established?.state ?? 'not_connected',
    pending: pending ? (pending.parent_folder_id ? 'verify' : 'pick') : null,
    provider: driveMode() };
}

const inflight = new Map<string, Promise<string>>();

async function accessToken(row: TokenRow, source: 'drive_connections' | 'drive_setups') {
  const key = `${source}:${row.teacher_id}:${row.generation}`;
  let attempt = inflight.get(key);
  if (!attempt) {
    attempt = (async () => {
      const context = { teacher: row.teacher_id, subject: row.google_subject };
      const refresh = await openToken(row.refresh_token_ciphertext,row.token_key_id,context);
      try {
        const tokens = await refreshAccess(refresh);
        if (tokens.refresh && tokens.refresh !== refresh) {
          const next = await sealToken(tokens.refresh, context);
          await database().query(`UPDATE garden.${source} SET refresh_token_ciphertext=$3,token_key_id=$4
            WHERE teacher_id=$1 AND generation=$2 AND refresh_token_ciphertext=$5`,
            [row.teacher_id,row.generation,next.ciphertext,next.keyId,row.refresh_token_ciphertext]);
        }
        return tokens.access;
      } catch (error) {
        if (source === 'drive_connections' && error instanceof DriveError && error.code === 'DRIVE_RECONNECT') {
          await database().query(`UPDATE garden.drive_connections SET state='reconnect_required',checked_at=now()
            WHERE teacher_id=$1 AND generation=$2 AND refresh_token_ciphertext=$3`,
            [row.teacher_id,row.generation,row.refresh_token_ciphertext]);
        }
        throw error;
      }
    })().finally(() => inflight.delete(key));
    inflight.set(key, attempt);
  }
  return attempt;
}

export async function pickerOptions(actor: Actor) {
  const pending = await setup(database(),actor);
  if (!pending || pending.parent_folder_id) throw new DriveError('DRIVE_SETUP_REQUIRED', 409);
  const access = await accessToken(pending,'drive_setups');
  if (driveMode() === 'fake') return { folders: await new DriveFiles(access).fakeFolders() };
  return { accessToken: access, projectNumber: requiredEnv('APP_DRIVE_GOOGLE_PROJECT_NUMBER'),
    developerKey: requiredEnv('APP_DRIVE_GOOGLE_PICKER_KEY') };
}

export async function finishDriveSetup(actor: Actor, selected?: string) {
  const pending = await setup(database(),actor);
  const established = await connection(database(),actor.teacher);
  if (!pending) {
    if (established?.state === 'ready' && !selected) return { state: 'ready' };
    throw new DriveError('DRIVE_SETUP_REQUIRED', 409);
  }
  const parent = pending.parent_folder_id ?? selected;
  if (!parent || !driveFileId.test(parent) || (selected && selected !== parent)) throw new DriveError('DRIVE_PARENT_FORBIDDEN', 403);
  const files = new DriveFiles(await accessToken(pending,'drive_setups'));
  if (driveMode() === 'fake' && selected) await files.fakeSelect(parent);
  validateParent(await files.inspect(parent), parent);
  const proposed = pending.app_folder_id ?? await files.generateId();
  const reserved = await teacherTransaction(actor, async db => {
    const current = await setup(db,actor);
    if (!current || current.generation !== pending.generation) throw new DriveError('DRIVE_SETUP_CHANGED', 409);
    if (current.parent_folder_id && current.parent_folder_id !== parent) throw new DriveError('DRIVE_SETUP_CHANGED', 409);
    if (current.app_folder_id) return current.app_folder_id;
    await db.query('UPDATE garden.drive_setups SET parent_folder_id=$2,app_folder_id=$3 WHERE teacher_id=$1', [actor.teacher,parent,proposed]);
    return proposed;
  });
  const existingFolder = established?.app_folder_id === reserved;
  await ensureFolder(files,reserved,parent,'Vườn Văn','app',actor.teacher,!existingFolder);
  return teacherTransaction(actor, async db => {
    const current = await setup(db, actor);
    const previous = await connection(db, actor.teacher);
    if (!current && previous?.app_folder_id === reserved && previous.state === 'ready') return { state: 'ready' };
    if (!current || current.generation !== pending.generation) throw new DriveError('DRIVE_SETUP_CHANGED', 409);
    if (previous?.data_started_at && previous.google_subject !== current.google_subject) throw new DriveError('DRIVE_IDENTITY', 409);
    await db.query(`INSERT INTO garden.drive_connections(teacher_id,google_subject,parent_folder_id,app_folder_id,
       refresh_token_ciphertext,token_key_id,granted_scopes,state,checked_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'ready',now()) ON CONFLICT (teacher_id) DO UPDATE SET
        google_subject=EXCLUDED.google_subject,parent_folder_id=EXCLUDED.parent_folder_id,app_folder_id=EXCLUDED.app_folder_id,
        refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,token_key_id=EXCLUDED.token_key_id,granted_scopes=EXCLUDED.granted_scopes,
        checked_at=now(),state='ready',generation=gen_random_uuid()
    `, [actor.teacher,current.google_subject,parent,reserved,current.refresh_token_ciphertext,current.token_key_id,current.granted_scopes]);
    await db.query('DELETE FROM garden.drive_setups WHERE teacher_id=$1', [actor.teacher]);
    await db.query(`INSERT INTO garden.audit_events(actor_id,action_code,target_kind,target_id,outcome)
      VALUES($1,'DRIVE_CONNECT','user',$1,'success')`, [actor.teacher]);
    return { state: 'ready' };
  });
}

export async function connectedDrive(teacher: string) {
  const row = await connection(database(),teacher);
  if (!row || row.state !== 'ready') throw new DriveError('DRIVE_SETUP_REQUIRED', 409);
  return { row, files: new DriveFiles(await accessToken(row,'drive_connections')) };
}
