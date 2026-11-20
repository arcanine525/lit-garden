import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { listAssignments } from '../../server/assignments/access';
import { sessionUser } from '../../server/auth/session';
import { reviewQueue } from '../../server/reviews/source';
import { AppShell } from '../app-shell';
import { DownloadGradebook } from './download-gradebook';
import { ReviewQueueRows } from './review-queue';
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
      <ReviewQueueRows entries={entries} titles={titles}/>
    </section>
  </AppShell>;
}
