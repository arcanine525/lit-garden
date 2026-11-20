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
  { id:'sprout',title:'Mầm',description:'Chưa nộp',image:sprout },
  { id:'flower',title:'Hoa',description:'Chờ chấm',image:flower },
  { id:'fruit',title:'Quả',description:'Đã trả',image:fruit }
] as const;
const statuses = { sprout:'Đang mở — chưa nộp',flower:'Chờ chấm',fruit:'Đã trả',closed:'Đã đóng — chưa nộp' };

export function StudentAssignmentRows({ assignments }: { assignments: Awaited<ReturnType<typeof listAssignments>> }) {
  return assignments.length ? <ul className="progress-rows" aria-label="Các bài theo bộ lọc">{assignments.map(item => {
    const stage = assignmentStage(item);
    return <li key={item.id}>
      <div>
        <Link href={`/assignments/${item.id}`}>{item.unavailable ? 'Chưa tải được đề bài' : item.title}</Link>
        <p>{item.className} · {item.teacherName}</p>
      </div>
      <span className={`progress-status ${stage}`}>{statuses[stage]}</span>
      {stage === 'fruit' && <Link href={`/results/${item.submissionId}`}>Xem nhận xét</Link>}
    </li>;
  })}</ul> : <p>Chưa có bài trong phạm vi này.</p>;
}

export async function StudentProgress({ student, filters, home }: { student: string; filters: AssignmentFilters; home?: boolean }) {
  const { assignments,classes,counts,featured } = await studentProgress(student,filters,Boolean(home));
  return <>
    {classes.length ? <ProgressFilters path={home ? '/' : '/garden'} classes={classes} {...filters}/> :
      <p>Em chưa tham gia lớp đang hoạt động. <Link href="/classes">Nhập mã lớp</Link></p>}
    <div className="progress-stages" aria-label="Tiến độ bài viết" role="group">
      {stages.map(({ id,title,description,image }) => <section key={id} aria-label={title}
        className={`progress-stage ${id}${home ? '' : ' illustrated'}`}>
        {!home && <Image src={image} alt="" sizes="(max-width: 600px) 42vw, (max-width: 1150px) 24vw, 27vw"/>}
        <div><h2>{title}</h2><p><strong>{counts[id]} bài</strong> · {description}</p></div>
      </section>)}
    </div>
    <section className="app-panel">
      <h2>Các bài viết</h2>
      <StudentAssignmentRows assignments={assignments}/>
    </section>
    {featured.length > 0 && <section className="app-panel">
      <h2>Tài liệu nổi bật</h2>
      <ul className="progress-rows">{featured.map(item => <li key={`${item.classId}:${item.slot}`}>
        <div><Link href={`/library/${item.id}`}>{item.title}</Link><p>{item.className} · {item.teacherName}</p></div>
      </li>)}</ul>
    </section>}
  </>;
}
