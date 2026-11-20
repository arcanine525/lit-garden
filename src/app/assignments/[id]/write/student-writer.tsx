'use client';

import { useEffect, useRef, useState } from 'react';
import { ActionDialog } from '../../../action-dialog';
import { EditorWorkbench } from '../../../editor/editor-workbench';
import type { EditorHandle } from '../../../editor/markdown-editor';
import type { DraftBody } from '../../../../server/student-drafts/access';
import { deadlineFormat } from '../../deadline-input';
import { deviceDrafts, downloadDraft, keepDeviceCopy, syncedBranch, type DeviceCopy } from './draft-device';
import { FocusClock, type FocusClockHandle } from './focus-clock';
import { useSubmission } from './use-submission';

type Head = { draft: DraftBody; writable: boolean; version: string; hash: string | null };
type Lease = { epoch: string; version: string };
type Attempt = { action: 'save'; key: string; epoch: string; baseVersion: string; draft: DraftBody };
const empty = { markdown:'',explanation:'' };
const synced = 'Đã đồng bộ nháp lên Drive.';
const stale = 'Quyền viết đã chuyển. Bạn vẫn có thể tải phần chưa đồng bộ.';
const same = (a: DraftBody, b: DraftBody) => a.markdown === b.markdown && a.explanation === b.explanation;
const inaccessible = (code: string) => ['UNAUTHENTICATED','FORBIDDEN','DRAFT_NOT_FOUND'].includes(code);
const fenced = (code: string) => inaccessible(code) || ['STALE_WRITER','DRAFT_READ_ONLY','DRAFT_CHANGED'].includes(code);

