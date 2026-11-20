'use client';

import { useRef, useState } from 'react';
import { keepSubmission, pendingSubmission, type PendingSubmission } from './draft-device';

type Timing = { id: string; number: number; submittedAt: string; late: boolean; returned: boolean };
type Status = { state: 'missing' | 'rejected' | 'pending' | 'unknown' } | { state: 'committed'; id: string };
const waiting = 'Chưa xác nhận đã nộp. Bạn có thể thử lại lần nộp này.';
const rejection = 'Chưa nộp. Nháp vẫn được giữ trên thiết bị.';
const resetCodes = ['SUBMISSION_REJECTED','SUBMISSION_EMPTY','INVALID_DRAFT','MARKDOWN_SIZE','STUDENT_IMAGE_FORBIDDEN',
  'UNSAFE_LINK','UNSUPPORTED_MARKDOWN','DRAFT_CHANGED','STALE_WRITER','DRAFT_READ_ONLY','DRIVE_INTEGRITY','KEY_REUSED'];

export function useSubmission(student: string, assignment: string) {
  const path = `/api/assignments/${assignment}/submissions`;
  const [status,setStatus] = useState('');
  const [history,setHistory] = useState<Timing[]>([]);
  const [attempt,setAttempt] = useState<PendingSubmission | null>(null);
  const [knownPending,setKnownPending] = useState(false);
  const [busy,setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<PendingSubmission | null>(null);

  async function request<T>(body?: object): Promise<T> {
    const response = await fetch(path,body ? { method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(body) } :
      { cache:'no-store' });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    return result;
  }

  function update(next: PendingSubmission | null) {
    pending.current = next;
    setAttempt(next);
  }

  async function historyNow() {
    try { setHistory((await request<{ submissions: Timing[] }>()).submissions); }
    catch { /* Keep the last history from this open page until reconnected. */ }
  }

  async function resolved(stored: PendingSubmission, committed: boolean) {
    await keepSubmission(student,assignment,stored,true).catch(() => {});
    if (pending.current?.key !== stored.key) return;
    update(null);
    setKnownPending(false);
    setStatus(committed ? 'Đã nộp bài.' : rejection);
    await historyNow();
  }

  async function inspect(stored: PendingSubmission) {
    try {
      const result = await request<Status>({ action:'status',key:stored.key });
      if (pending.current?.key !== stored.key || inFlight.current) return;
      if (result.state === 'committed' || result.state === 'rejected') await resolved(stored,result.state === 'committed');
      else setKnownPending(result.state === 'pending');
    } catch { /* Only a confirmed server result can clear a saved attempt. */ }
  }

  async function load() {
    const stored = await pendingSubmission(student,assignment).catch(() => null);
    if (stored) {
      update(stored);
      setStatus(waiting);
      await inspect(stored);
    }
    void historyNow();
    return pending.current !== null;
  }

  async function act(action: 'submit' | 'cancel', next?: PendingSubmission) {
    if (inFlight.current) return;
    const snapshot = pending.current ?? next;
    if (!snapshot) return;
    inFlight.current = true;
    setBusy(true);
    update(snapshot);
    setStatus(action === 'submit' ? 'Đang nộp bài…' : 'Đang kiểm tra lần nộp…');
    let stored = snapshot;
    try {
      if (next) {
        stored = await keepSubmission(student,assignment,snapshot).catch(() => snapshot);
        update(stored);
        if (stored.key !== snapshot.key) {
          setStatus(waiting);
          return;
        }
      }
      const result = await request<Status>(action === 'submit' ? stored : { action,key:stored.key });
      if (result.state === 'committed' || result.state === 'rejected') await resolved(stored,result.state === 'committed');
      else {
        setKnownPending(result.state === 'unknown' || result.state === 'pending');
        setStatus(waiting);
      }
    } catch (error) {
      if (resetCodes.includes((error as Error).message)) {
        await resolved(stored,false);
        if ((error as Error).message === 'SUBMISSION_EMPTY') setStatus('Chưa nộp. Hãy viết nội dung bài trước khi nộp.');
      } else setStatus(waiting);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function reconnect() {
    if (inFlight.current) return;
    if (pending.current) void inspect(pending.current);
    else void historyNow();
  }

  return { status,history,attempt,knownPending,busy,load,act,reconnect };
}
