import Link from 'next/link';
import type { ReactNode } from 'react';

type Role = 'admin' | 'teacher' | 'student';
type User = { display_name: string; role: Role };
type Destination = { href: string; label: string; name?: string };
const roleLabel = { admin: 'Quản trị viên', teacher: 'Giáo viên', student: 'Học sinh' };

const nav: Record<Role, Destination[]> = {
  admin: [{ href: '/', label: 'Trang chính' }, { href: '/admin/accounts', label: 'Tài khoản', name: 'Quản lý tài khoản' },
    { href: '/rubrics', label: 'Rubric mẫu', name: 'Quản lý rubric mẫu' }],
  teacher: [{ href: '/', label: 'Trang chính' }, { href: '/classes', label: 'Lớp học' },
    { href: '/rubrics', label: 'Rubric', name: 'Rubric chấm bài' }, { href: '/drive', label: 'Drive', name: 'Kết nối Google Drive' }],
  student: [{ href: '/', label: 'Trang chính' }, { href: '/classes', label: 'Tham gia lớp' },
    { href: '/rubrics', label: 'Rubric', name: 'Rubric chấm bài' }]
};

export function AppShell({ user, current, title, children }: { user: User; current: string; title: string; children: ReactNode }) {
  function links() {
    return nav[user.role].map(({ href,label,name }) =>
      <Link href={href} key={href} aria-label={name} aria-current={current === href ? 'page' : undefined}>{label}</Link>);
  }

  return <div className="app-shell">
    <a className="skip-link" href="#app-main">Đến nội dung chính</a>
    <aside className="app-sidebar">
      <Link href="/" className="app-brand">Vườn Văn</Link>
      <p className="app-identity">{user.display_name}</p>
      <nav aria-label="Điều hướng chính">{links()}</nav>
    </aside>
    <div className="app-workspace">
      <header className="app-topbar">
        <p className="app-breadcrumb">Vườn Văn / {title}</p>
        <Link href="/" className="app-brand app-mobile-brand">Vườn Văn</Link>
        <div className="app-account">
          <span>{user.display_name} · {roleLabel[user.role]}</span>
          <form action="/auth/logout" method="post"><button type="submit">Đăng xuất</button></form>
        </div>
      </header>
      <main id="app-main" className="app-main" tabIndex={-1}>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
    <nav className="app-bottom-nav" aria-label="Điều hướng chính">{links()}</nav>
  </div>;
}
