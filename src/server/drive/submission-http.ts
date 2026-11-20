import { sessionUser } from '../auth/session';
import { uuidPattern } from '../auth/identity-operations';
import { driveFailure, driveJson, markdownAttachment, privateHeaders } from './http';
import { readSubmissionFile } from './submission-integrity';

export async function serveSubmission(id: string, asset?: string, download = false) {
  try {
    const user = await sessionUser();
    if (!user) return driveJson({ error: 'UNAUTHENTICATED' }, 401);
    if (!uuidPattern.test(id) || (asset && !uuidPattern.test(asset))) return driveJson({ error: 'NOT_FOUND' }, 404);
    const { bytes, mimeType } = await readSubmissionFile(user.id,id,asset);
    // A session can be revoked while fetching and verifying the provider bytes.
    if ((await sessionUser())?.id !== user.id) return driveJson({ error: 'UNAUTHENTICATED' }, 401);
    if (!asset && download) return markdownAttachment(new Uint8Array(bytes),`bai-nop-${id}.md`);
    return new Response(new Uint8Array(bytes), { headers: {
      ...privateHeaders, 'Content-Type': asset ? mimeType : 'text/markdown; charset=utf-8',
      'Cross-Origin-Resource-Policy': 'same-origin'
    } });
  } catch (error) { return driveFailure(error); }
}
