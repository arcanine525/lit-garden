import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../../server/auth/session';
import { driveStatus } from '../../server/drive/connection';
import { DriveConnection } from './drive-connection';

export default async function DrivePage({ searchParams }: { searchParams: Promise<{ connect?: string }> }) {
  const session = await currentSession();
  if (!session) redirect('/');
  if (session.user.role !== 'teacher') notFound();
  const status = await driveStatus({ teacher: session.user.id, sessionDigest: session.sessionDigest }).catch(() => null);
  const { connect } = await searchParams;
  return <main>
    <p><a href="/">Vườn Văn</a></p>
    <h1>Kết nối Google Drive</h1>
    {status ? <DriveConnection status={status} result={connect}/> : <p role="alert">Chưa có cấu hình kết nối Drive.</p>}
  </main>;
}
