import { sessionUser } from '../../../../../server/auth/session';
import { uuidPattern } from '../../../../../server/auth/identity-operations';
import { driveFailure, driveJson } from '../../../../../server/drive/http';
import { verifyReviewSource } from '../../../../../server/drive/submission-integrity';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await sessionUser();
    if (!user) return driveJson({ error:'UNAUTHENTICATED' },401);
    if (user.role !== 'teacher') return driveJson({ error:'NOT_FOUND' },404);
    const { id } = await params;
    if (!uuidPattern.test(id)) return driveJson({ error:'NOT_FOUND' },404);
    const file = await verifyReviewSource(user.id,id.toLowerCase());
    if ((await sessionUser())?.id !== user.id) return driveJson({ error:'UNAUTHENTICATED' },401);
    return driveJson({ verified:true,submissionSha256:file.submissionSha256 });
  } catch (error) { return driveFailure(error); }
}
