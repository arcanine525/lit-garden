import { sessionUser } from '../../../../server/auth/session';
import { uuidPattern } from '../../../../server/auth/identity-operations';
import { driveActor, driveFailure, driveJson } from '../../../../server/drive/http';
import { assignmentDetails } from '../../../../server/assignments/access';
import { assignmentLease, publishAssignment, saveAssignment } from '../../../../server/assignments/mutations';
import { deadlineInput, draftInput } from '../../../../server/assignments/bundle';
import { changeAccepting, extendDeadline, publishReference, submissionTimings } from '../../../../server/assignments/lifecycle';

type Params = { params: Promise<{ id: string }> };
const isId = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);
const version = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) &&
  BigInt(value) < 9_223_372_036_854_775_807n;

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await sessionUser();
    if (!user) return driveJson({ error: 'UNAUTHENTICATED' },401);
    const { id } = await params;
    if (!isId(id)) return driveJson({ error:'ASSIGNMENT_NOT_FOUND' },404);
    const detail = await assignmentDetails(user.id,id.toLowerCase());
    const timings = detail.state === 'published' ? await submissionTimings(user.id,detail.id) : undefined;
    if ((await sessionUser())?.id !== user.id) return driveJson({ error: 'UNAUTHENTICATED' },401);
    return driveJson({ ...detail, ...(timings ? { timings } : {}) });
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await driveActor(request);
    const { id: raw } = await params;
    const body = await request.json().catch(() => null);
    if (!isId(raw) || !body) return driveJson({ error:'INVALID' },422);
    const id = raw.toLowerCase();
    switch (body.action) {
      case 'close': case 'reopen':
        if (!version(body.expectedVersion)) return driveJson({ error:'INVALID' },422);
        return driveJson(await changeAccepting(actor.teacher,id,body.action === 'reopen',body.expectedVersion));
      case 'publish_reference':
        if (!version(body.expectedVersion)) return driveJson({ error:'INVALID' },422);
        return driveJson(await publishReference(actor.teacher,id,body.expectedVersion));
      case 'extend_deadline':
        if (!version(body.expectedVersion) || !isId(body.key)) return driveJson({ error:'INVALID' },422);
        return driveJson(await extendDeadline(actor.teacher,id,body.key,body.expectedVersion,deadlineInput(body.dueAt)));
      case 'acquire': case 'takeover': case 'renew': case 'release':
        if (!isId(body.clientId)) return driveJson({ error:'INVALID' },422);
        if ((body.action === 'renew' || body.action === 'release') && !version(body.epoch)) return driveJson({ error:'INVALID' },422);
        return driveJson(await assignmentLease(actor.teacher,id,body.clientId,body.action,body.epoch));
      case 'save': case 'publish': {
        const { key, baseVersion, epoch, clientId } = body;
        if (!isId(key) || !isId(clientId) || !version(baseVersion) || !version(epoch)) return driveJson({ error:'INVALID' },422);
        const snapshot = { key, baseVersion, epoch, clientId };
        if (body.action === 'publish' && (typeof body.hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.hash))) return driveJson({ error:'INVALID' },422);
        const result = body.action === 'save' ? await saveAssignment(actor.teacher,id,snapshot,draftInput(body.draft)) :
          await publishAssignment(actor.teacher,id,snapshot,body.hash);
        return driveJson(result,result.state === 'unknown' ? 202 : 200);
      }
      default: return driveJson({ error:'INVALID' },422);
    }
  } catch (error) { return driveFailure(error); }
}
