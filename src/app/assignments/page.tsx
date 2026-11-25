import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../server/auth/session';
import { database } from '../../server/db';
import { listRubrics } from '../../server/rubrics/catalog';
import { listAssignments } from '../../server/assignments/access';
import { AppShell } from '../app-shell';
import { StudentAssignmentRows } from '../student-progress';
import { CreateAssignment } from './create-assignment';

import './assignment.css';

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role === 'admin') notFound();
  const teacher = user.role === 'teacher';
  const [assignments, classes, rubrics] = await Promise.all([
    listAssignments(user.id), teacher ? database().query<{ id: string; name: string }>(`
      SELECT id,name FROM garden.classes WHERE teacher_id=$1 AND state='active' ORDER BY name`,[user.id]).then(result => result.rows) : [],
    teacher ? listRubrics(false) : []
  ]);
  const creating = teacher && (await searchParams).new === '1';
  if (creating) return <AppShell user={user} current="/assignments" title="Gieo một ý tưởng mới">
    <CreateAssignment classes={classes} rubrics={rubrics.map(({ id,revision,label }) => ({ id,revision,label }))}/>
    <Link href="/assignments">Về danh sách bài</Link>
  </AppShell>;
  return <AppShell user={user} current="/assignments" title={teacher ? 'Giao bài' : 'Bài được giao'}>
    {teacher && <div className="assignment-heading"><p>Quản lý đề bài và các bài viết đã giao cho lớp.</p>
      <Link className="app-button app-primary" href="/assignments?new=1">+ Giao bài mới</Link></div>}
    <section className="app-panel">
      <h2 className="visually-hidden">Danh sách bài</h2>
      {!teacher ? <StudentAssignmentRows assignments={assignments}/> : assignments.length ? <ul className="assignment-list">{assignments.map(item => <li key={item.id}>
        <span className="assignment-book" aria-hidden="true">▤</span>
        <div className="assignment-list-body"><Link href={`/assignments/${item.id}`}>{item.unavailable ? 'Chưa tải được đề bài' : item.title || 'Nháp chưa đặt tên'}</Link>
        <p>{item.className} · {item.teacherName} · {item.state === 'draft' ? 'Nháp' : item.accepting ? 'Đang mở' : 'Đã đóng'}</p></div>
        <Link className="app-button" href={`/assignments/${item.id}`}
          aria-label={`${item.state === 'draft' ? 'Sửa nháp' : 'Xem bài'} · ${item.title || item.className}`}>{item.state === 'draft' ? 'Sửa nháp' : 'Xem bài'} ↗</Link>
      </li>)}</ul> : <p>Chưa có bài.</p>}
    </section>
  </AppShell>;
}
