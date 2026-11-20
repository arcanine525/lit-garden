import { appOrigin } from '../../../../server/auth/oidc';
import { currentSession } from '../../../../server/auth/session';
import { driveActor, driveFailure, driveJson } from '../../../../server/drive/http';
import { favoriteLibraryItem, shareLibraryItem } from '../../../../server/library/access';
import { libraryForm, libraryInput } from '../../../../server/library/format';
import { readLibraryItem, saveLibraryItem } from '../../../../server/library/items';
import { isId, isVersion } from '../../../../server/student-drafts/http';
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request,{ params }: Params) {
  try {
    const session = await currentSession();
    if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
    const { id } = await params;
    if (!isId(id)) return driveJson({ error:'NOT_FOUND' },404);
    const { row,manifest,markdown } = await readLibraryItem(session.user.id,id.toLowerCase());
    if ((await currentSession())?.sessionDigest !== session.sessionDigest) return driveJson({ error:'UNAUTHENTICATED' },401);
    const { title,category,author,sourceLabel,excerpt,format } = manifest;
    return driveJson({ id:row.id,version:row.version,title,category,author,sourceLabel,excerpt,format,markdown });
  } catch (error) { return driveFailure(error); }
}

export async function PUT(request: Request,{ params }: Params) {
  try {
    const actor = await driveActor(request);
    const { id } = await params;
    if (!isId(id)) return driveJson({ error:'NOT_FOUND' },404);
    const form = await libraryForm(request);
    const key = form.get('key'), version = form.get('version');
    if (!isId(key) || !isVersion(version)) return driveJson({ error:'INVALID_LIBRARY' },422);
    const result = await saveLibraryItem(actor,id.toLowerCase(),key,version,await libraryInput(form));
    return driveJson(result,result.state === 'unknown' ? 202 : 200);
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request,{ params }: Params) {
  try {
    if (request.headers.get('origin') !== appOrigin()) return driveJson({ error:'FORBIDDEN' },403);
    const session = await currentSession();
    if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
    const { id:raw } = await params;
    if (!isId(raw)) return driveJson({ error:'NOT_FOUND' },404);
    const id = raw.toLowerCase();
    const input = await request.json().catch(() => null);
    if (session.user.role === 'student' && input?.action === 'favorite' && typeof input.favorite === 'boolean') {
      return driveJson(await favoriteLibraryItem(session.user.id,id,input.favorite));
    }
    if (session.user.role === 'teacher' && input?.action === 'share' && Array.isArray(input.classIds) && input.classIds.length <= 250 &&
        input.classIds.every(isId) && new Set(input.classIds.map((id: string) => id.toLowerCase())).size === input.classIds.length) {
      return driveJson(await shareLibraryItem({ teacher:session.user.id,sessionDigest:session.sessionDigest },id,
        input.classIds.map((id: string) => id.toLowerCase())));
    }
    return driveJson({ error:'FORBIDDEN' },403);
  } catch (error) { return driveFailure(error); }
}
