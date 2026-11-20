import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../../server/auth/session';
import { driveStatus } from '../../server/drive/connection';
import { DriveConnection } from './drive-connection';
import { AppShell } from '../app-shell';
import './drive.css';

export default async function DrivePage({ searchParams }: { searchParams: Promise<{ connect?: string }> }) {
  const session = await currentSession();
  if (!session) redirect('/');
  if (session.user.role !== 'teacher') notFound();
  const status = await driveStatus({ teacher: session.user.id, sessionDigest: session.sessionDigest }).catch(() => null);
  const { connect } = await searchParams;
  return <AppShell user={session.user} current="/drive" title="Kết nối Google Drive">
    <section className="app-panel" aria-label="Trạng thái Drive">
      <h2>Drive của {session.user.display_name}</h2>
      {status ? <DriveConnection status={status} result={connect}/> : <p className="app-error" role="alert">Chưa có cấu hình kết nối Drive.</p>}
    </section>
  </AppShell>;
}
