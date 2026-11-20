import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';

test.use({ actionTimeout: 10_000, navigationTimeout: 15_000 });
const call = (page, path, data) => page.request.post(path,{ data,headers:{ Origin:origin } });
const accepted = async (response, code = 200) => {
  const value = await response.json();
  expect(response.status(),String(value.error ?? value.state ?? '')).toBe(code);
  return value;
};

test('T18 soft deadlines, closed writes, recipient accrual and permanent reference publication', async ({ browser }) => {
  test.setTimeout(90_000);
  const db = migrationPool();
  const kc = await keycloakAdmin();
  const tag = randomBytes(6).toString('hex');
  const subject = 'deadline_' + tag;
  const rubric = randomUUID();
  const accounts = [], contexts = [];
  const deadline = '2025-10-01T00:00:00.000Z';
  const extended = '2025-10-02T00:00:00.000Z';
  const past = ['2025-09-30T23:59:59.000Z',deadline,'2025-10-01T00:00:01.000Z'];
  let classId;

  async function login(role, label) {
    const username = 'due_' + label + '_' + tag;
    const password = key();
    const account = await provisionIdentity(kc,db,{ username,password,name:label,role });
    accounts.push(account);
    const context = await browser.newContext({ baseURL:origin });
    contexts.push(context);
    const page = await context.newPage();
    await enter(page,username,password);
    await setPassword(page,key());
    await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(200);
    return { ...account,page };
  }

  const detail = (user,id) => user.page.request.get('/api/assignments/' + id).then(response => accepted(response));

  async function makeAssignment(owner,title,dueAt,reference = '') {
    const id = randomUUID();
    const path = '/api/assignments/' + id;
    const clientId = randomUUID();
    await accepted(await call(owner.page,'/api/assignments',{ id,classId,rubricId:rubric,rubricRevision:1 }),201);
    const { epoch } = await accepted(await call(owner.page,path,{ action:'acquire',clientId }));
    const draft = { title,prompt:'Hãy viết một đoạn văn.',material:'',reference,rubricId:rubric,rubricRevision:1,scale:'2',dueAt };
    const { hash,draftVersion } = await accepted(await call(owner.page,path,{ action:'save',key:randomUUID(),clientId,epoch,baseVersion:'0',draft }));
    await accepted(await call(owner.page,path,{ action:'publish',key:randomUUID(),clientId,epoch,baseVersion:draftVersion,hash }));
    return { id,path };
  }

  async function putSubmissions(owner,recipient,times) {
    const result = [];
    for (const [index,time] of times.entries()) {
      const id = randomUUID(), op = randomUUID(), file = randomUUID();
      await db.query(`INSERT INTO garden.operations(id,actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version,state)
        VALUES($1,$2,$3,'submit','recipient',$4,$1,repeat('a',64),0,'committed')`,[op,recipient.student_id,owner.id,recipient.id]);
      const saved = await db.query(`INSERT INTO garden.drive_objects(teacher_id,operation_id,slot,drive_file_id,parent_drive_id,mime_type,
        expected_sha256,byte_size,integrity,lifecycle) VALUES($1,$2,'document',$3,'fixture-parent','text/markdown',repeat('a',64),1,'ok','referenced') RETURNING id`,
        [owner.id,op,file]);
      await db.query(`INSERT INTO garden.submissions(id,recipient_id,teacher_id,submission_no,operation_id,object_id,submitted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,recipient.id,owner.id,index+1,op,saved.rows[0].id,time]);
      result.push(id);
    }
    return result;
  }

  try {
    const teacher = await login('teacher','teacher');
    const admin = await login('admin','admin');
    const writer = await login('student','writer');
    const newcomer = await login('student','newcomer');
    const classroom = await accepted(await call(teacher.page,'/api/classes',{ action:'save_class',name:'Lớp hạn ' + tag,year:'2025–2026' }),201);
    classId = classroom.classId;
    const requestJoin = student => call(student.page,'/api/classes',{ action:'join',code:classroom.joinCode }).then(response => accepted(response));
    const approve = async student => {
      const { requests } = await (await teacher.page.request.get('/api/classes')).json();
      const request = requests.find(row => row.display_name === student);
      return accepted(await call(teacher.page,'/api/classes',{ action:'approve',requestId:request.id }));
    };
    await requestJoin(writer);
    await approve('writer');
    const definition = { criteria:[{ id:'idea',label:'Ý tưởng',levels:[
      { id:'done',score:'2',description:'Có ý rõ.' },{ id:'start',score:'0',description:'Chưa phát triển.' }
    ] }] };
    await accepted(await call(admin.page,'/api/rubrics',{ action:'create',id:rubric,label:'Rubric hạn nộp ' + tag,definition }),201);
    await teacher.page.goto('/drive');
    await teacher.page.getByRole('button',{ name:'Cấp quyền Drive' }).click();
    await teacher.page.getByLabel('Danh tính Drive thử').fill(subject);
    await teacher.page.getByRole('button',{ name:'Cho phép' }).click();
    await teacher.page.getByRole('button',{ name:'Chọn thư mục cha' }).click();
    await teacher.page.getByRole('button',{ name:'Dùng thư mục này' }).click();
    await expect(teacher.page.getByRole('status')).toContainText('Đã xác minh');

    const timed = await makeAssignment(teacher,'Một hạn mềm ' + tag,deadline,'Một đoạn **tham chiếu**.');
    const unlimited = await makeAssignment(teacher,'Bài không hạn ' + tag,null);
    const findRecipient = async (assignment,user) => (await db.query(
      'SELECT id,student_id FROM garden.recipients WHERE assignment_id=$1 AND student_id=$2',[assignment,user.id])).rows[0];
    const timedRecipient = await findRecipient(timed.id,writer);
    const unlimitedRecipient = await findRecipient(unlimited.id,writer);
    await putSubmissions(teacher,timedRecipient,past);
    await putSubmissions(teacher,unlimitedRecipient,[past[2]]);
    expect((await detail(writer,timed.id)).timings.map(item => [item.submittedAt,item.late])).toEqual(past.map((at,index) => [at,index === 2]));
    expect((await detail(writer,unlimited.id)).timings.map(item => item.late)).toEqual([false]);
    const noDeadline = await detail(teacher,unlimited.id);
    const adding = await call(teacher.page,unlimited.path,{ action:'extend_deadline',dueAt:extended,key:randomUUID(),expectedVersion:noDeadline.version });
    expect(adding.status()).toBe(409);
    const shut = await accepted(await call(teacher.page,unlimited.path,{ action:'close',expectedVersion:noDeadline.version }));
    const empty = await call(teacher.page,unlimited.path,{ action:'publish_reference',expectedVersion:shut.version });
    expect(empty.status()).toBe(422);

    await requestJoin(newcomer);
    await approve('newcomer');
    const received = await findRecipient(timed.id,newcomer);
    expect(received.id).toBeTruthy();
    expect(await findRecipient(unlimited.id,newcomer)).toBeUndefined();
    expect((await newcomer.page.request.get(unlimited.path)).status()).toBe(404);
    const eligibility = await db.query(`SELECT garden.can_write_recipient($1,$2) AS can_write,
      (SELECT due_at < now() FROM garden.assignments WHERE id=$3) AS through_deadline`,[newcomer.id,received.id,timed.id]);
    expect(eligibility.rows[0]).toEqual({ can_write:true,through_deadline:true });
    expect((await db.query("SELECT 1 FROM garden.notifications WHERE user_id=$1 AND target_id=$2 AND event_kind='assigned'",
      [newcomer.id,timed.id])).rowCount).toBe(1);

    const data = await detail(teacher,timed.id);
    expect(data.reference).toContain('tham chiếu');
    expect((await detail(writer,timed.id)).reference).toBeNull();
    expect((await call(teacher.page,timed.path,{ action:'publish_reference',expectedVersion:data.version })).status()).toBe(409);
    const earlier = await call(teacher.page,timed.path,{ action:'extend_deadline',key:randomUUID(),expectedVersion:data.version,
      dueAt:'2025-09-01T00:00:00.000Z' });
    expect(earlier.status()).toBe(409);
    await teacher.page.goto('/assignments/' + timed.id);
    await teacher.page.getByLabel('Hạn mới (giờ Việt Nam)').fill('2025-10-02T07:00');
    const clicked = teacher.page.waitForRequest(request => request.url() === origin + timed.path &&
      request.method() === 'POST' && request.postDataJSON()?.action === 'extend_deadline').then(request => request.postDataJSON());
    await teacher.page.getByRole('button',{ name:'Gia hạn',exact:true }).click();
    const intent = await clicked;
    await expect(teacher.page.getByText('Đã gia hạn.',{ exact:true })).toBeVisible();
    expect(intent.dueAt).toBe(extended);
    await accepted(await call(teacher.page,timed.path,intent));
    const updated = await detail(writer,timed.id);
    expect(updated.dueAt).toBe(extended);
    expect(updated.timings.map(item => [item.submittedAt,item.late])).toEqual(past.map(at => [at,false]));
    expect((await db.query('SELECT old_due_at,new_due_at FROM garden.assignment_deadlines WHERE assignment_id=$1',[timed.id])).rows)
      .toEqual([{ old_due_at:new Date(deadline),new_due_at:new Date(extended) }]);
    expect((await db.query("SELECT 1 FROM garden.notifications WHERE target_id=$1 AND event_kind='deadline_extended'",[timed.id])).rowCount).toBe(2);

    const stream = randomUUID(), client = randomUUID(), draftOp = randomUUID(), submitOp = randomUUID();
    await db.query(`INSERT INTO garden.document_streams(id,teacher_id,kind,lease_actor_id,lease_session_id,lease_epoch,lease_until)
      VALUES($1,$2,'student',$3,$4,8,now()+interval '1 minute')`,[stream,teacher.id,writer.id,client]);
    await db.query('INSERT INTO garden.student_drafts(recipient_id,teacher_id,stream_id) VALUES($1,$2,$3)',[timedRecipient.id,teacher.id,stream]);
    await db.query(`INSERT INTO garden.operations(id,actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version)
      VALUES($1,$3,$4,'autosave','stream',$5,$1,repeat('a',64),0),($2,$3,$4,'submit','recipient',$6,$2,repeat('b',64),0)`,
      [draftOp,submitOp,writer.id,teacher.id,stream,timedRecipient.id]);

    await teacher.page.getByRole('button',{ name:'Đóng bài',exact:true }).click();
    await teacher.page.getByRole('dialog').getByRole('button',{ name:'Xác nhận đóng bài',exact:true }).click();
    await expect(teacher.page.getByText('Đã đóng bài.',{ exact:true })).toBeVisible();
    const locked = await detail(teacher,timed.id);
    expect(locked.accepting).toBe(false);
    expect((await detail(writer,timed.id)).state).toBe('published');
    const policy = await db.query('SELECT garden.can_read_draft($1,$2) AS read_draft,garden.can_write_recipient($1,$3) AS write_draft',
      [writer.id,stream,timedRecipient.id]);
    expect(policy.rows[0]).toEqual({ read_draft:true,write_draft:false });
    expect((await db.query('SELECT lease_epoch,lease_session_id FROM garden.document_streams WHERE id=$1',[stream])).rows[0])
      .toEqual({ lease_epoch:'9',lease_session_id:null });
    expect((await db.query('SELECT state,error_code FROM garden.operations WHERE id IN ($1,$2)',[draftOp,submitOp])).rows)
      .toEqual([{ state:'rejected',error_code:'POLICY' },{ state:'rejected',error_code:'POLICY' }]);
    const reopened = await accepted(await call(teacher.page,timed.path,{ action:'reopen',expectedVersion:locked.version }));
    const reclosed = await accepted(await call(teacher.page,timed.path,{ action:'close',expectedVersion:reopened.version }));
    await accepted(await call(teacher.page,timed.path,{ action:'publish_reference',expectedVersion:reclosed.version }));
    const publicView = await detail(writer,timed.id);
    expect(publicView.reference).toContain('tham chiếu');
    const bump = async () => call(teacher.page,timed.path,{ action:'reopen',expectedVersion:publicView.version });
    expect((await bump()).status()).toBe(409);
    await accepted(await call(teacher.page,'/api/classes',{ action:'archive_class',classId }));
    expect((await bump()).status()).toBe(409);
    await accepted(await call(teacher.page,'/api/classes',{ action:'restore_class',classId }));
    expect((await bump()).status()).toBe(409);
    expect((await detail(writer,timed.id)).referencePublicAt).toBeTruthy();
    await accepted(await call(teacher.page,'/api/classes',{ action:'remove_student',classId,studentId:newcomer.id }));
    expect((await newcomer.page.request.get(timed.path)).status()).toBe(404);
    const clear = await accepted(await call(teacher.page,timed.path,{ action:'extend_deadline',expectedVersion:publicView.version,
      key:randomUUID(),dueAt:null }));
    expect(clear.dueAt).toBeNull();
    expect((await detail(writer,timed.id)).timings.map(item => [item.submittedAt,item.late])).toEqual(past.map(at => [at,false]));
  } finally {
    try {
      for (const context of contexts) await context.close();
      const ids = accounts.map(account => account.id);
      await db.query('DELETE FROM garden.audit_events WHERE actor_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.notifications WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.submissions WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.student_drafts WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.recipients WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.assignment_deadlines WHERE changed_by=ANY($1)',[ids]);
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
      await fetch(process.env.DRIVE_MOCK_URL + '/fake/control',{ method:'POST',
        headers:{ Authorization:'Bearer ' + process.env.APP_DRIVE_FAKE_CLIENT_SECRET,'Content-Type':'application/json' },
        body:JSON.stringify({ action:'reset',sub:subject }) });
    } finally { await db.end(); }
  }
});
