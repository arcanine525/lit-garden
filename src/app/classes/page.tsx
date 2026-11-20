import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../server/auth/session';
import { ClassDirectory } from './directory';

export default async function ClassesPage() {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role === 'admin') notFound();
  return <main>
    <p><a href="/">Vườn Văn</a></p>
    <h1>{user.role === 'teacher' ? 'Lớp học của tôi' : 'Tham gia lớp'}</h1>
    <ClassDirectory teacher={user.role === 'teacher'}/>
  </main>;
}
