import { appOrigin } from '../../../../../server/auth/oidc';
import { driveFailure, driveJson, markdownAttachment } from '../../../../../server/drive/http';
import { formatDraftMarkdown } from '../../../../../shared/draft-markdown';
import { readDraft } from '../../../../../server/student-drafts/access';
import { isId, isVersion, studentActor } from '../../../../../server/student-drafts/http';
import { saveStudentDraft, studentDraftInput, studentLease } from '../../../../../server/student-drafts/writer';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  try {
    const actor = await studentActor();
    const { id } = await params;
    if (!isId(id)) return driveJson({ error:'DRAFT_NOT_FOUND' },404);
    const result = await readDraft(actor,id.toLowerCase());
    if (new URL(request.url).searchParams.get('download') === '1') {
      return markdownAttachment(formatDraftMarkdown(result.draft),'vuon-van-nhap.md');
    }
    return driveJson(result);
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request, { params }: Params) {
  try {
    if (request.headers.get('origin') !== appOrigin()) return driveJson({ error:'FORBIDDEN' },403);
    const actor = await studentActor();
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
