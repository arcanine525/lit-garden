import Image from 'next/image';
import Link from 'next/link';
import sprout from '../../docs/research/vuon-van-ca-nhan.pages.dev/source/garden-sprout.webp';
import flower from '../../docs/research/vuon-van-ca-nhan.pages.dev/source/garden-flower.webp';
import fruit from '../../docs/research/vuon-van-ca-nhan.pages.dev/source/garden-fruit.webp';
import type { AssignmentFilters, listAssignments } from '../server/assignments/access';
import { assignmentStage, studentProgress } from '../server/assignments/progress';
import { ProgressFilters } from './progress-filters';
import './progress.css';

const stages = [
  { id:'sprout',title:'Mầm',description:'Đang viết',image:sprout },
  { id:'flower',title:'Hoa',description:'Chờ chấm',image:flower },
  { id:'fruit',title:'Quả',description:'Đã nhận xét',image:fruit }
] as const;
const statuses = { sprout:'Đang viết',flower:'Chờ chấm',fruit:'Đã nhận xét',closed:'Đã đóng · chưa nộp' };
const stageOrder = { sprout:0,flower:1,fruit:2,closed:3 };

export function StudentAssignmentRows({ assignments, progress = false }: { assignments: Awaited<ReturnType<typeof listAssignments>>; progress?: boolean }) {
  return assignments.length ? <ul className="progress-rows" aria-label="Các bài theo bộ lọc">{assignments.map(item => {
    const stage = assignmentStage(item);
    const title = item.unavailable ? 'Chưa tải được đề bài' : item.title;
    const assignment = `/assignments/${item.id}`;
    return <li key={item.id}>
      <div>
        {progress ? <strong>{title}</strong> : <Link href={assignment}>{title}</Link>}
        <p>{item.className} · {item.teacherName}</p>
      </div>
      <div className="progress-row-actions">
        <span className="progress-status">{statuses[stage]}</span>
        {stage === 'fruit' ? <Link className="app-button" href={`/results/${item.submissionId}`}
          aria-label={`Xem bài · Xem nhận xét · ${title}`}>Xem bài</Link>
          : progress && <Link className="app-button" href={assignment}
            aria-label={`${stage === 'sprout' ? 'Mở bài' : 'Xem bài'} · ${title}`}>
            {stage === 'sprout' ? 'Mở bài' : 'Xem bài'}
          </Link>}
      </div>
    </li>;
  })}</ul> : <p>Chưa có bài trong phạm vi này.</p>;
}

export async function StudentProgress({ student, filters, home }: { student: string; filters: AssignmentFilters; home?: boolean }) {
  const { assignments,classes,counts,featured } = await studentProgress(student,filters,Boolean(home));
  const ordered = [...assignments].sort((a,b) => a.className.localeCompare(b.className,'vi')
    || stageOrder[assignmentStage(a)] - stageOrder[assignmentStage(b)]);
  return <>
    {classes.length ? <ProgressFilters path={home ? '/' : '/garden'} classes={classes} {...filters}/> :
      <p>Em chưa tham gia lớp đang hoạt động. <Link href="/classes">Nhập mã lớp</Link></p>}
    <div className={`progress-stages${home ? '' : ' with-illustrations'}`} aria-label="Tiến độ bài viết" role="group">
      {stages.map(({ id,title,description,image }) => <section key={id} aria-label={title}
        className={`progress-stage ${id}${home ? '' : ' illustrated'}`}>
        {!home && <Image src={image} alt="" sizes="(max-width: 600px) 42vw, (max-width: 1150px) 24vw, 27vw"/>}
        <div><h2>{title}</h2><p><strong>{counts[id]} bài</strong> · {description}</p></div>
      </section>)}
    </div>
    <section className="app-panel">
      <h2>Các bài viết</h2>
      <StudentAssignmentRows assignments={ordered} progress/>
    </section>
    {featured.length > 0 && <section className="app-panel">
      <h2>Tài liệu nổi bật</h2>
      <ul className="progress-rows featured-rows">{featured.map(item => <li key={`${item.classId}:${item.slot}`}>
        <div><strong>{item.title}</strong><p>Lớp {item.className} · {item.teacherName}</p></div>
        <Link className="app-button" href={`/library/${item.id}`} aria-label={`Mở tài liệu · ${item.title}`}>Mở tài liệu</Link>
      </li>)}</ul>
    </section>}
  </>;
}
