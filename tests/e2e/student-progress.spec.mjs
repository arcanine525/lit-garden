import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { origin } from './auth-fixture.mjs';
import { post, responseBody, withStudentWork } from './student-work-fixture.mjs';

async function enroll(student,teacher,room) {
  await responseBody(await post(student.page,'/api/classes',{ action:'join',code:room.joinCode }));
  const { requests } = await responseBody(await teacher.page.request.get('/api/classes'));
  const request = requests.find(item => item.username === student.username && item.class_id === room.classId);
  expect(request).toBeDefined();
  await responseBody(await post(teacher.page,'/api/classes',{ action:'approve',requestId:request.id }));
}

async function writer(page,assignment) {
  const clientId = randomUUID();
  const lease = await responseBody(await post(page,assignment.draftApi,{ action:'acquire',clientId }));
  return async markdown => responseBody(await post(page,assignment.api + '/submissions',{
    action:'submit',key:randomUUID(),clientId,epoch:lease.epoch,baseVersion:lease.version,draft:{ markdown,explanation:'' }
  }));
}

async function publishReview(page,id) {
  await page.goto(`/reviews/${id}`);
  await page.getByRole('combobox',{ name:'Ý tưởng',exact:true }).selectOption('done');
  const response = page.waitForResponse(response => response.url() === origin + `/api/submissions/${id}/publication` &&
    response.request().method() === 'POST',{ timeout:14_000 });
  await page.getByRole('button',{ name:'Trả bài',exact:true }).click();
  await responseBody(await response);
  await expect(page.getByText('Đã trả bài.',{ exact:true })).toBeVisible();
}

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T29 home and garden filter current memberships and count each latest submission once', async ({ browser }) => {
  test.setTimeout(120_000);
  await withStudentWork(browser,async ({ teacher,student,classroom,db,tag,publish,provision,connectDrive }) => {
    const other = await provision('teacher','teacher_b');
    await connectDrive(other,'garden_b_' + tag);
    const roomB = await responseBody(await post(other.page,'/api/classes',{
      action:'save_class',name:'10B1',year:'2026–2027'
    }),201);
    await enroll(student,other,roomB);
    const sprout = await publish('Mùa xuân trong vườn');
    const flower = await publish('Giọt sương sớm');
    const fruit = await publish('Màu lá non',null,'',roomB,other);
    const closed = await publish('Giọt mưa đầu mùa',null,'',roomB,other);
    const change = async (owner,assignment,action) => {
      const { version } = await responseBody(await owner.page.request.get(assignment.api));
      return responseBody(await post(owner.page,assignment.api,{ action,expectedVersion:version }));
    };
    await change(other,closed,'close');
    const submitA = await writer(student.page,flower);
    const submitB = await writer(student.page,fruit);
    const v1 = await submitA('Một giọt sương trên lá.');
    await publishReview(teacher.page,v1.id);
    const v2 = await submitA('Hai giọt sương trên lá.');
    const otherVersion = await submitB('Lá chuyển sang màu xanh.');
    const draftSave = teacher.page.waitForResponse(response => response.url() === origin + `/api/submissions/${v1.id}/review` &&
      response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save',{ timeout:14_000 });
    await teacher.page.getByLabel('Nhận xét chung (không bắt buộc)').fill('Nhận xét bổ sung cho lần nộp đầu.');
    await responseBody(await draftSave);
    await teacher.page.getByRole('button',{ name:'Trả lại bài',exact:true }).click();
    await expect(teacher.page.getByText('Đã trả lại bài.',{ exact:true })).toBeVisible();
    await publishReview(other.page,otherVersion.id);

    const featured = randomUUID(), library = `/api/library/${featured}`;
    await responseBody(await post(teacher.page,'/api/library',{ id:featured }),201);
    await responseBody(await teacher.page.request.put(library,{ headers:{ Origin:origin },multipart:{
      key:randomUUID(),version:'0',title:'Hạt mầm và trang viết',format:'markdown',markdown:'# Gợi ý đọc'
    } }));
    await responseBody(await post(teacher.page,library,{ action:'share',classIds:[classroom.classId] }));
    await responseBody(await post(teacher.page,library,{ action:'feature',classId:classroom.classId,slot:1 }));

    const page = student.page;
    const rows = view => view.getByRole('list',{ name:'Các bài theo bộ lọc' });
    const card = (view,name) => view.getByRole('region',{ name,exact:true });
    async function counts(view,mam,hoa,qua,total) {
      await expect(card(view,'Mầm').getByText(`${mam} bài`,{ exact:true })).toBeVisible();
      await expect(card(view,'Hoa').getByText(`${hoa} bài`,{ exact:true })).toBeVisible();
      await expect(card(view,'Quả').getByText(`${qua} bài`,{ exact:true })).toBeVisible();
      await expect(rows(view).getByRole('listitem')).toHaveCount(total);
    }
    const assignment = name => rows(page).getByRole('listitem').filter({ hasText:name });
    async function filter(name,value) {
      const form = page.getByRole('form',{ name:'Lọc bài viết' });
      await form.getByRole('combobox',{ name,exact:true }).selectOption(value);
      await form.getByRole('button',{ name:'Áp dụng' }).click();
    }
    await page.goto('/');
    await counts(page,1,1,1,4);
    await expect(assignment('Giọt sương sớm')).toContainText('Chờ chấm');
    await expect(assignment('Giọt sương sớm').getByRole('link',{ name:'Xem nhận xét' })).toHaveCount(0);
    await expect(assignment('Màu lá non')).toContainText('10B1 · teacher_b');
    await expect(assignment('Màu lá non').getByRole('link',{ name:'Xem nhận xét' })).toHaveAttribute('href',`/results/${otherVersion.id}`);
    await expect(assignment('Giọt mưa đầu mùa')).toContainText('Đã đóng — chưa nộp');
    await expect(page.getByRole('link',{ name:'Hạt mầm và trang viết' })).toBeVisible();
    await filter('Lớp',roomB.classId);
    await counts(page,0,0,1,2);
    await expect(page.getByRole('link',{ name:'Hạt mầm và trang viết' })).toHaveCount(0);
    await filter('Giáo viên',teacher.id);
    await counts(page,1,1,0,2);
    await expect(page.getByRole('link',{ name:'Hạt mầm và trang viết' })).toBeVisible();
    await page.getByRole('link',{ name:'Mở khu vườn' }).click();
    await expect(page).toHaveURL(/\/garden\?teacher=/);
    await counts(page,1,1,0,2);
    await page.setViewportSize({ width:390,height:844 });
    await filter('Giáo viên','');
    await counts(page,1,1,1,4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    await teacher.page.goto('/');
    await expect(teacher.page.getByText('1 lớp đang hoạt động.',{ exact:true })).toBeVisible();
    await expect(teacher.page.getByText('1 bài viết đang chờ chấm.',{ exact:true })).toBeVisible();
    await teacher.page.getByRole('link',{ name:'Xem bài chờ chấm' }).click();
    await expect(teacher.page.getByRole('link',{ name:'Chấm bài',exact:true })).toHaveAttribute('href',`/reviews/${v2.id}`);
    await expect(teacher.page.getByText('Màu lá non')).toHaveCount(0);
    await other.page.goto('/');
    await expect(other.page.getByText('0 bài viết đang chờ chấm.',{ exact:true })).toBeVisible();

    const newcomer = await provision('student','garden_new');
    await enroll(newcomer,other,roomB);
    await newcomer.page.goto('/garden');
    await counts(newcomer.page,1,0,0,1);
    await change(other,closed,'reopen');
    await newcomer.page.reload();
    await counts(newcomer.page,2,0,0,2);
    expect((await db.query(`SELECT count(*)::int AS total FROM garden.notifications
      WHERE user_id=$1 AND target_id=$2 AND event_kind='assigned'`,[newcomer.id,closed.id])).rows[0].total).toBe(1);
    await page.reload();
    await counts(page,2,1,1,4);

    await responseBody(await post(teacher.page,library,{ action:'share',classIds:[] }));
    await page.goto('/');
    await expect(page.getByRole('link',{ name:'Hạt mầm và trang viết' })).toHaveCount(0);
    await responseBody(await post(other.page,'/api/classes',{ action:'archive_class',classId:roomB.classId }));
    await page.reload();
    await counts(page,1,1,0,2);
    const active = await responseBody(await page.request.get('/api/assignments?scope=current'));
    expect(active.assignments.map(entry => entry.id).sort()).toEqual([sprout.id,flower.id].sort());
    expect(active.assignments.find(entry => entry.id === flower.id)).toMatchObject({ submissionId:v2.id,returned:false });
    await page.goto('/assignments');
    await expect(assignment('Giọt sương sớm')).toContainText('Chờ chấm');
    await page.goto(`/results/${v1.id}`);
    await expect(page.getByRole('heading',{ name:'Kết quả đã trả' })).toBeVisible();
  });
});
