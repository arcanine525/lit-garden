import { randomUUID } from 'node:crypto';
import * as oidc from 'openid-client';
import { appOrigin } from '../auth/oidc';
import { requiredEnv } from '../config';

export const folderMime = 'application/vnd.google-apps.folder';
export const driveScope = 'https://www.googleapis.com/auth/drive.file';
const scopes = ['openid', driveScope];
export const driveFileId = /^[a-zA-Z0-9_-]{1,180}$/;

export class DriveError extends Error {
  constructor(public readonly code: string, public readonly status = 503) { super(code); }
}

export function driveMode(): 'fake' | 'google' {
  const mode = process.env.APP_DRIVE_PROVIDER;
  if (mode === 'fake' || mode === 'google') return mode;
  throw new DriveError('DRIVE_NOT_CONFIGURED');
}

function fakeOrigin() {
  const url = new URL(requiredEnv('DRIVE_MOCK_URL'));
  if (url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) {
    throw new DriveError('DRIVE_NOT_CONFIGURED');
  }
  return url.origin;
}

const callback = () => new URL('/api/drive/callback', appOrigin());
let googleClient: Promise<oidc.Configuration> | undefined;

function oauthClient() {
  if (googleClient) return googleClient;
  const fake = driveMode() === 'fake';
  const issuer = new URL(fake ? fakeOrigin() : 'https://accounts.google.com');
  const prefix = fake ? 'APP_DRIVE_FAKE_CLIENT' : 'APP_DRIVE_GOOGLE_CLIENT';
  const secret = requiredEnv(`${prefix}_SECRET`);
  const execute = fake ? [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks] : [oidc.enableNonRepudiationChecks];
  googleClient = oidc.discovery(issuer, requiredEnv(`${prefix}_ID`), secret, oidc.ClientSecretPost(secret), { execute })
    .then(config => { config.timeout = 8; return config; }).catch(error => { googleClient = undefined; throw error; });
  return googleClient;
}

export async function authorizationUrl(state: string, nonce: string, verifier: string) {
  return oidc.buildAuthorizationUrl(await oauthClient(), {
    redirect_uri: callback().href, scope: scopes.join(' '), state, nonce, access_type: 'offline',
    prompt: 'consent', code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256'
  });
}

function checkScopes(value: string | undefined) {
  const granted = value?.split(/\s+/).filter(Boolean) ?? [];
  if (!granted.includes(driveScope) || granted.some(scope => !scopes.includes(scope))) throw new DriveError('DRIVE_SCOPE', 403);
  return granted;
}

export async function exchangeCode(search: string, state: string, nonce: string, verifier: string) {
  const url = callback();
  url.search = search;
  const result = await oidc.authorizationCodeGrant(await oauthClient(), url, {
    expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier, idTokenExpected: true
  });
  const subject = result.claims()?.sub;
  if (!subject) throw new DriveError('DRIVE_AUTH', 403);
  return { subject, scopes: checkScopes(result.scope), refresh: result.refresh_token };
}

export async function refreshAccess(refreshToken: string) {
  try {
    const result = await oidc.refreshTokenGrant(await oauthClient(), refreshToken);
    if (result.scope !== undefined) checkScopes(result.scope);
    return { access: result.access_token, refresh: result.refresh_token };
  } catch (error) {
    if (error instanceof DriveError) throw error;
    if (error instanceof oidc.ResponseBodyError && error.error === 'invalid_grant') throw new DriveError('DRIVE_RECONNECT', 409);
    throw new DriveError('DRIVE_UNAVAILABLE');
  }
}

export type DriveFile = {
  id: string; name: string; mimeType: string; parents?: string[]; version?: string; size?: string;
  driveId?: string; ownedByMe: boolean; trashed: boolean; capabilities?: { canAddChildren: boolean };
  appProperties?: Record<string, string>; permissions?: Array<{ type: string }>;
};

