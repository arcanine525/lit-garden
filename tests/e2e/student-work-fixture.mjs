import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';

export const post = (page,path,data) => page.request.post(path,{ data,headers:{ Origin:origin } });
export async function responseBody(response,status = 200) {
  const body = await response.json();
  expect(response.status(),String(body.error ?? body.state ?? '')).toBe(status);
  return body;
}

async function clearFixturePublications(db,teachers) {
  if (!(await db.query('SELECT 1 FROM garden.review_publications WHERE teacher_id=ANY($1) LIMIT 1',[teachers])).rowCount) return;
  const connection = await db.connect();
  try {
    await connection.query('BEGIN');
    // Temporarily bypass append-only guards in one local fixture cleanup transaction.
    await connection.query(`ALTER TABLE garden.review_publications DISABLE TRIGGER publication_immutable;
      ALTER TABLE garden.publication_comments DISABLE TRIGGER publication_comment_immutable;
      ALTER TABLE garden.conversation_messages DISABLE TRIGGER message_immutable`);
    await connection.query('UPDATE garden.submissions SET current_publication_id=NULL WHERE teacher_id=ANY($1)',[teachers]);
    await connection.query('DELETE FROM garden.review_drafts WHERE teacher_id=ANY($1)',[teachers]);
    await connection.query(`DELETE FROM garden.publication_comments c USING garden.review_publications p
      WHERE c.publication_id=p.id AND p.teacher_id=ANY($1)`,[teachers]);
    await connection.query('DELETE FROM garden.review_publications WHERE teacher_id=ANY($1)',[teachers]);
    await connection.query('DELETE FROM garden.conversation_messages WHERE teacher_id=ANY($1)',[teachers]);
    await connection.query(`DELETE FROM garden.review_comments c USING garden.submissions s
      WHERE c.submission_id=s.id AND s.teacher_id=ANY($1)`,[teachers]);
    await connection.query(`ALTER TABLE garden.review_publications ENABLE TRIGGER publication_immutable;
      ALTER TABLE garden.publication_comments ENABLE TRIGGER publication_comment_immutable;
      ALTER TABLE garden.conversation_messages ENABLE TRIGGER message_immutable`);
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
}

export async function withStudentWork(browser, run, options = {}) {
  const db = migrationPool();
  const kc = await keycloakAdmin();
  const tag = randomBytes(6).toString('hex');
  const subject = 'writing_' + tag;
  const rubric = randomUUID();
  const accounts = [], contexts = [];
  const subjects = new Set();

  async function pageFor(username,password) {
    const context = await browser.newContext({ baseURL:origin });
    contexts.push(context);
    const page = await context.newPage();
    await enter(page,username,password);
    return page;
  }

  async function provision(role,name) {
    const username = name + '_' + tag, temporary = key(), password = key();
    const account = await provisionIdentity(kc,db,{ username,password:temporary,role,name });
    accounts.push(account);
    const page = await pageFor(username,temporary);
    await setPassword(page,password);
    await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(200);
    return { ...account,username,page,newSession:async () => {
      const other = await pageFor(username,password);
      await expect.poll(async () => (await other.request.get('/api/me')).status()).toBe(200);
      return other;
    } };
  }

  async function fake(action, fields = {}) {
    const response = await fetch(process.env.DRIVE_MOCK_URL + '/fake/control',{
      method:'POST',headers:{ Authorization:'Bearer ' + process.env.APP_DRIVE_FAKE_CLIENT_SECRET,'Content-Type':'application/json' },
      body:JSON.stringify({ action,sub:subject,...fields })
    });
    expect(response.status).toBe(200);
    return response.json();
  }

  async function connectDrive(account, driveSubject = subject) {
    subjects.add(driveSubject);
    const { page } = account;
    await page.goto('/drive');
    await page.getByRole('button',{ name:'Cấp quyền Drive' }).click();
    await page.getByLabel('Danh tính Drive thử').fill(driveSubject);
    await page.getByRole('button',{ name:'Cho phép' }).click();
    await page.getByRole('button',{ name:'Chọn thư mục cha' }).click();
    await page.getByRole('button',{ name:'Dùng thư mục này' }).click();
    await expect(page.getByRole('status')).toContainText('Đã xác minh');
  }

  try {
    const teacher = await provision('teacher','teacher');
    const admin = await provision('admin','admin');
    const student = await provision('student','writer');
    const classroom = await responseBody(await post(teacher.page,'/api/classes',{
      action:'save_class',name:'Lớp tập viết ' + tag,year:'2026–2027' }),201);
    const { classId } = classroom;
    await responseBody(await post(student.page,'/api/classes',{ action:'join',code:classroom.joinCode }));
    const { requests } = await responseBody(await teacher.page.request.get('/api/classes'));
    await responseBody(await post(teacher.page,'/api/classes',{ action:'approve',requestId:requests[0].id }));
    const definition = options.rubric ?? { criteria:[{ id:'idea',label:'Ý tưởng',levels:[
      { id:'done',score:'2',description:'Có ý rõ.' },{ id:'start',score:'0',description:'Chưa phát triển.' }
    ] }] };
    await responseBody(await post(admin.page,'/api/rubrics',{ action:'create',id:rubric,label:'Rubric tập viết ' + tag,definition }),201);
    await connectDrive(teacher);

    async function publish(title,dueAt = null,reference = '',room = classroom,owner = teacher) {
      const id = randomUUID(), clientId = randomUUID();
      const api = `/api/assignments/${id}`;
      await responseBody(await post(owner.page,'/api/assignments',{ id,classId:room.classId,rubricId:rubric,rubricRevision:1 }),201);
      const { epoch } = await responseBody(await post(owner.page,api,{ action:'acquire',clientId }));
      const draft = { title,prompt:'Hãy viết một đoạn văn.',material:'',reference,rubricId:rubric,rubricRevision:1,scale:'2',dueAt };
      const { hash,draftVersion } = await responseBody(await post(owner.page,api,{ action:'save',key:randomUUID(),clientId,epoch,baseVersion:'0',draft }));
      await responseBody(await post(owner.page,api,{ action:'publish',key:randomUUID(),clientId,epoch,baseVersion:draftVersion,hash }));
      return { id,api,draftApi:api + '/draft',url:`/assignments/${id}/write` };
    }

    await run({ student,teacher,admin,db,tag,fake,publish,classroom,provision,connectDrive });
  } finally {
    try {
      for (const context of contexts) await context.close();
      const ids = accounts.map(account => account.id);
      await clearFixturePublications(db,ids);
      await db.query(`DELETE FROM garden.library_delete_files f USING garden.operations op
        WHERE f.operation_id=op.id AND op.teacher_id=ANY($1)`,[ids]);
      for (const table of ['library_featured','library_favorites','library_shares','library_assets']) {
        await db.query(`DELETE FROM garden.${table} resource USING garden.library_items item
          WHERE resource.item_id=item.id AND item.teacher_id=ANY($1)`,[ids]);
      }
      await db.query('DELETE FROM garden.library_items WHERE teacher_id=ANY($1)',[ids]);
      for (const [table,column] of [
        ['audit_events','actor_id'],['notifications','teacher_id'],['review_drafts','teacher_id'],['submissions','teacher_id'],
        ['student_drafts','teacher_id'],['recipients','teacher_id'],['assignment_deadlines','changed_by'],['assignments','teacher_id'],
        ['document_streams','teacher_id'],['drive_objects','teacher_id'],['operations','teacher_id']
      ]) await db.query(`DELETE FROM garden.${table} WHERE ${column}=ANY($1)`,[ids]);
      await db.query('DELETE FROM garden.rubric_templates WHERE id=$1',[rubric]);
      for (const table of ['enrollment_requests','memberships']) {
        await db.query(`DELETE FROM garden.${table} resource USING garden.classes class
          WHERE resource.class_id=class.id AND class.teacher_id=ANY($1)`,[ids]);
      }
      for (const table of ['classes','drive_folders','drive_setups','drive_oauth_attempts','drive_connections']) {
        await db.query(`DELETE FROM garden.${table} WHERE teacher_id=ANY($1)`,[ids]);
      }
      await db.query('DELETE FROM garden.identity_operations WHERE actor_id=ANY($1) AND target_user_id=ANY($1)',[ids]);
      for (const table of ['students','teachers','users']) await db.query(`DELETE FROM garden.${table} WHERE id=ANY($1)`,[ids]);
      for (const account of accounts) await kc('/users/' + account.subject,'DELETE');
      for (const sub of subjects) await fake('reset',{ sub });
    } finally { await db.end(); }
  }
}

export async function writeSource(page, markdown) {
  const editor = page.locator('.garden-editor');
  await editor.getByRole('button',{ name:'Mã Markdown',exact:true }).click();
  await editor.getByRole('textbox',{ name:'Mã Markdown' }).fill(markdown);
  await editor.getByRole('button',{ name:'Trực quan',exact:true }).click();
}

export const lastCell = page => page.locator('.garden-editor-text tbody tr').last().locator('td:not([data-tool-cell]) [contenteditable="true"]').last();
