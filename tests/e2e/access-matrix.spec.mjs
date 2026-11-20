import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { parse } from 'csv-parse/sync';
import { expect, test } from '@playwright/test';
import { keycloakAdmin } from '../../infra/keycloak/bootstrap.mjs';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';
import { post, responseBody, withStudentWork, writeSource } from './student-work-fixture.mjs';
import { overlap } from './transaction-fixture.mjs';

const compose = action => promisify(execFile)('docker',['compose','--env-file','.env.local',action,'keycloak']);
const classes = (owner,data) => post(owner.page,'/api/classes',data);
const get = async (actor,path) => responseBody(await actor.page.request.get(path));
const mutate = async (actor,path,data,status = 200) => responseBody(await post(actor.page,path,data),status);
const source = id => `/api/content/submissions/${id}?download=1`;
const publishedFile = (id,publication) => `/api/submissions/${id}/publication/download` + (publication ? `?publication=${publication}` : '');

async function classroom(owner,name) {
  return responseBody(await classes(owner,{ action:'save_class',name,year:'2026–2027' }),201);
}

async function requestSeat(owner,student,room) {
  await mutate(student,'/api/classes',{ action:'join',code:room.joinCode });
  const { requests } = await get(owner,'/api/classes');
  const request = requests.find(item => item.username === student.username && item.class_id === room.classId);
  expect(request).toBeDefined();
  return request.id;
}

async function approve(owner,student,room) {
  await responseBody(await classes(owner,{ action:'approve',requestId:await requestSeat(owner,student,room) }));
}

async function change(owner,assignment,action,version) {
  return mutate(owner,assignment.api,{ action,expectedVersion:version ?? (await get(owner,assignment.api)).version });
}

async function writer(actor,assignment,action = 'acquire') {
  const clientId = randomUUID();
  const lease = await mutate(actor,assignment.draftApi,{ action,clientId });
  return (markdown,kind = 'submit') => ({ action:kind,key:randomUUID(),clientId,epoch:lease.epoch,baseVersion:lease.version,
    draft:{ markdown,explanation:'' } });
}

async function reviewOwner(teacher,id) {
  const route = `/api/submissions/${id}/review`, publication = `/api/submissions/${id}/publication`;
  const clientId = randomUUID(), comment = randomUUID();
  const { epoch } = await mutate(teacher,route,{ action:'acquire',clientId });
  const { submissionSha256 } = await get(teacher,`/api/submissions/${id}/verify`);
  let baseVersion = '0', basePublication = null;
  return {
    route,comment,thread:`/api/submissions/${id}/comments/${comment}/messages`,
    async save(body) {
      const saved = await mutate(teacher,route,{ action:'save',key:randomUUID(),clientId,epoch,baseVersion,
        draft:{ scores:[{ criterionId:'idea',levelId:'done',value:'2.00' }],overallCommentId:comment,comments:[{ id:comment,kind:'overall',body }] }
      });
      baseVersion = saved.version;
      return async () => {
        const released = await mutate(teacher,publication,{ key:randomUUID(),clientId,epoch,baseVersion,basePublication,draftHash:saved.hash,submissionSha256 });
        basePublication = released.id;
        return released;
      };
    }
  };
}

async function libraryItem(owner,title,rooms,{ image = false, publish = true } = {}) {
  const id = randomUUID(), path = `/api/library/${id}`;
  await mutate(owner,'/api/library',{ id },201);
  let reference;
  if (image) {
    const data = Buffer.from(await owner.page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 5; canvas.height = 4;
      canvas.getContext('2d').fillRect(0,0,5,4);
      return canvas.toDataURL('image/png').split(',')[1];
    }),'base64');
    ({ reference } = await responseBody(await owner.page.request.post('/api/assets',{
      headers:{ Origin:origin,'Content-Type':'image/png','X-Garden-Library':id,'Idempotency-Key':randomUUID() },data
    }),201));
  }
  if (publish) {
    const markdown = '# ' + title + (reference ? '\n\n![Ảnh tài liệu](' + reference + ')' : '');
    await responseBody(await owner.page.request.put(path,{ headers:{ Origin:origin },multipart:{
      key:randomUUID(),version:'0',title,format:'markdown',markdown
    } }));
    await mutate(owner,path,{ action:'share',classIds:rooms.map(room => room.classId) });
  }
  return { id,path,reference,download:path+'/download' };
}

