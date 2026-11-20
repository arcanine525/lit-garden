'use client';

import { useState } from 'react';

type Status = { state: string; pending: string | null; provider: 'fake' | 'google' };
type PickerSelection = { action: string; docs?: Array<{ id: string }> };
interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setCallback(callback: (result: PickerSelection) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}
type PickerLibrary = {
  DocsView: new (viewId: string) => { setIncludeFolders(value: boolean): void; setSelectFolderEnabled(value: boolean): void; setOwnedByMe(value: boolean): void };
  ViewId: { FOLDERS: string }; PickerBuilder: new () => PickerBuilder; Action: { PICKED: string; CANCEL: string };
};
const globalPicker = () => window as Window & {
  gapi?: { load(name: string, config: { callback(): void; onerror(): void; timeout: number; ontimeout(): void }): void };
  google?: { picker: PickerLibrary };
};
let library: Promise<PickerLibrary> | undefined;

function loadPicker() {
  if (library) return library;
  library = new Promise<PickerLibrary>((resolve, reject) => {
    const fail = () => reject(Error('DRIVE_PICKER'));
    const load = () => {
      if (!globalPicker().gapi) return fail();
      globalPicker().gapi?.load('picker', {
        callback: () => { const picker = globalPicker().google?.picker; if (picker) resolve(picker); else fail(); },
        onerror: fail, timeout: 10_000, ontimeout: fail
      });
    };
    if (globalPicker().gapi) return load();
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = load;
    script.onerror = () => { script.remove(); fail(); };
    document.head.appendChild(script);
  }).catch(error => { library = undefined; throw error; });
  return library;
}

const messages: Record<string,string> = {
  DRIVE_IDENTITY: 'Hãy kết nối lại tài khoản Google đã dùng để lưu dữ liệu.',
  DRIVE_CALLBACK_EXPIRED: 'Lượt cấp quyền đã kết thúc. Nếu cần, hãy kết nối lại.',
  DRIVE_AUTH: 'Google chưa xác nhận cấp quyền. Hãy thử lại.',
  DRIVE_QUOTA: 'Drive đang giới hạn lượt truy cập hoặc đã hết dung lượng. Hãy thử lại sau.',
  DRIVE_RECONNECT: 'Quyền Drive đã hết hạn. Hãy kết nối lại.',
  DRIVE_SCOPE: 'Cần cấp quyền truy cập tệp do Vườn Văn quản lý.',
  DRIVE_PARENT_FORBIDDEN: 'Hãy chọn thư mục có quyền thêm tệp trong My Drive của bạn.',
  DRIVE_FORBIDDEN: 'Drive từ chối quyền truy cập thư mục này.',
  DRIVE_MISSING: 'Không truy cập được thư mục trên Drive.',
  DRIVE_INTEGRITY: 'Thông tin thư mục trên Drive đã thay đổi. Hãy kiểm tra thư mục rồi thử lại.',
  DRIVE_PICKER: 'Chưa mở được bộ chọn thư mục của Google.'
};
const stateLabel: Record<string,string> = { not_connected: 'Chưa kết nối', ready: 'Đã kết nối', reconnect_required: 'Mất quyền truy cập', unavailable: 'Drive tạm thời không khả dụng' };

export function DriveConnection({ status, result }: { status: Status; result?: string }) {
  const [drive, setDrive] = useState(status);
  const [message, setMessage] = useState(result ? messages[result] ?? '' : '');
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [parent, setParent] = useState('');

  function report(error: unknown) {
    const code = error instanceof Error ? error.message : '';
    setMessage(messages[code] ?? 'Chưa xác minh được kết nối Drive. Hãy thử lại.');
  }

  async function finish(selected?: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finish', parent: selected }) });
      if (!response.ok) throw Error((await response.json()).error);
      setDrive({ ...drive, state: 'ready', pending: null });
      setMessage('Đã xác minh thư mục Vườn Văn trên Drive.');
    } catch (error) {
      report(error);
      const fresh = await fetch('/api/drive').catch(() => null);
      if (fresh?.ok) setDrive(await fresh.json());
    } finally { setBusy(false); }
  }

  async function pick() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/drive?view=picker', { cache: 'no-store' });
      const options = await response.json();
      if (!response.ok) throw Error(options.error);
      if (drive.provider === 'fake') {
        setFolders(options.folders);
        setParent(options.folders[0]?.id ?? '');
        setBusy(false);
        return;
      }
      const picker = await loadPicker();
      const view = new picker.DocsView(picker.ViewId.FOLDERS);
      view.setIncludeFolders(true);
      view.setSelectFolderEnabled(true);
      view.setOwnedByMe(true);
      const dialog = new picker.PickerBuilder().addView(view).setOrigin(window.location.origin)
        .setAppId(options.projectNumber).setDeveloperKey(options.developerKey).setOAuthToken(options.accessToken)
        .setCallback(selection => {
          if (selection.action === picker.Action.PICKED && selection.docs?.[0]?.id) void finish(selection.docs[0].id);
          else if (selection.action === picker.Action.CANCEL) setBusy(false);
        }).build();
      dialog.setVisible(true);
    } catch (error) { report(error); setBusy(false); }
  }

  const reconnect = drive.state === 'reconnect_required';
  return <>
    <span className={reconnect ? 'drive-state needs-access' : 'drive-state'}>{stateLabel[drive.state]}</span>
    {drive.state !== 'not_connected' && <p>Thư mục ứng dụng <strong>Vườn Văn</strong></p>}
    {reconnect && <p className="drive-notice">Kết nối lại bằng tài khoản Google đã liên kết để tiếp tục lưu bài.</p>}
    <div className="app-actions drive-actions">
      <form action="/api/drive" method="post">
        <input type="hidden" name="action" value="authorize"/>
        <button className="app-primary" disabled={busy}>{drive.state === 'not_connected' ? 'Cấp quyền Drive' : 'Kết nối lại Drive'}</button>
      </form>
      {(reconnect || drive.pending === 'pick') && <button disabled={busy || drive.pending !== 'pick'} onClick={pick}>Chọn thư mục cha</button>}
      {drive.pending === 'verify' && <button disabled={busy} onClick={() => finish()}>Xác minh thư mục</button>}
    </div>
    {drive.pending === 'pick' && folders.length > 0 && <p>
      <label>Thư mục cha <select value={parent} disabled={busy} onChange={event => setParent(event.target.value)}>
        {folders.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>{' '}
      <button disabled={busy || !parent} onClick={() => finish(parent)}>Dùng thư mục này</button>
    </p>}
    {drive.provider === 'fake' && <small className="drive-provider">Drive giả lập trên môi trường local</small>}
    <p role="status">{message}</p>
  </>;
}
