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
  teacher: [{ href: '/', label: 'Góc vườn của tôi' }, { href: '/classes', label: 'Lớp học' },
    { href: '/assignments', label: 'Giao bài' }, { href: '/reviews', label: 'Chấm & trả bài', name: 'Bàn chấm' },
    { href: '/rubrics', label: 'Rubric', name: 'Rubric chấm bài' }, { href: '/library', label: 'Thư viện' },
    { href: '/drive', label: 'Drive', name: 'Kết nối Google Drive' },markdown],
  student: [{ href: '/', label: 'Góc vườn của tôi' }, { href: '/classes', label: 'Lớp học', name: 'Tham gia lớp' },
    { href: '/assignments', label: 'Bài được giao' }, { href: '/garden', label: 'Khu vườn' },
    { href: '/rubrics', label: 'Rubric', name: 'Rubric chấm bài' }, { href: '/library', label: 'Thư viện' },markdown]
};

const navIcons: Record<string,string> = {
  '/':'⌂', '/classes':'♧', '/assignments':'▤', '/reviews':'✎', '/rubrics':'▦', '/library':'▤',
  '/drive':'☁', '/editor':'✎', '/garden':'✿', '/admin/accounts':'♧', '/admin/accounts?role=student':'♧'
};

export function AppShell({ user, current, title, children }: { user: User; current: string; title: string; children: ReactNode }) {
  const destinations = nav[user.role];
  const account = user.role === 'teacher' ? user.display_name : roleLabel[user.role];
  function links(mobile = false) {
    return destinations.filter(item => !mobile || !item.secondary && item.href !== '/drive').map(({ href,label,name }) =>
      <Link href={href} key={href} aria-label={name ? `${label} · ${name}` : undefined}
        aria-current={current === href ? 'page' : undefined}><span className="app-nav-icon" aria-hidden="true">{navIcons[href]}</span>{mobile && href === '/' ? 'Góc vườn' : label}</Link>);
  }

  return <div className="app-shell">
    <a className="skip-link" href="#app-main">Đến nội dung chính</a>
    <aside className="app-sidebar">
      <div className="app-sidebar-content">
        <div className="app-brand-group">
          <span className="app-flower" aria-hidden="true">✿</span>
          <Link href="/" className="app-brand">Vườn Văn</Link>
          <small>Không gian sáng tạo và kết nối</small>
        </div>
        <p className="app-identity">Không gian {roleLabel[user.role]}</p>
        <nav aria-label="Điều hướng chính">{links()}</nav>
        {user.role === 'teacher' && <div className="app-sidebar-note">
          <span aria-hidden="true">☼</span><p>Mỗi lời góp ý là một hạt nắng cho trang viết lớn lên.</p>
        </div>}
      </div>
    </aside>
    <div className="app-workspace">
      <header className="app-topbar">
        <p className="app-breadcrumb">Vườn Văn / {title}</p>
        <Link href="/" className="app-brand app-mobile-brand"><span aria-hidden="true">✿ </span>Vườn Văn</Link>
        <div className="app-account">
          <span className="app-avatar" aria-hidden="true">{Array.from(user.display_name)[0]}</span>
          <span className="app-account-name">{user.display_name} · {roleLabel[user.role]}</span>
          {user.role !== 'admin' && <Link className="app-button app-notifications" href="/notifications"
            aria-current={current === '/notifications' ? 'page' : undefined}>Thông báo</Link>}
          <a className="app-button app-password" href="/auth/login?action=password">Đổi mật khẩu</a>
          <form className="app-logout" action="/auth/logout" method="post"><button type="submit">Đăng xuất</button></form>
          <details className="app-mobile-account">
            <summary aria-label={`Tài khoản · ${account}`}>{account}</summary>
            <div>
              <p>{user.display_name}</p>
              <a href="/auth/login?action=password">Đổi mật khẩu</a>
              {user.role === 'teacher' && <Link href="/drive" aria-current={current === '/drive' ? 'page' : undefined}>Kết nối Google Drive</Link>}
              {destinations.some(item => item.secondary) && <Link href="/editor">Soạn Markdown</Link>}
              <form action="/auth/logout" method="post"><button type="submit">Đăng xuất</button></form>
            </div>
          </details>
        </div>
      </header>
      <main id="app-main" className="app-main" tabIndex={-1}>
        <h1 className={current === '/' ? 'visually-hidden' : undefined}>{title}</h1>
        {children}
        <footer className="app-footer">Vườn Văn · Không gian sáng tạo và kết nối</footer>
      </main>
    </div>
    <nav className="app-bottom-nav" aria-label="Điều hướng chính">{links(true)}</nav>
  </div>;
}
