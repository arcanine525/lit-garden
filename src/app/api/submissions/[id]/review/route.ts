import { driveActor, driveFailure, driveJson } from '../../../../../server/drive/http';
import { readReviewDraft, reviewLease, saveReviewDraft } from '../../../../../server/reviews/drafts';
import { reviewSource } from '../../../../../server/reviews/source';
import { isId, isVersion } from '../../../../../server/student-drafts/http';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request,{ params }: Params) {
  try {
    const { teacher,sessionDigest } = await driveActor();
    const { id } = await params;
    if (!isId(id)) return driveJson({ error:'NOT_FOUND' },404);
    const draft = await readReviewDraft(teacher,await reviewSource(teacher,id.toLowerCase()));
    if ((await driveActor()).sessionDigest !== sessionDigest) return driveJson({ error:'UNAUTHENTICATED' },401);
    return driveJson(draft);
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request,{ params }: Params) {
  try {
    const actor = await driveActor(request);
    const { id:raw } = await params;
    const body = await request.json().catch(() => null);
    if (!isId(raw) || !isId(body?.clientId)) return driveJson({ error:'INVALID' },422);
    const id = raw.toLowerCase();
    const { action,clientId,epoch,key,baseVersion } = body;
    switch (action) {
      case 'acquire': case 'takeover': case 'renew': case 'release':
        if ((action === 'renew' || action === 'release') && !isVersion(epoch)) return driveJson({ error:'INVALID' },422);
        return driveJson(await reviewLease(actor,id,action,clientId,epoch));
      case 'save': {
        if (!isVersion(epoch) || !isVersion(baseVersion) || !isId(key)) return driveJson({ error:'INVALID' },422);
        const result = await saveReviewDraft(actor,id,{ key,clientId,epoch,baseVersion },body.draft);
        return driveJson(result,result.state === 'unknown' ? 202 : 200);
      }
      default: return driveJson({ error:'INVALID' },422);
    }
  } catch (error) { return driveFailure(error); }
}
