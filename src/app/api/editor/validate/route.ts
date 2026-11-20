import { appOrigin } from '../../../../server/auth/oidc';
import { sessionUser } from '../../../../server/auth/session';
import { uuidPattern } from '../../../../server/auth/identity-operations';
import { driveFailure, driveJson } from '../../../../server/drive/http';
import { validateEditorDraft } from '../../../../server/drive/assignment-assets';

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== appOrigin()) return driveJson({ error: 'FORBIDDEN' },403);
    const user = await sessionUser();
    if (!user) return driveJson({ error: 'UNAUTHENTICATED' },401);
    if (user.role === 'admin') return driveJson({ error: 'FORBIDDEN' },403);
    const body = await request.json().catch(() => null);
    if (!body || (body.assignmentId !== undefined && (typeof body.assignmentId !== 'string' || !uuidPattern.test(body.assignmentId)))) {
      return driveJson({ error: 'INVALID' },422);
    }
    await validateEditorDraft(user.id,user.role,body.markdown,body.assignmentId);
    return driveJson({ valid: true });
  } catch (error) { return driveFailure(error); }
}
