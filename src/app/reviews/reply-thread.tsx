'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { ReplySnapshot } from '../../server/reviews/conversation';
import { deadlineFormat } from '../assignments/deadline-input';
import { MarkdownDocument } from '../editor/markdown-document';

type Thread = { publicationId: string; commentDigest: string; writable: boolean; locked: boolean; pending: boolean;
  messages: Array<{ id: string; author: string; role: string; sentAt: string; body: string | null }> };
const messages: Record<string,string> = {
  PUBLICATION_CHANGED:'Kết quả đã được cập nhật. Tải lại trang để mở nhận xét hiện hành.',
  INVALID_REPLY:'Kiểm tra nội dung trước khi gửi.',
  REPLY_REJECTED:'Lần gửi này đã bị hủy hoặc không còn quyền gửi.',
  REPLY_READ_ONLY:'Hội thoại đang ở chế độ chỉ đọc.',
  CLASS_INACTIVE:'Lớp đã lưu trữ. Hội thoại chỉ đọc.',
  OP_IN_PROGRESS:'Đang có một phản hồi chờ xác nhận cho nhận xét này.'
};

export function ReplyThread({ submission, comment, publication, viewer }: { submission: string; comment: string; publication: string; viewer: string }) {
  const path = `/api/submissions/${submission}/comments/${comment}/messages`;
  const storageKey = `garden:reply:${viewer}:${submission}:${comment}`;
  const [thread,setThread] = useState<Thread | null>(null);
  const [body,setBody] = useState('');
  const [attempt,setAttempt] = useState<ReplySnapshot | null>(null);
  const [status,setStatus] = useState('');
  const [loading,setLoading] = useState(false);
  const [busy,setBusy] = useState(false);
  const working = useRef(false);

  async function request<T>(data?: object): Promise<T> {
    const response = await fetch(path,data ? { method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(data) } : { cache:'no-store' });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    return result;
  }

  function remember(value: ReplySnapshot | null) {
    setAttempt(value);
    try {
      if (value) sessionStorage.setItem(storageKey,JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The open page still retains a pending reply. */ }
  }

  async function load(opening = false) {
    setLoading(true);
    try {
      if (opening) try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const intent: ReplySnapshot = JSON.parse(saved);
          setAttempt(intent);
          setBody(intent.body);
          setStatus('Chưa xác nhận đã gửi phản hồi.');
        }
      } catch { /* Storage availability does not affect reading existing messages. */ }
      const result = await request<Thread>();
      if (result.publicationId !== publication) {
        setThread(null);
        setStatus(messages.PUBLICATION_CHANGED);
      } else setThread(result);
    } catch { setStatus('Chưa tải được hội thoại. Hãy thử lại.'); }
    finally { setLoading(false); }
  }

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (working.current) return;
    const intent = attempt ?? (thread?.writable && body.trim() ? { key:crypto.randomUUID(),publicationId:thread.publicationId,
      commentDigest:thread.commentDigest,body } : null);
    if (!intent) return;
    working.current = true;
    setBusy(true);
    remember(intent);
    setStatus('Đang gửi phản hồi…');
    try {
      const response = await request<{ state: string }>({ action:'send',...intent });
      if (response.state !== 'committed') { setStatus('Chưa xác nhận đã gửi phản hồi.'); return; }
      remember(null);
      setBody('');
      await load();
      setStatus('Đã gửi phản hồi.');
    } catch (error) {
      const code = (error as Error).message;
      if (Object.hasOwn(messages,code)) {
        remember(null);
        setStatus(messages[code]);
      } else setStatus('Chưa xác nhận đã gửi phản hồi.');
    } finally { working.current = false; setBusy(false); }
  }

  async function cancel() {
    if (!attempt || working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const result = await request<{ state: string }>({ action:'cancel',key:attempt.key });
      if (result.state === 'missing') { setStatus('Chưa xác nhận được lần gửi.'); return; }
      remember(null);
      if (result.state === 'committed') setBody('');
      await load();
      setStatus(result.state === 'committed' ? 'Đã gửi phản hồi.' : 'Đã hủy lần gửi.');
    } catch { setStatus('Chưa xác nhận hủy lần gửi.'); }
    finally { working.current = false; setBusy(false); }
  }

  return <details onToggle={event => { if (event.currentTarget.open) void load(true); }}>
    <summary>Hội thoại</summary>
    {loading && <p role="status">Đang tải hội thoại…</p>}
    {thread && <>
      {thread.messages.length > 0 && <ul className="reply-list">{thread.messages.map(message => <li key={message.id}>
        <p><strong>{message.author}</strong> · <time dateTime={message.sentAt}>{deadlineFormat.format(new Date(message.sentAt))}</time></p>
        {message.body === null ? <p>Chưa đọc được tin nhắn trên Drive.</p> : <MarkdownDocument source={message.body}/>}
      </li>)}</ul>}
      {!thread.writable && <p>Hội thoại chỉ đọc.</p>}
      {thread.writable && <form onSubmit={send}>
        <label>Tin nhắn mới<textarea required disabled={!!attempt || busy} maxLength={3000} value={body}
          onChange={event => setBody(event.target.value)}/></label>
        <div className="app-actions"><button type="submit" disabled={busy || !body.trim() || (!attempt && thread.pending)}>
          {attempt ? 'Thử gửi lại' : 'Gửi phản hồi'}</button>
          {attempt && <button type="button" disabled={busy} onClick={cancel}>Hủy lần gửi</button>}
        </div>
      </form>}
    </>}
    {!thread && !loading && <button type="button" onClick={() => load(true)}>Tải lại hội thoại</button>}
    {status && <p role="status">{status}</p>}
  </details>;
}
