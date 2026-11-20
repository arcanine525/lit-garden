import { currentSession } from '../auth/session';
import { appOrigin } from '../auth/oidc';
import { DriveError } from './provider';

export const privateHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

export async function driveActor(request?: Request) {
  if (request && request.headers.get('origin') !== appOrigin()) throw new DriveError('FORBIDDEN', 403);
  const session = await currentSession();
  if (!session) throw new DriveError('UNAUTHENTICATED', 401);
  if (session.user.role !== 'teacher') throw new DriveError('FORBIDDEN', 403);
  return { teacher: session.user.id, sessionDigest: session.sessionDigest };
}

export function driveJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}

export function markdownAttachment(bytes: string | Uint8Array<ArrayBuffer>, filename: string) {
  return new Response(bytes,{
    headers:{ ...privateHeaders,'Content-Type':'text/markdown; charset=utf-8',
      'Content-Disposition':`attachment; filename="${filename}"`,'Cross-Origin-Resource-Policy':'same-origin' }
  });
}

export function driveFailure(error: unknown) {
  return error instanceof DriveError ? driveJson({ error: error.code }, error.status) : driveJson({ error: 'DRIVE_UNAVAILABLE' }, 503);
}
