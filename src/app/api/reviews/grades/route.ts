import { currentSession } from '../../../../server/auth/session';
import { driveJson, privateHeaders } from '../../../../server/drive/http';
import { DriveError } from '../../../../server/drive/provider';
import { gradebook } from '../../../../server/reviews/gradebook';
import { isId } from '../../../../server/student-drafts/http';

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return driveJson({ error:'UNAUTHENTICATED' },401);
  if (session.user.role !== 'teacher') return driveJson({ error:'FORBIDDEN' },403);
  const assignment = new URL(request.url).searchParams.get('assignment');
  if (assignment !== null && !isId(assignment)) return driveJson({ error:'NOT_FOUND' },404);
  try {
    const csv = await gradebook(session.user.id,assignment?.toLowerCase());
    if ((await currentSession())?.sessionDigest !== session.sessionDigest) return driveJson({ error:'UNAUTHENTICATED' },401);
    return new Response(csv,{ headers:{ ...privateHeaders,'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':'attachment; filename="bang-diem.csv"' } });
  } catch (error) {
    if (error instanceof DriveError && error.code === 'ASSIGNMENT_NOT_FOUND') return driveJson({ error:'NOT_FOUND' },404);
    if (error instanceof DriveError && error.code === 'GRADEBOOK_CHANGED') return driveJson({ error:error.code },409);
    return driveJson({ error:'GRADEBOOK_UNAVAILABLE' },503);
  }
}
