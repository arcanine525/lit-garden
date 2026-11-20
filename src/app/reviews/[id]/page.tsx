import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../../server/auth/session';
import { uuidPattern } from '../../../server/auth/identity-operations';
import { DriveError } from '../../../server/drive/provider';
import { readReviewDraft } from '../../../server/reviews/drafts';
import { publicationHistory } from '../../../server/reviews/publications';
import { reviewSource } from '../../../server/reviews/source';
import { reviewMessages } from '../../../shared/review';
import { AppShell } from '../../app-shell';
import { ReviewWorkbench } from './workbench';
import '../../editor/editor.css';
import '../review.css';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role !== 'teacher') notFound();
  const { id:raw } = await params;
  if (!uuidPattern.test(raw)) notFound();
  const id = raw.toLowerCase();
  let source;
  let draft;
  let history;
  try {
    source = await reviewSource(user.id,id);
    [draft,history] = await Promise.all([readReviewDraft(user.id,source),publicationHistory(user.id,id)]);
  } catch (error) {
    if (error instanceof DriveError && error.code === 'NOT_FOUND') notFound();
    const message = error instanceof DriveError ? reviewMessages[error.code] : undefined;
    return <AppShell user={user} current="/reviews" title="Bàn chấm">
      <section className="app-panel">
        <p role="alert">{message ?? 'Chưa mở được bài chấm trên Drive.'}</p>
        <div className="app-actions"><a href={`/reviews/${id}`}>Thử lại</a><a href="/reviews">Về danh sách bài chấm</a></div>
      </section>
    </AppShell>;
  }
  if ((await sessionUser())?.id !== user.id) redirect('/');
  const { submission } = source;
  return <AppShell user={user} current="/reviews" title="Chấm bài">
    <ReviewWorkbench key={id} id={id} teacher={user.id} markdown={source.markdown} text={source.text}
      title={source.title} submissionLabel={`${submission.student_name} · Lớp ${submission.class_name} · Lần nộp ${submission.submission_no}`}
      assignment={submission.assignment_id}
      explanation={source.explanation} projectionSha256={source.projectionSha256} submissionSha256={source.submissionSha256}
      rubric={source.rubric} initial={draft} history={history}/>
  </AppShell>;
}
