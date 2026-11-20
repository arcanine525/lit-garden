import { appOrigin } from '../../../../../../../server/auth/oidc';
import { currentSession } from '../../../../../../../server/auth/session';
import { driveFailure, driveJson } from '../../../../../../../server/drive/http';
import { isId } from '../../../../../../../server/student-drafts/http';
import { cancelReply, readThread, sendReply } from '../../../../../../../server/reviews/conversation';

type Params = { params: Promise<{ id: string; comment: string }> };

export async function GET(_request: Request,{ params }: Params) {
  try {
    const session = await currentSession();
    if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
    const { id,comment } = await params;
    if (!isId(id) || !isId(comment)) return driveJson({ error:'NOT_FOUND' },404);
    const result = await readThread(session.user.id,id.toLowerCase(),comment.toLowerCase());
    if ((await currentSession())?.sessionDigest !== session.sessionDigest) return driveJson({ error:'UNAUTHENTICATED' },401);
    return driveJson(result);
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request,{ params }: Params) {
  try {
    if (request.headers.get('origin') !== appOrigin()) return driveJson({ error:'FORBIDDEN' },403);
    const session = await currentSession();
    if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
    const { id,comment } = await params;
    if (!isId(id) || !isId(comment)) return driveJson({ error:'NOT_FOUND' },404);
    const data = await request.json().catch(() => null);
    if (!isId(data?.key)) return driveJson({ error:'INVALID_REPLY' },422);
    const actor = { id:session.user.id,sessionDigest:session.sessionDigest };
    if (data.action === 'cancel') return driveJson(await cancelReply(actor,id.toLowerCase(),comment.toLowerCase(),data.key));
    const { key,publicationId,commentDigest,body } = data;
    if (data.action !== 'send' || !isId(publicationId) || typeof commentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(commentDigest) || typeof body !== 'string') {
      return driveJson({ error:'INVALID_REPLY' },422);
    }
    const result = await sendReply(actor,id.toLowerCase(),comment.toLowerCase(),{ key,publicationId,commentDigest,body });
    return driveJson(result,result.state === 'unknown' ? 202 : 200);
  } catch (error) { return driveFailure(error); }
}
