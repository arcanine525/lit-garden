import { redirect } from 'next/navigation';
import { sessionUser } from '../../server/auth/session';
import { listRubrics } from '../../server/rubrics/catalog';
import { RubricCatalog } from './rubric-catalog';

export default async function RubricsPage() {
  const user = await sessionUser();
  if (!user) redirect('/');
  const editable = user.role === 'admin';
  return <main>
    <p><a href="/">Vườn Văn</a></p>
    <h1>{editable ? 'Quản lý rubric mẫu' : 'Rubric chấm bài'}</h1>
    <RubricCatalog initial={await listRubrics(editable)} editable={editable}/>
  </main>;
}
