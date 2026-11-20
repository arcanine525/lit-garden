'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ActionDialog } from '../action-dialog';

type Class = { id: string; name: string; school_year: string; teacher?: string; state: string; class_state?: string };
type Member = { class_id: string; student_id: string; display_name: string; username: string; state: string };
type Request = { id: string; class_id: string; display_name: string; username: string };
type Row = { line: number; name: string; username: string; className: string; state: string; error?: string; temporaryPassword?: string };

const enrollmentState: Record<string, string> = { active: 'Đã tham gia', pending: 'Đang chờ duyệt', removed: 'Đã rời lớp' };
const rowState: Record<string, string> = {
  ready: 'Có thể cấp', invalid: 'Dòng chưa hợp lệ', existing: 'Đã có tài khoản, hãy dùng mã lớp',
  created: 'Đã cấp', pending: 'Chưa xác nhận, thử lại dòng này'
};
const initial = { classes: [] as Class[], memberships: [] as Member[], requests: [] as Request[] };

export function ClassDirectory({ teacher }: { teacher: boolean }) {
  const [data, setData] = useState(initial);
  const [feedback, setFeedback] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [credentials, setCredentials] = useState('');
  const [records, setRecords] = useState<Row[]>([]);
  const [source, setSource] = useState('');
  const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState(false);
  const [singleKey, setSingleKey] = useState('');
  const [archived, setArchived] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);

  async function refresh(showArchived = archived, signal?: AbortSignal) {
    const response = await fetch(showArchived ? '/api/classes?view=archived' : '/api/classes', { cache: 'no-store', signal });
    if (!response.ok) throw Error('Chưa tải được lớp học.');
    setData({ ...initial, ...await response.json() });
  }

  useEffect(() => {
    const controller = new AbortController();
    refresh(archived, controller.signal).then(() => {
      if (!controller.signal.aborted) setLoadState('ready');
    }, () => {
      if (!controller.signal.aborted) setLoadState('error');
    });
    return () => controller.abort();
  }, [archived, retry]);

  async function post(payload: Record<string, unknown>) {
    const response = await fetch('/api/classes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error === 'INVALID_CSV'
      ? 'CSV chưa hợp lệ. Kiểm tra tiêu đề và tối đa 300 dòng.'
      : result.error === 'CLASS_NOT_FOUND' ? 'Không tìm thấy lớp phù hợp.'
      : result.error === 'CLASS_ARCHIVED' ? 'Lớp đã lưu trữ. Khôi phục lớp để thay đổi danh sách.'
      : 'Chưa thực hiện được thao tác. Kiểm tra thông tin và thử lại.');
    return result;
  }

  async function handle(event: FormEvent<HTMLFormElement>, action: string, extra: Record<string, unknown> = {}) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    await perform(async () => {
      const key = singleKey || crypto.randomUUID();
      if (action === 'create_student' && !singleKey) setSingleKey(key);
      const result = await post({ action, ...fields, key, ...extra });
      if (result.joinCode) setJoinCode(result.joinCode);
      if (action === 'create_student') {
        setCredentials(result.temporaryPassword ?? '');
        setFeedback(rowState[result.state]);
        if (result.state !== 'pending') setSingleKey('');
      } else if (action === 'join') {
        setFeedback(enrollmentState[result.state]);
      } else setFeedback('Đã lưu lớp.');
      await refresh();
    });
  }

  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (error) { setFeedback((error as Error).message); }
    finally { setBusy(false); }
  }

  async function loadRows(preview: boolean, line?: number) {
    await perform(async () => {
      const currentBatch = batch || crypto.randomUUID();
      if (!batch) setBatch(currentBatch);
      const result = await post({ action: preview ? 'preview_csv' : 'import_csv', source, batch: currentBatch, line });
      setRecords(previous => line === undefined ? result.rows : previous.map(row => row.line === line ? result.rows[0] : row));
      setFeedback(preview ? 'Đã kiểm tra CSV.' : 'Đã xử lý các dòng được chọn.');
      if (!preview) await refresh();
    });
  }

  function clearSource(value: string) {
    setSource(value);
    setBatch('');
    setRecords([]);
  }

  function changeView(showArchived: boolean) {
    if (archived === showArchived) return;
    setData(initial);
    setFeedback('');
    setLoadState('loading');
    setArchived(showArchived);
  }

  async function changeRoster(payload: Record<string, unknown>, message: string) {
    await perform(async () => {
      await post(payload);
      setFeedback(message);
      await refresh();
    });
  }

  const currentClasses = data.classes.filter(item => item.class_state !== 'archived' && item.state !== 'removed');
  const pastClasses = data.classes.filter(item => item.class_state === 'archived' || item.state === 'removed');

  return <div aria-busy={busy || loadState === 'loading'}>
    {teacher && <nav className="app-actions" aria-label="Danh sách lớp">
        <button disabled={busy} aria-pressed={!archived} onClick={() => changeView(false)}>Đang hoạt động</button>{' '}
        <button disabled={busy} aria-pressed={archived} onClick={() => changeView(true)}>Đã lưu trữ</button>
      </nav>}
    {loadState === 'loading' && <p className="app-panel" role="status">Đang tải lớp học…</p>}
    {loadState === 'error' && <section className="app-panel">
      <p className="app-error" role="alert">Chưa tải được lớp học.</p>
      <button onClick={() => { setLoadState('loading'); setRetry(retry + 1); }}>Thử lại</button>
    </section>}
    {loadState === 'ready' && (teacher ? <>
      {!archived && <section className="app-panel app-roster-form">
      <h2>Tạo lớp</h2>
      <form onSubmit={event => handle(event, 'save_class')}>
        <label>Tên lớp <input name="name" required maxLength={100}/></label>{' '}
        <label>Năm học <input name="year" required maxLength={30}/></label>{' '}
        <button disabled={busy}>Tạo lớp</button>
      </form>
      {joinCode && <p>Mã lớp <output>{joinCode}</output>{' '}
        <button onClick={() => setJoinCode('')}>Đã ghi lại</button></p>}
      <h2>Cấp tài khoản học sinh</h2>
      <form onSubmit={event => handle(event, 'create_student')} onChange={() => setSingleKey('')}>
        <label>Họ tên <input name="name" required maxLength={100}/></label>{' '}
        <label>Tên đăng nhập <input name="username" required minLength={3} maxLength={30} pattern="[a-z0-9_]+"/></label>{' '}
        <label>Lớp <select name="classId" required defaultValue="">
          <option value="" disabled>Chọn lớp</option>
          {data.classes.filter(item => item.state === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>{' '}
        <button disabled={busy}>Cấp tài khoản</button>
      </form>
      {credentials && <p>Mật khẩu tạm <output>{credentials}</output>{' '}
        <button onClick={() => setCredentials('')}>Đã lưu</button></p>}
      <h2>Nhập CSV</h2>
      <p>Dùng tiêu đề <code>ho_ten,ten_dang_nhap,lop,nam_hoc</code> và lớp đã tạo.</p>
      <label>Tệp CSV <input type="file" accept=".csv,.tsv,text/csv" onChange={async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 1_000_000) { setFeedback('Tệp vượt quá 1 MB.'); return; }
        clearSource(await file.text());
      }}/></label>
      <p><label>Nội dung CSV <textarea value={source} onChange={event => clearSource(event.target.value)}/></label></p>
      <button disabled={!source || busy} onClick={() => loadRows(true)}>Xem trước</button>{' '}
      <button disabled={!records.some(row => row.state === 'ready') || busy} onClick={() => loadRows(false)}>Nhập tài khoản mới</button>
      {records.length > 0 && <ul>{records.map(row => <li key={row.line}>
        Dòng {row.line} · {row.name} · {row.username} · {rowState[row.state]}
        {row.temporaryPassword && <p>Mật khẩu tạm <output>{row.temporaryPassword}</output></p>}
        {row.state === 'pending' && <button disabled={busy} onClick={() => loadRows(false, row.line)}>Thử lại dòng {row.line}</button>}
      </li>)}</ul>}
      </section>}
      <h2>{archived ? 'Lớp đã lưu trữ' : 'Danh sách lớp'}</h2>
      {data.classes.length === 0 && <p className="app-panel">{archived ? 'Chưa có lớp đã lưu trữ.' : 'Tạo lớp để cấp tài khoản và gửi mã tham gia.'}</p>}
      {data.classes.map(item => <section className="app-panel" aria-label={item.name} key={item.id}>
        <h3>{item.name} · {item.school_year}</h3>
        {item.state === 'active'
          ? <ActionDialog trigger="Lưu trữ lớp" title={`Lưu trữ ${item.name}?`} detail="Lớp sẽ chuyển sang lịch sử. Bạn có thể khôi phục để tiếp tục quản lý lớp."
            confirmLabel="Xác nhận lưu trữ" inactive={busy} onConfirm={async () => {
              await post({ action: 'archive_class', classId: item.id });
              await refresh();
              setFeedback('Đã lưu trữ lớp.');
            }}/>
          : <button disabled={busy} onClick={() => changeRoster({ action: 'restore_class', classId: item.id }, 'Đã khôi phục lớp.')}>Khôi phục lớp</button>}
        {item.state === 'active' && <form onSubmit={event => handle(event, 'save_class', {classId: item.id})}>
          <label>Tên lớp <input name="name" required maxLength={100} defaultValue={item.name}/></label>{' '}
          <label>Năm học <input name="year" required maxLength={30} defaultValue={item.school_year}/></label>{' '}
          <button disabled={busy}>Lưu lớp</button>
        </form>}
        <ul>{data.memberships.filter(member => member.class_id === item.id).map(member => <li key={member.student_id}>
          {member.display_name} · {member.username} · {enrollmentState[member.state]}{' '}
          {item.state === 'active' && <button disabled={busy} onClick={() => {
            const remove = member.state === 'active';
            return changeRoster({ action: remove ? 'remove_student' : 'readmit_student', classId: item.id, studentId: member.student_id },
              remove ? 'Đã đưa học sinh ra khỏi lớp.' : 'Đã nhận lại học sinh.');
          }}>{member.state === 'active' ? 'Đưa ra khỏi lớp' : 'Nhận lại'} {member.display_name}</button>}
        </li>)}</ul>
        <ul>{data.requests.filter(request => request.class_id === item.id).map(request => <li key={request.id}>
          {request.display_name} · {request.username}{' '}
          {item.state === 'active' && <button disabled={busy} onClick={() =>
            changeRoster({ action: 'approve', requestId: request.id }, 'Đã duyệt yêu cầu vào lớp.')}>Duyệt {request.display_name}</button>}
        </li>)}</ul>
      </section>)}
    </> : <section className="app-panel">
      <form onSubmit={event => handle(event, 'join')}>
        <label>Mã lớp <input name="code" required maxLength={12}/></label>{' '}
        <button disabled={busy}>Gửi yêu cầu</button>
      </form>
      <h2>Lớp của tôi</h2>
      {currentClasses.length === 0 && <p>Nhập mã giáo viên gửi để xin tham gia lớp.</p>}
      <ul>{currentClasses.map(item => <li key={item.id}>{item.name} · {item.teacher} · {enrollmentState[item.state]}</li>)}</ul>
      {pastClasses.length > 0 && <>
        <h2>Lịch sử lớp</h2>
        <ul>{pastClasses.map(item => <li key={item.id}>{item.name} · {item.teacher} · {item.class_state === 'archived'
          ? `Đã lưu trữ · ${enrollmentState[item.state]}` : enrollmentState[item.state]}</li>)}</ul>
      </>}
    </section>)}
    {loadState === 'ready' && <p role="status">{busy ? 'Đang xử lý…' : feedback}</p>}
  </div>;
}
