import Link from 'next/link';
import type { reviewQueue } from '../../server/reviews/source';

export function ReviewQueueRows({ entries, titles, table = false }: {
  entries: Awaited<ReturnType<typeof reviewQueue>>;
  table?: boolean;
  titles: ReadonlyMap<string,string>;
}) {
  if (!entries.length) return <p>Chưa có bản nộp.</p>;
  const rows = entries.map(item => {
    const identity = <><strong>{titles.get(item.assignment_id) || 'Đề bài chưa khả dụng'}</strong>
      <p>{item.student_name} · {item.class_name} · Lần nộp {item.submission_no}</p></>;
    const state = <span className={`review-queue-state ${item.returned ? 'returned' : 'pending'}`}>
      {item.integrity === 'conflict' ? 'Bản nộp đã thay đổi' : item.integrity === 'missing' ? 'Không tìm thấy bản nộp' :
        item.integrity === 'unavailable' ? 'Chưa đọc được bản nộp' : item.returned ? 'Đã trả' : item.grading ? 'Đang chấm' : 'Chờ chấm'}
    </span>;
    const action = <Link className="app-button" href={`/reviews/${item.id}`}>{item.grading && !item.returned ? 'Tiếp tục chấm' : item.returned ? 'Xem bài' : 'Chấm bài'}</Link>;
    return table ? <tr key={item.id}><td>{identity}</td><td>{state}</td><td>{action}</td></tr> :
      <li key={item.id}><div>{identity}</div><div className="review-row-actions">{state}{action}</div></li>;
  });
  return table ? <table className="review-table" aria-label="Các bản nộp">
    <thead><tr><th scope="col">Học sinh / Bài viết</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead>
    <tbody>{rows}</tbody></table> : <ul className="review-queue">{rows}</ul>;
}
