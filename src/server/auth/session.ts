import { createHash, randomBytes } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { database } from '../db';
import { appOrigin } from './oidc';

export const sessionCookie = 'garden_session';
export const flowCookie = 'garden_oidc';
const sessionTtl = 8 * 60 * 60;
export const attemptTtl = 10 * 60;
const randomHandle = () => randomBytes(32).toString('base64url');
const digest = (handle: string) => createHash('sha256').update(handle).digest('hex');
const validHandle = (handle: string) => /^[\w-]{43}$/.test(handle);

type SessionUser = {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'teacher' | 'student';
};
type Attempt = { state: string; nonce: string; verifier: string };

export function setAuthCookie(response: NextResponse, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, {
    maxAge, httpOnly: true, secure: new URL(appOrigin()).protocol === 'https:', sameSite: 'lax', path: '/'
  });
  response.headers.set('Cache-Control', 'no-store');
}

export async function saveAttempt({ state, nonce, verifier }: Attempt) {
  const handle = randomHandle();
  await database().query('DELETE FROM garden.oidc_attempts WHERE expires_at <= now()');
  await database().query(`
    INSERT INTO garden.oidc_attempts(handle_digest, state, nonce, verifier, expires_at)
    VALUES ($1, $2, $3, $4, now() + $5 * interval '1 second')
  `, [digest(handle), state, nonce, verifier, attemptTtl]);
  return handle;
}

export async function consumeAttempt(handle: string, state: string) {
  if (!validHandle(handle)) return null;
  const { rows } = await database().query<Attempt>(`
    DELETE FROM garden.oidc_attempts
    WHERE handle_digest=$1 AND state=$2 AND expires_at > now()
    RETURNING state, nonce, verifier
  `, [digest(handle), state]);
  return rows[0] ?? null;
}

export async function createSession(userId: string, authEpoch: string, authTime: number) {
  const handle = randomHandle();
  await database().query('DELETE FROM garden.app_sessions WHERE expires_at <= now()');
  const result = await database().query(`
    INSERT INTO garden.app_sessions(handle_digest, user_id, auth_epoch, expires_at, authenticated_at)
    SELECT $1, id, auth_epoch, now() + $4 * interval '1 second', to_timestamp($5)
    FROM garden.users WHERE id=$2 AND auth_epoch=$3 AND status='active'
  `, [digest(handle), userId, authEpoch, sessionTtl, authTime]);
  return result.rowCount === 1 ? { handle, maxAge: sessionTtl } : null;
}

export async function sessionUser(): Promise<SessionUser | null> {
  const session = await currentSession();
  return session?.user ?? null;
}

export async function currentSession() {
  const handle = (await cookies()).get(sessionCookie)?.value;
  if (!handle || !validHandle(handle)) return null;
  const { rows } = await database().query<SessionUser & { recent_auth: boolean }>(`
    SELECT users.id, users.username, users.display_name, users.role,
      COALESCE(session.authenticated_at > now() - interval '5 minutes', false) AS recent_auth
    FROM garden.app_sessions AS session JOIN garden.users ON users.id=session.user_id
    WHERE session.handle_digest=$1 AND session.expires_at>now()
      AND session.auth_epoch=users.auth_epoch AND users.status='active'
  `, [digest(handle)]);
  if (!rows[0]) return null;
  const { recent_auth, ...user } = rows[0];
  return { user, recentAuth: recent_auth, sessionDigest: digest(handle) };
}

export async function revokeSession(handle: string | undefined) {
  if (!handle || !validHandle(handle)) return;
  await database().query('DELETE FROM garden.app_sessions WHERE handle_digest=$1', [digest(handle)]);
}
