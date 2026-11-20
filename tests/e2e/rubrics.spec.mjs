import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';

const criteria = [
  { label: 'Xác định vấn đề nghị luận', group: 'Nội dung', levels: [
    ['0,25', 'Đúng vấn đề và yêu cầu trọng tâm.'], ['0', 'Chưa xác định được vấn đề.']
  ] },
  { label: 'Triển khai vấn đề', group: 'Nội dung', levels: [
    ['0,75', 'Lí giải ba khía cạnh có liên kết.'], ['0,50', 'Lí giải được hai khía cạnh.'],
    ['0,25', 'Lí giải được một khía cạnh.'], ['0', 'Chưa lí giải khía cạnh nào.']
  ] },
  { label: 'Sử dụng bằng chứng', group: 'Nội dung', levels: [
    ['0,50', 'Hai bằng chứng phù hợp.'], ['0,25', 'Một bằng chứng phù hợp.'], ['0', 'Chưa có bằng chứng phù hợp.']
  ] },
  { label: 'Tổ chức đoạn văn', group: 'Hình thức', levels: [
    ['0,25', 'Đoạn hoàn chỉnh và mạch lạc.'], ['0', 'Các ý rời rạc hoặc đoạn chưa hoàn chỉnh.']
  ] },
  { label: 'Diễn đạt', group: 'Hình thức', levels: [
    ['0,25', 'Diễn đạt rõ, không quá hai lỗi.'], ['0', 'Có từ ba lỗi diễn đạt.']
  ] }
];

const post = (page, data, source = origin) => page.request.post('/api/rubrics', { data, headers: { Origin: source } });
const list = async page => {
  const response = await page.request.get('/api/rubrics');
  expect(response.status()).toBe(200);
  return (await response.json()).rubrics;
};

