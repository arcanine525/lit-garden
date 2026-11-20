import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';

const post = (page, data, path = '/api/classes') => page.request.post(path, { data, headers: { Origin: origin } });
const read = async (page, path = '/api/classes') => {
  const response = await page.request.get(path);
  expect(response.ok()).toBe(true);
  return response.json();
};

test('T11 class and membership transitions are owner-only, preserve history and respect suspension', async ({ browser }) => {
  test.setTimeout(70_000);
  const db = migrationPool();
  const admin = await keycloakAdmin();
  const accounts = [];
  const contexts = [];
  const tag = randomBytes(6).toString('hex');
  const year = '2026–2027';

  async function seed(role, handle, name, login = true) {
    const password = key();
    const identity = await provisionIdentity(admin, db, { username: `${handle}_${tag}`, name, role, password });
    accounts.push(identity);
    if (!login) return { id: identity.id };
    const context = await browser.newContext({ baseURL: origin });
    contexts.push(context);
    const page = await context.newPage();
    await enter(page, `${handle}_${tag}`, password);
    await setPassword(page, key());
    await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(200);
    return { id: identity.id, page };
  }

  async function create(page, name) {
    const response = await post(page, { action: 'save_class', name, year });
    expect(response.status()).toBe(201);
    return response.json();
  }

  try {
    const owner = await seed('teacher', 'owner', 'Cô An');
    const other = await seed('teacher', 'other', 'Thầy Minh');
    const student = await seed('student', 'pupil', 'Học sinh chung');
    const applicant = await seed('student', 'applicant', 'Học sinh chờ duyệt', false);
    const operator = await seed('admin', 'operator', 'Quản trị');
    const name = `Lớp An ${tag}`;
    const otherName = `Lớp Minh ${tag}`;
    const { classId, joinCode } = await create(owner.page, name);
    const second = await create(other.page, otherName);
    for (const [teacher, code] of [[owner, joinCode], [other, second.joinCode]]) {
      const joined = await post(student.page, { action: 'join', code });
      expect((await joined.json()).state).toBe('pending');
      const { requests } = await read(teacher.page);
      expect((await post(teacher.page, { action: 'approve', requestId: requests[0].id })).status()).toBe(200);
    }
    const pending = await db.query(`INSERT INTO garden.enrollment_requests(class_id,student_id)
      VALUES($1,$2) RETURNING id`, [classId, applicant.id]);
    const approve = { action: 'approve', requestId: pending.rows[0].id };
    const membership = async id => (await db.query(`SELECT class_id,student_id,state,joined_at,removed_at,version
      FROM garden.memberships WHERE class_id=$1 AND student_id=$2`, [id,student.id])).rows[0];
    const original = await membership(classId);
    const unrelated = await membership(second.classId);

    const archive = { action: 'archive_class', classId };
    const restore = { action: 'restore_class', classId };
    const remove = { action: 'remove_student', classId, studentId: student.id };
    const readmit = { action: 'readmit_student', classId, studentId: student.id };
    const edit = { action: 'save_class', classId, name, year };
    const issue = { action: 'create_student', classId, name: 'Không được cấp', username: `blocked_${tag}`, key: randomUUID() };
    for (const action of [archive, restore, remove, readmit, edit, approve, issue]) {
      expect((await post(other.page, action)).status()).toBe(404);
      expect((await post(student.page, action)).status()).toBe(403);
    }
    expect((await post(student.page, { action: 'leave_class', classId, studentId: student.id })).status()).toBe(403);
    expect((await read(other.page)).classes.map(item => item.id)).toEqual([second.classId]);

    await owner.page.goto('/classes');
    await owner.page.getByRole('button', { name: 'Đưa ra khỏi lớp Học sinh chung' }).click();
    await expect(owner.page.getByRole('status')).toHaveText('Đã đưa học sinh ra khỏi lớp.');
    const removed = await membership(classId);
    expect(removed.removed_at).toBeInstanceOf(Date);
    expect(removed).toEqual({ ...original, state: 'removed', version: '1', removed_at: removed.removed_at });
    expect((await post(owner.page, remove)).status()).toBe(200);
    expect(await membership(classId)).toEqual(removed);
    await student.page.goto('/classes');
    await expect(student.page.getByText(new RegExp(`${name}.*Đã rời lớp`))).toBeVisible();
    await expect(student.page.getByText(new RegExp(`${otherName}.*Đã tham gia`))).toBeVisible();
    expect(await membership(second.classId)).toEqual(unrelated);

    await owner.page.getByRole('button', { name: 'Lưu trữ lớp', exact: true }).click();
    await expect(owner.page.getByRole('status')).toHaveText('Đã lưu trữ lớp.');
    await expect(owner.page.getByRole('heading', { name: new RegExp(name) })).toHaveCount(0);
    expect((await read(owner.page)).classes).toEqual([]);
    expect((await post(owner.page, archive)).status()).toBe(200);
    for (const action of [remove, readmit, edit, approve, issue]) {
      const response = await post(owner.page, action);
      expect(response.status()).toBe(409);
      expect(await response.json()).toEqual({ error: 'CLASS_ARCHIVED' });
    }
    const source = `ho_ten,ten_dang_nhap,lop,nam_hoc\nHọc sinh CSV,csv_${tag},${name},${year}`;
    const csv = await post(owner.page, { action: 'import_csv', source, batch: randomUUID() });
    expect(csv.status()).toBe(200);
    expect((await csv.json()).rows[0]).toMatchObject({ state: 'invalid', error: 'CLASS_NOT_FOUND' });
    expect((await post(student.page, { action: 'join', code: joinCode })).status()).toBe(404);
    expect((await read(other.page, '/api/classes?view=archived')).classes).toEqual([]);
    expect(await membership(classId)).toEqual(removed);

    await owner.page.getByRole('button', { name: 'Đã lưu trữ', exact: true }).click();
    await expect(owner.page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
    await expect(owner.page.getByRole('button', { name: /Nhận lại|Duyệt Học sinh|Lưu lớp/ })).toHaveCount(0);
    await owner.page.getByRole('button', { name: 'Khôi phục lớp' }).click();
    await expect(owner.page.getByRole('status')).toHaveText('Đã khôi phục lớp.');
    await owner.page.getByRole('button', { name: 'Đang hoạt động' }).click();
    await owner.page.getByRole('button', { name: 'Nhận lại Học sinh chung' }).click();
    await expect(owner.page.getByRole('status')).toHaveText('Đã nhận lại học sinh.');
    expect(await membership(classId)).toEqual({ ...original, version: '2' });
    expect(await membership(second.classId)).toEqual(unrelated);

    const suspended = await post(operator.page, { kind: 'suspend_teacher', userId: owner.id, key: randomUUID() }, '/api/admin/accounts');
    expect(suspended.status()).toBe(200);
    expect((await owner.page.request.get('/api/classes')).status()).toBe(401);
    for (const action of [archive, restore, remove, readmit, edit, approve, issue]) {
      expect((await post(owner.page, action)).status()).toBe(401);
    }
    expect((await post(student.page, { action: 'join', code: joinCode })).status()).toBe(404);
    expect((await post(other.page, { ...edit, classId: second.classId, name: `${otherName} mới` })).status()).toBe(200);
    expect((await read(student.page)).classes.find(item => item.id === second.classId).state).toBe('active');
    expect(await membership(second.classId)).toEqual(unrelated);

    const audit = await db.query(`SELECT action_code,target_id,class_id FROM garden.audit_events WHERE actor_id=$1
      AND action_code IN ('ARCHIVE','UNARCHIVE','REMOVE','RESTORE') ORDER BY id`, [owner.id]);
    expect(audit.rows).toEqual([
      { action_code: 'REMOVE', target_id: student.id, class_id: classId },
      { action_code: 'ARCHIVE', target_id: classId, class_id: null },
      { action_code: 'UNARCHIVE', target_id: classId, class_id: null },
      { action_code: 'RESTORE', target_id: student.id, class_id: classId }
    ]);
  } finally {
    try {
      for (const context of contexts) await context.close();
      const ids = accounts.map(account => account.id);
      await db.query('DELETE FROM garden.audit_events WHERE actor_id=ANY($1) OR target_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.identity_operations WHERE actor_id=ANY($1) OR target_user_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.enrollment_requests WHERE student_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.memberships WHERE student_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.classes WHERE teacher_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.students WHERE id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.teachers WHERE id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.users WHERE id=ANY($1)', [ids]);
      for (const account of accounts) await admin(`/users/${account.subject}`, 'DELETE');
    } finally {
      await db.end();
    }
  }
});
