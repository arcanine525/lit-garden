'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const errors: Record<string,string> = {
  CLASS_FORBIDDEN:'Chỉ chia sẻ được với lớp đang hoạt động do bạn quản lý.',
  NOT_FOUND:'Tài liệu không còn khả dụng.'
};

export function AddLibraryItem() {
  const router = useRouter();
  const id = useRef('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function add() {
    id.current ||= crypto.randomUUID();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/library',{ method:'POST',headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ id:id.current }) });
      if (!response.ok) throw Error('CREATE_FAILED');
      router.push(`/library/${id.current}/edit`);
    } catch { setError('Chưa tạo được tài liệu. Hãy thử lại.'); setBusy(false); }
  }
  return <><button type="button" className="app-primary" disabled={busy} onClick={add}>Thêm tài liệu</button>
    {error && <p role="alert">{error}</p>}</>;
}

export function LibrarySharing({ id, classes, shared }: { id: string; classes: { id: string; name: string }[]; shared: string[] }) {
  const [selected,setSelected] = useState(shared);
  const [busy,setBusy] = useState(false);
  const [status,setStatus] = useState('');
  async function share(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch(`/api/library/${id}`,{ method:'POST',headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ action:'share',classIds:selected }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setStatus(selected.length ? 'Đã lưu chia sẻ.' : 'Đã chuyển tài liệu về chế độ riêng tư.');
    } catch (error) { setStatus(errors[(error as Error).message] ?? 'Chưa lưu được chia sẻ.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={share}>
    <fieldset disabled={busy}><legend>Chia sẻ theo lớp</legend>
      {classes.length ? classes.map(room => <label key={room.id} className="library-share-choice"><input type="checkbox" checked={selected.includes(room.id)}
        onChange={event => setSelected(current => event.target.checked ? [...current,room.id] : current.filter(id => id !== room.id))}/>{room.name}</label>) :
        <p>Chưa có lớp đang hoạt động để chia sẻ.</p>}
      <p>{selected.length ? `Đã chọn ${selected.length} lớp.` : 'Riêng tư.'}</p>
      <button type="submit">Lưu chia sẻ</button>
    </fieldset>
    <p role="status">{status}</p>
  </form>;
}

export function FavoriteLibraryItem({ id, initial }: { id: string; initial: boolean }) {
  const router = useRouter();
  const [favorite,setFavorite] = useState(initial);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/library/${id}`,{ method:'POST',headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ action:'favorite',favorite:!favorite }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setFavorite(result.favorite);
      router.refresh();
    } catch (error) { setError(errors[(error as Error).message] ?? 'Chưa lưu được yêu thích.'); }
    finally { setBusy(false); }
  }
  return <><button type="button" disabled={busy} aria-pressed={favorite} onClick={toggle}>Yêu thích</button>
    {error && <p role="alert">{error}</p>}</>;
}
