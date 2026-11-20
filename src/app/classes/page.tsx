import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../server/auth/session';
import { ClassDirectory } from './directory';

export default async function ClassesPage() {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role === 'admin') notFound();
  return <ClassDirectory user={{ display_name:user.display_name,role:user.role }}/>;
}
