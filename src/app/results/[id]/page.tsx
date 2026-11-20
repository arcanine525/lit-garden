import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../../../server/auth/session';
import { uuidPattern } from '../../../server/auth/identity-operations';
import { readPublication } from '../../../server/reviews/publications';
import { DriveError } from '../../../server/drive/provider';
import { reviewMessages, type RangeComment } from '../../../shared/review';
import { AppShell } from '../../app-shell';
import { deadlineFormat } from '../../assignments/deadline-input';
import { ReviewDocument } from '../../reviews/review-document';
import { ReplyThread } from '../../reviews/reply-thread';
import '../../editor/editor.css';
import '../../reviews/review.css';

const points = new Intl.NumberFormat('vi-VN',{ minimumFractionDigits:2,maximumFractionDigits:2 });
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ publication?: string | string[] }> };

export default async function ResultPage({ params,searchParams }: Props) {
  const session = await currentSession();
  if (!session) redirect('/');
  const { user } = session;
  if (user.role === 'admin') notFound();
  const { id:raw } = await params;
  const selected = (await searchParams).publication;
  if (!uuidPattern.test(raw) || (selected !== undefined && (typeof selected !== 'string' || !uuidPattern.test(selected)))) notFound();
  const id = raw.toLowerCase();
  const current = user.role === 'teacher' ? '/reviews' : '/assignments';
  let result;
  try { result = await readPublication(user.id,id,selected?.toLowerCase()); }
  catch (error) {
    if (error instanceof DriveError && error.code === 'NOT_FOUND') notFound();
    const message = error instanceof DriveError ? reviewMessages[error.code] : undefined;
    return <AppShell user={user} current={current} title="Kết quả bài viết">
      <section className="app-panel"><p role="alert">{message ?? 'Chưa đọc được kết quả từ Drive.'}</p>
        <Link href={`/results/${id}${selected ? `?publication=${selected}` : ''}`}>Thử lại</Link></section>
    </AppShell>;
  }
  if ((await currentSession())?.sessionDigest !== session.sessionDigest) redirect('/');
  const { publication,history } = result;
  if (!publication) return <AppShell user={user} current={current} title="Kết quả bài viết">
    <section className="app-panel"><p>Bài đang chờ giáo viên trả.</p></section>
  </AppShell>;
  const { rubric,scores,comments } = publication;
  const ranges = comments.filter((comment): comment is RangeComment => comment.kind === 'range');
  const overall = comments.find(comment => comment.kind === 'overall');
  const currentResult = !history || history[0]?.id === publication.id;
  return <AppShell user={user} current={current} title={publication.title}>
    <p>{publication.studentName} · {publication.className} · Lần nộp {publication.submissionNo}</p>
    {history && <section className="app-panel">
      <h2>Lịch sử trả bài</h2>
      <ul>{history.map(item => <li key={item.id}><Link href={`/results/${id}?publication=${item.id}`}
        aria-current={item.id === publication.id ? 'page' : undefined}>Lần trả {item.revision}</Link>
        {' · '}{deadlineFormat.format(new Date(item.publishedAt))}</li>)}</ul>
      <Link href={`/reviews/${id}`}>Mở nháp chấm</Link>
    </section>}
    <div className="review-columns">
      <section className="app-panel">
        <h2>Bài nộp</h2>
        <article aria-label="Văn bản bài nộp"><ReviewDocument source={publication.markdown} marks={ranges}/></article>
        {publication.explanation && <><h3>Giải thích của học sinh</h3><p className="review-text">{publication.explanation}</p></>}
        {ranges.length > 0 && <section aria-label="Nhận xét theo đoạn">{ranges.map(comment => <div key={comment.id} className="review-comment">
          <blockquote><mark className={`review-mark-${comment.color}`}>{comment.anchor.exact}</mark></blockquote>
          {comment.body && <p className="review-text">{comment.body}</p>}
          {currentResult && <ReplyThread submission={id} comment={comment.id} publication={publication.id} viewer={user.id}/>}
        </div>)}</section>}
      </section>
      <section className="app-panel" aria-label="Kết quả đã trả">
        <h2>Kết quả đã trả</h2>
        <p>Lần trả {publication.revision} · {deadlineFormat.format(new Date(publication.publishedAt))}</p>
        <p>{rubric.label} · {points.format(publication.total)} / {points.format(Number(rubric.scale))} điểm</p>
        <dl>{scores.map(score => {
          const criterion = rubric.criteria.find(item => item.id === score.criterionId);
          const level = criterion?.levels.find(item => item.id === score.levelId);
          return <div key={score.criterionId}><dt>{criterion?.label}</dt>
            <dd>{points.format(Number(score.value))} điểm · {level?.description}</dd></div>;
        })}</dl>
        {overall && <section aria-label="Nhận xét chung"><h3>Nhận xét chung</h3><p className="review-text">{overall.body}</p>
          {currentResult && <ReplyThread submission={id} comment={overall.id} publication={publication.id} viewer={user.id}/>}</section>}
      </section>
    </div>
  </AppShell>;
}
