import { requiredEnv } from './config';
import { database } from './db';
import { metadataReady } from './metadata';

const jsonOptions: RequestInit = {
  cache: 'no-store',
  redirect: 'error'
};

async function probeJson(url: string): Promise<unknown> {
  const response = await fetch(url, { ...jsonOptions, signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('Dependency probe failed');
  return response.json();
}

async function checkDatabase() {
  return metadataReady(database());
}

async function checkOidc() {
  const issuer = requiredEnv('KEYCLOAK_ISSUER').replace(/\/$/, '');
  const jwksUri = `${issuer}/protocol/openid-connect/certs`;
  const discovery = await probeJson(`${issuer}/.well-known/openid-configuration`) as {
    issuer?: string;
    jwks_uri?: string;
    authorization_endpoint?: string;
  } | null;
  if (discovery?.issuer !== issuer ||
      discovery.jwks_uri !== jwksUri ||
      discovery.authorization_endpoint !== `${issuer}/protocol/openid-connect/auth`) return false;
  const jwks = await probeJson(jwksUri) as { keys?: Array<{ kid?: string; use?: string }> } | null;
  return Array.isArray(jwks?.keys) && jwks.keys.some(key => key?.use === 'sig' && key.kid);
}

async function checkDriveMock() {
  const origin = new URL(requiredEnv('DRIVE_MOCK_URL'));
  const state = await probeJson(new URL('/health', origin).href) as { provider?: string; ready?: boolean } | null;
  return state?.provider === 'mock-drive' && state.ready === true;
}

export async function readiness() {
  const mode = process.env.APP_DRIVE_PROVIDER;
  const google = mode === 'google';
  const checkDrive = google ? async () => [
    'APP_DRIVE_GOOGLE_CLIENT_ID', 'APP_DRIVE_GOOGLE_CLIENT_SECRET', 'APP_DRIVE_GOOGLE_PROJECT_NUMBER',
    'APP_DRIVE_GOOGLE_PICKER_KEY', 'APP_DRIVE_KMS_KEY'
  ].every(name => Boolean(process.env[name])) : async () => mode === 'fake' && checkDriveMock();
  const [database, oidc, drive] = await Promise.all(
    [checkDatabase, checkOidc, checkDrive].map(check => check().then(Boolean, () => false))
  );
  return {
    status: database && oidc && drive ? 'ready' : 'unavailable',
    checks: { database, oidc, ...(google ? { googleDriveConfig: drive } : { driveMock: drive }) }
  } as const;
}
