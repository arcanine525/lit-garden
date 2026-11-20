'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function ActionDialog({ trigger, title, detail, confirmLabel, cancelLabel = 'Hủy', inactive, confirmInactive, confirmation, onOpen, onConfirm, children }: {
  trigger: string; title: string; detail?: string; confirmLabel: string; cancelLabel?: string; inactive?: boolean;
  confirmInactive?: boolean; confirmation?: ReactNode; onOpen?: () => void; onConfirm: () => Promise<void>; children?: ReactNode;
}) {
  const heading = useId();
  const explanation = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [restoreFocus, setRestoreFocus] = useState(false);

  useEffect(() => {
    if (!restoreFocus || pending || inactive) return;
    const focused = document.activeElement;
    if (focused === document.body || dialog.current?.contains(focused)) opener.current?.focus();
    setRestoreFocus(false);
  },[restoreFocus,pending,inactive]);

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
      onOpen?.();
    }}>{trigger}</button>
    <dialog ref={dialog} aria-labelledby={heading} aria-describedby={detail ? explanation : undefined} aria-busy={pending}
      onCancel={event => { if (pending) event.preventDefault(); }}
      onClose={() => setRestoreFocus(true)}>
      <h2 id={heading}>{title}</h2>
      {detail && <p id={explanation}>{detail}</p>}
      {children}
      {error && <p className="app-error" role="alert">{error}</p>}
      <div className="app-actions">
        <button ref={cancel} type="button" disabled={pending} onClick={() => dialog.current?.close()}>{cancelLabel}</button>
        {confirmation}
        <button type="button" className="app-primary" disabled={pending || confirmInactive} onClick={confirm}>{pending ? 'Đang lưu…' : confirmLabel}</button>
      </div>
    </dialog>
  </>;
}
