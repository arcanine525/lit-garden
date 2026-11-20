import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../../../server/auth/session';
import { uuidPattern } from '../../../server/auth/identity-operations';
import { assignmentDetails } from '../../../server/assignments/access';
import { listRubrics } from '../../../server/rubrics/catalog';
import { DriveError } from '../../../server/drive/provider';
import { AppShell } from '../../app-shell';
import { MarkdownDocument } from '../../editor/markdown-document';
import { AssignmentEditor } from '../assignment-editor';
import { AssignmentLifecycle } from '../assignment-lifecycle';
import { deadlineFormat } from '../deadline-input';
import { submissionTimings } from '../../../server/assignments/lifecycle';
import { draftVisible } from '../../../server/student-drafts/access';
import '../assignment.css';

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) redirect('/');
  const { user } = session;
  if (user.role === 'admin') notFound();
  const { id: raw } = await params;
  if (!uuidPattern.test(raw)) notFound();
  const id = raw.toLowerCase();
  let detail;
  try { detail = await assignmentDetails(user.id,id); }
  catch (error) {
    if (error instanceof DriveError && error.code === 'ASSIGNMENT_NOT_FOUND') notFound();
    return <AppShell user={user} current="/assignments" title="Bài giao">
      <section className="app-panel" role="alert">
        <p className="app-error">Chưa tải được nội dung bài từ Drive.</p>
        <a className="app-button" href={`/assignments/${id}`}>Thử lại</a>
      </section>
    </AppShell>;
  }
  if (detail.state === 'draft') {
    const rubrics = (await listRubrics(false)).map(({ id,revision,label }) => ({ id,revision,label }));
    return <AppShell user={user} current="/assignments" title="Gieo một ý tưởng mới">
      <p>{detail.className}</p>
      <AssignmentEditor id={id} initial={{ draft:detail.draft, hash:detail.hash, draftVersion:detail.draftVersion }} rubrics={rubrics}/>
    </AppShell>;
  }
  const timings = await submissionTimings(user.id,id);
  let ownDraft = false;
  if (user.role === 'student') {
    ownDraft = await draftVisible({ student:user.id,sessionDigest:session.sessionDigest },id).then(() => true,() => false);
  }
  return <AppShell user={user} current="/assignments" title={detail.prompt.title}>
    <p>{detail.className} · {detail.teacherName} · {detail.accepting ? 'Đang mở' : 'Đã đóng'}</p>
    <p>{detail.dueAt ? `Hạn nộp ${deadlineFormat.format(new Date(detail.dueAt))}` : 'Không giới hạn hạn nộp'}</p>
    {ownDraft && <p><a className="app-button app-primary" href={`/assignments/${id}/write`}>{detail.accepting ? 'Mở nháp bài viết' : 'Xem nháp bài viết'}</a></p>}
    {user.role === 'teacher' && detail.classState === 'active' && <AssignmentLifecycle id={id} version={detail.version}
      accepting={detail.accepting} dueAt={detail.dueAt} hasReference={Boolean(detail.reference)} referenceIsPublic={Boolean(detail.referencePublicAt)}/>}
    <section className="app-panel">
      <h2>Đề bài</h2>
      <MarkdownDocument source={detail.prompt.prompt}/>
      {detail.prompt.material.trim() && <><h2>Ngữ liệu</h2><MarkdownDocument source={detail.prompt.material}/></>}
      {detail.reference && <><h2>Tham chiếu</h2><MarkdownDocument source={detail.reference}/></>}
    </section>
    <section className="app-panel">
      <h2>Rubric của bài</h2>
      <p>{detail.rubric.label} · {new Intl.NumberFormat('vi-VN').format(Number(detail.rubric.scale))} điểm</p>
      {detail.rubric.criteria.map(criterion => <details key={criterion.id}>
        <summary>{criterion.label}</summary>
        <dl>{criterion.levels.map(level => <div key={level.id}>
          <dt>{new Intl.NumberFormat('vi-VN').format(Number(level.score))} điểm</dt><dd>{level.description}</dd>
        </div>)}</dl>
      </details>)}
    </section>
    {timings.length > 0 && <section className="app-panel">
      <h2>Lịch sử bản nộp</h2>
      <ul>{timings.map(item => <li key={item.id}>
        {user.role === 'teacher' && `${item.student} · `}Lần nộp {item.number} · {deadlineFormat.format(new Date(item.submittedAt))}
        {item.late && ' · Nộp muộn'}
        {user.role === 'teacher' && <> · <a href={`/reviews/${item.id}`}>Mở bàn chấm</a></>}
      </li>)}</ul>
    </section>}
  </AppShell>;
}
