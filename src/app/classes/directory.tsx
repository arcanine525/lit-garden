'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ActionDialog } from '../action-dialog';
import { AppShell } from '../app-shell';
import './classes.css';

type Class = { id: string; name: string; school_year: string; teacher?: string; state: string; class_state?: string };
type Member = { class_id: string; student_id: string; display_name: string; username: string; state: string };
type Request = { id: string; class_id: string; display_name: string; username: string };
type Row = { line: number; name: string; username: string; className: string; state: string; error?: string; temporaryPassword?: string };

const enrollmentState: Record<string, string> = { active: 'Đang tham gia', pending: 'Đang chờ duyệt', removed: 'Đã rời lớp' };
const rowState: Record<string, string> = {
  ready: 'Có thể cấp', invalid: 'Dòng chưa hợp lệ', existing: 'Đã có tài khoản, hãy dùng mã lớp',
  created: 'Đã cấp', pending: 'Chưa xác nhận, thử lại dòng này'
};
const initial = { classes: [] as Class[], memberships: [] as Member[], requests: [] as Request[] };

export function ClassDirectory({ user }: { user: { display_name: string; role: 'teacher' | 'student' } }) {
  const teacher = user.role === 'teacher';
  const [data, setData] = useState(initial);
  const [feedback, setFeedback] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [credentials, setCredentials] = useState('');
  const [records, setRecords] = useState<Row[]>([]);
  const [source, setSource] = useState('');
  const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState(false);
  const [singleKey, setSingleKey] = useState('');
  const [selected, setSelected] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const createDialog = useRef<HTMLDialogElement>(null);
  const previewList = useRef<HTMLUListElement>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);

  async function refresh(signal?: AbortSignal) {
    const requested = await Promise.all([
      fetch('/api/classes',{ cache:'no-store',signal }),
      teacher ? fetch('/api/classes?view=archived',{ cache:'no-store',signal }) : null
    ]);
    if (requested.some(response => response && !response.ok)) throw Error('Chưa tải được lớp học.');
    const current = { ...initial,...await requested[0]!.json() };
    if (requested[1]) current.classes = [...current.classes,...(await requested[1].json()).classes];
    setData(current);
  }

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal).then(() => {
      if (!controller.signal.aborted) setLoadState('ready');
    }, () => {
      if (!controller.signal.aborted) setLoadState('error');
    });
    return () => controller.abort();
  }, [retry,teacher]);

  useEffect(() => {
    if (previewing) previewList.current?.focus();
  },[previewing]);

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
    const form = event.currentTarget;
    await perform(async () => {
      const key = singleKey || crypto.randomUUID();
      if (action === 'create_student' && !singleKey) setSingleKey(key);
      const result = await post({ action, ...fields, key, ...extra });
      if (result.joinCode) {
        setJoinCode(result.joinCode);
        form.reset();
        createDialog.current?.close();
      }
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
    setBusy(true);
    setPreviewError('');
    try {
      const currentBatch = batch || crypto.randomUUID();
      if (!batch) setBatch(currentBatch);
      const result = await post({ action: preview ? 'preview_csv' : 'import_csv', source, batch: currentBatch, line });
      setRecords(previous => line === undefined ? result.rows : previous.map(row => row.line === line ? result.rows[0] : row));
      setFeedback(preview ? 'Đã kiểm tra CSV.' : 'Đã xử lý các dòng được chọn.');
      setPreviewing(preview);
      if (!preview) await refresh().catch(() => {});
    } catch (error) {
      if (!preview && line === undefined) throw error;
      if (preview) setPreviewError((error as Error).message);
      else setFeedback((error as Error).message);
    } finally { setBusy(false); }
  }

  function clearSource(value: string) {
    setSource(value);
    setBatch('');
    setRecords([]);
  }

  async function changeRoster(payload: Record<string, unknown>, message: string) {
    await perform(async () => {
      await post(payload);
      setFeedback(message);
      await refresh();
    });
  }

  const currentClasses = data.classes.filter(item => item.state !== 'archived' && item.class_state !== 'archived' && item.state !== 'removed');
  const pastClasses = data.classes.filter(item => item.state === 'archived' || item.class_state === 'archived' || item.state === 'removed');
  const room = teacher ? currentClasses.find(item => item.id === selected) : undefined;
  const title = teacher ? room ? `Lớp ${room.name}` : 'Lớp học của tôi' : 'Tham gia lớp';

  return <AppShell user={user} current="/classes" title={title}><div aria-busy={busy || loadState === 'loading'}>
    {loadState === 'loading' && <p className="app-panel" role="status">Đang tải lớp học…</p>}
    {loadState === 'error' && <section className="app-panel">
      <p className="app-error" role="alert">Chưa tải được lớp học.</p>
      <button onClick={() => { setLoadState('loading'); setRetry(retry + 1); }}>Thử lại</button>
    </section>}
    {loadState === 'ready' && teacher && !room && <>
      <section className="class-directory" aria-labelledby="current-classes">
        <p id="current-classes">Các lớp đang hoạt động và danh sách học sinh của bạn.</p>
        <button className="app-primary" onClick={() => { setFeedback(''); createDialog.current?.showModal(); }}>+ Tạo lớp</button>
        <dialog ref={createDialog} className="class-form-dialog" aria-labelledby="create-class-title"
          onCancel={event => { if (busy) event.preventDefault(); }}>
          <h2 id="create-class-title">Tạo lớp</h2>
          <form onSubmit={event => handle(event, 'save_class')}>
            <label>Tên lớp <input name="name" required maxLength={100}/></label>
            <label>Năm học <input name="year" required maxLength={30}/></label>
            <div className="app-actions">
              <button className="app-primary" disabled={busy}>Tạo lớp</button>
              <button type="button" disabled={busy} onClick={() => createDialog.current?.close()}>Hủy</button>
            </div>
            {feedback && <p role="status">{feedback}</p>}
          </form>
        </dialog>
        {joinCode && <p>Mã lớp <output>{joinCode}</output> <button onClick={() => setJoinCode('')}>Đã ghi lại</button></p>}
        {!currentClasses.length && <p>Tạo lớp để cấp tài khoản và gửi mã tham gia.</p>}
        <div className="class-cards">{currentClasses.map(item => <section className="class-card" aria-label={item.name} key={item.id}>
          <div><h3>{item.name}</h3><p>Năm học {item.school_year} · {data.memberships.filter(member => member.class_id === item.id && member.state === 'active').length} thành viên</p></div>
          <button onClick={() => { setSelected(item.id); setFeedback(''); }}>Mở lớp</button>
        </section>)}</div>
      </section>
      <section className="app-panel" aria-labelledby="past-classes">
        <h2 id="past-classes">Đã lưu trữ</h2>
        {!pastClasses.length && <p>Chưa có lớp đã lưu trữ.</p>}
        {pastClasses.map(item => <section className="class-row" aria-label={item.name} key={item.id}>
          <div><h3>{item.name}</h3><p>Năm học {item.school_year}</p></div>
          <button disabled={busy} onClick={() => changeRoster({ action:'restore_class',classId:item.id },'Đã khôi phục lớp.')}>Khôi phục lớp</button>
        </section>)}
      </section>
    </>}
    {loadState === 'ready' && room && <>
      <section className="app-panel" aria-labelledby="class-members">
        <h2 id="class-members">Thành viên</h2>
        <div className="app-actions class-member-actions">
          <details className="class-form">
            <summary className="app-button">Cấp tài khoản</summary>
            <form onSubmit={event => handle(event,'create_student',{ classId:room.id })} onChange={() => setSingleKey('')}>
              <label>Họ tên <input name="name" required maxLength={100}/></label>
              <label>Tên đăng nhập <input name="username" required minLength={3} maxLength={30} pattern="[a-z0-9_]+"/></label>
              <button disabled={busy}>Cấp tài khoản</button>
            </form>
          </details>
          <ActionDialog trigger="Nhập CSV" title={previewing ? 'Xem trước danh sách CSV' : 'Nhập CSV'}
            detail={previewing ? undefined : 'Dùng tiêu đề ho_ten,ten_dang_nhap,lop,nam_hoc.'}
            cancelLabel={previewing ? 'Quay lại' : 'Hủy'}
            confirmLabel={`Cấp ${records.filter(row => row.state === 'ready').length} tài khoản`}
            inactive={busy} confirmInactive={busy || !previewing || !records.some(row => row.state === 'ready')}
            onOpen={() => { setPreviewing(false); setPreviewError(''); }} onConfirm={() => loadRows(false)}>
            {previewing ? <>
              <ul ref={previewList} tabIndex={-1} className="csv-preview" aria-label="Các dòng trong tệp CSV">{records.map(row => <li key={row.line}>
                <div><strong>{row.name || `Dòng ${row.line}`}</strong><small>{row.username}</small></div>
                <span className={row.state === 'ready' ? 'csv-row-state ready' : 'csv-row-state'}>
                  {row.state === 'ready' ? 'Hợp lệ' : row.state === 'existing' ? 'Tài khoản đã tồn tại' : rowState[row.state]}
                </span>
              </li>)}</ul>
              {records.some(row => row.state === 'existing') && <p>Học sinh có thể dùng tài khoản hiện có để gửi yêu cầu tham gia lớp.</p>}
            </> : <>
              <label>Tệp CSV <input type="file" accept=".csv,.tsv,text/csv" onChange={async event => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 1_000_000) { setPreviewError('Tệp vượt quá 1 MB.'); return; }
                clearSource(await file.text());
              }}/></label>
              <p><label>Nội dung CSV <textarea value={source} onChange={event => clearSource(event.target.value)}/></label></p>
              <p><button type="button" disabled={!source || busy} onClick={() => loadRows(true)}>Xem trước</button></p>
            </>}
            {previewError && <p className="app-error" role="alert">{previewError}</p>}
          </ActionDialog>
        </div>
        {credentials && <p>Mật khẩu tạm <output>{credentials}</output> <button onClick={() => setCredentials('')}>Đã lưu</button></p>}
        {!previewing && records.some(row => row.state === 'created' || row.state === 'pending') && <ul>{records.map(row => <li key={row.line}>
          {row.name} · {row.username} · {rowState[row.state]}
          {row.temporaryPassword && <p>Mật khẩu tạm <output>{row.temporaryPassword}</output></p>}
          {row.state === 'pending' && <button disabled={busy} onClick={() => loadRows(false,row.line)}>Thử lại dòng {row.line}</button>}
        </li>)}</ul>}
        {data.memberships.filter(member => member.class_id === room.id).map(member => <div className="class-row" key={member.student_id}>
          <div><strong>{member.display_name}</strong><p>{member.username} · {enrollmentState[member.state]}</p></div>
          <button disabled={busy} onClick={() => {
            const remove = member.state === 'active';
            return changeRoster({ action:remove ? 'remove_student' : 'readmit_student',classId:room.id,studentId:member.student_id },
              remove ? 'Đã đưa học sinh ra khỏi lớp.' : 'Đã nhận lại học sinh.');
          }}>{member.state === 'active' ? 'Đưa ra khỏi lớp' : 'Nhận lại'} {member.display_name}</button>
        </div>)}
      </section>
      <section className="app-panel" aria-labelledby="class-requests">
        <h2 id="class-requests">Yêu cầu tham gia</h2>
        {data.requests.filter(request => request.class_id === room.id).map(request => <div className="class-row" key={request.id}>
          <div><strong>{request.display_name}</strong><p>{request.username}</p></div>
          <button disabled={busy} onClick={() => changeRoster({ action:'approve',requestId:request.id },'Đã duyệt yêu cầu vào lớp.')}>Duyệt {request.display_name}</button>
        </div>)}
      </section>
      <div className="app-actions class-room-nav">
        <button onClick={() => { setSelected(''); setFeedback(''); }} disabled={busy}>Về danh sách lớp</button>
        <ActionDialog trigger="Lưu trữ lớp" title={`Lưu trữ ${room.name}?`} detail="Lớp sẽ chuyển sang lịch sử. Bạn có thể khôi phục để tiếp tục quản lý lớp."
          confirmLabel="Xác nhận lưu trữ" inactive={busy} onConfirm={async () => {
            await post({ action:'archive_class',classId:room.id });
            await refresh();
            setSelected('');
            setFeedback('Đã lưu trữ lớp.');
          }}/>
      </div>
      <details className="class-form">
        <summary>Cài đặt lớp</summary>
        <form onSubmit={event => handle(event,'save_class',{ classId:room.id })}>
          <label>Tên lớp <input name="name" required maxLength={100} defaultValue={room.name}/></label>
          <label>Năm học <input name="year" required maxLength={30} defaultValue={room.school_year}/></label>
          <button disabled={busy}>Lưu lớp</button>
        </form>
      </details>
    </>}
    {loadState === 'ready' && !teacher && <section className="app-panel">
      <h2>Nhập mã lớp</h2>
      <form className="class-join" onSubmit={event => handle(event, 'join')}>
        <label>Mã lớp <input name="code" required maxLength={12}/></label>
        <button disabled={busy}>Gửi yêu cầu</button>
      </form>
      {currentClasses.some(item => item.state === 'active') && <h2>Lớp của tôi</h2>}
      {currentClasses.length === 0 && <p>Nhập mã giáo viên gửi để xin tham gia lớp.</p>}
      {currentClasses.length > 0 && <ul className="class-student-list">{currentClasses.map(item =>
        <li key={item.id} className={item.state === 'pending' ? 'class-pending' : undefined}>
          {item.name} · {item.teacher} · {enrollmentState[item.state]}
        </li>)}</ul>}
      {pastClasses.length > 0 && <>
        <h2>Lịch sử lớp</h2>
        <ul>{pastClasses.map(item => <li key={item.id}>{item.name} · {item.teacher} · {item.class_state === 'archived'
          ? `Đã lưu trữ · ${enrollmentState[item.state]}` : enrollmentState[item.state]}</li>)}</ul>
      </>}
    </section>}
    {loadState === 'ready' && <p role="status">{busy ? 'Đang xử lý…' : feedback}</p>}
  </div></AppShell>;
}
