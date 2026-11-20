import { sessionUser } from '../server/auth/session';

const roleName = { admin: 'Quản trị viên', teacher: 'Giáo viên', student: 'Học sinh' };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ auth?: string }> }) {
  const user = await sessionUser();
  const { auth } = await searchParams;
  return <main>
    <h1>Vườn Văn</h1>
    {user ? <>
      <p>{user.display_name} · {roleName[user.role]}</p>
      {user.role === 'admin' && <p><a href="/admin/accounts">Quản lý tài khoản</a></p>}
      {user.role !== 'admin' && <p><a href="/classes">{user.role === 'teacher' ? 'Lớp học' : 'Tham gia lớp'}</a></p>}
      {user.role === 'teacher' && <p><a href="/drive">Kết nối Google Drive</a></p>}
      <p><a href="/rubrics">{user.role === 'admin' ? 'Quản lý rubric mẫu' : 'Rubric chấm bài'}</a></p>
      <form action="/auth/logout" method="post"><button type="submit">Đăng xuất</button></form>
    </> : <>
      <p>Không gian dạy và học viết.</p>
      {auth && <p role="alert">{auth === 'denied' ? 'Tài khoản này chưa được cấp quyền vào Vườn Văn.' : 'Chưa đăng nhập được. Hãy thử lại.'}</p>}
      <a href="/auth/login">Đăng nhập</a>
    </>}
  </main>;
}
