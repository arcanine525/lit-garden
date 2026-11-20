import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';

const call = (page, data, url = '/api/classes') => page.request.post(url, { data, headers: { Origin: origin } });
const collect = async response => {
  expect(response.ok()).toBe(true);
  return response.json();
};

async function spareServer() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, [
    fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url)),
    'start', '--hostname', '127.0.0.1', '--port', String(port)
  ], { stdio: 'ignore' });
  return { child, url: `http://127.0.0.1:${port}` };
}

test('T10 two teachers, shared student enrollment, CSV validation and crash recovery', async ({ browser }) => {
  test.setTimeout(90_000);
  const db = migrationPool();
  const admin = await keycloakAdmin();
  const contexts = [];
  const usernames = [];
  const teachers = [];
  const slug = randomBytes(5).toString('hex');
  const teacherClass = `10A ${slug}`;
  const otherClass = `10B ${slug}`;
  const year = '2026–2027';
  const csvHeader = 'ho_ten,ten_dang_nhap,lop,nam_hoc';
  const created = `new_${slug}`, csvName = `csv_${slug}`, interrupted = `hold_${slug}`;
  let child, blockedPid, pending;
  let triggerCreated = false;
  const trigger = `fixture_pause_${slug}`;

  async function signIn(username, password) {
    const context = await browser.newContext({ baseURL: origin });
    contexts.push(context);
    const page = await context.newPage();
    await enter(page, username, password);
    await setPassword(page, key());
    return page;
  }

  async function teacher(label) {
    const username = `gv_${label.toLowerCase()}_${slug}`;
    usernames.push(username);
    const password = key();
    const identity = await provisionIdentity(admin, db, { username, name: `Cô ${label}`, role: 'teacher', password });
    teachers.push(identity.id);
    return signIn(username, password);
  }

  async function removeTrigger() {
    if (!triggerCreated) return;
    await db.query(`DROP TRIGGER ${trigger} ON garden.memberships; DROP FUNCTION garden.${trigger}()`);
    triggerCreated = false;
  }

  try {
    const [a,b] = [await teacher('An'),await teacher('Mai')];
    const drive = await db.query('SELECT 1 FROM garden.drive_connections WHERE teacher_id=ANY($1)', [teachers]);
    expect(drive.rowCount).toBe(0);
    const classA = await collect(await call(a, { action: 'save_class', name: 'Lớp sẽ sửa', year }));
    const classB = await collect(await call(b, { action: 'save_class', name: otherClass, year }));
    expect(classA.joinCode).toMatch(/^[A-F0-9]{12}$/);
    expect(await collect(await call(a, { action: 'save_class', classId: classA.classId, name: teacherClass, year })))
      .toEqual({ classId: classA.classId });
    expect((await call(b, { action: 'save_class', classId: classA.classId, name: 'Sai quyền', year })).status()).toBe(404);

    usernames.push(created,csvName,interrupted);
    const single = await collect(await call(a, {
      action: 'create_student', classId: classA.classId, name: 'Học sinh chung', username: created, key: randomUUID()
    }));
    expect(single.state).toBe('created');
    expect(typeof single.temporaryPassword).toBe('string');

    const source = `\uFEFF${csvHeader}\r\n"Nguyễn, Linh",${csvName},${otherClass},${year}\r\nSai tên,,${otherClass},${year}\r\nHọc sinh chung,${created},${otherClass},${year}\r\nTrùng CSV,${csvName},${otherClass},${year}`;
    const preview = await collect(await call(b, { action: 'preview_csv', source }));
    expect(preview.rows.map(row => row.state)).toEqual(['ready','invalid','existing','invalid']);
    await b.goto('/classes');
    await b.getByRole('region',{ name:otherClass,exact:true }).getByRole('button',{ name:'Mở lớp' }).click();
    const importButton = b.getByRole('button',{ name:'Nhập CSV',exact:true });
    await importButton.focus();
    await importButton.press('Enter');
    const importDialog = b.getByRole('dialog');
    await expect(importDialog.getByRole('button',{ name:'Hủy',exact:true })).toBeFocused();
    await importDialog.getByLabel('Nội dung CSV').fill(source);
    await importDialog.getByRole('button',{ name:'Xem trước',exact:true }).click();
    await expect(importDialog.getByRole('heading',{ name:'Xem trước danh sách CSV' })).toBeVisible();
    await expect(importDialog.getByText('Tài khoản đã tồn tại',{ exact:true })).toBeVisible();
    await expect(importDialog.getByRole('button',{ name:'Cấp 1 tài khoản' })).toBeEnabled();
    await b.keyboard.press('Escape');
    await expect(importDialog).not.toBeVisible();
    await expect(importButton).toBeFocused();
    expect((await db.query('SELECT id FROM garden.users WHERE username=$1',[csvName])).rowCount).toBe(0);
    await importButton.press('Enter');
    await importDialog.getByRole('button',{ name:'Xem trước',exact:true }).click();
    const confirmImport = importDialog.getByRole('button',{ name:'Cấp 1 tài khoản' });
    await expect(confirmImport).toBeEnabled();
    const imported = b.waitForResponse(response => response.url().endsWith('/api/classes') &&
      response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'import_csv',{ timeout:14_000 });
    await confirmImport.press('Enter');
    const importResult = await collect(await imported);
    await expect(importDialog).not.toBeVisible();
    await expect(importButton).toBeFocused();
    expect(importResult.rows.map(row => row.state)).toEqual(['created','invalid','existing','invalid']);
    expect(importResult.rows[0].name).toBe('Nguyễn, Linh');
    expect(importResult.rows[0].temporaryPassword).toBeTruthy();
    expect(importResult.rows[2]).not.toHaveProperty('temporaryPassword');

    // The original password still works after the duplicate row was processed.
    const student = await signIn(created, single.temporaryPassword);
    await student.goto('/classes');
    await expect(student.getByText(new RegExp(teacherClass))).toBeVisible();
    await expect(student.getByText(new RegExp(otherClass))).toHaveCount(0);
    await student.getByLabel('Mã lớp').fill(classB.joinCode);
    await student.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    await expect(student.getByRole('status')).toHaveText('Đang chờ duyệt');
    const studentId = (await (await student.request.get('/api/me')).json()).user.id;
    const beforeApprove = await db.query('SELECT class_id FROM garden.memberships WHERE student_id=$1', [studentId]);
    expect(beforeApprove.rows).toEqual([{ class_id: classA.classId }]);
    expect((await db.query('SELECT 1 FROM garden.recipients WHERE student_id=$1 AND class_id=$2',
      [studentId,classB.classId])).rowCount).toBe(0);
    const directory = await collect(await b.request.get('/api/classes'));
    const request = directory.requests.find(item => item.class_id === classB.classId && item.username === created);
    expect((await call(a, { action: 'approve', requestId: request.id })).status()).toBe(404);
    await b.goto('/classes');
    await b.getByRole('region',{ name:otherClass,exact:true }).getByRole('button',{ name:'Mở lớp' }).click();
    await b.getByRole('button', { name: 'Duyệt Học sinh chung' }).click();
    await expect(b.getByRole('status')).toHaveText('Đã duyệt yêu cầu vào lớp.');
    await student.reload();
    await expect(student.getByText(new RegExp(`${otherClass}.*Đang tham gia`))).toBeVisible();
    const afterApprove = await db.query('SELECT class_id FROM garden.memberships WHERE student_id=$1', [studentId]);
    expect(afterApprove.rows.map(row => row.class_id).sort()).toEqual([classA.classId,classB.classId].sort());

    await db.query(`
      CREATE FUNCTION garden.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM garden.users WHERE id=NEW.student_id AND username='${interrupted}')
          THEN PERFORM pg_sleep(25); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER ${trigger} BEFORE INSERT ON garden.memberships
        FOR EACH ROW EXECUTE FUNCTION garden.${trigger}();
    `);
    triggerCreated = true;
    const recoverySource = `${csvHeader}\nHọc sinh gián đoạn,${interrupted},${otherClass},${year}`;
    const batch = randomUUID();
    const spare = await spareServer();
    child = spare.child;
    await expect.poll(async () => (await fetch(`${spare.url}/api/health`).catch(() => ({ status: 0 }))).status).toBe(200);
    pending = call(b, { action: 'import_csv', source: recoverySource, batch }, spare.url + '/api/classes').catch(() => null);
    const linked = async () => (await db.query(`
      SELECT operation.id,operation.keycloak_user_id,account.id AS account_id
      FROM garden.identity_operations operation JOIN garden.users account ON account.id=operation.target_user_id
      WHERE account.username=$1 AND operation.state='keycloak_linked'
    `, [interrupted])).rows[0];
    await expect.poll(linked).toBeTruthy();
    const pin = await linked();
    await expect.poll(async () => {
      const { rows } = await db.query(`
        SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event='PgSleep' AND query LIKE '%INSERT INTO garden.memberships%'
      `);
      blockedPid = rows[0]?.pid;
      return blockedPid;
    }).toBeTruthy();
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
    child = undefined;
    await db.query('SELECT pg_terminate_backend($1)', [blockedPid]);
    blockedPid = undefined;
    expect(await pending).toBeNull();
    await removeTrigger();

    const retry = await collect(await call(b, { action: 'import_csv', source: recoverySource, batch, line: 2 }));
    expect(retry.rows[0].state).toBe('created');
    expect(retry.rows[0].operationId).toBe(pin.id);
    expect(retry.rows[0].temporaryPassword).toBeTruthy();
    const providerUsers = await admin(`/users?exact=true&username=${interrupted}`);
    expect(providerUsers.map(user => user.id)).toEqual([pin.keycloak_user_id]);
    expect((await db.query('SELECT 1 FROM garden.memberships WHERE class_id=$1 AND student_id=$2',
      [classB.classId, pin.account_id])).rowCount).toBe(1);
    const recoveryReplay = await collect(await call(b, { action: 'import_csv', source: recoverySource, batch, line: 2 }));
    expect(recoveryReplay.rows[0]).not.toHaveProperty('temporaryPassword');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    if (blockedPid) await db.query('SELECT pg_terminate_backend($1)', [blockedPid]);
    if (pending) await pending;
    try {
      await removeTrigger();
      for (const context of contexts) await context.close();
      const { rows } = await db.query('SELECT id FROM garden.users WHERE username=ANY($1)', [usernames]);
      const ids = rows.map(row => row.id);
      await db.query('DELETE FROM garden.audit_events WHERE actor_id=ANY($1) OR target_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.identity_operations WHERE actor_id=ANY($1) OR target_user_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.enrollment_requests WHERE student_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.memberships WHERE student_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.classes WHERE teacher_id=ANY($1)', [teachers]);
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