export function StudentWriter({ assignment, student }: { assignment: string; student: string }) {
  const path = `/api/assignments/${assignment}/draft`;
  const submission = useSubmission(student,assignment);
  const [initial,setInitial] = useState<DraftBody>(empty);
  const [explanation,setExplanation] = useState('');
  const [renderKey,remountEditor] = useState(0);
  const [ready,setReady] = useState(false);
  const [writable,setWritable] = useState(true);
  const [epoch,setEpoch] = useState('');
  const [held,setHeld] = useState(false);
  const [busy,setBusy] = useState(false);
  const [dirty,setDirty] = useState(false);
  const [retry,setRetry] = useState(false);
  const [recovery,setRecovery] = useState<DeviceCopy | null>(null);
  const [deviceError,setDeviceError] = useState(false);
  const [status,setStatus] = useState('Đang mở nháp…');
  const editor = useRef<EditorHandle>(null);
  const clock = useRef<FocusClockHandle>(null);
  const client = useRef('');
  const branch = useRef('');
  const restored = useRef<string | null>(null);
  const lease = useRef('');
  const body = useRef<DraftBody>(empty);
  const head = useRef<Head>({ draft:empty,writable:true,version:'0',hash:null });
  const writes = useRef(Promise.resolve());
  const pending = useRef<Attempt | null>(null);
  const working = useRef(false);
  const pause = useRef(false);
  const updatedAt = useRef(0);
  const dirtySince = useRef(0);
  const frame = useRef(0);
  const autosave = useRef<() => void>(() => {});
  const reconnect = useRef<() => void>(() => {});

  async function request<T>(data?: Record<string,unknown>): Promise<T> {
    const response = await fetch(path,data ? { method:'POST',headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ clientId:client.current,...data }) } : { cache:'no-store' });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    return result;
  }

  function setLease(next: string) {
    lease.current = next;
    setEpoch(next);
  }

  function show(draft: DraftBody) {
    cancelAnimationFrame(frame.current);
    setInitial(draft);
    setExplanation(draft.explanation);
    body.current = draft;
    remountEditor(value => value+1);
  }

  function persist(branchId: string, copy: DeviceCopy | null) {
    writes.current = writes.current.then(async () => {
      try { await keepDeviceCopy(student,assignment,branchId,copy); setDeviceError(false); }
      catch { setDeviceError(true); }
    });
  }

  function copy(draft: DraftBody, branchId: string) {
    return { ...draft,branch:branchId,savedAt:Date.now(),version:head.current.version,hash:head.current.hash };
  }

  function remember() {
    const changed = !same(body.current,head.current.draft) ||
      (!!pending.current && !same(body.current,pending.current.draft));
    dirtySince.current = changed ? dirtySince.current || performance.now() : 0;
    setDirty(changed);
    const branchId = branch.current;
    persist(branchId,changed ? copy(body.current,branchId) : null);
  }

  function capture(value: DraftBody) {
    if (!lease.current || same(value,body.current)) return;
    body.current = value;
    updatedAt.current = performance.now();
    if (!pending.current) pause.current = false;
    remember();
    if (!pending.current) setStatus(same(value,head.current.draft) ?
      (head.current.hash ? synced : 'Nháp sẽ tự đồng bộ khi có thay đổi.') : 'Có thay đổi chưa đồng bộ.');
  }

  async function claim(action: 'acquire' | 'takeover' | 'read') {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const local = !ready ? deviceDrafts(student,assignment).catch(() => { setDeviceError(true); return null; }) : null;
    try {
      const previous = await request<Head>();
      const granted = previous.writable && action !== 'read' ? await request<Lease>({ action }).catch(error => {
        if (error.message === 'LEASE_HELD') return null;
        throw error;
      }) : null;
      const latest = granted ? await request<Head>() : previous;
      if (local) setRecovery((await local)?.recovery ?? null);
      if (!same(body.current,head.current.draft)) {
        // A new writer starts from Drive. Keep edits from the old lease as a separate copy.
        setRecovery(copy(body.current,branch.current));
        branch.current = crypto.randomUUID();
        restored.current = null;
      }
      head.current = latest;
      if (latest.hash) persist(syncedBranch,copy(latest.draft,syncedBranch));
      show(latest.draft);
      setDirty(false);
      dirtySince.current = 0;
      setWritable(latest.writable);
      setHeld(latest.writable && !granted);
      setLease(latest.writable ? granted?.epoch ?? '' : '');
      pending.current = null;
      pause.current = false;
      setRetry(false);
      setStatus(!latest.writable ? 'Bài đang ở chế độ chỉ đọc.' : action === 'read' ? 'Hãy xử lý lần nộp đang chờ để tiếp tục viết.' :
        !granted ? 'Nháp đang được viết ở nơi khác.' :
        latest.hash ? synced : 'Nháp sẽ tự đồng bộ khi có thay đổi.');
    } catch (error) {
      const code = (error as Error).message;
      if (inaccessible(code)) {
        setWritable(false);
        setRecovery(null);
        show(empty);
        setStatus('Bạn không còn quyền mở nháp này.');
      } else {
        const cached = await local;
        if (local) setRecovery(cached?.recovery ?? null);
        if (cached && cached.synced) {
          const { markdown,explanation,version,hash } = cached.synced;
          head.current = { draft:{ markdown,explanation },version,hash,writable:false };
          show(head.current.draft);
        }
        setStatus('Chưa mở được nháp từ Drive. Bạn có thể tải bản lưu trên thiết bị nếu có.');
      }
    } finally {
      working.current = false;
      setBusy(false);
      setReady(true);
    }
  }

  useEffect(() => {
    client.current ||= crypto.randomUUID();
    branch.current ||= crypto.randomUUID();
    void submission.load().then(pending => claim(pending ? 'read' : 'acquire'));
    const timer = window.setInterval(() => autosave.current(),350);
    const onOnline = () => reconnect.current();
    window.addEventListener('online',onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online',onOnline);
      cancelAnimationFrame(frame.current);
    };
  },[assignment,student]);

  function lose(code: string) {
    setLease('');
    setHeld(code === 'STALE_WRITER' || code === 'DRAFT_CHANGED');
    if (code === 'DRAFT_READ_ONLY' || inaccessible(code)) setWritable(false);
    setRetry(false);
    setStatus(code === 'STALE_WRITER' || code === 'DRAFT_CHANGED' ? stale : 'Bài đang ở chế độ chỉ đọc.');
    pending.current = null;
  }

  async function renew(expected: string) {
    try { await request<Lease>({ action:'renew',epoch:expected }); }
    catch (error) { if (lease.current === expected && fenced((error as Error).message)) lose((error as Error).message); }
  }

  useEffect(() => {
    if (!epoch) return;
    const timer = window.setInterval(() => { void renew(epoch); },20_000);
    return () => window.clearInterval(timer);
  },[epoch,assignment]);

  async function release() {
    if (!lease.current || working.current) return;
    capture(current());
    working.current = true;
    setBusy(true);
    try {
      await request({ action:'release',epoch:lease.current });
      setLease('');
      setHeld(false);
      setStatus('Đã nhường quyền viết.');
      pending.current = null;
      pause.current = false;
      setRetry(false);
    } catch (error) {
      const code = (error as Error).message;
      if (fenced(code)) lose(code);
      else setStatus('Chưa nhường được quyền viết.');
    } finally { working.current = false; setBusy(false); }
  }

  function current() {
    return { ...body.current,markdown:editor.current?.getMarkdown() ?? body.current.markdown };
  }

  function startSubmission() {
    if (!lease.current || working.current || submission.busy || submission.attempt) return;
    const snapshot = current();
    capture(snapshot);
    if (snapshot.markdown.trim()) clock.current?.pause();
    void submission.act('submit',{ action:'submit',key:crypto.randomUUID(),clientId:client.current,epoch:lease.current,
      baseVersion:head.current.version,draft:snapshot });
  }

  async function save() {
    if (!lease.current || working.current) return;
    capture(current());
    if (!pending.current && same(body.current,head.current.draft)) return;
    const attempt = pending.current ?? { action:'save',key:crypto.randomUUID(),epoch:lease.current,
      baseVersion:head.current.version,draft:body.current };
    pending.current = attempt;
    working.current = true;
    setBusy(true);
    setStatus('Đang đồng bộ nháp…');
    try {
      await writes.current;
      if (attempt.epoch !== lease.current) return;
      const result = await request<{ state: string; version: string; hash: string }>(attempt);
      if (attempt.epoch !== lease.current) return;
      if (result.state === 'unknown') {
        setRetry(true);
        setStatus('Chưa xác nhận đồng bộ lên Drive.');
        return;
      }
      pending.current = null;
      setRetry(false);
      head.current = { ...head.current,draft:attempt.draft,version:result.version,hash:result.hash };
      persist(syncedBranch,copy(attempt.draft,syncedBranch));
      remember();
      if (restored.current && same(body.current,attempt.draft)) {
        persist(restored.current,null);
        restored.current = null;
        setRecovery(null);
      }
      setStatus(same(body.current,attempt.draft) ? synced : 'Có thay đổi chưa đồng bộ.');
    } catch (error) {
      const code = (error as Error).message;
      if (attempt.epoch !== lease.current) return;
      if (fenced(code)) lose(code);
      else if (['INVALID_DRAFT','MARKDOWN_SIZE','STUDENT_IMAGE_FORBIDDEN','UNSAFE_LINK','UNSUPPORTED_MARKDOWN','EDITOR_IMPORT'].includes(code)) {
        pending.current = null;
        pause.current = true;
        setStatus('Kiểm tra Markdown trước khi đồng bộ lại.');
      } else {
        setRetry(true);
        setStatus('Chưa xác nhận đồng bộ lên Drive.');
      }
    } finally { working.current = false; setBusy(false); }
  }

  useEffect(() => {
    autosave.current = () => {
      if (!lease.current || working.current || submission.busy || retry || pause.current || !dirty) return;
      const now = performance.now();
      if (now - updatedAt.current < 2_000 && now - dirtySince.current < 10_000) return;
      void save();
    };
    reconnect.current = () => {
      if (lease.current) void renew(lease.current);
      submission.reconnect();
    };
  });

  const draftPanel = <section className="app-panel" aria-label="Nháp bài viết" onInputCapture={() => {
    if (!lease.current) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => capture(current()));
  }}>
    <p role="status">{status}</p>
    {deviceError && <p role="alert">Chưa lưu được bản trên thiết bị. Hãy tải Markdown để giữ nội dung.</p>}
    {ready && !epoch && writable && !submission.attempt && (held ? <ActionDialog trigger="Tiếp tục viết tại đây" title="Chuyển quyền viết"
      detail="Thiết bị trước có thể còn nội dung chưa đồng bộ. Bạn sẽ bắt đầu từ bản đã đồng bộ gần nhất."
      confirmLabel="Chuyển quyền viết" inactive={busy} onConfirm={() => claim('takeover')}/> :
      <button type="button" disabled={busy} onClick={() => claim('acquire')}>Thử mở quyền viết</button>)}
    {recovery && <div className="app-actions">
      <button type="button" onClick={() => downloadDraft(recovery)}>Tải bản lưu trên thiết bị (.md)</button>
      {epoch && !dirty && <ActionDialog trigger="Khôi phục bản lưu trên thiết bị" title="Khôi phục bản lưu"
        detail="Nội dung được khôi phục vào editor và sẽ đồng bộ cho bài này."
        confirmLabel="Khôi phục bản lưu" inactive={busy} onConfirm={async () => {
          restored.current = recovery.branch;
          const { markdown,explanation } = recovery;
          const draft = { markdown,explanation };
          capture(draft);
          show(draft);
        }}/>}
    </div>}
    {ready && <>
      <EditorWorkbench key={renderKey} role="student" assignmentId={assignment} editorRef={editor} readOnly={!epoch}
        initialMarkdown={initial.markdown} onMarkdownChange={markdown => capture({ ...body.current,markdown })}/>
      <label>Giải thích (tùy chọn)<textarea value={explanation} readOnly={!epoch} onChange={event => {
        setExplanation(event.target.value);
        capture({ ...current(),explanation:event.target.value });
      }}/></label>
      <div className="app-actions">
        <button type="button" onClick={() => downloadDraft(epoch ? current() : body.current)}>Tải nháp của tôi (.md)</button>
        {epoch && <>
          <button type="button" disabled={busy || submission.busy || (!dirty && !retry)} onPointerDown={event => event.preventDefault()}
            onClick={() => void save()}>{retry ? 'Thử đồng bộ lại' : 'Đồng bộ nháp'}</button>
          <button type="button" disabled={busy || submission.busy || !!submission.attempt} onClick={() => void release()}>Ngừng viết ở đây</button>
        </>}
        {submission.attempt ? <>
          <button type="button" className="app-primary" disabled={submission.busy || busy} onClick={() => void submission.act('submit')}>Thử nộp lại</button>
          <button type="button" onClick={() => { if (submission.attempt) downloadDraft(submission.attempt.draft); }}>Tải lần nộp đang chờ (.md)</button>
          {submission.knownPending && <ActionDialog trigger="Hủy lần nộp đang chờ" title="Hủy lần nộp đang chờ"
            detail="Bạn vẫn có thể giữ nháp và chủ động nộp một lần khác." confirmLabel="Hủy lần nộp"
            inactive={submission.busy || busy} onConfirm={() => submission.act('cancel')}/>}
        </> : epoch && <button type="button" className="app-primary" disabled={busy || submission.busy}
          onPointerDown={event => event.preventDefault()} onClick={startSubmission}>
          {submission.history.length ? 'Nộp bản mới' : 'Nộp bài'}
        </button>}
      </div>
      <p role="status">{submission.status}</p>
      {submission.history.length > 0 && <section>
        <h2>Lịch sử bản nộp</h2>
        <ul>{submission.history.map(item => <li key={item.id}>
          <a href={`/api/content/submissions/${item.id}`} target="_blank" rel="noreferrer">Lần nộp {item.number}</a>
          {' · '}{deadlineFormat.format(new Date(item.submittedAt))}{item.late && ' · Nộp muộn'}
          {item.returned && <> · <a href={`/results/${item.id}`}>Xem nhận xét</a></>}
        </li>)}</ul>
      </section>}
    </>}
  </section>;
  return <>
    <FocusClock student={student} assignment={assignment} clockRef={clock}/>
    {draftPanel}
  </>;
}
