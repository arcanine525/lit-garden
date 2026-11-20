'use client';

import { useState } from 'react';

export function DownloadGradebook({ assignment }: { assignment?: string }) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function download() {
    setBusy(true);
    setError('');
    const url = '/api/reviews/grades' + (assignment ? '?assignment=' + assignment : '');
    try {
      const response = await fetch(url,{ cache:'no-store' });
      if (!response.ok) {
        setError(response.status === 409 ? 'Bảng điểm vừa thay đổi. Hãy tải lại.' : 'Chưa tải được bảng điểm. Hãy thử lại.');
        return;
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'bang-diem.csv';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl),0);
    } catch { setError('Chưa tải được bảng điểm. Hãy thử lại.'); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" disabled={busy} aria-busy={busy} onClick={download}>
      {busy ? 'Đang tải bảng điểm…' : 'Tải bảng điểm CSV'}
    </button>
    {error && <p className="app-error" role="alert">{error}</p>}
  </>;
}
