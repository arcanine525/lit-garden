'use client';

import { useRef, useState } from 'react';

export function NotificationRead({ id, read }: { id: string; read: boolean }) {
  const [acknowledged,setAcknowledged] = useState(false);
  const [busy,setBusy] = useState(false);
  const [failed,setFailed] = useState(false);
  const status = useRef<HTMLSpanElement>(null);
  const complete = read || acknowledged;
  async function markRead() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch('/api/notifications',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ id }) });
      if (!response.ok) throw Error('NOT_READ');
      setAcknowledged(true);
      status.current?.focus();
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <>
    <span ref={status} tabIndex={-1} className={complete ? 'notification-state read' : 'visually-hidden'} role="status">
      {complete ? 'Đã đọc' : 'Chưa đọc'}
    </span>
    {!complete && <button type="button" className="notification-mark" aria-label="Chưa đọc · Đánh dấu đã đọc"
      disabled={busy} onClick={markRead}>{busy ? 'Đang lưu…' : 'Chưa đọc'}</button>}
    {failed && <p role="alert">Chưa đánh dấu được. Hãy thử lại.</p>}
  </>;
}
