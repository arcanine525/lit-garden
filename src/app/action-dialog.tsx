'use client';

import { useId, useRef, useState } from 'react';

export function ActionDialog({ trigger, title, detail, confirmLabel, inactive, onConfirm }: {
  trigger: string; title: string; detail: string; confirmLabel: string; inactive?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const heading = useId();
  const explanation = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setPending(true);
    setError('');
    try { await onConfirm(); dialog.current?.close(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setPending(false); }
  }

  return <>
    <button ref={opener} type="button" disabled={inactive} onClick={() => {
      setError('');
      dialog.current?.showModal();
      cancel.current?.focus();
    }}>{trigger}</button>
    <dialog ref={dialog} aria-labelledby={heading} aria-describedby={explanation} aria-busy={pending}
      onCancel={event => { if (pending) event.preventDefault(); }}
      onClose={() => opener.current?.focus()}>
      <h2 id={heading}>{title}</h2>
      <p id={explanation}>{detail}</p>
      {error && <p className="app-error" role="alert">{error}</p>}
      <div className="app-actions">
        <button ref={cancel} type="button" disabled={pending} onClick={() => dialog.current?.close()}>Hủy</button>
        <button type="button" className="app-primary" disabled={pending} onClick={confirm}>{pending ? 'Đang lưu…' : confirmLabel}</button>
      </div>
    </dialog>
  </>;
}