const fields = 'id,name,mimeType,parents,version,size,driveId,ownedByMe,trashed,capabilities(canAddChildren),appProperties,permissions(type)';

export class DriveFiles {
  constructor(private readonly access: string) {}

  private async call(path: string, init: RequestInit = {}) {
    const base = driveMode() === 'fake' ? fakeOrigin() : 'https://www.googleapis.com';
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.access}`);
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, { ...init, headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    } catch { throw new DriveError('DRIVE_UNAVAILABLE'); }
    if (response.ok) return response;
    if (response.status === 401) throw new DriveError('DRIVE_RECONNECT', 409);
    if (response.status === 404) throw new DriveError('DRIVE_MISSING', 404);
    if (response.status === 409) throw new DriveError('DRIVE_CONFLICT', 409);
    if (response.status === 429) throw new DriveError('DRIVE_QUOTA', 503);
    if (response.status === 403) {
      const payload = await response.json().catch(() => null);
      const reason = payload?.error?.errors?.[0]?.reason;
      if (['rateLimitExceeded','userRateLimitExceeded','storageQuotaExceeded','dailyLimitExceeded'].includes(reason)) {
        throw new DriveError('DRIVE_QUOTA');
      }
      throw new DriveError('DRIVE_FORBIDDEN', 403);
    }
    throw new DriveError('DRIVE_UNAVAILABLE');
  }

  async inspect(id: string): Promise<DriveFile> {
    if (!driveFileId.test(id)) throw new DriveError('DRIVE_INTEGRITY', 409);
    return (await this.call(`/drive/v3/files/${id}?fields=${encodeURIComponent(fields)}`)).json();
  }

  async trash(id: string) {
    if (!driveFileId.test(id)) throw new DriveError('DRIVE_INTEGRITY',409);
    await this.call(`/drive/v3/files/${id}?fields=id,trashed`,{
      method:'PATCH',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ trashed:true })
    });
  }

  async generateId(): Promise<string> {
    const json = await (await this.call('/drive/v3/files/generateIds?count=1&space=drive')).json();
    if (typeof json.ids?.[0] !== 'string' || !driveFileId.test(json.ids[0])) throw new DriveError('DRIVE_UNAVAILABLE');
    return json.ids[0];
  }

  async createFolder(id: string, parent: string, name: string, appProperties: Record<string, string>) {
    await this.call('/drive/v3/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, parents: [parent], mimeType: folderMime, appProperties })
    });
  }

  async fakeFolders(): Promise<Array<{ id: string; name: string }>> {
    if (driveMode() !== 'fake') throw new DriveError('DRIVE_NOT_CONFIGURED');
    return (await this.call('/fake/picker')).json();
  }

  async fakeSelect(id: string) {
    if (driveMode() !== 'fake') throw new DriveError('DRIVE_NOT_CONFIGURED');
    await this.call('/fake/picker', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
    });
  }

  async upload(id: string, parent: string, name: string, mimeType: string, bytes: Buffer, appProperties: Record<string, string>) {
    const boundary = randomUUID();
    const metadata = JSON.stringify({ id, name, mimeType, parents: [parent], appProperties });
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    await this.call('/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: new Uint8Array(payload)
    });
  }

  async download(id: string, size: number) {
    if (!driveFileId.test(id) || !Number.isSafeInteger(size) || size < 0) throw new DriveError('DRIVE_INTEGRITY', 409);
    const response = await this.call(`/drive/v3/files/${id}?alt=media`);
    if (!response.body) throw new DriveError('DRIVE_INTEGRITY', 409);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let received = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > size) {
          await reader.cancel();
          throw new DriveError('DRIVE_INTEGRITY', 409);
        }
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      if (error instanceof DriveError) throw error;
      throw new DriveError('DRIVE_UNAVAILABLE');
    } finally { reader.releaseLock(); }
    if (received !== size) throw new DriveError('DRIVE_INTEGRITY', 409);
    return Buffer.concat(chunks, received);
  }
}
