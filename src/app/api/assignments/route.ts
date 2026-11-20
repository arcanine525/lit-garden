import { sessionUser } from '../../../server/auth/session';
import { uuidPattern } from '../../../server/auth/identity-operations';
import { driveActor, driveFailure, driveJson } from '../../../server/drive/http';
import { createAssignment } from '../../../server/assignments/mutations';
import { listAssignments } from '../../../server/assignments/access';

export async function GET() {
  try {
    const user = await sessionUser();
    if (!user) return driveJson({ error: 'UNAUTHENTICATED' },401);
    if (user.role === 'admin') return driveJson({ error: 'FORBIDDEN' },403);
    const assignments = await listAssignments(user.id);
    if ((await sessionUser())?.id !== user.id) return driveJson({ error: 'UNAUTHENTICATED' },401);
    return driveJson({ assignments });
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await driveActor(request);
    const { id, classId, rubricId, rubricRevision } = await request.json().catch(() => ({})) ?? {};
    if ([id,classId,rubricId].some(value => typeof value !== 'string' || !uuidPattern.test(value)) ||
      !Number.isSafeInteger(rubricRevision) || rubricRevision < 1 || rubricRevision > 2_147_483_647) {
      return driveJson({ error:'INVALID' },422);
    }
    return driveJson(await createAssignment(actor.teacher,id,classId,rubricId,rubricRevision),201);
  } catch (error) { return driveFailure(error); }
}
