'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AssignmentDraft } from '../../server/assignments/bundle';
import { EditorWorkbench } from '../editor/editor-workbench';
import type { EditorHandle } from '../editor/markdown-editor';
import type { RubricChoice } from './create-assignment';

type Saved = { draft: AssignmentDraft; draftVersion: string; hash: string | null };
type Attempt = {
  action: 'save' | 'publish'; key: string; clientId: string; epoch: string; baseVersion: string;
  draft?: AssignmentDraft; hash?: string;
};
const messages: Record<string,string> = {
  LEASE_HELD: 'Nháp đang mở để sửa ở nơi khác.',
  STALE_WRITER: 'Quyền sửa đã chuyển sang phiên khác. Chuyển quyền để tiếp tục.',
  CLASS_INACTIVE: 'Lớp đã lưu trữ. Khôi phục lớp để sửa nháp.',
  DRIVE_SETUP_REQUIRED: 'Kết nối Drive để lưu nháp.',
  RUBRIC_CHANGED: 'Rubric đã thay đổi. Chọn phiên bản đang dùng trước khi giao.',
  PROMPT_REQUIRED: 'Điền tên bài và đề bài trước khi giao.',
  INVALID_SCALE: 'Chọn thang từ 0,25 đến 100 điểm, theo bước 0,25.',
  DRAFT_CHANGED: 'Nháp đã đổi. Tải lại trang để mở bản mới nhất.',
  OP_IN_PROGRESS: 'Đang có thao tác lưu trên Drive. Thử đồng bộ lại.',
  ASSET_SCOPE: 'Có ảnh nằm ngoài phạm vi bài này.'
};

