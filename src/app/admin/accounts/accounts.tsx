'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ActionDialog } from '../../action-dialog';

type Account = {
  id: string; username: string; display_name: string; role: 'teacher' | 'student';
  status: 'active' | 'suspended' | 'provisioning';
  pending_identity_operation_id: string | null;
  drive_state: 'ready' | 'reconnect_required' | 'unavailable' | null;
};

const driveState = { ready: 'Đã kết nối', reconnect_required: 'Cần kết nối lại', unavailable: 'Không truy cập được' };
const userState = { active: 'Hoạt động', suspended: 'Đã khóa', provisioning: 'Chờ xử lý' };

export function Accounts({ editable, role }: { editable: boolean; role: Account['role'] }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [message, setMessage] = useState('Đang tải danh sách…');
  const [password, setPassword] = useState('');
  const [verifiedStudent, setVerifiedStudent] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const visibleAccounts = accounts.filter(account => account.role === role && (!query
    || account.username.includes(query) || account.display_name.toLocaleLowerCase('vi').includes(query)));

  async function load() {
    const response = await fetch('/api/admin/accounts', { cache: 'no-store' });
    if (!response.ok) throw Error('Chưa tải được danh sách tài khoản.');
    setAccounts((await response.json()).accounts);
  }

  useEffect(() => {
    load().then(() => setMessage(''), error => setMessage(error.message));
  }, []);

  async function mutate(input: Record<string, unknown>, inDialog = false) {
    setBusy(true);
    setPassword('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: crypto.randomUUID(), ...input })
      }).catch(() => { throw Error('Chưa kết nối được. Vui lòng thử lại.'); });
      const result = await response.json();
      if (!response.ok) {
        throw Error(result.error === 'REAUTH_REQUIRED' ? 'Phiên xác minh đã hết hạn. Hãy đăng nhập lại.' :
          result.error === 'ALREADY_EXISTS_OR_PENDING' ? 'Tài khoản đã có hoặc đang chờ xử lý.' : 'Chưa thực hiện được thao tác.');
      }
      setPassword(result.temporaryPassword ?? '');
      setMessage(result.operation.state === 'committed' ? 'Đã lưu thay đổi.' :
        result.operation.state === 'unknown' ? 'Đã ghi thay đổi quyền trong ứng dụng. Chờ đồng bộ Keycloak.' :
          'Chưa xác nhận được mật khẩu. Cần người vận hành xử lý tài khoản.');
      await load().catch(() => {});
    } catch (error) {
      if (inDialog) throw error;
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate({ kind: 'create_teacher', username: data.get('username'), name: data.get('name') });
  }

  return <>
    {role === 'teacher' ? <section className="app-panel account-directory" aria-label="Giáo viên" aria-busy={busy}>
      <h2>Tài khoản giáo viên</h2>
      <details className="account-create">
        <summary className="app-button app-primary">Cấp tài khoản giáo viên</summary>
        <form onSubmit={createTeacher} autoComplete="off">
          <label>Tên đăng nhập giáo viên <input name="username" minLength={3} maxLength={30} pattern="[a-z0-9_]+" required/></label>
          <label>Họ tên giáo viên <input name="name" maxLength={100} required/></label>
          <button disabled={!editable || busy}>Cấp tài khoản</button>
        </form>
      </details>
      <ul>{visibleAccounts.map(account => <li key={account.id}>
        <div><strong>{account.display_name}</strong>
          <small>{account.username} · Drive {account.drive_state ? driveState[account.drive_state] : 'chưa kết nối'}</small></div>
        <div className="app-actions">
        <span className={account.status === 'suspended' ? 'account-state suspended' : 'account-state'}>{userState[account.status]}</span>
        {account.pending_identity_operation_id
          ? <button disabled={!editable || busy} onClick={() => mutate({
            kind: 'reconcile', operationId: account.pending_identity_operation_id
          })}>Thử đồng bộ Keycloak</button>
          : <button disabled={!editable || busy || account.status === 'provisioning'} onClick={() => mutate({
          kind: account.status === 'suspended' ? 'resume_teacher' : 'suspend_teacher', userId: account.id
        })}>{account.status === 'suspended' ? 'Mở khóa' : 'Khóa tài khoản'}</button>}
        </div>
      </li>)}</ul>
    </section> : <section className="app-panel account-directory" aria-labelledby="students" aria-busy={busy}>
      <div className="account-search-head">
        <h2 id="students" ref={resultsHeading} tabIndex={-1}>
          {query && visibleAccounts.length === 1 ? 'Tài khoản đã tìm thấy' : 'Tài khoản học sinh'}
        </h2>
        <details className="account-search" open={!query}>
          <summary>{query ? 'Tìm lại' : 'Tìm tài khoản'}</summary>
          <form onSubmit={event => {
            event.preventDefault();
            setQuery(search.trim().toLocaleLowerCase('vi'));
            resultsHeading.current?.focus();
          }}>
            <label>Tên hoặc tên đăng nhập <input type="search" value={search} onChange={event => setSearch(event.target.value)}/></label>{' '}
            <button type="submit">Tìm</button>
          </form>
        </details>
      </div>
      {query && visibleAccounts.length === 0 && <p role="status">Không tìm thấy tài khoản phù hợp.</p>}
      <ul>{visibleAccounts.map(account => <li key={account.id}>
        <div><strong>{account.display_name}</strong><small>{account.username}</small></div>
        <ActionDialog trigger="Đặt lại mật khẩu" title={`Đặt lại mật khẩu của ${account.display_name}?`}
          detail={`Phiên đăng nhập cũ sẽ hết hiệu lực. ${account.display_name} cần đổi mật khẩu tạm khi đăng nhập lại.`}
          confirmLabel="Xác nhận đặt lại" cancelLabel="Quay lại" inactive={!editable || busy} confirmInactive={verifiedStudent !== account.id}
          confirmation={<label className="app-checkbox">
            <input type="checkbox" aria-label="Đã xác minh danh tính người yêu cầu qua thông tin của lớp"
              checked={verifiedStudent === account.id}
              onChange={event => setVerifiedStudent(event.target.checked ? account.id : '')}/>
            Đã xác minh
          </label>}
          onOpen={() => setVerifiedStudent('')} onConfirm={async () => {
            if (verifiedStudent !== account.id) return;
            await mutate({ kind:'reset_student',userId:account.id,identityVerified:true },true);
            setVerifiedStudent('');
          }}/>
      </li>)}</ul>
    </section>}
    <p role="status">{message}</p>
    {password && <section aria-label="Mật khẩu tạm">
      <p>Mật khẩu tạm chỉ hiện cho lần cấp này.</p><output>{password}</output>{' '}
      <button onClick={() => setPassword('')}>Đã lưu</button>
    </section>}
  </>;
}
