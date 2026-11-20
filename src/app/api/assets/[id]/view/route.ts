import { currentSession } from '../../../../../server/auth/session';
import { uuidPattern } from '../../../../../server/auth/identity-operations';
import { driveFailure, driveJson, privateHeaders } from '../../../../../server/drive/http';
import { viewAssignmentAsset } from '../../../../../server/drive/assignment-assets';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await currentSession();
    if (!session) return driveJson({ error: 'UNAUTHENTICATED' },401);
    const { id } = await params;
    const lease = new URL(request.url).searchParams.get('lease');
    if (!uuidPattern.test(id) || !lease || !/^[\w-]{43}$/.test(lease)) return driveJson({ error: 'NOT_FOUND' },404);
    const file = await viewAssignmentAsset(session.user.id,session.sessionDigest,id,lease);
    if ((await currentSession())?.sessionDigest !== session.sessionDigest) return driveJson({ error: 'UNAUTHENTICATED' },401);
    return new Response(new Uint8Array(file.bytes), { headers: {
      ...privateHeaders, 'Cache-Control': 'private, no-store', 'Content-Type': file.mimeType,
      'Cross-Origin-Resource-Policy': 'same-origin'
    } });
  } catch (error) { return driveFailure(error); }
}
