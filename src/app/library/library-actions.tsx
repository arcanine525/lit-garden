'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ActionDialog } from '../action-dialog';

const errors: Record<string,string> = {
  CLASS_FORBIDDEN:'Chỉ chia sẻ được với lớp đang hoạt động do bạn quản lý.',
  LIBRARY_READ_ONLY:'Tài liệu đang ở chế độ chỉ đọc.',
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

export function LibrarySharing({ id, classes, shared, featured }: { id: string; classes: { id: string; name: string }[];
  shared: string[]; featured: { class_id: string; slot: 1 | 2 }[] }) {
  const [selected,setSelected] = useState(shared);
  const [busy,setBusy] = useState(false);
  const [sharedWith,setSharedWith] = useState(shared);
  const [slots,setSlots] = useState<Record<string,number>>(() => Object.fromEntries(featured.map(item => [item.class_id,item.slot])));
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
      setSharedWith(result.shared);
      setSlots(current => Object.fromEntries(Object.entries(current).filter(([room]) => selected.includes(room))));
      setStatus(selected.length ? 'Đã lưu chia sẻ.' : 'Đã chuyển tài liệu về chế độ riêng tư.');
    } catch (error) { setStatus(errors[(error as Error).message] ?? 'Chưa lưu được chia sẻ.'); }
    finally { setBusy(false); }
  }
  async function feature(classId: string, slot: number) {
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch(`/api/library/${id}`,{ method:'POST',headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ action:'feature',classId,slot:slot || null }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setSlots(previous => ({ ...previous,[classId]:slot }));
      setStatus(slot ? 'Đã lưu tài liệu nổi bật.' : 'Đã bỏ khỏi tài liệu nổi bật.');
    } catch (error) { setStatus(errors[(error as Error).message] ?? 'Chưa lưu được tài liệu nổi bật.'); }
    finally { setBusy(false); }
  }
  return <><form onSubmit={share}>
    <fieldset disabled={busy}><legend>Chia sẻ theo lớp</legend>
      {classes.length ? classes.map(room => <label key={room.id} className="library-share-choice"><input type="checkbox" checked={selected.includes(room.id)}
        onChange={event => setSelected(current => event.target.checked ? [...current,room.id] : current.filter(id => id !== room.id))}/>{room.name}</label>) :
        <p>Chưa có lớp đang hoạt động để chia sẻ.</p>}
      <p>{selected.length ? `Đã chọn ${selected.length} lớp.` : 'Riêng tư.'}</p>
      <button type="submit">Lưu chia sẻ</button>
    </fieldset>
  </form>
    {classes.some(room => sharedWith.includes(room.id)) && <fieldset disabled={busy}>
      <legend>Tài liệu nổi bật</legend>
      {classes.filter(room => sharedWith.includes(room.id)).map(room => <label className="library-share-choice" key={room.id}>
        {room.name}<select value={slots[room.id] ?? 0} onChange={event => void feature(room.id,Number(event.target.value))}>
          <option value={0}>Không đặt nổi bật</option><option value={1}>Vị trí 1</option><option value={2}>Vị trí 2</option>
        </select>
      </label>)}
    </fieldset>}
    <p role="status">{status}</p>
  </>;
}

export function FavoriteLibraryItem({ id, initial, writable }: { id: string; initial: boolean; writable: boolean }) {
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
  return <><button type="button" disabled={busy || !writable} aria-pressed={favorite} onClick={toggle}>Yêu thích</button>
    {error && <p role="alert">{error}</p>}</>;
}

export function RemoveLibraryItem({ id, version, pending = false }: { id: string; version: string; pending?: boolean }) {
  const router = useRouter();
  const key = useRef('');
  const [deleting,setDeleting] = useState(pending);
  const [busy,setBusy] = useState(false);
  const [status,setStatus] = useState(pending ? 'Đã gỡ khỏi thư viện. Drive còn file cần đối chiếu.' : '');
  async function remove() {
    key.current ||= crypto.randomUUID();
    setBusy(true);
    try {
      const response = await fetch(`/api/library/${id}`,{ method:'DELETE',headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ key:key.current,version }) });
      const result = await response.json();
      if (!response.ok) throw Error('Chưa xác nhận được việc gỡ tài liệu. Hãy thử lại.');
      if (result.state === 'deleting') {
        setDeleting(true);
        setStatus('Đã gỡ khỏi thư viện. Drive còn file cần đối chiếu.');
      } else {
        setStatus('Đã chuyển các tệp của tài liệu vào thùng rác Drive.');
        router.replace('/library');
        router.refresh();
      }
    } finally { setBusy(false); }
  }
  return <>
    {deleting ? <button type="button" disabled={busy} onClick={() => remove().catch(error => setStatus(error.message))}>
      {busy ? 'Đang đối chiếu…' : 'Thử chuyển vào thùng rác lại'}</button> :
      <ActionDialog trigger="Xóa tài liệu" title="Xóa tài liệu?"
        detail="Tài liệu sẽ được gỡ khỏi thư viện. Các tệp của tài liệu do Vườn Văn quản lý sẽ chuyển vào thùng rác Drive."
        confirmLabel="Gỡ và đưa vào thùng rác" onConfirm={remove}/>}
    {status && <p role="status">{status}</p>}
  </>;
}
