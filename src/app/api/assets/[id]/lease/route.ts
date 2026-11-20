import { appOrigin } from '../../../../../server/auth/oidc';
import { currentSession } from '../../../../../server/auth/session';
import { uuidPattern } from '../../../../../server/auth/identity-operations';
import { driveFailure, driveJson } from '../../../../../server/drive/http';
import { issueAssetView } from '../../../../../server/drive/assignment-assets';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get('origin') !== appOrigin()) return driveJson({ error: 'FORBIDDEN' },403);
    const session = await currentSession();
    if (!session) return driveJson({ error: 'UNAUTHENTICATED' },401);
    const { id } = await params;
    if (!uuidPattern.test(id)) return driveJson({ error: 'NOT_FOUND' },404);
    return driveJson(await issueAssetView(session.user.id,session.sessionDigest,id));
  } catch (error) { return driveFailure(error); }
}
