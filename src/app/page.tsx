import { sessionUser } from '../server/auth/session';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import book from '../../docs/research/vuon-van-ca-nhan.pages.dev/source/vuon-trong-trang-sach.webp';
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
    <section className="app-hero" aria-label="Lớp học">
      <div className="app-hero-content">
        <h2>Mỗi bài viết là một hạt mầm</h2>
        <p>Theo dõi bài viết theo lớp và giáo viên.</p>
        <Link className="app-button app-primary" href={`/garden${filterSearch(query)}`}>Mở khu vườn</Link>
      </div>
      <Image className="app-hero-image" src={book} alt="" preload sizes="(max-width: 760px) 100vw, (max-width: 1150px) 42vw, 44vw"/>
    </section>
    <StudentProgress student={user.id} filters={progressFilters(query)} home/>
  </AppShell>;
  if (user?.role === 'teacher') {
    const [classes,waiting,reviews,featured] = await Promise.all([
      database().query<{ total: number }>(`SELECT count(*)::int AS total FROM garden.classes
        WHERE teacher_id=$1 AND state='active'`,[user.id]).then(result => result.rows[0].total),
      reviewQueue(user.id,true),reviewQueue(user.id,false,5),featuredLibrary(user.id)
    ]);
    const titles = new Map((reviews.length ? await listAssignments(user.id) : []).map(item => [item.id,item.title]));
    return <AppShell user={user} current="/" title={`Góc vườn của ${user.display_name}`}>
      <section className="app-hero" aria-label="Lớp học">
        <div className="app-hero-content">
          <h2>Chăm chút từng trang viết</h2>
          <p>{waiting.length} bài viết đang chờ chấm.</p>
          <div className="app-actions">
            <Link className="app-button app-primary" href="/reviews?waiting=1">Xem bài chờ chấm</Link>
            <Link className="home-classes" href="/classes">{classes} lớp đang hoạt động.</Link>
          </div>
        </div>
        <Image className="app-hero-image" src={book} alt="" preload sizes="(max-width: 760px) 100vw, (max-width: 1150px) 42vw, 44vw"/>
      </section>
      <section className="app-panel home-summary" aria-labelledby="home-reviews">
        <h2 id="home-reviews">Các bài viết</h2>
        <ReviewQueueRows entries={reviews} titles={titles}/>
      </section>
      {featured.length > 0 && <section className="app-panel">
        <h2>Tài liệu nổi bật</h2>
        <ul className="progress-rows featured-rows">{featured.map(item => <li key={`${item.classId}:${item.slot}`}>
          <div><strong>{item.title}</strong><p>Lớp {item.className} · {item.teacherName}</p></div>
          <Link className="app-button" href={`/library/${item.id}`} aria-label={`Mở tài liệu · ${item.title}`}>Mở tài liệu</Link>
        </li>)}</ul>
      </section>}
    </AppShell>;
  }
  return <main className="app-standalone">
    <h1>Vườn Văn</h1>
    <p>Không gian dạy và học viết.</p>
    {auth && <p className="app-error" role="alert">{auth === 'denied' ? 'Tài khoản này chưa được cấp quyền vào Vườn Văn.' : 'Chưa đăng nhập được. Hãy thử lại.'}</p>}
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
