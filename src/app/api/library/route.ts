import { currentSession } from '../../../server/auth/session';
import { driveActor, driveFailure, driveJson } from '../../../server/drive/http';
import { createLibraryItem, featuredLibrary, listLibrary } from '../../../server/library/items';
import { isId } from '../../../server/student-drafts/http';

export async function GET(request: Request) {
  try {
    const session = await currentSession();
    if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
    if (session.user.role === 'admin') return driveJson({ error:'FORBIDDEN' },403);
    const search = new URL(request.url).searchParams;
    const classId = search.get('classId');
    const featured = search.get('featured') === '1';
    if (featured && (session.user.role !== 'student' || (classId !== null && !isId(classId)))) return driveJson({ error:'FORBIDDEN' },403);
    const items = featured ? await featuredLibrary(session.user.id,classId?.toLowerCase()) : await listLibrary(session.user.id,search.get('favorites') === '1');
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
