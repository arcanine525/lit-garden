import { currentSession } from '../../../server/auth/session';
import { driveActor, driveFailure, driveJson } from '../../../server/drive/http';
import { createLibraryItem, listLibrary } from '../../../server/library/items';
import { isId } from '../../../server/student-drafts/http';

export async function GET(request: Request) {
  try {
    const session = await currentSession();
    if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
    if (session.user.role === 'admin') return driveJson({ error:'FORBIDDEN' },403);
    const favorite = new URL(request.url).searchParams.get('favorites') === '1';
    const items = await listLibrary(session.user.id,favorite);
    if ((await currentSession())?.sessionDigest !== session.sessionDigest) return driveJson({ error:'UNAUTHENTICATED' },401);
    return driveJson({ items });
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await driveActor(request);
    const input = await request.json().catch(() => null);
    if (!isId(input?.id)) return driveJson({ error:'INVALID_LIBRARY' },422);
    return driveJson(await createLibraryItem(actor,input.id.toLowerCase()),201);
  } catch (error) { return driveFailure(error); }
}