export function AssignmentEditor({ id, initial, rubrics }: { id: string; initial: Saved; rubrics: RubricChoice[] }) {
  const router = useRouter();
  const [draft,setDraft] = useState(initial.draft);
  const [epoch,setEpoch] = useState('');
  const [held,setHeld] = useState(false);
  const [lockPending,setLockPending] = useState(true);
  const [status,setStatus] = useState('Đang kiểm tra quyền sửa…');
  const [busy,setBusy] = useState(false);
  const [publishing,setPublishing] = useState(false);
  const [retry,setRetry] = useState<Attempt['action'] | null>(null);
  const [paused,setPaused] = useState(false);
  const lastInput = useRef(0);
  const autosave = useRef<() => void>(() => {});
  const baseline = useRef(initial);
  const client = useRef('');
  const active = useRef(false);
  const pending = useRef<Attempt | null>(null);
  const prompt = useRef<EditorHandle>(null);
  const material = useRef<EditorHandle>(null);
  const reference = useRef<EditorHandle>(null);

  async function call(data: Record<string,unknown>) {
    const response = await fetch(`/api/assignments/${id}`,{ method:'POST',headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ clientId:client.current,...data }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    return result;
  }

  async function claim(action: 'acquire' | 'takeover') {
    setLockPending(true);
    try {
      const result = await call({ action });
      if (action === 'takeover') {
        const response = await fetch(`/api/assignments/${id}`,{ cache:'no-store' });
        const data = await response.json();
        if (!response.ok || data.state !== 'draft') throw Error(data.error ?? 'DRAFT_CHANGED');
        baseline.current = data;
        setDraft(data.draft);
        prompt.current?.setMarkdown(data.draft.prompt);
        material.current?.setMarkdown(data.draft.material);
        reference.current?.setMarkdown(data.draft.reference);
      }
      setEpoch(result.epoch);
      pending.current = null;
      setRetry(null);
      setPaused(false);
      setHeld(false);
      setStatus(baseline.current.hash ? 'Đã lưu nháp trên Drive.' : 'Nháp tự lưu khi có thay đổi.');
    } catch (error) {
      const code = (error as Error).message;
      setHeld(code === 'LEASE_HELD');
      setStatus(messages[code] ?? 'Chưa mở được quyền sửa nháp.');
    } finally { setLockPending(false); }
  }

  useEffect(() => {
    if (!client.current) client.current = crypto.randomUUID();
    void claim('acquire');
  }, [id]);

  useEffect(() => {
    if (!epoch) return;
    const timer = window.setInterval(() => {
      void call({ action:'renew',epoch }).catch(error => {
        if (error.message !== 'STALE_WRITER' && error.message !== 'ASSIGNMENT_PUBLISHED' && error.message !== 'CLASS_INACTIVE') return;
        setEpoch('');
        setHeld(error.message === 'STALE_WRITER');
        setStatus(messages[error.message] ?? 'Bài đã được giao.');
      });
    },20_000);
    return () => window.clearInterval(timer);
  },[epoch,id]);

  function current(): AssignmentDraft {
    return { ...draft, title:draft.title.trim(), prompt:prompt.current?.getMarkdown() ?? draft.prompt,
      material:material.current?.getMarkdown() ?? draft.material, reference:reference.current?.getMarkdown() ?? draft.reference };
  }

  function acknowledge(result: { draftVersion: string; hash: string }, snapshot: AssignmentDraft) {
    baseline.current = { draft:snapshot, draftVersion:result.draftVersion, hash:result.hash };
    setStatus('Đã lưu nháp trên Drive.');
  }

  async function send(attempt: Attempt) {
    pending.current = attempt;
    const result = await call(attempt);
    if (result.state === 'unknown') {
      setRetry(attempt.action);
      setStatus(attempt.action === 'save' ? 'Chưa xác nhận lưu nháp trên Drive.' : 'Chưa xác nhận giao bài.');
      return false;
    }
    pending.current = null;
    setRetry(null);
    if (attempt.action === 'save' && attempt.draft) acknowledge(result,attempt.draft);
    if (attempt.action === 'publish') {
      setEpoch('');
      setStatus('Đã giao bài.');
      router.refresh();
    }
    return true;
  }

  async function run(action: 'save' | 'publish' | 'retry') {
    if (!epoch || active.current) return;
    active.current = true;
    setBusy(true);
    setPublishing(action === 'publish' || (action === 'retry' && pending.current?.action === 'publish'));
    try {
      if (action === 'retry') {
        if (pending.current) await send(pending.current);
        return;
      }
      const snapshot = current();
      if (action === 'publish' && (!snapshot.title || !snapshot.prompt.trim())) throw Error('PROMPT_REQUIRED');
      if (JSON.stringify(snapshot) !== JSON.stringify(baseline.current.draft)) {
        setStatus('Đang lưu nháp…');
        const saved = await send({ action:'save', key:crypto.randomUUID(), clientId:client.current,
          epoch, baseVersion:baseline.current.draftVersion, draft:snapshot });
        if (!saved) return;
      }
      if (action === 'publish') {
        const { hash, draftVersion } = baseline.current;
        if (!hash) throw Error('PROMPT_REQUIRED');
        setStatus('Đang giao bài…');
        await send({ action:'publish',key:crypto.randomUUID(),clientId:client.current,epoch,baseVersion:draftVersion,hash });
      }
    } catch (error) {
      const code = (error as Error).message;
      const attempt = pending.current;
      if (attempt && ['Failed to fetch','DRIVE_RECONNECT','DRIVE_UNAVAILABLE','DRIVE_SETUP_REQUIRED'].includes(code)) setRetry(attempt.action);
      else pending.current = null;
      if (code === 'STALE_WRITER') { setEpoch(''); setHeld(true); }
      setPaused(true);
      setStatus(messages[code] ?? 'Chưa lưu được nội dung. Kiểm tra Markdown rồi thử lại.');
    } finally { active.current = false; setBusy(false); setPublishing(false); }
  }

  useEffect(() => {
    autosave.current = () => {
      if (!epoch || busy || retry || paused || performance.now() - lastInput.current < 2_000) return;
      if (JSON.stringify(current()) !== JSON.stringify(baseline.current.draft)) void run('save');
    };
  });

  useEffect(() => {
    if (!epoch) return;
    const timer = window.setInterval(() => autosave.current(),350);
    return () => window.clearInterval(timer);
  },[epoch,id]);

  const readOnly = !epoch;
  const value = `${draft.rubricId}:${draft.rubricRevision}`;
  const old = !rubrics.some(item => `${item.id}:${item.revision}` === value);
  return <section className="app-panel" aria-busy={busy || lockPending} onInputCapture={() => {
    lastInput.current = performance.now(); setPaused(false);
  }}>
    {!lockPending && readOnly && <p><button onClick={() => claim(held ? 'takeover' : 'acquire')}>
      {held ? 'Tiếp tục sửa tại đây' : 'Thử mở quyền sửa'}
    </button></p>}
    <fieldset disabled={readOnly || busy} className="assignment-inputs">
      <legend>Thông tin bài</legend>
      <label>Tên bài <input value={draft.title} maxLength={160} onChange={event => setDraft({ ...draft,title:event.target.value })}/></label>
      <label>Rubric <select value={value} onChange={event => {
        const [rubricId,revision] = event.target.value.split(':');
        setDraft({ ...draft,rubricId,rubricRevision:Number(revision) });
        setPaused(false);
      }}>
        {old && <option value={value}>Rubric đã đổi · chọn phiên bản mới</option>}
        {rubrics.map(item => <option key={item.id} value={`${item.id}:${item.revision}`}>{item.label} · v{item.revision}</option>)}
      </select></label>
      <label>Điểm tối đa <input type="number" min="0.25" max="100" step="0.25" required value={draft.scale}
        onChange={event => setDraft({ ...draft,scale:event.target.value })}/></label>
    </fieldset>
    {([
      ['Đề bài','prompt',prompt],['Ngữ liệu','material',material],['Nội dung tham chiếu','reference',reference]
    ] as const).map(([label,field,ref]) => <fieldset key={field}>
      <legend>{label}</legend>
      <EditorWorkbench role="teacher" assignmentId={id} editorRef={ref} readOnly={readOnly || publishing}
        initialMarkdown={initial.draft[field]} onMarkdownChange={source => {
          setDraft(current => current[field] === source ? current : { ...current,[field]:source });
          setPaused(false);
        }}/>
    </fieldset>)}
    <p role="status">{status}</p>
    <div className="app-actions">
      {retry ? <button onClick={() => run('retry')} disabled={busy || readOnly}>
        {retry === 'save' ? 'Thử đồng bộ lại' : 'Thử giao lại'}
      </button> : <>
        <button disabled={busy || readOnly} onClick={() => run('save')}>Lưu nháp</button>
        <button disabled={busy || readOnly} className="app-primary" onClick={() => run('publish')}>Giao bài</button>
      </>}
    </div>
  </section>;
}
