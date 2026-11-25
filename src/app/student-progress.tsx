import Link from 'next/link';
import { HomeColumns, HomeDisclosure } from './home-panels';
import { GardenStages } from './garden/garden-stages';
import type { AssignmentFilters, listAssignments } from '../server/assignments/access';
import { assignmentStage, studentProgress } from '../server/assignments/progress';
import { ProgressFilters } from './progress-filters';
import './progress.css';

const statuses = { sprout:'Đang viết',flower:'Chờ chấm',fruit:'Đã nhận xét',closed:'Đã đóng · chưa nộp' };
const stageOrder = { sprout:0,flower:1,fruit:2,closed:3 };

export function StudentAssignmentRows({ assignments, progress = false }: { assignments: Awaited<ReturnType<typeof listAssignments>>; progress?: boolean }) {
  return assignments.length ? <ul className={progress ? "progress-rows" : "progress-rows student-assignment-list"} aria-label="Các bài theo bộ lọc">{assignments.map(item => {
    const stage = assignmentStage(item);
    const title = item.unavailable ? 'Chưa tải được đề bài' : item.title;
    const assignment = `/assignments/${item.id}`;
    const write = !progress && stage === 'sprout';
    const action = write ? 'Làm bài' : stage === 'sprout' ? 'Mở bài' : 'Xem bài';
    return <li key={item.id}>
      {!progress && <span className="assignment-book" aria-hidden="true">▤</span>}
      <div>
        {progress ? <strong>{title}</strong> : <Link href={assignment}>{title}</Link>}
        <p>{item.className} · {item.teacherName}</p>
      </div>
      <div className="progress-row-actions">
        <span className="progress-status">{statuses[stage]}</span>
        {stage === 'fruit' ? <Link className="app-button" href={`/results/${item.submissionId}`}
          aria-label={`Xem bài · Xem nhận xét · ${title}`}>Xem bài</Link>
          : <Link className="app-button" href={write ? `${assignment}/write` : assignment}
            aria-label={`${action} · ${title}`}>{action}
          </Link>}
      </div>
    </li>;
  })}</ul> : <p>Chưa có bài trong phạm vi này.</p>;
}

export async function StudentProgress({ student, filters, home }: { student: string; filters: AssignmentFilters; home?: boolean }) {
  const { assignments,classes,counts,featured } = await studentProgress(student,filters,Boolean(home));
  const ordered = [...assignments].sort((a,b) => a.className.localeCompare(b.className,'vi')
    || stageOrder[assignmentStage(a)] - stageOrder[assignmentStage(b)]);
  const inputs = classes.length ? <ProgressFilters path={home ? '/' : '/garden'} classes={classes} {...filters}/> :
    <p>Em chưa tham gia lớp đang hoạt động. <Link href="/classes">Nhập mã lớp</Link></p>;
  if (home) return <>
    <HomeColumns assignments={assignments} featured={featured} student/>
    <HomeDisclosure title="Tiến độ bài viết và bộ lọc" open={Boolean(filters.classId || filters.teacherId)}>
      {inputs}
      <div className="progress-stages" aria-label="Tiến độ bài viết" role="group">
        {([['sprout','Mầm'],['flower','Hoa'],['fruit','Quả']] as const).map(([id,title]) =>
          <section className="progress-stage" key={id} aria-label={title}><div>
            <h2>{title}</h2><p><strong>{counts[id]} bài</strong> · {statuses[id]}</p>
          </div></section>)}
      </div>
      <StudentAssignmentRows assignments={ordered} progress/>
    </HomeDisclosure>
  </>;
  const rows = (stage?: 'sprout' | 'flower' | 'fruit') => <StudentAssignmentRows
    assignments={stage ? ordered.filter(item => assignmentStage(item) === stage) : ordered} progress/>;
  return <GardenStages counts={counts} lists={{all:rows(),sprout:rows('sprout'),flower:rows('flower'),fruit:rows('fruit')}}
    filters={<HomeDisclosure title="Lọc bài viết theo lớp và giáo viên" open={Boolean(filters.classId || filters.teacherId)}>{inputs}</HomeDisclosure>}/>;
}
