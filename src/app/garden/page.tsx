import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../server/auth/session';
import { progressFilters, type ProgressQuery } from '../../server/assignments/progress';
import { AppShell } from '../app-shell';
import { StudentProgress } from '../student-progress';

export default async function GardenPage({ searchParams }: { searchParams: Promise<ProgressQuery> }) {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role !== 'student') notFound();
  return <AppShell user={user} current="/garden" title="Khu vườn của em">
    <StudentProgress student={user.id} filters={progressFilters(await searchParams)}/>
  </AppShell>;
}
