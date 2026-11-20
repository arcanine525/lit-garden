import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../../../server/auth/session';
import { Accounts } from './accounts';
import { AppShell } from '../../app-shell';

export default async function AdminAccountsPage() {
  const session = await currentSession();
  if (!session) redirect('/');
  if (session.user.role !== 'admin') notFound();
  return <AppShell user={session.user} current="/admin/accounts" title="Quản lý tài khoản">
    {!session.recentAuth && <p>Để thay đổi tài khoản, <a href="/auth/login">đăng nhập lại</a>.</p>}
    <Accounts editable={session.recentAuth}/>
  </AppShell>;
}
