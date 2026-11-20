'use client';

import { useEffect, useState, type FormEvent } from 'react';

type Account = {
  id: string; username: string; display_name: string; role: 'teacher' | 'student';
  status: 'active' | 'suspended' | 'provisioning';
  pending_identity_operation_id: string | null;
  drive_state: 'ready' | 'reconnect_required' | 'unavailable' | null;
};

const driveState = { ready: 'Đã kết nối', reconnect_required: 'Cần kết nối lại', unavailable: 'Không truy cập được' };
const userState = { active: 'Hoạt động', suspended: 'Đã khóa', provisioning: 'Chờ xử lý' };

export function Accounts({ editable }: { editable: boolean }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [message, setMessage] = useState('Đang tải danh sách…');
  const [password, setPassword] = useState('');
  const [verifiedStudent, setVerifiedStudent] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch('/api/admin/accounts', { cache: 'no-store' });
    if (!response.ok) throw Error('Chưa tải được danh sách tài khoản.');
    setAccounts((await response.json()).accounts);
  }

  useEffect(() => {
    load().then(() => setMessage(''), error => setMessage(error.message));
  }, []);

  async function mutate(input: Record<string, unknown>) {
    setBusy(true);
    setPassword('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: crypto.randomUUID(), ...input })
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error === 'REAUTH_REQUIRED' ? 'Phiên xác minh đã hết hạn. Hãy đăng nhập lại.' :
          result.error === 'ALREADY_EXISTS_OR_PENDING' ? 'Tài khoản đã có hoặc đang chờ xử lý.' : 'Chưa thực hiện được thao tác.');
        return;
      }
      setPassword(result.temporaryPassword ?? '');
      setMessage(result.operation.state === 'committed' ? 'Đã lưu thay đổi.' :
        result.operation.state === 'unknown' ? 'Đã ghi thay đổi quyền trong ứng dụng. Chờ đồng bộ Keycloak.' :
          'Chưa xác nhận được mật khẩu. Cần người vận hành xử lý tài khoản.');
      await load();
    } catch {
      setMessage('Chưa kết nối được. Vui lòng thử lại.');
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
    <section aria-labelledby="teachers">
      <h2 id="teachers">Giáo viên</h2>
      <form onSubmit={createTeacher} autoComplete="off">
        <label>Tên đăng nhập giáo viên <input name="username" minLength={3} maxLength={30} pattern="[a-z0-9_]+" required/></label>
        <label>Họ tên giáo viên <input name="name" maxLength={100} required/></label>
        <button disabled={!editable || busy}>Cấp tài khoản</button>
      </form>
      <ul>{accounts.filter(account => account.role === 'teacher').map(account => <li key={account.id}>
        <p><strong>{account.display_name}</strong> · {account.username}</p>
        <p>{userState[account.status]} · Drive {account.drive_state ? driveState[account.drive_state] : 'chưa kết nối'}</p>
        {account.pending_identity_operation_id
          ? <button disabled={!editable || busy} onClick={() => mutate({
            kind: 'reconcile', operationId: account.pending_identity_operation_id
          })}>Thử đồng bộ Keycloak</button>
          : <button disabled={!editable || busy || account.status === 'provisioning'} onClick={() => mutate({
          kind: account.status === 'suspended' ? 'resume_teacher' : 'suspend_teacher', userId: account.id
        })}>{account.status === 'suspended' ? 'Mở khóa' : 'Khóa tài khoản'}</button>}
      </li>)}</ul>
    </section>
    <section aria-labelledby="students">
      <h2 id="students">Học sinh</h2>
      <ul>{accounts.filter(account => account.role === 'student').map(account => <li key={account.id}>
        <p><strong>{account.display_name}</strong> · {account.username}</p>
        <label><input type="checkbox" checked={verifiedStudent === account.id}
          onChange={event => setVerifiedStudent(event.target.checked ? account.id : '')}/>
          Đã xác minh người yêu cầu qua danh sách và thông tin liên hệ của lớp.
        </label>
        <button disabled={!editable || busy || verifiedStudent !== account.id} onClick={() => {
          setVerifiedStudent('');
          mutate({ kind: 'reset_student', userId: account.id, identityVerified: true });
        }}>Đặt lại mật khẩu</button>
      </li>)}</ul>
    </section>
    <p role="status">{message}</p>
    {password && <section aria-label="Mật khẩu tạm">
      <p>Mật khẩu tạm chỉ hiện cho lần cấp này.</p><output>{password}</output>{' '}
      <button onClick={() => setPassword('')}>Đã lưu</button>
    </section>}
  </>;
}
