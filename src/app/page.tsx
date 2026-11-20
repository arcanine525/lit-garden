import { sessionUser } from '../server/auth/session';
import Image from 'next/image';
import Link from 'next/link';
import book from '../../docs/research/vuon-van-ca-nhan.pages.dev/source/vuon-trong-trang-sach.webp';
import { progressFilters, type ProgressQuery } from '../server/assignments/progress';
import { database } from '../server/db';
import { reviewQueue } from '../server/reviews/source';
import { AppShell } from './app-shell';
import { StudentProgress } from './student-progress';

export default async function HomePage({ searchParams }: { searchParams: Promise<ProgressQuery & { auth?: string }> }) {
  const user = await sessionUser();
  const query = await searchParams;
  const { auth } = query;
  if (user?.role === 'admin') return <AppShell user={user} current="/" title="Trang chính">
    <section className="app-panel"><h2>Quản trị Vườn Văn</h2>
      <p>Cấp và quản lý tài khoản giáo viên, học sinh và cấu hình rubric dùng chung.</p>
    </section>
  </AppShell>;
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
    const [classes,waiting] = await Promise.all([
      database().query<{ total: number }>(`SELECT count(*)::int AS total FROM garden.classes
        WHERE teacher_id=$1 AND state='active'`,[user.id]).then(result => result.rows[0].total),
      reviewQueue(user.id,true)
    ]);
    return <AppShell user={user} current="/" title="Góc vườn của giáo viên">
      <section className="app-hero" aria-label="Lớp học">
        <div className="app-hero-content">
          <h2>Chăm chút từng trang viết</h2>
          <p>{waiting.length} bài viết đang chờ chấm.</p>
          <Link className="app-button app-primary" href="/reviews?waiting=1">Xem bài chờ chấm</Link>
        </div>
        <Image className="app-hero-image" src={book} alt="" preload sizes="(max-width: 760px) 100vw, (max-width: 1150px) 42vw, 44vw"/>
      </section>
      <section className="app-panel home-summary" aria-labelledby="home-classes">
        <h2 id="home-classes">Lớp học</h2>
        <p>{classes} lớp đang hoạt động.</p>
        <Link href="/classes">Quản lý lớp</Link>
      </section>
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
