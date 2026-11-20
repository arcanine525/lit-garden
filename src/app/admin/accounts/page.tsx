import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../../../server/auth/session';
import { Accounts } from './accounts';
import { AppShell } from '../../app-shell';
import './accounts.css';

export default async function AdminAccountsPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const session = await currentSession();
  if (!session) redirect('/');
  if (session.user.role !== 'admin') notFound();
  const role = (await searchParams).role === 'student' ? 'student' : 'teacher';
  return <AppShell user={session.user} current={role === 'student' ? '/admin/accounts?role=student' : '/admin/accounts'}
    title={role === 'student' ? 'Tài khoản học sinh' : 'Giáo viên'}>
    {!session.recentAuth && <p>Để thay đổi tài khoản, <a href="/auth/login">đăng nhập lại</a>.</p>}
    <Accounts key={role} editable={session.recentAuth} role={role}/>
  </AppShell>;
}
