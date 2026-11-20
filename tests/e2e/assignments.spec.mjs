import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';

const api = (actor, path, data) => actor.page.request.post(path,{ data, headers:{ Origin:origin } });
test.use({ actionTimeout: 10_000, navigationTimeout: 15_000 });
const form = {
  max: '2.00', criteria: [{ id: 'argument', label: 'Lập luận', levels: [
    { id: 'full', score: '2.00', description: 'Lập luận có dẫn chứng cụ thể.' },
    { id: 'start', score: '0', description: 'Chưa nêu được dẫn chứng.' }
  ] }]
};

test('T17 autosaves an assignment, publishes all verified objects and keeps a rubric snapshot', async ({ browser }) => {
  test.setTimeout(90_000);
  const db = migrationPool();
  const kc = await keycloakAdmin();
  const slug = randomBytes(6).toString('hex');
  const subject = 'publish_' + slug;
  const rubric = randomUUID();
  const trigger = 'fixture_publish_' + slug;
  const contexts = [], accounts = [];
  let assignment, classId, triggerCreated = false;
  const title = 'Mùa xuân trong vườn ' + slug;
  const prompt = 'Hãy viết một đoạn văn về **mùa xuân**.';
  const material = '> Những mầm non bắt đầu xanh.';

  async function fixture(action, fields = {}) {
    const response = await fetch(process.env.DRIVE_MOCK_URL + '/fake/control',{
      method:'POST',headers:{ Authorization:'Bearer ' + process.env.APP_DRIVE_FAKE_CLIENT_SECRET,'Content-Type':'application/json' },
      body:JSON.stringify({ sub:subject,action,...fields })
    });
    expect(response.status).toBe(200);
    return response.json();
  }

  async function signIn(role, suffix) {
    const username = 'assign_' + suffix + '_' + slug;
    const password = key();
    const account = await provisionIdentity(kc,db,{ name:suffix, username, role, password });
    accounts.push(account);
    const context = await browser.newContext({ baseURL:origin });
    contexts.push(context);
    const page = await context.newPage();
    await enter(page,username,password);
    await setPassword(page,key());
    await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(200);
    return { page,id:account.id };
  }

  async function setSource(page, group, content) {
    const field = page.getByRole('group',{ name:group,exact:true });
    await field.getByRole('button',{ name:'Mã Markdown',exact:true }).click();
    await field.getByRole('textbox',{ name:'Mã Markdown',exact:true }).fill(content);
    await field.getByRole('button',{ name:'Trực quan',exact:true }).click();
  }

  async function removeTrigger() {
    if (!triggerCreated) return;
    await db.query(`DROP TRIGGER ${trigger} ON garden.assignments; DROP FUNCTION garden.${trigger}()`);
    triggerCreated = false;
  }

  try {
    const teacher = await signIn('teacher','teacher');
    const operator = await signIn('admin','admin');
    const student = await signIn('student','student');
    const pending = await signIn('student','pending');
    const rubricLabel = 'Lập luận xã hội ' + slug;
    expect((await api(operator,'/api/rubrics',{ action:'create',id:rubric,label:rubricLabel,definition:form })).status()).toBe(201);
    const classroom = await api(teacher,'/api/classes',{ action:'save_class',name:'10A ' + slug,year:'2026–2027' });
    expect(classroom.status()).toBe(201);
    const { classId: newClass, joinCode } = await classroom.json();
    classId = newClass;
    for (const actor of [student,pending]) {
      expect((await (await api(actor,'/api/classes',{ action:'join',code:joinCode })).json()).state).toBe('pending');
    }
    const requests = (await (await teacher.page.request.get('/api/classes')).json()).requests;
    expect((await api(teacher,'/api/classes',{ action:'approve',requestId:requests.find(item => item.display_name === 'student').id })).status()).toBe(200);
    const create = { id:randomUUID(),classId,rubricId:rubric,rubricRevision:1 };
    expect((await api(teacher,'/api/assignments',create)).status()).toBe(409);
    expect((await api(student,'/api/assignments',create)).status()).toBe(403);
    await teacher.page.goto('/drive');
    await teacher.page.getByRole('button',{ name:'Cấp quyền Drive' }).click();
    await teacher.page.getByLabel('Danh tính Drive thử').fill(subject);
    await teacher.page.getByRole('button',{ name:'Cho phép' }).click();
    await teacher.page.getByRole('button',{ name:'Chọn thư mục cha' }).click();
    await teacher.page.getByRole('button',{ name:'Dùng thư mục này' }).click();
    await expect(teacher.page.getByRole('status')).toContainText('Đã xác minh');

    await teacher.page.goto('/assignments');
    await teacher.page.getByRole('combobox',{ name:'Lớp',exact:true }).selectOption(classId);
    await teacher.page.getByRole('combobox',{ name:'Rubric',exact:true }).selectOption(`${rubric}:1`);
    await teacher.page.getByRole('button',{ name:'Tạo bài nháp' }).click();
    await expect(teacher.page.getByRole('heading',{ name:'Giao bài mới' })).toBeVisible();
    assignment = new URL(teacher.page.url()).pathname.split('/').at(-1);
    const path = '/api/assignments/' + assignment;
    expect((await student.page.request.get(path)).status()).toBe(404);
    await expect(teacher.page.getByLabel('Thang điểm của bài')).toHaveValue('2.00');
    const autosave = teacher.page.waitForResponse(response => response.url() === origin + path &&
      response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save', { timeout: 12_000 })
      .catch(async () => { throw Error('Autosave not sent. UI status: ' + (await teacher.page.getByRole('status').allTextContents()).filter(Boolean).join(' | ')); });
    await teacher.page.getByLabel('Tên bài').fill(title);
    await teacher.page.getByLabel('Thang điểm của bài').fill('4');
    await setSource(teacher.page,'Đề bài',prompt);
    await teacher.page.locator('summary').filter({ hasText:/^Ngữ liệu$/ }).click();
    await setSource(teacher.page,'Ngữ liệu',material);
    const saved = await autosave;
    expect(await saved.json()).toMatchObject({ state:'committed' });
    await expect(teacher.page.getByText('Đã lưu nháp trên Drive.',{exact:true})).toBeVisible({ timeout:15_000 });
    const draft = (await (await teacher.page.request.get(path)).json());
    expect(draft).toMatchObject({ state:'draft',draft:{ title,prompt,material,reference:'',scale:'4.00',rubricId:rubric,rubricRevision:1 } });
    expect(typeof draft.hash).toBe('string');
    expect((await (await student.page.request.get('/api/assignments')).json()).assignments).toEqual([]);
    expect((await student.page.request.get(path)).status()).toBe(404);
    expect((await operator.page.request.get(path)).status()).toBe(404);
    const before = await db.query(`SELECT a.state,ds.version,ds.head_object_id,o.drive_file_id FROM garden.assignments a
      JOIN garden.document_streams ds ON ds.id=a.draft_stream_id JOIN garden.drive_objects o ON o.id=ds.head_object_id WHERE a.id=$1`,[assignment]);
    expect(before.rows[0]).toMatchObject({ state:'draft',version:draft.draftVersion });
    expect((await fixture('inspect')).files.some(file => file.id === before.rows[0].drive_file_id)).toBe(true);

    await teacher.page.reload();
    await expect(teacher.page.getByLabel('Tên bài')).toHaveValue(title);
    await teacher.page.getByRole('button',{ name:'Tiếp tục sửa tại đây' }).click();
    await expect(teacher.page.getByRole('button',{ name:'Giao bài',exact:true })).toBeEnabled();
    const requestBody = teacher.page.waitForRequest(request => request.method() === 'POST' && request.url() === origin + path &&
      request.postDataJSON()?.action === 'publish').then(request => request.postDataJSON());
    await fixture('fault',{ operation:'upload', status:504,reason:'backendError',afterCommit:true });
    await teacher.page.getByRole('button',{ name:'Giao bài',exact:true }).click();
    const action = await requestBody;
    await expect(teacher.page.getByText('Chưa xác nhận giao bài.',{exact:true})).toBeVisible();
    const listing = async () => (await (await student.page.request.get('/api/assignments')).json()).assignments;
    expect(await listing()).toEqual([]);
    expect((await student.page.request.get(path)).status()).toBe(404);
    const pins = async () => (await db.query(`SELECT o.id,o.slot,o.drive_file_id,o.integrity,op.state FROM garden.drive_objects o
      JOIN garden.operations op ON op.id=o.operation_id WHERE op.kind='assign' AND op.target_id=$1 ORDER BY o.slot`,[assignment])).rows;
    const first = await pins();
    expect(first.map(file => file.slot)).toEqual(['prompt','rubric']);
    expect(first.every(file => file.state === 'unknown')).toBe(true);
    const invisible = async () => (await db.query(`SELECT a.state,a.prompt_object_id,
      (SELECT count(*) FROM garden.recipients WHERE assignment_id=a.id) AS grants,
      (SELECT count(*) FROM garden.notifications WHERE target_id=a.id) AS notices
      FROM garden.assignments a WHERE a.id=$1`,[assignment])).rows[0];
    expect(await invisible()).toEqual({ state:'draft',prompt_object_id:null,grants:'0',notices:'0' });

    await db.query(`CREATE FUNCTION garden.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id='${assignment}'::uuid AND NEW.state='published' THEN RAISE EXCEPTION 'Fixture final commit failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER ${trigger} BEFORE UPDATE ON garden.assignments FOR EACH ROW EXECUTE FUNCTION garden.${trigger}()`);
    triggerCreated = true;
    const failing = teacher.page.waitForResponse(response => response.url() === origin + path && response.request().postDataJSON()?.action === 'publish');
    await teacher.page.getByRole('button',{ name:'Thử giao lại' }).click();
    expect((await failing).status()).toBe(202);
    const failedFinalization = await pins();
    expect(failedFinalization.map(file => file.id)).toEqual(first.map(file => file.id));
    expect(failedFinalization.every(file => file.integrity === 'ok' && file.state === 'unknown')).toBe(true);
    expect(await invisible()).toEqual({ state:'draft',prompt_object_id:null,grants:'0',notices:'0' });
    expect(await listing()).toEqual([]);
    await removeTrigger();

    await teacher.page.getByRole('button',{ name:'Thử giao lại' }).click();
    await expect(teacher.page.getByRole('heading',{ name:title,exact:true })).toBeVisible();
    expect((await api(teacher,path,action)).status()).toBe(200);
    expect((await api(teacher,path,{ ...action,action:'save',key:randomUUID(),draft:draft.draft })).status()).toBe(409);
    expect((await student.page.request.get(path)).status()).toBe(200);
    expect((await pending.page.request.get(path)).status()).toBe(404);
    expect((await listing()).map(entry => entry.title)).toEqual([title]);
    const published = await (await student.page.request.get(path)).json();
    expect(published).toMatchObject({ state:'published',accepting:true,reference:null,prompt:{ title,prompt,material },
      rubric:{ id:rubric,revision:1,max:'2.00',scale:'4.00',rounding:'round-half-up-2' } });
    expect(await invisible()).toMatchObject({ state:'published',grants:'1',notices:'1' });
    expect((await pins()).map(file => file.drive_file_id)).toEqual(first.map(file => file.drive_file_id));
    await student.page.goto('/assignments');
    await student.page.getByRole('link',{ name:title }).click();
    await expect(student.page.getByRole('heading',{ name:title,exact:true })).toBeVisible();
    await expect(student.page.locator('.markdown-document strong')).toHaveText('mùa xuân');
    await expect(student.page.locator('.markdown-document blockquote')).toHaveText('Những mầm non bắt đầu xanh.');
    await expect(student.page.getByRole('heading',{ name:'Tham chiếu',exact:true })).toHaveCount(0);

    const revised = structuredClone(form);
    revised.criteria[0].levels[0].description = 'Mô tả mới cho bài sau.';
    expect((await api(operator,'/api/rubrics',{ action:'revise',id:rubric,label:'Rubric mới ' + slug,definition:revised,expectedRevision:1 })).status()).toBe(200);
    expect((await api(operator,'/api/rubrics',{ action:'retire',id:rubric,expectedRevision:2 })).status()).toBe(200);
    const again = await (await student.page.request.get(path)).json();
    expect(again.rubric).toEqual(published.rubric);
    expect(again.rubricHash).toBe(published.rubricHash);
    expect((await api(teacher,'/api/assignments',{ ...create,id:randomUUID() })).status()).toBe(409);
    const metadata = await db.query('SELECT to_jsonb(a)::text AS row FROM garden.assignments a WHERE id=$1',[assignment]);
    expect(metadata.rows[0].row).not.toContain(title);
    expect(metadata.rows[0].row).not.toContain(prompt);
  } finally {
    try {
      await removeTrigger();
      for (const context of contexts) await context.close();
      const ids = accounts.map(account => account.id);
      await db.query('DELETE FROM garden.audit_events WHERE actor_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.notifications WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.recipients WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.assignments WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.document_streams WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_objects WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.operations WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.rubric_templates WHERE id=$1',[rubric]);
      await db.query('DELETE FROM garden.enrollment_requests WHERE class_id=$1',[classId ?? null]);
      await db.query('DELETE FROM garden.memberships WHERE class_id=$1',[classId ?? null]);
      await db.query('DELETE FROM garden.classes WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_folders WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_setups WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_oauth_attempts WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_connections WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.students WHERE id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.teachers WHERE id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.users WHERE id=ANY($1)',[ids]);
      for (const account of accounts) await kc('/users/' + account.subject,'DELETE');
      await fixture('reset');
    } finally { await db.end(); }
  }
});
