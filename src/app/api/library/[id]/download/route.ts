import { currentSession } from '../../../../../server/auth/session';
import { driveFailure, driveJson, privateHeaders } from '../../../../../server/drive/http';
import { readLibraryFile } from '../../../../../server/library/items';
import { isId } from '../../../../../server/student-drafts/http';

export async function GET(request: Request,{ params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await currentSession();
    if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
    const { id } = await params;
    if (!isId(id)) return driveJson({ error:'NOT_FOUND' },404);
    const file = await readLibraryFile(session.user.id,id.toLowerCase());
    if ((await currentSession())?.sessionDigest !== session.sessionDigest) return driveJson({ error:'UNAUTHENTICATED' },401);
    const inline = file.extension === 'pdf' && new URL(request.url).searchParams.get('inline') === '1';
    return new Response(new Uint8Array(file.bytes),{ headers:{ ...privateHeaders,'Content-Type':file.mimeType,
      'Content-Disposition':`${inline ? 'inline' : 'attachment'}; filename="tai-lieu.${file.extension}"`,
      'Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'" } });
  } catch (error) { return driveFailure(error); }
}
