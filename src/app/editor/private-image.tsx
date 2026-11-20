'use client';

import { useEffect, useState } from 'react';
import { assetBlob } from './asset-client';

export function PrivateImage({ reference, alt }: { reference: string; alt: string }) {
  const [source,setSource] = useState<string | null>(null);
  const [failed,setFailed] = useState(false);
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    let mounted = true;
    let url: string | undefined;
    assetBlob(reference).then(blob => {
      if (!mounted) return;
      url = URL.createObjectURL(blob);
      setSource(url);
    }, () => { if (mounted) setFailed(true); });
    return () => { mounted = false; if (url) URL.revokeObjectURL(url); };
  },[reference,attempt]);
  if (failed) return <span className="inline-asset-error">
    <span role="status">Chưa tải được ảnh {alt}.</span>{' '}
    <button type="button" onClick={() => { setSource(null); setFailed(false); setAttempt(current => current + 1); }}>Thử lại ảnh</button>
  </span>;
  if (!source) return <span role="status">Đang tải ảnh…</span>;
  return <img src={source} alt={alt}/>;
}
