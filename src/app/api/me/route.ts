import { sessionUser } from '../../../server/auth/session';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const user = await sessionUser();
    if (!user) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401, headers });
    return Response.json({ user }, { headers });
  } catch {
    return Response.json({ error: 'UNAVAILABLE' }, { status: 503, headers });
  }
}
