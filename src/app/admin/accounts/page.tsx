import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../../../server/auth/session';
import { Accounts } from './accounts';

export default async function AdminAccountsPage() {
  const session = await currentSession();
  if (!session) redirect('/');
  if (session.user.role !== 'admin') notFound();
  return <main>
    <p><a href="/">Vườn Văn</a></p>
    <h1>Quản lý tài khoản</h1>
    {!session.recentAuth && <p>Để thay đổi tài khoản, <a href="/auth/login">đăng nhập lại</a>.</p>}
    <Accounts editable={session.recentAuth}/>
  </main>;
}
