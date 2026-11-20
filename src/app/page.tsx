import { sessionUser } from '../server/auth/session';
import Image from 'next/image';
import Link from 'next/link';
import book from '../../docs/research/vuon-van-ca-nhan.pages.dev/source/vuon-trong-trang-sach.webp';
import { AppShell } from './app-shell';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ auth?: string }> }) {
  const user = await sessionUser();
  const { auth } = await searchParams;
  if (user?.role === 'admin') return <AppShell user={user} current="/" title="Trang chính">
    <section className="app-panel"><h2>Quản trị Vườn Văn</h2>
      <p>Cấp và quản lý tài khoản giáo viên, học sinh và cấu hình rubric dùng chung.</p>
    </section>
  </AppShell>;
  if (user) return <AppShell user={user} current="/" title={user.role === 'student' ? 'Góc vườn của em' : 'Góc vườn của giáo viên'}>
    <section className="app-hero" aria-label="Lớp học">
      <div className="app-hero-content">
        <h2>{user.role === 'student' ? 'Em gieo điều gì vào trang viết?' : 'Chăm chút từng trang viết'}</h2>
        <Link className="app-button app-primary" href="/classes">{user.role === 'student' ? 'Nhập mã lớp' : 'Quản lý lớp'}</Link>
      </div>
      <Image className="app-hero-image" src={book} alt="" preload sizes="(max-width: 760px) 100vw, (max-width: 1150px) 42vw, 44vw"/>
    </section>
  </AppShell>;
  return <main className="app-standalone">
    <h1>Vườn Văn</h1>
    <p>Không gian dạy và học viết.</p>
    {auth && <p className="app-error" role="alert">{auth === 'denied' ? 'Tài khoản này chưa được cấp quyền vào Vườn Văn.' : 'Chưa đăng nhập được. Hãy thử lại.'}</p>}
    <a className="app-button app-primary" href="/auth/login">Đăng nhập</a>
  </main>;
}
