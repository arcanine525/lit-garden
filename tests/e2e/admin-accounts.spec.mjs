import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';

const compose = (...args) => promisify(execFile)('docker', ['compose', '--env-file', '.env.local', ...args]);
const call = (page, data) => page.request.post('/api/admin/accounts', {
  data, headers: { Origin: origin }
});

test('T09 provisions accounts, revokes a reset session, and reconciles a Keycloak timeout', async ({ browser }) => {
  test.setTimeout(70_000);
  const db = migrationPool();
  const admin = await keycloakAdmin();
  const identities = [];
  const browsers = [];
  const usernames = [];
  let paused = false;

  async function seed(role) {
    const username = `iam_${randomBytes(6).toString('hex')}`;
    usernames.push(username);
    const password = key();
    const identity = await provisionIdentity(admin, db, { username, name: `Vai trò ${role}`, role, password });
    identities.push(identity);
    const context = await browser.newContext({ baseURL: origin });
    browsers.push(context);
    const page = await context.newPage();
    await enter(page, username, password);
    await setPassword(page, key());
    await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(200);
    return { page, identity, username };
  }

  try {
    const operator = await seed('admin');
    const teacherA = await seed('teacher');
    const teacherB = await seed('teacher');
    const student = await seed('student');

    expect((await teacherA.page.request.get('/api/admin/accounts')).status()).toBe(403);
    expect((await call(teacherB.page, {
      kind: 'reset_student', userId: student.identity.id, key: randomUUID(), identityVerified: true
    })).status()).toBe(403);
    await db.query(`INSERT INTO garden.drive_connections(teacher_id,google_subject,parent_folder_id,app_folder_id,
      refresh_token_ciphertext,token_key_id,granted_scopes,state)
      VALUES($1,'fixture-google','fixture-parent','fixture-folder','\\x00','fixture',ARRAY['drive.file'],'reconnect_required')`,
      [teacherA.identity.id]);

    await operator.page.goto('/admin/accounts');
    await expect(operator.page.getByRole('heading', { name: 'Quản lý tài khoản' })).toBeVisible();
    const directory = await (await operator.page.request.get('/api/admin/accounts')).json();
    const entry = directory.accounts.find(account => account.id === teacherA.identity.id);
    expect(entry.drive_state).toBe('reconnect_required');
    expect(Object.keys(entry).sort()).toEqual([
      'display_name', 'drive_checked_at', 'drive_state', 'id', 'pending_identity_operation_id', 'role', 'status', 'username'
    ]);

    const username = `issued_${randomBytes(5).toString('hex')}`;
    usernames.push(username);
    const create = { kind: 'create_teacher', username, name: 'Giáo viên mới', key: randomUUID() };
    const created = await call(operator.page, create);
    expect(created.status()).toBe(200);
    expect(created.headers()['cache-control']).toBe('no-store');
    const issued = await created.json();
    expect(issued.operation.state).toBe('committed');
    expect(typeof issued.temporaryPassword).toBe('string');
    const [keycloakIssued] = await admin(`/users?exact=true&username=${username}`);
    expect(keycloakIssued.requiredActions).toContain('UPDATE_PASSWORD');
    const repeated = await (await call(operator.page, create)).json();
    expect(repeated.operation.id).toBe(issued.operation.id);
    expect(repeated).not.toHaveProperty('temporaryPassword');

    const reset = { kind: 'reset_student', userId: student.identity.id, key: randomUUID() };
    expect((await call(operator.page, reset)).status()).toBe(422);
    const resetResponse = await call(operator.page, { ...reset, identityVerified: true });
    expect(resetResponse.status()).toBe(200);
    const resetResult = await resetResponse.json();
    expect((await student.page.request.get('/api/me')).status()).toBe(401);
    const studentProfile = await admin(`/users/${student.identity.subject}`);
    expect(studentProfile.requiredActions).toContain('UPDATE_PASSWORD');
    const studentContext = await browser.newContext({ baseURL: origin });
    browsers.push(studentContext);
    const freshStudent = await studentContext.newPage();
    await enter(freshStudent, student.username, resetResult.temporaryPassword);
    await setPassword(freshStudent, key());
    await expect.poll(async () => (await freshStudent.request.get('/api/me')).status()).toBe(200);

    const roleBefore = await admin(`/users/${teacherA.identity.subject}`);
    expect(roleBefore.enabled).toBe(true);
    await compose('pause', 'keycloak');
    paused = true;
    let apiSettled = false;
    const suspended = call(operator.page, {
      kind: 'suspend_teacher', userId: teacherA.identity.id, key: randomUUID()
    }).finally(() => { apiSettled = true; });
    await expect.poll(async () => (await teacherA.page.request.get('/api/me')).status()).toBe(401);
    expect(apiSettled).toBe(false);
    expect((await teacherB.page.request.get('/api/me')).status()).toBe(200);
    const partial = await suspended;
    expect(partial.status()).toBe(202);
    const pending = await partial.json();
    expect(pending.operation.state).toBe('unknown');
    await compose('unpause', 'keycloak');
    paused = false;
    expect((await admin(`/users/${teacherA.identity.subject}`)).enabled).toBe(true);
    await operator.page.reload();
    const retry = operator.page.getByRole('button', { name: 'Thử đồng bộ Keycloak' });
    await expect(retry).toHaveCount(1);
    await retry.click();
    await expect(operator.page.getByRole('status')).toContainText('Đã lưu thay đổi.');
    expect((await admin(`/users/${teacherA.identity.subject}`)).enabled).toBe(false);
    expect(await admin(`/users/${teacherA.identity.subject}/sessions`)).toEqual([]);
    expect((await teacherB.page.request.get('/api/me')).status()).toBe(200);

    const restored = await call(operator.page, { kind: 'resume_teacher', userId: teacherA.identity.id, key: randomUUID() });
    expect(restored.status()).toBe(200);
    expect((await admin(`/users/${teacherA.identity.subject}`)).enabled).toBe(true);
    expect((await teacherA.page.request.get('/api/me')).status()).toBe(401);
    const checks = await db.query(`
      SELECT action_code,outcome,actor_id,target_id,occurred_at
      FROM garden.audit_events WHERE identity_operation_id=ANY($1) ORDER BY id
    `, [[issued.operation.id, resetResult.operation.id, pending.operation.id]]);
    expect(checks.rows.map(row => [row.action_code, row.outcome])).toEqual([
      ['PROVISION', 'requested'], ['PROVISION', 'success'],
      ['RESET', 'requested'], ['RESET', 'success'],
      ['SUSPEND', 'requested'], ['SUSPEND', 'unknown'], ['SUSPEND', 'success']
    ]);
    expect(checks.rows.every(row => row.actor_id === operator.identity.id && row.target_id && row.occurred_at)).toBe(true);

    const metadata = await db.query(`
      SELECT (SELECT jsonb_agg(to_jsonb(operation)) FROM garden.identity_operations operation WHERE actor_id=$1) AS operations,
        (SELECT jsonb_agg(to_jsonb(event)) FROM garden.audit_events event WHERE actor_id=$1) AS audit
    `, [operator.identity.id]);
    const serialized = JSON.stringify(metadata.rows);
    expect(serialized).not.toContain(issued.temporaryPassword);
    expect(serialized).not.toContain(resetResult.temporaryPassword);

    await db.query("UPDATE garden.app_sessions SET authenticated_at=now()-interval '10 minutes' WHERE user_id=$1",
      [operator.identity.id]);
    expect((await operator.page.request.get('/api/admin/accounts')).status()).toBe(200);
    const staleAuth = await call(operator.page, { kind: 'suspend_teacher', userId: teacherA.identity.id, key: randomUUID() });
    expect(staleAuth.status()).toBe(403);
    expect(await staleAuth.json()).toEqual({ error: 'REAUTH_REQUIRED' });
  } finally {
    if (paused) await compose('unpause', 'keycloak');
    try {
      for (const context of browsers) await context.close();
      const { rows } = await db.query('SELECT id,username FROM garden.users WHERE username=ANY($1)', [usernames]);
      const ids = [...new Set(rows.map(row => row.id).concat(identities.map(identity => identity.id)))];
      await db.query('DELETE FROM garden.audit_events WHERE actor_id=ANY($1) OR target_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.identity_operations WHERE actor_id=ANY($1) OR target_user_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.drive_connections WHERE teacher_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.students WHERE id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.teachers WHERE id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.users WHERE id=ANY($1)', [ids]);
      for (const username of usernames) {
        const [user] = await admin(`/users?exact=true&username=${username}`);
        if (user) await admin(`/users/${user.id}`, 'DELETE');
      }
    } finally {
      await db.end();
    }
  }
});
