import { appOrigin } from '../../../server/auth/oidc';
import { currentSession } from '../../../server/auth/session';
import { driveJson } from '../../../server/drive/http';
import { listNotifications, markNotificationRead } from '../../../server/notifications';
import { isId } from '../../../server/student-drafts/http';

export async function GET() {
  const session = await currentSession();
  if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
  if (session.user.role === 'admin') return driveJson({ error:'FORBIDDEN' },403);
  const notifications = await listNotifications(session.user.id);
  if ((await currentSession())?.sessionDigest !== session.sessionDigest) return driveJson({ error:'UNAUTHENTICATED' },401);
  return driveJson({ notifications });
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== appOrigin()) return driveJson({ error:'FORBIDDEN' },403);
  const session = await currentSession();
  if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
  if (session.user.role === 'admin') return driveJson({ error:'FORBIDDEN' },403);
  const body = await request.json().catch(() => null);
  if (!isId(body?.id)) return driveJson({ error:'NOT_FOUND' },404);
  const readAt = await markNotificationRead(session.user.id,session.sessionDigest,body.id.toLowerCase());
  return readAt ? driveJson({ readAt }) : driveJson({ error:'NOT_FOUND' },404);
}
