import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { listAssignments } from '../../server/assignments/access';
import { sessionUser } from '../../server/auth/session';
import { reviewQueue } from '../../server/reviews/source';
import { AppShell } from '../app-shell';
import { DownloadGradebook } from './download-gradebook';
import './review.css';

export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<{ waiting?: string }> }) {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role !== 'teacher') notFound();
  const waiting = (await searchParams).waiting === '1';
  const [entries,assignments] = await Promise.all([reviewQueue(user.id,waiting),listAssignments(user.id)]);
  const titles = new Map(assignments.map(item => [item.id,item.title]));
  return <AppShell user={user} current="/reviews" title="Bàn chấm">
    <section className="app-panel">
      <h2>{waiting ? 'Bản mới nhất chờ chấm' : 'Các bài viết'}</h2>
      {waiting && <p><Link href="/reviews">Xem tất cả lần nộp</Link></p>}
      <DownloadGradebook/>
      {entries.length ? <ul className="review-queue">{entries.map(item => <li key={item.id}>
        <div><strong>{titles.get(item.assignment_id) || 'Đề bài chưa khả dụng'}</strong>
          <p>{item.student_name} · {item.class_name} · Lần nộp {item.submission_no}</p></div>
        <span>{item.integrity === 'conflict' ? 'Bản nộp đã thay đổi' : item.integrity === 'missing' ? 'Không tìm thấy bản nộp' :
          item.integrity === 'unavailable' ? 'Chưa đọc được bản nộp' : item.returned ? 'Đã trả' : item.grading ? 'Đang chấm' : 'Chờ chấm'}</span>
        <Link className="app-button" href={`/reviews/${item.id}`}>{item.grading ? 'Tiếp tục chấm' : item.returned ? 'Xem bài' : 'Chấm bài'}</Link>
      </li>)}</ul> : <p>Chưa có bản nộp.</p>}
    </section>
  </AppShell>;
}
