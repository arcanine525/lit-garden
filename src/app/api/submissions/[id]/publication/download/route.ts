import { currentSession } from '../../../../../../server/auth/session';
import { database } from '../../../../../../server/db';
import { driveFailure, driveJson, markdownAttachment } from '../../../../../../server/drive/http';
import { verifiedPublication } from '../../../../../../server/reviews/publications';
import { submissionForReader } from '../../../../../../server/reviews/source';
import { isId } from '../../../../../../server/student-drafts/http';

export async function GET(request: Request,{ params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await currentSession();
    if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
    const { id } = await params;
    const selected = new URL(request.url).searchParams.get('publication');
    if (!isId(id) || (selected !== null && !isId(selected))) return driveJson({ error:'NOT_FOUND' },404);
    const submission = await submissionForReader(database(),session.user.id,id.toLowerCase());
    const result = await verifiedPublication(session.user.id,submission,selected?.toLowerCase() ?? null);
    if ((await currentSession())?.sessionDigest !== session.sessionDigest) return driveJson({ error:'UNAUTHENTICATED' },401);
    if (!result) return driveJson({ error:'NOT_FOUND' },404);
    return markdownAttachment(new Uint8Array(result.bytes),`nhan-xet-${result.publication.id}.md`);
  } catch (error) { return driveFailure(error); }
}
