import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../server/auth/session';
import { ClassDirectory } from './directory';
import { AppShell } from '../app-shell';

export default async function ClassesPage() {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role === 'admin') notFound();
  return <AppShell user={user} current="/classes" title={user.role === 'teacher' ? 'Lớp học của tôi' : 'Tham gia lớp'}>
    <ClassDirectory teacher={user.role === 'teacher'}/>
  </AppShell>;
}