test('T12 shared rubric has immutable revisions, a read-only catalog and retirement', async ({ browser, request }) => {
  test.setTimeout(70_000);
  const db = migrationPool();
  const admin = await keycloakAdmin();
  const accounts = [];
  const contexts = [];
  const tag = randomBytes(6).toString('hex');
  const label = `Đoạn nghị luận xã hội ${tag}`;
  const changedDescription = 'Nêu đúng yêu cầu và giới hạn phạm vi.';
  let rubricId;

  async function signIn(role) {
    const username = `${role}_${tag}`;
    const password = key();
    const account = await provisionIdentity(admin, db, { username, name: role, role, password });
    accounts.push(account);
    const context = await browser.newContext({ baseURL: origin });
    contexts.push(context);
    const page = await context.newPage();
    await enter(page, username, password);
    await setPassword(page, key());
    await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(200);
    return page;
  }

  try {
    expect((await request.get('/api/rubrics')).status()).toBe(401);
    const operator = await signIn('admin');
    const teacher = await signIn('teacher');
    const student = await signIn('student');
    await operator.getByRole('link', { name: 'Quản lý rubric mẫu' }).click();
    await operator.getByRole('button', { name: 'Tạo rubric', exact: true }).click();
    await operator.getByLabel('Tên rubric', { exact: true }).fill(label);
    for (const [index, criterion] of criteria.entries()) {
      if (index) await operator.getByRole('button', { name: 'Thêm tiêu chí' }).click();
      const section = operator.getByRole('group', { name: `Tiêu chí ${index + 1}`, exact: true });
      await section.getByLabel('Tên tiêu chí').fill(criterion.label);
      await section.getByLabel('Nhóm').fill(criterion.group);
      for (const [levelIndex, [points, description]] of criterion.levels.entries()) {
        if (levelIndex >= 2) await section.getByRole('button', { name: 'Thêm mức điểm' }).click();
        const level = section.getByRole('group', { name: `Mức ${levelIndex + 1}`, exact: true });
        await level.getByLabel('Điểm', { exact: true }).fill(points);
        await level.getByLabel('Mô tả', { exact: true }).fill(description);
      }
    }
    await operator.getByRole('button', { name: 'Lưu rubric' }).click();
    await expect(operator.getByRole('status')).toHaveText('Đã lưu phiên bản rubric.');
    const first = (await list(operator)).find(item => item.label === label);
    rubricId = first.id;
    expect(first.revision).toBe(1);
    expect(first.definition.max).toBe('2.00');
    expect(first.definition.criteria.map(item => item.levels.length)).toEqual([2,4,3,2,2]);

    const create = { action: 'create', id: rubricId, label, definition: first.definition };
    expect((await post(operator, create)).status()).toBe(201);
    const revise = { ...create, action: 'revise', expectedRevision: 1 };
    const retire = { action: 'retire', id: rubricId, expectedRevision: 1 };
    for (const data of [create,revise,retire]) {
      expect((await post(teacher, data)).status()).toBe(403);
      expect((await post(student, data)).status()).toBe(403);
    }
    expect((await post(operator, revise, 'https://untrusted.test')).status()).toBe(403);
    const invalid = structuredClone(revise);
    invalid.definition.criteria[0].levels[1].score = '0.25';
    expect((await post(operator, invalid)).status()).toBe(422);

    await teacher.getByRole('link', { name: 'Rubric chấm bài' }).click();
    await teacher.getByRole('button', { name: label, exact: true }).press('Enter');
    await expect(teacher.getByRole('heading', { name: label })).toBeVisible();
    await expect(teacher.getByText('Thang chuẩn 2 điểm')).toBeVisible();
    await expect(teacher.getByRole('button', { name: /Tạo rubric|Tạo phiên bản|Ngừng dùng/ })).toHaveCount(0);
    for (const criterion of criteria) {
      await teacher.locator('summary').filter({ hasText: criterion.label }).click();
      for (const [,description] of criterion.levels) await expect(teacher.getByText(description, { exact: true })).toBeVisible();
    }
    await student.getByRole('link', { name: 'Rubric chấm bài' }).click();
    await student.getByRole('button', { name: label, exact: true }).click();
    await expect(student.getByRole('heading', { name: label })).toBeVisible();
    await expect(student.getByRole('button', { name: /Tạo rubric|Tạo phiên bản|Ngừng dùng/ })).toHaveCount(0);

    await operator.getByRole('button', { name: 'Tạo phiên bản mới' }).click();
    await operator.getByRole('group', { name: 'Tiêu chí 1', exact: true }).getByRole('group', { name: 'Mức 1', exact: true })
      .getByLabel('Mô tả').fill(changedDescription);
    await operator.getByRole('button', { name: 'Lưu rubric' }).click();
    await expect(operator.getByRole('status')).toHaveText('Đã lưu phiên bản rubric.');
    const history = (await list(operator)).filter(item => item.id === rubricId);
    expect(history.map(item => item.revision)).toEqual([2,1]);
    expect(history[1]).toEqual(first);
    expect(history[0].definition.criteria[0].levels[0].description).toBe(changedDescription);
    expect((await post(operator, revise)).status()).toBe(409);
    expect((await post(operator, { ...revise, definition: history[0].definition })).status()).toBe(200);
    expect((await post(operator, retire)).status()).toBe(409);
    await expect(db.query('UPDATE garden.rubric_templates SET label=$2 WHERE id=$1 AND revision=1', [rubricId,'Oops']))
      .rejects.toMatchObject({ code: '23514' });
    expect((await list(teacher)).filter(item => item.id === rubricId)).toEqual([history[0]]);

    await operator.getByRole('button', { name: 'Ngừng dùng', exact: true }).click();
    await expect(operator.getByRole('status')).toHaveText('Đã ngừng dùng rubric.');
    expect((await post(operator, { ...retire, expectedRevision: 2 })).status()).toBe(200);
    await expect(db.query('UPDATE garden.rubric_templates SET retired=false WHERE id=$1 AND revision=2', [rubricId]))
      .rejects.toMatchObject({ code: '23514' });
    expect((await list(teacher)).filter(item => item.id === rubricId)).toEqual([]);
    expect((await list(student)).filter(item => item.id === rubricId)).toEqual([]);
    await teacher.reload();
    await expect(teacher.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    await operator.getByRole('button', { name: `${label} · v1`, exact: true }).click();
    await expect(operator.getByText('Thang chuẩn 2 điểm')).toBeVisible();
    await expect(operator.getByText('Phiên bản 1', { exact: true })).toBeVisible();
    await operator.locator('summary').filter({ hasText: criteria[0].label }).click();
    await expect(operator.getByText(criteria[0].levels[0][1])).toBeVisible();
    const audit = await db.query('SELECT target_kind FROM garden.audit_events WHERE target_id=$1 ORDER BY id', [rubricId]);
    expect(audit.rows.map(item => item.target_kind)).toEqual(['rubric_create','rubric_revise','rubric_retire']);
  } finally {
    try {
      for (const context of contexts) await context.close();
      const ids = accounts.map(account => account.id);
      await db.query('DELETE FROM garden.audit_events WHERE actor_id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.rubric_templates WHERE created_by=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.students WHERE id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.teachers WHERE id=ANY($1)', [ids]);
      await db.query('DELETE FROM garden.users WHERE id=ANY($1)', [ids]);
      for (const account of accounts) await admin(`/users/${account.subject}`, 'DELETE');
    } finally {
      await db.end();
    }
  }
});