async function hiddenPage(actor,path,heading) {
  await actor.page.goto(path);
  await expect(actor.page.getByRole('heading',{ name:heading,exact:true })).toHaveCount(0);
}

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T33 two Drive tenants, Q01-B, archived history and membership boundaries', async ({ browser }) => {
  test.setTimeout(150_000);
  await withStudentWork(browser,async ({ student,teacher:a,admin,db,fake,tag,publish,provision,connectDrive,classroom:roomA }) => {
    const b = await provision('teacher','matrix_b');
    await connectDrive(b,'matrix_b_' + tag);
    const roomB = await classroom(b,'Lớp B');
    const alternate = await classroom(a,'Lớp thứ hai của A');
    await approve(b,student,roomB);
    await approve(a,student,alternate);
    const peer = await provision('student','matrix_peer');
    const core = await publish('Bài đóng có người nhận','2026-12-20T10:00:00.000Z','# Tham chiếu A chỉ sau công khai');
    const sealed = await publish('Bài khóa tham chiếu',null,'# Tham chiếu đã công khai');
    const targetB = await publish('Bài của B',null,'',roomB,b);
    const sendA = await writer(student,core);
    const original = await mutate(student,core.api + '/submissions',sendA('Bản nộp riêng ở lớp A.'));
    await mutate(student,core.draftApi,sendA('Nháp riêng tiếng Việt của em.','save'));
    const sendB = await writer(student,targetB);
    const other = await mutate(student,targetB.api + '/submissions',sendB('Bài riêng của em ở lớp B.'));
    const closed = await change(a,core,'close');
    const sealedState = await change(a,sealed,'close');
    await change(a,sealed,'publish_reference',sealedState.version);
    const request = await requestSeat(a,peer,roomA);
    const visibleAssignments = actor => get(actor,'/api/assignments?scope=current').then(body => body.assignments);
    expect(await visibleAssignments(peer)).toEqual([]);
    expect((await peer.page.request.get(core.api)).status()).toBe(404);
    expect((await peer.page.request.get(core.draftApi)).status()).toBe(404);
    expect((await post(peer.page,core.api + '/submissions',sendA('Không được nộp.'))).status()).toBe(404);
    await hiddenPage(peer,`/assignments/${core.id}`,'Bài đóng có người nhận');
    expect((await get(student,core.api)).reference).toBeNull();
    expect((await get(student,sealed.api)).reference).toContain('Tham chiếu đã công khai');
    expect((await post(a.page,sealed.api,{ action:'reopen',expectedVersion:sealedState.version })).status()).toBe(409);
    const draftUrl = core.draftApi + '?download=1';
    expect(await (await student.page.request.get(draftUrl)).text()).toContain('Nháp riêng');
    expect((await post(student.page,core.draftApi,sendA('Không được sync.','save'))).status()).toBe(409);
    expect((await post(student.page,core.api + '/submissions',sendA('Không được nộp khi đóng.'))).status()).toBe(409);
    await student.page.goto(core.url);
    await expect(student.page.getByText('Bài đang ở chế độ chỉ đọc.')).toBeVisible();
    await expect(student.page.getByRole('button',{ name:'Tải nháp của tôi (.md)' })).toBeEnabled();

    const grading = await reviewOwner(a,original.id);
    const priorRelease = await (await grading.save('Nhận xét cũ của A.'))();
    const next = await grading.save('Nhận xét mới của A.');
    expect((await student.page.request.get(grading.route)).status()).toBe(403);
    expect(await (await student.page.request.get(publishedFile(original.id))).text()).toContain('Nhận xét cũ của A.');
    const current = await next();
    const conversation = await get(student,grading.thread);
    expect(conversation.writable).toBe(true);
    const reply = text => ({ action:'send',key:randomUUID(),publicationId:current.id,commentDigest:conversation.commentDigest,body:text });
    await mutate(student,grading.thread,reply('Cảm ơn cô, em hiểu rồi.'));
    await student.page.goto(`/results/${original.id}`);
    await expect(student.page.getByText('Nhận xét mới của A.',{ exact:true })).toBeVisible();
    await expect(student.page.getByText('Nhận xét cũ của A.',{ exact:true })).toHaveCount(0);
    expect((await student.page.request.get(publishedFile(original.id,priorRelease.id))).status()).toBe(404);
    expect((await a.page.request.get(publishedFile(original.id,priorRelease.id))).status()).toBe(200);
    expect((await get(a,`/api/submissions/${original.id}/publication`)).history.map(item => item.id)).toEqual([current.id,priorRelease.id]);
    expect((await get(student,'/api/notifications')).notifications.filter(item => item.kind === 'returned').map(item => item.available).sort()).toEqual([false,true]);

    const shared = await libraryItem(a,'Tài liệu dùng qua hai lớp',[roomA,alternate],{ image:true });
    const limited = await libraryItem(a,'Tài liệu chỉ chia sẻ lớp A',[roomA],{ image:true });
    const privateObject = await libraryItem(a,'Asset kiểm quyền theo bài nộp',[],{ image:true,publish:false });
    const asset = privateObject.reference.split('/').at(-1);
    await db.query('INSERT INTO garden.submission_assets(submission_id,asset_id,teacher_id) VALUES($1,$2,$3)',[original.id,asset,a.id]);
    const privateImage = `/api/content/submissions/${original.id}/assets/${asset}`;
    expect((await student.page.request.get(privateImage)).headers()['content-type']).toBe('image/png');
    expect((await a.page.request.get(privateImage)).status()).toBe(200);
    await student.page.goto(`/library/${shared.id}`);
    const image = student.page.getByRole('img',{ name:'Ảnh tài liệu' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBe(5);
    const limitLease = await mutate(student,limited.reference + '/lease',{});
    expect((await student.page.request.get(limitLease.url)).status()).toBe(200);
    expect((await peer.page.request.get(limited.download)).status()).toBe(404);
    expect((await post(peer.page,limited.reference + '/lease',{})).status()).toBe(404);

    const track = async actor => (await db.query(`SELECT
      (SELECT count(*)::int FROM garden.recipients WHERE assignment_id=$1 AND student_id=$2) AS recipients,
      (SELECT count(*)::int FROM garden.notifications WHERE target_id=$1 AND user_id=$2 AND event_kind='assigned') AS assigned`,
    [core.id,actor.id])).rows[0];
    const before = await track(student);
    const history = (await get(student,core.api)).timings;
    await a.page.goto(`/assignments/${core.id}`);
    await a.page.getByRole('button',{ name:'Mở lại bài',exact:true }).click();
    const dialog = a.page.getByRole('dialog',{ name:'Mở lại bài này?' });
    await expect(dialog).toContainText('giao bổ sung cho học sinh đang thuộc lớp và chưa nhận bài này');
    await overlap(db,'fixture_matrix_' + tag,'memberships','INSERT OR UPDATE',
      `NEW.class_id='${roomA.classId}'::uuid AND NEW.student_id='${peer.id}'::uuid`,
      () => classes(a,{ action:'approve',requestId:request }),
      async () => {
        const reopened = a.page.waitForResponse(response => response.url() === origin + core.api &&
          response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'reopen',{ timeout:14_000 });
        await dialog.getByRole('button',{ name:'Mở lại và giao bổ sung' }).click();
        return reopened;
      });
    expect(await change(a,core,'reopen',closed.version)).toMatchObject({ accepting:true });
    expect(await track(student)).toEqual(before);
    expect((await get(student,core.api)).timings).toEqual(history);
    expect(await track(peer)).toEqual({ recipients:1,assigned:1 });
    await peer.page.goto('/garden');
    await expect(peer.page.getByRole('region',{ name:'Mầm',exact:true }).getByText('1 bài',{ exact:true })).toBeVisible();
    await expect(peer.page.getByRole('link',{ name:'Bài đóng có người nhận' })).toBeVisible();
    expect((await peer.page.request.get(sealed.api)).status()).toBe(404);
    expect((await peer.page.request.get(limited.download)).status()).toBe(200);
    for (const file of [source(original.id),publishedFile(original.id,current.id),grading.thread,privateImage]) {
      for (const actor of [peer,b,admin]) expect((await actor.page.request.get(file)).status()).toBe(404);
    }
    await hiddenPage(peer,`/results/${original.id}`,'Bài đóng có người nhận');
    await hiddenPage(admin,`/results/${original.id}`,'Bài đóng có người nhận');
    expect((await a.page.request.get(source(other.id))).status()).toBe(404);
    expect((await post(a.page,'/api/classes',{ action:'archive_class',classId:roomB.classId })).status()).toBe(404);
    expect((await post(student.page,'/api/classes',{ action:'remove_student',classId:roomA.classId,studentId:peer.id })).status()).toBe(403);
    expect((await a.page.request.get(core.draftApi)).status()).toBe(403);
    await peer.page.goto(core.url);
    await expect(peer.page.getByRole('button',{ name:'Nộp bài',exact:true })).toBeEnabled();
    await writeSource(peer.page,'Bản đầu tiên sau khi bài mở lại.');
    await peer.page.getByRole('button',{ name:'Nộp bài',exact:true }).click();
    await expect(peer.page.getByText('Đã nộp bài.',{ exact:true })).toBeVisible();
    expect((await get(peer,core.api)).timings).toHaveLength(1);
    expect((await get(peer,'/api/notifications')).notifications.filter(item => item.kind === 'assigned')).toHaveLength(1);

    const unsubmitted = await publish('Bài A chưa nộp');
    const lease = await writer(student,unsubmitted);
    const pending = lease('Bản đang gửi khi lớp được lưu trữ.');
    await fake('fault',{ operation:'upload',afterCommit:true,hold:true });
    const sending = post(student.page,unsubmitted.api + '/submissions',pending).then(response => response,() => null);
    await expect.poll(async () => (await fake('inspect')).holds).toEqual(['upload']);
    await responseBody(await classes(a,{ action:'archive_class',classId:roomA.classId }));
    expect((await visibleAssignments(student)).map(item => item.id)).toEqual([targetB.id]);
    await student.page.goto(core.url);
    await expect(student.page.getByText('Bài đang ở chế độ chỉ đọc.')).toBeVisible();
    expect((await student.page.request.get(draftUrl)).status()).toBe(200);
    expect((await student.page.request.get(source(original.id))).status()).toBe(200);
    expect((await get(student,grading.thread)).writable).toBe(false);
    expect((await post(student.page,grading.thread,reply('Không gửi khi lưu trữ.'))).status()).toBe(409);
    expect((await a.page.request.get(`/api/submissions/${original.id}/verify`)).status()).toBe(409);
    expect((await post(a.page,'/api/assignments',{ id:randomUUID(),classId:roomA.classId,
      rubricId:(await get(a,core.api)).rubric.id,rubricRevision:1 })).status()).toBe(409);
    expect((await post(a.page,sealed.api,{ action:'reopen',expectedVersion:(await get(a,sealed.api)).version })).status()).toBe(409);
    await fake('release',{ operation:'upload' });
    expect((await sending)?.status()).toBe(409);
    expect((await get(student,unsubmitted.api)).timings).toEqual([]);
    await responseBody(await classes(a,{ action:'restore_class',classId:roomA.classId }));
    expect((await get(student,core.api)).accepting).toBe(true);
    expect((await get(student,sealed.api)).accepting).toBe(false);
    expect((await post(student.page,unsubmitted.api + '/submissions',pending)).status()).toBe(409);

    await fake('fault',{ operation:'read',hold:true });
    const reading = student.page.request.get(limited.download).then(response => response,() => null);
    await expect.poll(async () => (await fake('inspect')).holds).toEqual(['read']);
    await responseBody(await classes(a,{ action:'remove_student',classId:roomA.classId,studentId:student.id }));
    await fake('release',{ operation:'read' });
    expect((await reading)?.status()).toBe(404);
    expect((await student.page.request.get(limitLease.url)).status()).toBe(404);
    expect((await student.page.request.get(unsubmitted.api)).status()).toBe(404);
    expect((await student.page.request.get(draftUrl)).status()).toBe(404);
    expect((await student.page.request.get(shared.download)).status()).toBe(200);
    expect((await student.page.request.get(source(original.id))).status()).toBe(200);
    expect((await student.page.request.get(publishedFile(original.id,current.id))).status()).toBe(200);
    expect((await post(student.page,grading.thread,reply('Không gửi sau khi rời lớp.'))).status()).toBe(409);
    await student.page.goto('/library');
    await expect(student.page.getByRole('link',{ name:'Tài liệu dùng qua hai lớp' })).toBeVisible();
    await expect(student.page.getByRole('link',{ name:'Tài liệu chỉ chia sẻ lớp A' })).toHaveCount(0);
    expect((await visibleAssignments(student)).map(item => item.id)).toEqual([targetB.id]);
    const oldAssignment = (await db.query(`SELECT n.id FROM garden.notifications n WHERE user_id=$1 AND target_id=$2
      AND event_kind='assigned'`,[student.id,unsubmitted.id])).rows[0].id;
    await student.page.goto(`/notifications/${oldAssignment}`);
    await expect(student.page.getByRole('heading',{ name:'Nội dung không còn khả dụng' })).toBeVisible();
    await responseBody(await classes(a,{ action:'readmit_student',classId:roomA.classId,studentId:student.id }));
    expect(await track(student)).toEqual(before);
    expect((await get(student,core.api)).timings).toEqual(history);
    expect((await student.page.request.get(limited.download)).status()).toBe(200);
    expect((await post(student.page,core.draftApi,{ action:'takeover',clientId:randomUUID() })).status()).toBe(200);
    expect((await post(student.page,sealed.draftApi,{ action:'acquire',clientId:randomUUID() })).status()).toBe(409);

    for (const [owner,title] of [[a,'Bài đóng có người nhận'],[b,'Bài của B']]) {
      const csv = await owner.page.request.get('/api/reviews/grades');
      expect(csv.status()).toBe(200);
      const rows = parse(await csv.text(),{ bom:true,columns:true });
      expect(new Set(rows.map(row => row['Bài giao']))).toEqual(new Set([title]));
    }
    expect((await admin.page.request.get('/api/reviews/grades')).status()).toBe(403);
    expect((await admin.page.request.get('/api/notifications')).status()).toBe(403);
  });
});

