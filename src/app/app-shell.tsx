import Link from 'next/link';
import type { ReactNode } from 'react';

type Role = 'admin' | 'teacher' | 'student';
type User = { display_name: string; role: Role };
type Destination = { href: string; label: string; name?: string; secondary?: boolean };
const roleLabel = { admin: 'Quản trị viên', teacher: 'Giáo viên', student: 'Học sinh' };
const markdown: Destination = { href:'/editor',label:'Soạn Markdown',secondary:true };

const nav: Record<Role, Destination[]> = {
  admin: [{ href: '/admin/accounts', label: 'Giáo viên', name: 'Quản lý tài khoản' },
    { href: '/admin/accounts?role=student', label: 'Học sinh' },
    { href: '/rubrics', label: 'Rubric mẫu', name: 'Quản lý rubric mẫu' }],
  teacher: [{ href: '/', label: 'Trang chính' }, { href: '/classes', label: 'Lớp học' },
    { href: '/assignments', label: 'Bài giao' }, { href: '/reviews', label: 'Chấm bài', name: 'Bàn chấm' },
    { href: '/rubrics', label: 'Rubric', name: 'Rubric chấm bài' }, { href: '/library', label: 'Thư viện' },
    { href: '/drive', label: 'Drive', name: 'Kết nối Google Drive' },markdown],
  student: [{ href: '/', label: 'Trang chính' }, { href: '/classes', label: 'Lớp học', name: 'Tham gia lớp' },
    { href: '/assignments', label: 'Bài được giao' }, { href: '/garden', label: 'Khu vườn' },
    { href: '/rubrics', label: 'Rubric', name: 'Rubric chấm bài' }, { href: '/library', label: 'Thư viện' },markdown]
};

export function AppShell({ user, current, title, children }: { user: User; current: string; title: string; children: ReactNode }) {
  const destinations = nav[user.role];
  const account = user.role === 'teacher' ? user.display_name : roleLabel[user.role];
  function links(mobile = false) {
    return destinations.filter(item => !mobile || !item.secondary).map(({ href,label,name }) =>
      <Link href={href} key={href} aria-label={name ? `${label} · ${name}` : undefined}
        aria-current={current === href ? 'page' : undefined}>{label}</Link>);
  }

  return <div className="app-shell">
    <a className="skip-link" href="#app-main">Đến nội dung chính</a>
    <aside className="app-sidebar">
      <div className="app-sidebar-content">
        <Link href="/" className="app-brand">Vườn Văn</Link>
        <p className="app-identity">{account}</p>
        <nav aria-label="Điều hướng chính">{links()}</nav>
      </div>
    </aside>
    <div className="app-workspace">
      <header className="app-topbar">
        <p className="app-breadcrumb">Vườn Văn / {title}</p>
        <Link href="/" className="app-brand app-mobile-brand">Vườn Văn</Link>
        <div className="app-account">
          <span className="app-account-name">{user.display_name} · {roleLabel[user.role]}</span>
          {user.role !== 'admin' && <Link className="app-button app-notifications" href="/notifications"
            aria-current={current === '/notifications' ? 'page' : undefined}>Thông báo</Link>}
          <form className="app-logout" action="/auth/logout" method="post"><button type="submit">Đăng xuất</button></form>
          <details className="app-mobile-account">
            <summary aria-label={`Tài khoản · ${account}`}>{account}</summary>
            <div>
              <p>{user.display_name}</p>
              {destinations.some(item => item.secondary) && <Link href="/editor">Soạn Markdown</Link>}
              <form action="/auth/logout" method="post"><button type="submit">Đăng xuất</button></form>
            </div>
          </details>
        </div>
      </header>
      <main id="app-main" className="app-main" tabIndex={-1}>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
    <nav className="app-bottom-nav" aria-label="Điều hướng chính">{links(true)}</nav>
  </div>;
}
