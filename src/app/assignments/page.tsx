import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../server/auth/session';
import { database } from '../../server/db';
import { listRubrics } from '../../server/rubrics/catalog';
import { listAssignments } from '../../server/assignments/access';
import { AppShell } from '../app-shell';
import { StudentAssignmentRows } from '../student-progress';
import { CreateAssignment } from './create-assignment';

export default async function AssignmentsPage() {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role === 'admin') notFound();
  const teacher = user.role === 'teacher';
  const [assignments, classes, rubrics] = await Promise.all([
    listAssignments(user.id), teacher ? database().query<{ id: string; name: string }>(`
      SELECT id,name FROM garden.classes WHERE teacher_id=$1 AND state='active' ORDER BY name`,[user.id]).then(result => result.rows) : [],
    teacher ? listRubrics(false) : []
  ]);
  return <AppShell user={user} current="/assignments" title={teacher ? 'Bài giao' : 'Bài được giao'}>
    {teacher && <CreateAssignment classes={classes} rubrics={rubrics.map(({ id, revision, label }) => ({ id,revision,label }))}/>}
    <section className="app-panel">
      <h2>Danh sách bài</h2>
      {!teacher ? <StudentAssignmentRows assignments={assignments}/> : assignments.length ? <ul className="assignment-list">{assignments.map(item => <li key={item.id}>
        <Link href={`/assignments/${item.id}`}>{item.unavailable ? 'Chưa tải được đề bài' : item.title || 'Nháp chưa đặt tên'}</Link>
        <p>{item.className} · {item.teacherName} · {item.state === 'draft' ? 'Nháp' : item.accepting ? 'Đang mở' : 'Đã đóng'}</p>
      </li>)}</ul> : <p>Chưa có bài.</p>}
    </section>
  </AppShell>;
}
