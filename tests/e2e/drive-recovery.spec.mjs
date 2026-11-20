import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { restartableApp, unusedPort } from './restartable-app.mjs';
import { post, responseBody, withStudentWork, writeSource } from './student-work-fixture.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const remotePost = (page,app,path,data) => page.request.post(app.origin + path,{ headers:{ Origin:app.origin },data });
const remoteGet = (page,app,path) => page.request.get(app.origin + path);
const requestFor = (page,app,path,action) => page.waitForResponse(response => response.url() === app.origin + path &&
  response.request().method() === 'POST' && response.request().postDataJSON()?.action === action,{ timeout:14_000 });

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T32 recovers a pinned submission after restart without uploading content again', async ({ browser }) => {
  test.setTimeout(120_000);
  await withStudentWork(browser,async ({ student,teacher,db,fake,publish,tag }) => {
    const assignment = await publish('Đối chiếu bài viết');
    const path = assignment.api + '/submissions';
    const port = await unusedPort();
    let app = await restartableApp(port);
    const writer = student.page, owner = teacher.page;
    const markdown = '# Dấu vết trong vườn\n\nBản ở thiết bị.';
    const submissions = [];
    writer.on('request',request => {
      if (request.url() === app.origin + path && request.method() === 'POST' && request.postDataJSON()?.action === 'submit') {
        submissions.push(request.postDataJSON());
      }
    });
    const pins = async () => (await db.query(`SELECT op.id,op.state,op.error_code,op.idempotency_key,op.accepted_at,
      object.drive_file_id,object.expected_sha256,object.lifecycle,object.integrity FROM garden.operations op
      JOIN garden.recipients r ON r.id=op.target_id LEFT JOIN garden.drive_objects object ON object.operation_id=op.id
      WHERE op.kind='submit' AND r.assignment_id=$1 ORDER BY op.accepted_at`,[assignment.id])).rows;
    const history = async () => (await responseBody(await remoteGet(writer,app,path))).submissions;
    try {
      await writer.goto(app.origin + assignment.url);
      await expect(writer.getByRole('button',{ name:'Nộp bài',exact:true })).toBeEnabled();
      await writer.context().setOffline(true);
      await writeSource(writer,markdown);
      await writer.getByRole('button',{ name:'Đồng bộ nháp',exact:true }).click();
      await expect(writer.getByText('Mất kết nối. Nháp chưa đồng bộ lên Drive.',{ exact:true })).toBeVisible();
      expect(await pins()).toEqual([]);
      await writer.getByRole('button',{ name:'Nộp bài',exact:true }).click();
      await expect(writer.getByText('Chưa nộp do mất kết nối. Nội dung vẫn được giữ trên thiết bị.',{ exact:true })).toBeVisible();
      const download = writer.waitForEvent('download');
      await writer.getByRole('button',{ name:'Tải lần nộp đang chờ (.md)',exact:true }).click();
      expect(await readFile(await (await download).path(),'utf8')).toContain('Bản ở thiết bị.');
      expect(submissions).toEqual([]);
      const reconnect = requestFor(writer,app,path,'status');
      await writer.context().setOffline(false);
      expect(await responseBody(await reconnect)).toEqual({ state:'missing' });
      expect(await history()).toEqual([]);
      expect(submissions).toEqual([]);

      async function retry(issue) {
        const response = requestFor(writer,app,path,'submit');
        await writer.getByRole('button',{ name:'Thử nộp lại',exact:true }).click();
        return expect(await responseBody(await response,202)).toEqual({ state:'unknown',...(issue ? { issue } : {}) });
      }
      await fake('fault',{ operation:'upload',status:429,reason:'rateLimitExceeded' });
      await retry('QUOTA');
      await expect(writer.getByText('Chưa xác nhận đã nộp. Drive đang giới hạn ghi tệp.')).toBeVisible();
      const [pin] = await pins();
      expect(pin).toMatchObject({ state:'unknown',error_code:'QUOTA',lifecycle:'candidate',integrity:'unverified' });
      expect((await fake('inspect')).files.some(file => file.id === pin.drive_file_id)).toBe(false);
      const stillWaiting = await responseBody(await remotePost(writer,app,path,{ action:'status',key:pin.idempotency_key }));
      expect(stillWaiting).toEqual({ state:'pending',issue:'QUOTA' });
      expect(await history()).toEqual([]);
      expect((await remoteGet(writer,app,`/api/content/submissions/${pin.id}`)).status()).toBe(404);

      await fake('fault',{ operation:'upload',status:403,reason:'insufficientFilePermissions' });
      await retry('FORBIDDEN');
      await expect(writer.getByText('Chưa xác nhận đã nộp. Không có quyền ghi lên Drive.')).toBeVisible();
      await fake('revoke');
      await retry('AUTH');
      await expect(writer.getByText('Chưa xác nhận đã nộp. Giáo viên cần kết nối lại Drive.')).toBeVisible();
      expect((await pins())[0]).toMatchObject({ error_code:'AUTH',drive_file_id:pin.drive_file_id,expected_sha256:pin.expected_sha256 });
      await owner.goto('/drive');
      await owner.getByRole('button',{ name:'Kết nối lại Drive' }).click();
      await owner.getByLabel('Danh tính Drive thử').fill('writing_' + tag);
      await owner.getByRole('button',{ name:'Cho phép' }).click();
      await owner.getByRole('button',{ name:'Xác minh thư mục' }).click();
      await expect(owner.getByRole('status')).toContainText('Đã xác minh');

      await fake('fault',{ operation:'upload',status:504,reason:'backendError' });
      await retry();
      expect((await fake('inspect')).files.some(file => file.id === pin.drive_file_id)).toBe(false);
      await fake('fault',{ operation:'upload',afterCommit:true,status:504,reason:'backendError' });
      await retry();
      expect((await fake('inspect')).files.filter(file => file.id === pin.drive_file_id)).toHaveLength(1);
      expect(await history()).toEqual([]);
      const pid = app.pid;
      await app.stop();
      app = await restartableApp(port);
      expect(app.pid).not.toBe(pid);
      await fake('fault',{ operation:'upload',status:503,reason:'backendError' });
      const recovery = requestFor(writer,app,path,'status');
      await writer.reload();
      const verified = await recovery;
      expect(verified.request().postDataJSON()).toEqual({ action:'status',key:pin.idempotency_key });
      expect(await responseBody(verified)).toEqual({ state:'committed',id:pin.id });
      await expect(writer.getByRole('link',{ name:'Lần nộp 1',exact:true })).toBeVisible();
      expect(submissions).toEqual(Array(5).fill(submissions[0]));
      expect(await pins()).toEqual([{ ...pin,state:'committed',error_code:null,lifecycle:'referenced',integrity:'ok' }]);
      expect(await history()).toEqual([expect.objectContaining({ id:pin.id,number:1,submittedAt:pin.accepted_at.toISOString() })]);
      const bytes = await (await remoteGet(writer,app,`/api/content/submissions/${pin.id}`)).body();
      expect(sha256(bytes)).toBe(pin.expected_sha256);
      expect(bytes.toString('utf8')).toContain('Bản ở thiết bị.');

      const clientId = randomUUID();
      const grant = await responseBody(await remotePost(writer,app,assignment.draftApi,{ action:'takeover',clientId }));
      const late = { action:'submit',key:randomUUID(),clientId,epoch:grant.epoch,baseVersion:grant.version,
        draft:{ markdown:'Bản đến muộn sau khi đóng bài.',explanation:'' } };
      await fake('fault',{ operation:'upload',afterCommit:true,hold:true });
      const inFlight = remotePost(writer,app,path,late).then(response => response,() => null);
      await expect.poll(async () => (await fake('inspect')).holds).toEqual(['upload']);
      const held = (await pins())[1];
      const { version } = await responseBody(await owner.request.get(assignment.api));
      const closed = await responseBody(await post(owner,assignment.api,{ action:'close',expectedVersion:version }));
      expect((await pins())[1]).toMatchObject({ state:'rejected',error_code:'POLICY',lifecycle:'orphan' });
      await responseBody(await post(owner,assignment.api,{ action:'reopen',expectedVersion:closed.version }));
      await fake('release',{ operation:'upload' });
      expect((await responseBody(await inFlight,409)).error).toBe('SUBMISSION_REJECTED');
      expect((await responseBody(await remotePost(writer,app,path,late),409)).error).toBe('SUBMISSION_REJECTED');
      expect(await responseBody(await remotePost(writer,app,path,{ action:'status',key:late.key }))).toEqual({ state:'rejected' });
      expect((await history()).map(row => row.id)).toEqual([pin.id]);
      expect((await fake('inspect')).files.some(file => file.id === held.drive_file_id)).toBe(true);
    } finally { await app.stop(); }
  });
});

