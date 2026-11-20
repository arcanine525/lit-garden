import { appOrigin } from '../../../../../server/auth/oidc';
import { driveFailure, driveJson } from '../../../../../server/drive/http';
import { isId, isVersion, studentActor } from '../../../../../server/student-drafts/http';
import { submissionHistory, submissionIntent, submitWork } from '../../../../../server/student-drafts/submission';
import { studentDraftInput } from '../../../../../server/student-drafts/writer';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const actor = await studentActor();
    const { id } = await params;
    if (!isId(id)) return driveJson({ error:'NOT_FOUND' },404);
    return driveJson(await submissionHistory(actor,id.toLowerCase()));
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request, { params }: Params) {
  try {
    if (request.headers.get('origin') !== appOrigin()) return driveJson({ error:'FORBIDDEN' },403);
    const actor = await studentActor();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!isId(id) || !isId(body?.key)) return driveJson({ error:'INVALID' },422);
    const assignment = id.toLowerCase();
    if (body.action === 'status' || body.action === 'cancel') {
      return driveJson(await submissionIntent(actor,assignment,body.key,body.action === 'cancel'));
    }
    const { key,baseVersion,epoch,clientId } = body;
    if (body.action !== 'submit' || !isVersion(baseVersion) || !isVersion(epoch) || !isId(clientId)) {
      return driveJson({ error:'INVALID' },422);
    }
    const result = await submitWork(actor,assignment,{ key,baseVersion,epoch,clientId },studentDraftInput(body.draft));
    return driveJson(result,result.state === 'unknown' ? 202 : 200);
  } catch (error) { return driveFailure(error); }
}