test('T33 Keycloak timeout closes teacher A sessions while teacher B remains independent', async ({ browser }) => {
  test.setTimeout(130_000);
  await withStudentWork(browser,async ({ student,teacher:a,admin,db,fake,tag,publish,provision,connectDrive,classroom:roomA }) => {
    const b = await provision('teacher','suspension_b');
    await connectDrive(b,'suspension_b_' + tag);
    const roomB = await classroom(b,'Lớp B độc lập');
    await approve(b,student,roomB);
    const assignmentA = await publish('Bài của giáo viên A');
    const closedA = await publish('Bài đóng của A');
    const close = await change(a,closedA,'close');
    const assignmentB = await publish('Bài của giáo viên B',null,'',roomB,b);
    const writerA = await writer(student,assignmentA), writerB = await writer(student,assignmentB);
    const v1 = await mutate(student,assignmentA.api + '/submissions',writerA('Bản của A vẫn đọc được.'));
    await mutate(student,assignmentA.draftApi,writerA('Nháp A trước khi giáo viên bị khóa.','save'));
    const grading = await reviewOwner(a,v1.id);
    const release = await (await grading.save('Nhận xét hiện hành của A.'))();
    const aLibrary = await libraryItem(a,'Tài liệu đọc của A',[roomA]);
    const bLibrary = await libraryItem(b,'Tài liệu riêng của B',[roomB],{ image:true });
    await mutate(b,bLibrary.path,{ action:'feature',classId:roomB.classId,slot:1 });
    const list = () => get(student,'/api/assignments?scope=current').then(result => result.assignments);
    const resultUrl = `/results/${v1.id}`;
    const assignmentNotice = (await db.query(`SELECT id FROM garden.notifications WHERE target_id=$1 AND user_id=$2
      AND event_kind='assigned'`,[assignmentA.id,student.id])).rows[0].id;

    await admin.page.goto('/admin/accounts');
    const aAccount = admin.page.getByRole('listitem').filter({ hasText:a.username });
    await expect(aAccount).toContainText('Drive Đã kết nối');
    const account = (await get(admin,'/api/admin/accounts')).accounts.find(account => account.id === a.id);
    expect(account).toMatchObject({ role:'teacher',drive_state:'ready',status:'active' });
    expect(Object.keys(account).sort()).toEqual([
      'display_name','drive_checked_at','drive_state','id','pending_identity_operation_id','role','status','username'
    ]);
    expect((await get(admin,'/api/rubrics')).rubrics.length).toBeGreaterThan(0);
    expect((await a.page.request.get('/api/admin/accounts')).status()).toBe(403);
    expect((await post(a.page,'/api/admin/accounts',{ kind:'reset_student',userId:student.id,key:randomUUID(),identityVerified:true })).status()).toBe(403);
    expect((await admin.page.request.get(aLibrary.download)).status()).toBe(404);
    expect((await admin.page.request.get(assignmentA.api)).status()).toBe(404);
    expect((await admin.page.request.get('/api/library')).status()).toBe(403);
    await hiddenPage(admin,resultUrl,'Bài của giáo viên A');
    await admin.page.goto('/admin/accounts');

    let paused = false;
    try {
      await compose('pause');
      paused = true;
      const operation = admin.page.waitForResponse(response => response.url() === origin + '/api/admin/accounts' &&
        response.request().method() === 'POST' && response.request().postDataJSON()?.kind === 'suspend_teacher',{ timeout:20_000 });
      await aAccount.getByRole('button',{ name:'Khóa tài khoản' }).click();
      await expect.poll(() => a.page.request.get('/api/me').then(response => response.status())).toBe(401);
      for (const path of [source(v1.id),publishedFile(v1.id,release.id),grading.thread,assignmentA.api,aLibrary.path,'/api/reviews/grades']) {
        expect((await a.page.request.get(path)).status()).toBe(401);
      }
      expect((await post(a.page,closedA.api,{ action:'reopen',expectedVersion:close.version })).status()).toBe(401);
      expect((await operation).status()).toBe(202);
      await expect(aAccount).toContainText('Đã khóa');
      await expect(admin.page.getByText('Đã ghi thay đổi quyền trong ứng dụng. Chờ đồng bộ Keycloak.')).toBeVisible();
      expect((await b.page.request.get('/api/me')).status()).toBe(200);
      expect((await student.page.request.get(source(v1.id))).status()).toBe(200);
    } finally { if (paused) await compose('unpause'); }

    const kc = await keycloakAdmin();
    expect((await kc('/users/' + a.subject)).enabled).toBe(true);
    await aAccount.getByRole('button',{ name:'Thử đồng bộ Keycloak' }).click();
    await expect(aAccount.getByRole('button',{ name:'Mở khóa' })).toBeVisible();
    expect((await kc('/users/' + a.subject)).enabled).toBe(false);
    expect(await kc('/users/' + a.subject + '/sessions')).toEqual([]);
    expect((await get(student,assignmentA.api)).accepting).toBe(true);
    expect((await student.page.request.get(assignmentA.draftApi + '?download=1')).status()).toBe(200);
    expect((await post(student.page,assignmentA.draftApi,writerA('Chặn ghi khi A bị khóa.','save'))).status()).toBe(409);
    expect((await post(student.page,assignmentA.api + '/submissions',writerA('Chặn nộp khi A bị khóa.'))).status()).toBe(409);
    expect((await get(student,grading.thread)).writable).toBe(false);
    const thread = await get(student,grading.thread);
    expect(await mutate(student,grading.thread,{ action:'send',key:randomUUID(),publicationId:thread.publicationId,
      commentDigest:thread.commentDigest,body:'Không được trao đổi khi A bị khóa.' },403)).toEqual({ error:'FORBIDDEN' });
    expect((await post(student.page,aLibrary.path,{ action:'favorite',favorite:true })).status()).toBe(409);
    await student.page.goto(`/library/${aLibrary.id}`);
    await expect(student.page.getByRole('button',{ name:'Yêu thích' })).toBeDisabled();
    await student.page.goto(assignmentA.url);
    await expect(student.page.getByText('Bài đang ở chế độ chỉ đọc.')).toBeVisible();
    await expect(student.page.getByRole('button',{ name:'Nộp bài',exact:true })).toHaveCount(0);
    await student.page.goto(resultUrl);
    await expect(student.page.getByText('Nhận xét hiện hành của A.',{ exact:true })).toBeVisible();
    expect((await student.page.request.get(publishedFile(v1.id,release.id))).status()).toBe(200);

    await fake('revoke');
    await student.page.goto(`/notifications/${assignmentNotice}`);
    await expect(student.page.getByText('Chưa tải được nội dung bài từ Drive.',{ exact:true })).toBeVisible();
    await student.page.goto(`/library/${bLibrary.id}`);
    const image = student.page.getByRole('img',{ name:'Ảnh tài liệu' });
    await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBe(5);
    const onB = await mutate(student,assignmentB.api + '/submissions',writerB('Bài B vẫn nộp bình thường.'));
    expect((await get(student,assignmentB.api)).timings.map(row => row.id)).toEqual([onB.id]);
    expect((await b.page.request.get(source(onB.id))).status()).toBe(200);
    await b.page.goto('/');
    await expect(b.page.getByText('1 lớp đang hoạt động.',{ exact:true })).toBeVisible();
    await expect(b.page.getByText('1 bài viết đang chờ chấm.',{ exact:true })).toBeVisible();
    const csv = await b.page.request.get('/api/reviews/grades');
    expect(parse(await csv.text(),{ bom:true,columns:true })).toEqual([expect.objectContaining({ 'Bài giao':'Bài của giáo viên B' })]);

    const reset = await mutate(admin,'/api/admin/accounts',{ kind:'reset_student',userId:student.id,key:randomUUID(),identityVerified:true });
    expect(reset.operation.state).toBe('committed');
    expect((await student.page.request.get(source(onB.id))).status()).toBe(401);
    expect((await student.page.request.get('/api/notifications')).status()).toBe(401);
    const fresh = await browser.newContext({ baseURL:origin });
    try {
      const page = await fresh.newPage();
      await enter(page,student.username,reset.temporaryPassword);
      await setPassword(page,key());
      const newStudent = { page };
      expect((await get(newStudent,'/api/me')).user.id).toBe(student.id);
      expect((await page.request.get(source(onB.id))).status()).toBe(200);
      expect((await get(newStudent,'/api/assignments?scope=current')).assignments.map(row => row.id).sort()).toEqual((await db.query(`
        SELECT a.id FROM garden.recipients r JOIN garden.assignments a ON a.id=r.assignment_id
        WHERE r.student_id=$1 ORDER BY a.id`,[student.id])).rows.map(row => row.id));
    } finally { await fresh.close(); }
  });
});