test('T32 review and reply retries after restart preserve files, pointers and one notification', async ({ browser }) => {
  test.setTimeout(130_000);
  await withStudentWork(browser,async ({ student,teacher,db,fake,publish,tag }) => {
    const assignment = await publish('Công bố và hội thoại qua lần khởi động lại');
    const port = await unusedPort();
    let app = await restartableApp(port);
    const writer = student.page, owner = teacher.page;
    const send = async (page,path,body,status = 200) => responseBody(await remotePost(page,app,path,body),status);
    const get = async (page,path) => responseBody(await remoteGet(page,app,path));
    const restart = async () => {
      const pid = app.pid;
      await app.stop();
      app = await restartableApp(port);
      expect(app.pid).not.toBe(pid);
    };
    const pin = async key => (await db.query(`SELECT op.id,op.state,op.target_id,op.request_digest,op.result_id,
      o.drive_file_id,o.expected_sha256,o.lifecycle FROM garden.operations op
      LEFT JOIN garden.drive_objects o ON o.operation_id=op.id WHERE op.idempotency_key=$1`,[key])).rows[0];
    let trigger;
    async function failNotification(kind,target) {
      trigger = 'fixture_event_' + tag;
      await db.query(`CREATE FUNCTION garden.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.event_kind='${kind}' AND NEW.target_id='${target}'::uuid THEN
          RAISE EXCEPTION 'Fixture notification commit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER ${trigger} BEFORE INSERT ON garden.notifications FOR EACH ROW EXECUTE FUNCTION garden.${trigger}()`);
    }
    async function releaseNotification() {
      if (!trigger) return;
      await db.query(`DROP TRIGGER ${trigger} ON garden.notifications; DROP FUNCTION garden.${trigger}()`);
      trigger = undefined;
    }

    try {
      const writerClient = randomUUID();
      const lease = await send(writer,assignment.draftApi,{ action:'acquire',clientId:writerClient });
      const { id } = await send(writer,assignment.api + '/submissions',{ action:'submit',key:randomUUID(),
        clientId:writerClient,epoch:lease.epoch,baseVersion:lease.version,draft:{ markdown:'Vườn có một chồi non.',explanation:'' } });
      const review = `/api/submissions/${id}/review`, publication = `/api/submissions/${id}/publication`;
      const comment = randomUUID(), editor = randomUUID(), thread = `/api/submissions/${id}/comments/${comment}/messages`;
      const { epoch } = await send(owner,review,{ action:'acquire',clientId:editor });
      const { submissionSha256 } = await get(owner,`/api/submissions/${id}/verify`);
      async function draft(baseVersion,basePublication,body) {
        const data = { scores:[{ criterionId:'idea',levelId:'done',value:'2.00' }],
          comments:[{ id:comment,kind:'overall',body }],overallCommentId:comment };
        const saved = await send(owner,review,{ action:'save',key:randomUUID(),clientId:editor,epoch,baseVersion,draft:data });
        return { key:randomUUID(),clientId:editor,epoch,baseVersion:saved.version,basePublication,draftHash:saved.hash,submissionSha256 };
      }
      const initial = await draft('0',null,'Nhận xét đang hiển thị.');
      const first = await send(owner,publication,initial);
      const next = await draft(initial.baseVersion,first.id,'Nhận xét sẽ hiện sau giao dịch.');
      const events = async () => (await db.query(`SELECT event_kind,event_operation_id,user_id FROM garden.notifications
        WHERE target_id IN ($1,$2) ORDER BY created_at,id`,[id,comment])).rows;
      await failNotification('returned',id);
      expect(await send(owner,publication,next,202)).toEqual({ state:'unknown' });
      const pending = await pin(next.key);
      expect(pending).toMatchObject({ state:'unknown',lifecycle:'candidate',result_id:null,expected_sha256:expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect((await get(writer,publication)).publication.id).toBe(first.id);
      expect(await events()).toHaveLength(1);
      expect((await fake('inspect')).files.filter(file => file.id === pending.drive_file_id)).toHaveLength(1);
      await restart();
      await writer.goto(app.origin + `/results/${id}`);
      await expect(writer.getByText('Nhận xét đang hiển thị.',{ exact:true })).toBeVisible();
      await expect(writer.getByText('Nhận xét sẽ hiện sau giao dịch.',{ exact:true })).toHaveCount(0);
      await releaseNotification();
      const returned = await send(owner,publication,next);
      expect(await send(owner,publication,next)).toEqual(returned);
      expect(returned.id).toBe(pending.id);
      expect(await pin(next.key)).toEqual({ ...pending,state:'committed',lifecycle:'referenced',result_id:returned.id });
      const report = await remoteGet(writer,app,publication + '/download');
      expect(sha256(await report.body())).toBe(pending.expected_sha256);
      expect((await remoteGet(writer,app,publication + '/download?publication=' + first.id)).status()).toBe(404);
      expect(await events()).toHaveLength(2);

      const { publicationId,commentDigest } = await get(writer,thread);
      const reply = body => ({ action:'send',key:randomUUID(),publicationId,commentDigest,body });
      const sent = [];
      for (const [firstSender,secondSender,firstRole,secondRole] of [[writer,owner,student,teacher],[owner,writer,teacher,student]]) {
        const a = reply('Tin đang chờ thứ ' + (sent.length + 1));
        const b = reply('Tin gửi tiếp theo thứ ' + (sent.length + 2));
        await fake('fault',{ operation:'upload',afterCommit:true,hold:true });
        const held = remotePost(firstSender,app,thread,a).then(response => response,() => null);
        await expect.poll(async () => (await fake('inspect')).holds).toEqual(['upload']);
        const prior = await pin(a.key);
        expect((await get(writer,thread)).messages.map(message => message.id)).toEqual(sent);
        expect(await send(secondSender,thread,b,409)).toEqual({ error:'OP_IN_PROGRESS' });
        expect(await pin(a.key)).toEqual(prior);
        expect(await pin(b.key)).toBeUndefined();
        await fake('release',{ operation:'upload' });
        const accepted = await responseBody(await held);
        expect(await send(firstSender,thread,a)).toEqual(accepted);
        const after = await send(secondSender,thread,b);
        expect(await send(secondSender,thread,b)).toEqual(after);
        sent.push(accepted.id,after.id);
        expect((await get(writer,thread)).messages.map(message => message.id)).toEqual(sent);
        expect((await events()).slice(-2)).toEqual([
          { event_kind:'reply',event_operation_id:accepted.id,user_id:secondRole.id },
          { event_kind:'reply',event_operation_id:after.id,user_id:firstRole.id }
        ]);
      }

      const timed = reply('Tin cuối khôi phục từ cùng ID.');
      await failNotification('reply',comment);
      expect(await send(writer,thread,timed,202)).toEqual({ state:'unknown' });
      const replyPin = await pin(timed.key);
      expect(replyPin).toMatchObject({ state:'unknown',lifecycle:'candidate' });
      expect((await get(owner,thread)).messages.map(message => message.id)).toEqual(sent);
      expect((await events()).some(row => row.event_operation_id === replyPin.id)).toBe(false);
      await restart();
      await releaseNotification();
      expect(await send(writer,thread,timed)).toEqual({ state:'committed',id:replyPin.id });
      expect(await send(writer,thread,timed)).toEqual({ state:'committed',id:replyPin.id });
      expect(await send(writer,thread,{ ...timed,body:'Không được đổi payload.' },409)).toEqual({ error:'KEY_REUSED' });
      expect(await pin(timed.key)).toEqual({ ...replyPin,state:'committed',lifecycle:'referenced',result_id:replyPin.id });
      expect((await get(owner,thread)).messages.map(message => message.id)).toEqual([...sent,replyPin.id]);
      expect((await events()).filter(row => row.event_operation_id === replyPin.id)).toEqual([
        { event_kind:'reply',event_operation_id:replyPin.id,user_id:teacher.id }
      ]);
      const files = (await fake('inspect')).files;
      expect(files.filter(file => file.name.startsWith('review-pub-'))).toHaveLength(2);
      expect(files.filter(file => file.name.startsWith('message-'))).toHaveLength(5);
      const savedMetadata = (await db.query('SELECT to_jsonb(op) AS data FROM garden.operations op WHERE id=$1',[replyPin.id])).rows[0].data;
      expect(JSON.stringify(savedMetadata)).not.toContain(timed.body);
    } finally {
      await releaseNotification();
      await app.stop();
    }
  });
});
