import { appOrigin } from '../../../../../server/auth/oidc';
import { currentSession } from '../../../../../server/auth/session';
import { uuidPattern } from '../../../../../server/auth/identity-operations';
import { driveFailure, driveJson } from '../../../../../server/drive/http';
import { DriveError } from '../../../../../server/drive/provider';
import { readDraft } from '../../../../../server/student-drafts/access';
import { saveStudentDraft, studentDraftInput, studentLease } from '../../../../../server/student-drafts/writer';

type Params = { params: Promise<{ id: string }> };
const isId = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);
const isVersion = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) &&
  BigInt(value) < 9_223_372_036_854_775_807n;

async function student() {
  const session = await currentSession();
  if (!session) throw new DriveError('UNAUTHENTICATED',401);
  if (session.user.role !== 'student') throw new DriveError('FORBIDDEN',403);
  return { student:session.user.id, sessionDigest:session.sessionDigest };
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const actor = await student();
    const { id } = await params;
    if (!isId(id)) return driveJson({ error:'DRAFT_NOT_FOUND' },404);
    return driveJson(await readDraft(actor,id.toLowerCase()));
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request, { params }: Params) {
  try {
    if (request.headers.get('origin') !== appOrigin()) return driveJson({ error:'FORBIDDEN' },403);
    const actor = await student();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!isId(id) || !body || !isId(body.clientId)) return driveJson({ error:'INVALID' },422);
    const assignment = id.toLowerCase();
    switch (body.action) {
      case 'acquire': case 'takeover': case 'renew': case 'release':
        if ((body.action === 'renew' || body.action === 'release') && !isVersion(body.epoch)) return driveJson({ error:'INVALID' },422);
        return driveJson(await studentLease(actor,assignment,body.action,body.clientId,body.epoch));
      case 'save': {
        const { key,baseVersion,epoch,clientId } = body;
        if (!isId(key) || !isVersion(baseVersion) || !isVersion(epoch)) return driveJson({ error:'INVALID' },422);
        const result = await saveStudentDraft(actor,assignment,{ key,baseVersion,epoch,clientId },studentDraftInput(body.draft));
        return driveJson(result,result.state === 'unknown' ? 202 : 200);
      }
      default: return driveJson({ error:'INVALID' },422);
    }
  } catch (error) { return driveFailure(error); }
}
