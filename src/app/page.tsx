import { sessionUser } from '../server/auth/session';
import { redirect } from 'next/navigation';
import { HomeColumns, HomeDisclosure, HomeHero, HomeStats } from './home-panels';
import { progressFilters, type ProgressQuery } from '../server/assignments/progress';
import { listAssignments } from '../server/assignments/access';
import { database } from '../server/db';
import { featuredLibrary } from '../server/library/items';
import { reviewQueue } from '../server/reviews/source';
import { AppShell } from './app-shell';
import { StudentProgress } from './student-progress';
import { ReviewQueueRows } from './reviews/review-queue';
import './reviews/review.css';

export default async function HomePage({ searchParams }: { searchParams: Promise<ProgressQuery & { auth?: string }> }) {
  const user = await sessionUser();
  const query = await searchParams;
  const { auth } = query;
  if (user?.role === 'admin') redirect('/admin/accounts');
  if (user?.role === 'student') return <AppShell user={user} current="/" title="Góc vườn của em">
    <HomeHero gardenHref={`/garden${filterSearch(query)}`}/>
    <StudentProgress student={user.id} filters={progressFilters(query)} home/>
  </AppShell>;
  if (user?.role === 'teacher') {
    const [metrics,waiting,reviews,featured,assignments] = await Promise.all([
      database().query<{ classes: number; students: number }>(`SELECT count(DISTINCT c.id)::int AS classes,
        count(DISTINCT s.id)::int AS students FROM garden.classes c
        LEFT JOIN garden.memberships m ON m.class_id=c.id AND m.state='active'
        LEFT JOIN garden.users s ON s.id=m.student_id AND s.status='active' AND s.role='student'
        WHERE c.teacher_id=$1 AND c.state='active'`,[user.id]).then(result => result.rows[0]),
      reviewQueue(user.id,true),reviewQueue(user.id,false,5),featuredLibrary(user.id),listAssignments(user.id)
    ]);
    const titles = new Map(assignments.map(item => [item.id,item.title]));
    return <AppShell user={user} current="/" title={`Góc vườn của ${user.display_name}`}>
      <HomeHero/>
      <HomeStats {...metrics} waiting={waiting.length} name={user.display_name}/>
      <HomeColumns assignments={assignments} featured={featured}/>
      {reviews.length > 0 && <HomeDisclosure title="Các bản nộp gần đây">
        <ReviewQueueRows entries={reviews} titles={titles}/>
      </HomeDisclosure>}
    </AppShell>;
  }
  if (!auth) redirect('/auth/login');
  return <main className="app-standalone">
    <h1>Vườn Văn</h1>
    <p className="app-error" role="alert">{auth === 'denied' ? 'Tài khoản này chưa được cấp quyền vào Vườn Văn.' : 'Chưa đăng nhập được. Hãy thử lại.'}</p>
    <a className="app-button app-primary" href="/auth/login">Đăng nhập</a>
  </main>;
}

function filterSearch(query: ProgressQuery) {
  const { classId,teacherId } = progressFilters(query);
  const params = new URLSearchParams();
  if (classId) params.set('class',classId);
  if (teacherId) params.set('teacher',teacherId);
  return params.size ? '?' + params.toString() : '';
}
