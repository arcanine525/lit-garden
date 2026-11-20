'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export type RubricChoice = { id: string; revision: number; label: string };

export function CreateAssignment({ classes, rubrics }: { classes: Array<{ id: string; name: string }>; rubrics: RubricChoice[] }) {
  const router = useRouter();
  const id = useRef('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!id.current) id.current = crypto.randomUUID();
    const [rubricId,rubricRevision] = String(form.get('rubric')).split(':');
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/assignments',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({
        id:id.current, classId:form.get('class'), rubricId, rubricRevision:Number(rubricRevision)
      }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      router.push(`/assignments/${result.id}`);
    } catch (failure) {
      const code = (failure as Error).message;
      setError(code === 'DRIVE_SETUP_REQUIRED' ? 'Kết nối Drive trước khi tạo nháp.' :
        code === 'RUBRIC_CHANGED' ? 'Rubric đã thay đổi. Tải lại trang để chọn phiên bản đang dùng.' : 'Chưa tạo được bài nháp. Hãy thử lại.');
    } finally { setBusy(false); }
  }

  return <section className="app-panel" aria-busy={busy}>
    <h2>Bài giao mới</h2>
    {classes.length && rubrics.length ? <form onSubmit={create} onChange={() => { id.current = ''; }} className="app-actions">
      <label>Lớp <select name="class" required>
        {classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Rubric <select name="rubric" required>
        {rubrics.map(item => <option key={item.id} value={`${item.id}:${item.revision}`}>{item.label}</option>)}
      </select></label>
      <button className="app-primary" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo bài nháp'}</button>
    </form> : <p>{!classes.length ? 'Tạo một lớp hoạt động để giao bài.' : 'Chưa có rubric đang dùng.'}</p>}
    {error && <p className="app-error" role="alert">{error}</p>}
  </section>;
}
