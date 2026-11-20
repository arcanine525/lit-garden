import Link from 'next/link';
import type { reviewQueue } from '../../server/reviews/source';

export function ReviewQueueRows({ entries, titles }: {
  entries: Awaited<ReturnType<typeof reviewQueue>>;
  titles: ReadonlyMap<string,string>;
}) {
  return entries.length ? <ul className="review-queue">{entries.map(item => <li key={item.id}>
    <div><strong>{titles.get(item.assignment_id) || 'Đề bài chưa khả dụng'}</strong>
      <p>{item.student_name} · {item.class_name} · Lần nộp {item.submission_no}</p></div>
    <div className="review-row-actions">
      <span className={`review-queue-state ${item.returned ? 'returned' : 'pending'}`}>
        {item.integrity === 'conflict' ? 'Bản nộp đã thay đổi' : item.integrity === 'missing' ? 'Không tìm thấy bản nộp' :
          item.integrity === 'unavailable' ? 'Chưa đọc được bản nộp' : item.returned ? 'Đã trả' : item.grading ? 'Đang chấm' : 'Chờ chấm'}
      </span>
      <Link className="app-button" href={`/reviews/${item.id}`}>{item.grading && !item.returned ? 'Tiếp tục chấm' : item.returned ? 'Xem bài' : 'Chấm bài'}</Link>
    </div>
  </li>)}</ul> : <p>Chưa có bản nộp.</p>;
}
