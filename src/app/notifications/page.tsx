import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../../server/auth/session';
import { listNotifications } from '../../server/notifications';
import { AppShell } from '../app-shell';
import { NotificationRead } from './read-control';
import './notifications.css';

const labels = {
  assigned:'Bài mới',
  deadline_extended:'Hạn nộp đã được gia hạn',
  returned:'Giáo viên đã trả bài',
  reply:'Có phản hồi mới'
};
const date = new Intl.DateTimeFormat('vi-VN',{ dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh' });

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ unavailable?: string }> }) {
  const session = await currentSession();
  if (!session) redirect('/');
  if (session.user.role === 'admin') notFound();
  const entries = await listNotifications(session.user.id);
  if ((await currentSession())?.sessionDigest !== session.sessionDigest) redirect('/');
  const unavailable = (await searchParams).unavailable === '1';
  return <AppShell user={session.user} current="/notifications" title="Thông báo">
    {unavailable && <section className="app-panel"><h2>Nội dung không còn khả dụng</h2></section>}
    <section className="app-panel" aria-labelledby="notification-inbox">
      <h2 id="notification-inbox">{session.user.role === 'student' ? 'Hộp thư của em' : 'Hộp thư'}</h2>
      {entries.length ? <ul className="notification-list">{entries.map(item => <li key={item.id}>
        <div>
          <h3>{labels[item.kind]}</h3>
          <p>{item.available && item.className && <>{item.className} · {item.teacherName} · </>}
            <time dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time></p>
        </div>
        <div className="app-actions">
          <NotificationRead id={item.id} read={Boolean(item.readAt)}/>
          {item.available ? <a className="app-button" href={`/notifications/${item.id}`}>Mở nội dung</a> :
            <span>Nội dung không còn khả dụng</span>}
        </div>
      </li>)}</ul> : <p>Chưa có thông báo.</p>}
    </section>
  </AppShell>;
}
