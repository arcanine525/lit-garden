import { currentSession } from '../../../../../server/auth/session';
import { driveActor, driveFailure, driveJson } from '../../../../../server/drive/http';
import { isId, isVersion } from '../../../../../server/student-drafts/http';
import { publishReview, readPublication } from '../../../../../server/reviews/publications';

type Params = { params: Promise<{ id: string }> };
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export async function GET(request: Request,{ params }: Params) {
  try {
    const session = await currentSession();
    if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
    const { id } = await params;
    const selected = new URL(request.url).searchParams.get('publication');
    if (!isId(id) || (selected !== null && !isId(selected))) return driveJson({ error:'NOT_FOUND' },404);
    const result = await readPublication(session.user.id,id.toLowerCase(),selected?.toLowerCase() ?? null);
    if ((await currentSession())?.sessionDigest !== session.sessionDigest) return driveJson({ error:'UNAUTHENTICATED' },401);
    return driveJson(result);
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request,{ params }: Params) {
  try {
    const actor = await driveActor(request);
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!isId(id) || !body) return driveJson({ error:'INVALID' },422);
    const { key,clientId,epoch,baseVersion,basePublication,draftHash,submissionSha256 } = body;
    if (!isId(key) || !isId(clientId) || !isVersion(epoch) || !isVersion(baseVersion) ||
        (basePublication !== null && !isId(basePublication)) || !digest(draftHash) || !digest(submissionSha256)) {
      return driveJson({ error:'INVALID' },422);
    }
    const result = await publishReview(actor,id.toLowerCase(),{ key,clientId,epoch,baseVersion,basePublication,draftHash,submissionSha256 });
    return driveJson(result,result.state === 'unknown' ? 202 : 200);
  } catch (error) { return driveFailure(error); }
}
