import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { projectMarkdown } from '../../prototypes/editor/src/markdown.js';
import { origin } from './auth-fixture.mjs';
import { post, responseBody, withStudentWork } from './student-work-fixture.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const responseFor = (page,path,action) => page.waitForResponse(response => response.url() === origin+path &&
  response.request().method() === 'POST' && (!action || response.request().postDataJSON()?.action === action),{ timeout:14_000 });

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T26 comment replies are append-only and fence a publication already in flight', async ({ browser }) => {
  test.setTimeout(125_000);
  await withStudentWork(browser,async ({ student,teacher,admin,db,fake,publish,classroom,provision }) => {
    const assignment = await publish('Hội thoại dưới nhận xét');
    const markdown = 'Giọt sương lấp lánh trên lá.';
    const author = student.page, editor = teacher.page;
    const writerId = randomUUID(), marker = randomUUID(), overall = randomUUID();
    const grant = await responseBody(await post(author,assignment.draftApi,{ action:'acquire',clientId:writerId }));
    const result = await responseBody(await post(author,assignment.api + '/submissions',{ action:'submit',key:randomUUID(),clientId:writerId,
      baseVersion:grant.version,epoch:grant.epoch,draft:{ markdown,explanation:'' } }));
    const id = result.id;
    const draftApi = `/api/submissions/${id}/review`, publicationApi = `/api/submissions/${id}/publication`;
    const threadApi = `/api/submissions/${id}/comments/${marker}/messages`;
    const teacherId = randomUUID();
    const editorLease = await responseBody(await post(editor,draftApi,{ action:'acquire',clientId:teacherId }));
    const { text } = projectMarkdown(markdown);
    const end = 'Giọt sương'.length;
    const comment = { id:marker,kind:'range',body:'Hình ảnh này có thể phát triển thêm.',color:'yellow',anchor:{ start:0,end,
      exact:text.slice(0,end),prefix:'',suffix:text.slice(end,end+32),projectionSha256:digest(text) } };
    const review = { scores:[{ criterionId:'idea',levelId:'done',value:'2.00' }],comments:[comment,
      { id:overall,kind:'overall',body:'Giữ cách quan sát của em.' }],overallCommentId:overall };
    const saved = await responseBody(await post(editor,draftApi,{ action:'save',key:randomUUID(),clientId:teacherId,
      baseVersion:'0',epoch:editorLease.epoch,draft:review }));
    const original = await responseBody(await pageGet(editor,`/api/submissions/${id}/verify`));
    const live = await responseBody(await post(editor,publicationApi,{ key:randomUUID(),clientId:teacherId,baseVersion:saved.version,
      epoch:editorLease.epoch,basePublication:null,draftHash:saved.hash,submissionSha256:original.submissionSha256 }));
    const thread = page => pageGet(page,threadApi).then(responseBody);
    const inText = page => page.getByRole('region',{ name:'Nhận xét theo đoạn' });
    const forum = page => inText(page).locator('details');
    const pointer = async () => (await db.query('SELECT current_publication_id FROM garden.submissions WHERE id=$1',[id])).rows[0].current_publication_id;
    const sent = async () => (await db.query(`SELECT m.id,m.message_no,m.author_id,m.sent_at,o.drive_file_id
      FROM garden.conversation_messages m JOIN garden.drive_objects o ON o.id=m.object_id WHERE m.comment_id=$1 ORDER BY m.message_no`,[marker])).rows;
    const events = async () => (await db.query("SELECT event_operation_id,user_id FROM garden.notifications WHERE target_id=$1 AND event_kind='reply' ORDER BY created_at,id",[marker])).rows;

    const peer = await provision('student','conversation_peer');
    await responseBody(await post(peer.page,'/api/classes',{ action:'join',code:classroom.joinCode }));
    const { requests } = await responseBody(await pageGet(editor,'/api/classes'));
    await responseBody(await post(editor,'/api/classes',{ action:'approve',requestId:requests.find(request => request.username === peer.username).id }));
    expect((await pageGet(peer.page,threadApi)).status()).toBe(404);
    expect((await pageGet(admin.page,threadApi)).status()).toBe(404);

    await author.goto(`/results/${id}`);
    await forum(author).getByText('Hội thoại',{ exact:true }).click();
    await forum(author).getByLabel('Tin nhắn mới').fill('Em sẽ thêm một âm thanh cho đoạn này.');
    await editor.goto(`/reviews/${id}`);
    await editor.getByRole('button',{ name:'Tiếp tục chấm tại đây' }).click();
    await editor.getByRole('dialog').getByRole('button',{ name:'Chuyển quyền chấm' }).click();
    await inText(editor).getByRole('button',{ name:'Sửa nhận xét' }).click();
    await editor.getByLabel('Nhận xét cho đoạn chọn').fill('Bản sửa đang chờ công bố.');
    const draftSave = responseFor(editor,draftApi,'save');
    await editor.getByRole('button',{ name:'Lưu nhận xét',exact:true }).click();
    await responseBody(await draftSave);
    await expect(editor.getByRole('button',{ name:'Trả lại bài',exact:true })).toBeEnabled();
    await fake('fault',{ operation:'upload',afterCommit:true,hold:true });
    const delayedPublication = responseFor(editor,publicationApi);
    await editor.getByRole('button',{ name:'Trả lại bài',exact:true }).click();
    await expect.poll(async () => (await fake('inspect')).holds).toEqual(['upload']);
    const newMessage = responseFor(author,threadApi,'send');
    await forum(author).getByRole('button',{ name:'Gửi phản hồi',exact:true }).click();
    const first = await responseBody(await newMessage);
    await expect(forum(author).getByText('Em sẽ thêm một âm thanh cho đoạn này.')).toBeVisible();
    await fake('release',{ operation:'upload' });
    const rejected = await delayedPublication;
    expect((await responseBody(rejected,409)).error).toBe('COMMENT_LOCKED');
    expect(await pointer()).toBe(live.id);
    const aborted = (await db.query(`SELECT op.state,o.lifecycle FROM garden.operations op JOIN garden.drive_objects o
      ON o.operation_id=op.id WHERE op.idempotency_key=$1`,[rejected.request().postDataJSON().key])).rows[0];
    expect(aborted).toEqual({ state:'rejected',lifecycle:'orphan' });
    expect((await thread(author)).messages).toEqual([expect.objectContaining({ id:first.id,body:'Em sẽ thêm một âm thanh cho đoạn này.' })]);
    await expect(inText(editor).getByText('Nhận xét đã có phản hồi và được khóa.')).toBeVisible();
    await expect(inText(editor).getByRole('button',{ name:'Bỏ đánh dấu' })).toHaveCount(0);

    await editor.getByText('Quản lý nháp',{ exact:true }).press('Enter');
    await editor.getByRole('button',{ name:'Khôi phục nhận xét đã khóa',exact:true }).click();
    const restored = responseFor(editor,draftApi,'save');
    await editor.getByRole('dialog').getByRole('button',{ name:'Khôi phục nhận xét',exact:true }).click();
    await responseBody(await restored);
    await expect(inText(editor).getByText(comment.body,{ exact:true })).toBeVisible();
    const republish = responseFor(editor,publicationApi);
    await editor.getByRole('button',{ name:'Trả lại bài',exact:true }).click();
    const updated = await responseBody(await republish);
    expect(await pointer()).toBe(updated.id);
    expect((await thread(author)).messages.map(message => message.id)).toEqual([first.id]);

    await editor.goto(`/results/${id}`);
    await forum(editor).getByText('Hội thoại',{ exact:true }).click();
    await forum(editor).getByLabel('Tin nhắn mới').fill('Cô đính chính. Chi tiết hiện tại đã đủ rõ.');
    await fake('fault',{ operation:'upload',afterCommit:true,status:504,reason:'backendError' });
    const failedReply = responseFor(editor,threadApi,'send');
    await forum(editor).getByRole('button',{ name:'Gửi phản hồi',exact:true }).click();
    const lost = await failedReply;
    await responseBody(lost,202);
    expect(await sent()).toHaveLength(1);
    expect(await events()).toEqual([{ event_operation_id:first.id,user_id:teacher.id }]);
    const secondAttempt = lost.request().postDataJSON();
    const pinned = (await db.query(`SELECT o.drive_file_id FROM garden.operations op JOIN garden.drive_objects o
      ON o.operation_id=op.id WHERE op.idempotency_key=$1`,[secondAttempt.key])).rows[0].drive_file_id;
    const retried = responseFor(editor,threadApi,'send');
    await forum(editor).getByRole('button',{ name:'Thử gửi lại',exact:true }).click();
    const retriedResult = await retried;
    expect(retriedResult.request().postDataJSON()).toEqual(secondAttempt);
    const second = await responseBody(retriedResult);
    await expect(forum(editor).getByText('Cô đính chính. Chi tiết hiện tại đã đủ rõ.')).toBeVisible();
    expect(await responseBody(await post(editor,threadApi,secondAttempt))).toEqual(second);
    expect(await sent()).toMatchObject([{ id:first.id,message_no:1,author_id:student.id },
      { id:second.id,message_no:2,author_id:teacher.id,drive_file_id:pinned }]);
    expect((await fake('inspect')).files.filter(file => file.name.startsWith('message-'))).toHaveLength(2);
    expect(await events()).toEqual([{ event_operation_id:first.id,user_id:teacher.id },{ event_operation_id:second.id,user_id:student.id }]);
    await expect(db.query('UPDATE garden.conversation_messages SET sent_at=now() WHERE id=$1',[first.id])).rejects.toMatchObject({ code:'23514' });

    const canceled = { ...secondAttempt,key:randomUUID(),body:'Tin chưa xác nhận và sẽ bị hủy.' };
    await fake('fault',{ operation:'upload',afterCommit:true,status:504,reason:'backendError' });
    await responseBody(await post(editor,threadApi,canceled),202);
    expect(await responseBody(await post(editor,threadApi,{ action:'cancel',key:canceled.key }))).toEqual({ state:'rejected' });
    expect((await responseBody(await post(editor,threadApi,canceled),409)).error).toBe('REPLY_REJECTED');
    expect((await thread(editor)).pending).toBe(false);
    expect(await sent()).toHaveLength(2);
    const orphan = (await db.query(`SELECT o.lifecycle FROM garden.operations op JOIN garden.drive_objects o
      ON o.operation_id=op.id WHERE op.idempotency_key=$1`,[canceled.key])).rows[0];
    expect(orphan.lifecycle).toBe('orphan');

    const assignmentInfo = await responseBody(await pageGet(editor,assignment.api));
    await responseBody(await post(editor,assignment.api,{ action:'close',expectedVersion:assignmentInfo.version }));
    const latest = await thread(author);
    expect(latest.writable).toBe(true);
    await responseBody(await post(author,threadApi,{ action:'send',key:randomUUID(),publicationId:latest.publicationId,
      commentDigest:latest.commentDigest,body:'Em hiểu rồi, cảm ơn cô.' }));
    expect((await thread(editor)).messages).toHaveLength(3);
    await responseBody(await post(editor,'/api/classes',{ action:'archive_class',classId:classroom.classId }));
    expect((await thread(author)).writable).toBe(false);
    expect((await post(author,threadApi,{ action:'send',key:randomUUID(),publicationId:latest.publicationId,
      commentDigest:latest.commentDigest,body:'Tin không được gửi ở lớp lưu trữ.' })).status()).toBe(409);
    await author.reload();
    await forum(author).getByText('Hội thoại',{ exact:true }).click();
    await expect(forum(author).getByText('Hội thoại chỉ đọc.',{ exact:true })).toBeVisible();
    await expect(forum(author).getByText('Em hiểu rồi, cảm ơn cô.')).toBeVisible();
    await expect(forum(author).getByRole('button',{ name:'Gửi phản hồi' })).toHaveCount(0);
    await responseBody(await post(editor,'/api/classes',{ action:'restore_class',classId:classroom.classId }));
    await responseBody(await post(editor,'/api/classes',{ action:'remove_student',classId:classroom.classId,studentId:student.id }));
    expect((await thread(author)).writable).toBe(false);
    expect((await thread(author)).messages).toHaveLength(3);
    const other = await responseBody(await pageGet(author,`/api/submissions/${id}/comments/${overall}/messages`));
    expect(other.messages).toEqual([]);
  });
});

function pageGet(page,path) { return page.request.get(path); }
