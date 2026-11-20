import { redirect } from 'next/navigation';
import { sessionUser } from '../../server/auth/session';
import { listRubrics } from '../../server/rubrics/catalog';
import { RubricCatalog } from './rubric-catalog';
import { AppShell } from '../app-shell';

export default async function RubricsPage() {
  const user = await sessionUser();
  if (!user) redirect('/');
  const editable = user.role === 'admin';
  return <AppShell user={user} current="/rubrics" title={editable ? 'Quản lý rubric mẫu' : 'Rubric chấm bài'}>
    <RubricCatalog initial={await listRubrics(editable)} editable={editable}/>
  </AppShell>;
}
