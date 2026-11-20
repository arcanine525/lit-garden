'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ActionDialog } from '../action-dialog';
import { deadlineValue } from './deadline-input';

const errorText: Record<string,string> = {
  ASSIGNMENT_CHANGED: 'Bài đã thay đổi. Tải lại trang rồi thử lại.',
  CLASS_INACTIVE: 'Lớp đã lưu trữ. Khôi phục lớp để thay đổi bài giao.',
  REFERENCE_ALREADY_PUBLIC: 'Bài đã công khai tham chiếu và tiếp tục giữ trạng thái đóng.',
  REFERENCE_REQUIRED: 'Thêm nội dung tham chiếu khi tạo bài mới.',
  ASSIGNMENT_OPEN: 'Đóng bài trước khi công khai tham chiếu.',
  DEADLINE_NOT_EXTENDED: 'Chọn hạn mới muộn hơn hạn hiện tại.'
};

export function AssignmentLifecycle({ id, version, accepting, dueAt, hasReference, referenceIsPublic }: {
  id: string; version: string; accepting: boolean; dueAt: string | null; hasReference: boolean; referenceIsPublic: boolean;
}) {
  const router = useRouter();
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [unlimited,setUnlimited] = useState(false);
  const [date,setDate] = useState('');
  const key = useRef('');

  async function change(action: string, resultText: string, data: Record<string,unknown> = {}) {
    setMessage('');
    setBusy(true);
    try {
      const response = await fetch(`/api/assignments/${id}`,{ method:'POST',headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ action,expectedVersion:version,...data }) })
        .catch(() => { throw Error('Chưa xác nhận được thay đổi. Hãy thử lại.'); });
      if (!response.ok) throw Error(errorText[(await response.json()).error] ?? 'Chưa lưu được thay đổi. Hãy thử lại.');
      setMessage(resultText);
      router.refresh();
    } finally { setBusy(false); }
  }

  async function extend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key.current) key.current = crypto.randomUUID();
    try {
      await change('extend_deadline','Đã gia hạn.',{ key:key.current, dueAt:unlimited ? null : deadlineValue(date) });
      key.current = '';
      setDate('');
    } catch (error) { setMessage((error as Error).message); }
  }

  return <section className="app-panel" aria-label="Quản lý bài giao" aria-busy={busy}>
    <div className="app-actions">
      {accepting ? <ActionDialog trigger="Đóng bài" title="Đóng bài giao?"
        detail="Học sinh vẫn xem được bài và nháp. Vườn Văn sẽ dừng nhận bản nộp mới."
        confirmLabel="Xác nhận đóng bài" inactive={busy} onConfirm={() => change('close','Đã đóng bài.')}/> :
        <ActionDialog trigger="Mở lại bài" title="Mở lại bài này?"
          detail="Bài sẽ được giao bổ sung cho học sinh đang thuộc lớp và chưa nhận bài này. Mỗi em sẽ nhận một thông báo bài mới. Hạn nộp và lịch sử các lần nộp được giữ nguyên."
          confirmLabel="Mở lại và giao bổ sung" inactive={busy || referenceIsPublic} onConfirm={() => change('reopen','Đã mở lại bài.')}/>}
      {!accepting && hasReference && !referenceIsPublic && <ActionDialog trigger="Công khai tham chiếu" title="Công khai tham chiếu?"
        detail="Học sinh được giao bài sẽ xem được tham chiếu. Bài sẽ giữ trạng thái đóng."
        confirmLabel="Xác nhận công khai" inactive={busy} onConfirm={() => change('publish_reference','Đã công khai tham chiếu.')}/>}
    </div>
    {referenceIsPublic && <p>Tham chiếu đã công khai cho học sinh được giao bài.</p>}
    {dueAt && <form className="app-actions" onSubmit={extend} onChange={() => { key.current = ''; }}>
      <label>Hạn mới (giờ Việt Nam) <input type="datetime-local" required={!unlimited} disabled={busy || unlimited}
        value={date} onChange={event => setDate(event.target.value)}/></label>
      <label><input type="checkbox" checked={unlimited} disabled={busy} onChange={event => setUnlimited(event.target.checked)}/> Bỏ hạn nộp</label>
      <button disabled={busy}>Gia hạn</button>
    </form>}
    <p role="status">{message}</p>
  </section>;
}
