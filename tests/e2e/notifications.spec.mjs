import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { post, responseBody, withStudentWork } from './student-work-fixture.mjs';

const inbox = async page => (await responseBody(await page.request.get('/api/notifications'))).notifications;
const openUrl = id => `/notifications/${id}`;

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T30 inbox isolates recipients, marks read and checks current targets when opened', async ({ browser }) => {
  test.setTimeout(100_000);
  await withStudentWork(browser,async ({ student,teacher,admin,db,classroom,publish,provision }) => {
    const writer = student.page, owner = teacher.page;
    const title = 'Một đề bài chỉ hiện sau khi mở';
    const essay = 'Nội dung bài nộp không nằm trong hộp thư.';
    const privateNote = 'Nhận xét cũ chỉ đọc được trong công bố đầu.';
    const privateReply = 'Nội dung phản hồi không dùng làm preview.';
    const core = await publish(title,'2026-12-21T10:00:00.000Z');
    const reopen = await publish('Bài giao bổ sung');
    const detail = async assignment => responseBody(await owner.request.get(assignment.api));
    const close = await responseBody(await post(owner,reopen.api,{ action:'close',expectedVersion:(await detail(reopen)).version }));
    const newcomer = await provision('student','inbox_new');
    await responseBody(await post(newcomer.page,'/api/classes',{ action:'join',code:classroom.joinCode }));
    const { requests } = await responseBody(await owner.request.get('/api/classes'));
    const request = requests.find(item => item.username === newcomer.username && item.class_id === classroom.classId);
    await responseBody(await post(owner,'/api/classes',{ action:'approve',requestId:request.id }));
    expect((await inbox(newcomer.page)).map(row => row.kind)).toEqual(['assigned']);
    const reopening = { action:'reopen',expectedVersion:close.version };
    const reopened = await responseBody(await post(owner,reopen.api,reopening));
    expect(await responseBody(await post(owner,reopen.api,reopening))).toEqual(reopened);
    expect((await inbox(newcomer.page)).map(row => row.kind)).toEqual(['assigned','assigned']);
    expect((await inbox(writer)).map(row => row.kind)).toEqual(['assigned','assigned']);
    const reopenedNotice = (await inbox(newcomer.page))[0];
    await newcomer.page.goto(openUrl(reopenedNotice.id));
    await expect(newcomer.page).toHaveURL(`/assignments/${reopen.id}`);

    const extend = { action:'extend_deadline',expectedVersion:(await detail(core)).version,
      dueAt:'2026-12-23T10:00:00.000Z',key:randomUUID() };
    const extended = await responseBody(await post(owner,core.api,extend));
    expect(await responseBody(await post(owner,core.api,extend))).toEqual(extended);
    const deadline = (await inbox(writer)).find(row => row.kind === 'deadline_extended');
    expect(deadline).toMatchObject({ available:true,readAt:null });

    const studentClient = randomUUID();
    const studentLease = await responseBody(await post(writer,core.draftApi,{ action:'acquire',clientId:studentClient }));
    const { id } = await responseBody(await post(writer,core.api + '/submissions',{
      action:'submit',key:randomUUID(),clientId:studentClient,epoch:studentLease.epoch,baseVersion:studentLease.version,
      draft:{ markdown:essay,explanation:'' }
    }));
    const review = `/api/submissions/${id}/review`, publication = `/api/submissions/${id}/publication`;
    const clientId = randomUUID(), oldComment = randomUUID(), newComment = randomUUID();
    const { epoch } = await responseBody(await post(owner,review,{ action:'acquire',clientId }));
    const { submissionSha256 } = await responseBody(await owner.request.get(`/api/submissions/${id}/verify`));
    async function release(baseVersion,basePublication,comment,body) {
      const draft = { overallCommentId:comment,scores:[{ criterionId:'idea',levelId:'done',value:'2.00' }],
        comments:[{ id:comment,kind:'overall',body }] };
      const saved = await responseBody(await post(owner,review,{ action:'save',key:randomUUID(),clientId,epoch,baseVersion,draft }));
      const intent = { key:randomUUID(),clientId,epoch,baseVersion:saved.version,basePublication,draftHash:saved.hash,submissionSha256 };
      const result = await responseBody(await post(owner,publication,intent));
      expect(await responseBody(await post(owner,publication,intent))).toEqual(result);
      return { ...result,version:saved.version };
    }
    const first = await release('0',null,oldComment,privateNote);
    const firstNotice = (await inbox(writer)).find(row => row.kind === 'returned');
    await writer.goto('/');
    await writer.getByRole('link',{ name:'Thông báo',exact:true }).click();
    const returns = writer.getByRole('listitem').filter({ has:writer.getByRole('heading',{ name:'Giáo viên đã trả bài',exact:true }) });
    await expect(returns.getByRole('status')).toHaveText('Chưa đọc');
    const firstLink = await returns.getByRole('link',{ name:'Mở nội dung' }).getAttribute('href');
    expect(firstLink).toBe(openUrl(firstNotice.id));
    await returns.getByRole('button',{ name:'Đánh dấu đã đọc' }).click();
    await expect(returns.getByRole('status')).toHaveText('Đã đọc');
    const readAt = (await inbox(writer)).find(row => row.id === firstNotice.id).readAt;
    expect(readAt).toEqual(expect.any(String));
    expect(await responseBody(await post(writer,'/api/notifications',{ id:firstNotice.id }))).toEqual({ readAt });
    await writer.reload();
    await expect(returns.getByRole('status')).toHaveText('Đã đọc');
    const [inboxResponse,peerResponse] = await Promise.all([writer.request.get('/api/notifications'),newcomer.page.request.get(firstLink)]);
    expect(inboxResponse.headers()['cache-control']).toBe('no-store');
    expect(peerResponse.status()).toBe(404);
    expect((await post(newcomer.page,'/api/notifications',{ id:firstNotice.id })).status()).toBe(404);
    expect((await admin.page.request.get('/api/notifications')).status()).toBe(403);
    await returns.getByRole('link',{ name:'Mở nội dung' }).click();
    await expect(writer).toHaveURL(`/results/${id}?publication=${first.id}`);
    await expect(writer.getByText(privateNote,{ exact:true })).toBeVisible();

    const second = await release(first.version,first.id,newComment,'Nhận xét ở công bố hiện hành.');
    await writer.goto(firstLink);
    await expect(writer.getByRole('heading',{ name:'Nội dung không còn khả dụng' })).toBeVisible();
    await expect(writer.getByText(privateNote)).toHaveCount(0);
    expect((await writer.request.get(`${publication}?publication=${first.id}`)).status()).toBe(404);
    const currentNotice = (await inbox(writer)).find(row => row.kind === 'returned' && row.available);
    expect(currentNotice.id).not.toBe(firstNotice.id);
    expect((await inbox(writer)).find(row => row.id === firstNotice.id)).toMatchObject({
      available:false,className:null,teacherName:null,readAt
    });

    const messages = `/api/submissions/${id}/comments/${newComment}/messages`;
    async function send(page,body) {
      const { commentDigest,publicationId } = await responseBody(await page.request.get(messages));
      const request = { action:'send',key:randomUUID(),publicationId,commentDigest,body };
      const result = await responseBody(await post(page,messages,request));
      expect(await responseBody(await post(page,messages,request))).toEqual(result);
    }
    await send(writer,privateReply);
    await send(owner,'Giáo viên đã đọc phản hồi.');
    const teacherInbox = await inbox(owner);
    expect(teacherInbox).toEqual([expect.objectContaining({ kind:'reply',available:true,readAt:null })]);
    const ownInbox = await inbox(writer);
    expect(ownInbox.map(row => row.kind).sort()).toEqual(['assigned','assigned','deadline_extended','reply','returned','returned']);
    const reply = ownInbox.find(row => row.kind === 'reply');
    await owner.goto(openUrl(teacherInbox[0].id));
    await expect(owner).toHaveURL(`/results/${id}?publication=${second.id}#comment-${newComment}`);
    await expect(owner.locator(`#comment-${newComment}`)).toBeVisible();
    await writer.goto(openUrl(reply.id));
    await expect(writer).toHaveURL(`/results/${id}?publication=${second.id}#comment-${newComment}`);
    await writer.goto('/notifications');
    for (const text of [title,essay,privateNote,privateReply]) {
      expect(JSON.stringify(ownInbox)).not.toContain(text);
      await expect(writer.getByText(text,{ exact:true })).toHaveCount(0);
    }

    const removed = (await db.query(`SELECT id FROM garden.notifications WHERE user_id=$1 AND target_id=$2
      AND event_kind='assigned'`,[student.id,reopen.id])).rows[0].id;
    await responseBody(await post(owner,'/api/classes',{ action:'remove_student',classId:classroom.classId,studentId:student.id }));
    await writer.goto(openUrl(removed));
    await expect(writer.getByRole('heading',{ name:'Nội dung không còn khả dụng' })).toBeVisible();
    expect((await inbox(writer)).find(row => row.id === removed)).toMatchObject({ available:false,className:null,teacherName:null });
    await writer.goto(openUrl(deadline.id));
    await expect(writer).toHaveURL(`/assignments/${core.id}`);
    await writer.goto(openUrl(currentNotice.id));
    await expect(writer).toHaveURL(`/results/${id}?publication=${second.id}`);
    const columns = (await db.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='garden' AND table_name='notifications' ORDER BY column_name`)).rows.map(row => row.column_name);
    expect(columns).toEqual(['created_at','event_kind','event_operation_id','id','read_at','target_id','target_kind','teacher_id','user_id']);
  });
});
