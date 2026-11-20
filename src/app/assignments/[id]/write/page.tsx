import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../../../../server/auth/session';
import { uuidPattern } from '../../../../server/auth/identity-operations';
import { draftVisible } from '../../../../server/student-drafts/access';
import { DriveError } from '../../../../server/drive/provider';
import { StudentWriter } from './student-writer';
import '../../../editor/editor.css';

export default async function WritePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) redirect('/');
  if (session.user.role !== 'student') notFound();
  const { id: raw } = await params;
  if (!uuidPattern.test(raw)) notFound();
  const id = raw.toLowerCase();
  try { await draftVisible({ student:session.user.id,sessionDigest:session.sessionDigest },id); }
  catch (error) { if (error instanceof DriveError && error.status === 404) notFound(); throw error; }
  if ((await currentSession())?.sessionDigest !== session.sessionDigest) redirect('/');
  return <StudentWriter key={id} assignment={id} student={session.user.id} displayName={session.user.display_name}/>;
}
