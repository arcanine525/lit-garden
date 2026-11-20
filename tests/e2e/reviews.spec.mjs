import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { projectMarkdown } from '../../prototypes/editor/src/markdown.js';
import { origin } from './auth-fixture.mjs';
import { post, responseBody, withStudentWork } from './student-work-fixture.mjs';

const labels = ['Ý tưởng','Bố cục','Dẫn chứng','Diễn đạt','Chính tả'];
const rubric = { criteria:labels.map((label,index) => ({ id:'criterion_' + index,label,levels:[
  { id:'full',score:'2',description:'Đạt yêu cầu.' },{ id:'zero',score:'0',description:'Cần luyện tập.' }
] })) };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = 'Lá e\u0301 🌱';
const first = `**${quote}** ở đầu.\n\n**${quote}** ở sau, em xử dụng hình ảnh mới.\n\n| Màu | Ghi chú |\n| --- | --- |\n| Xanh | Dòng cuối |`;
const saveResponse = (page,sub) => page.waitForResponse(response => response.url() === origin + `/api/submissions/${sub}/review` &&
  response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save',{ timeout:14_000 });

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T24 annotates and autosaves a per-version review using the rubric snapshot and verified source', async ({ browser }) => {
  test.setTimeout(110_000);
  await withStudentWork(browser,async ({ student,teacher,admin,db,fake,publish,provision }) => {
    const assignment = await publish('Tả khu vườn của em');
    const clientId = randomUUID();
    const lease = await responseBody(await post(student.page,assignment.draftApi,{ action:'acquire',clientId }));
    const submit = async markdown => responseBody(await post(student.page,assignment.api + '/submissions',{
      action:'submit',key:randomUUID(),clientId,epoch:lease.epoch,baseVersion:lease.version,draft:{ markdown,explanation:'' }
    }));
    const v1 = await submit(first);
    const page = teacher.page;
    const article = page.getByRole('article',{ name:'Văn bản bài nộp' });
    const head = async id => (await db.query(`SELECT s.version,o.drive_file_id,o.expected_sha256,o.mime_type
      FROM garden.review_drafts r JOIN garden.document_streams s ON s.id=r.stream_id
      JOIN garden.drive_objects o ON o.id=s.head_object_id WHERE r.submission_id=$1`,[id])).rows[0];
    const sourceFile = async id => (await db.query(`SELECT o.drive_file_id,o.expected_sha256
      FROM garden.submissions s JOIN garden.drive_objects o ON o.id=s.object_id WHERE s.id=$1`,[id])).rows[0];
    const raw = id => page.request.get('/api/content/submissions/' + id);
    const getDraft = id => page.request.get(`/api/submissions/${id}/review`).then(responseBody);
    const own = `/reviews/${v1.id}`;
    expect((await responseBody(await page.request.get(assignment.api))).reference).toBeNull();
    const baseline = await (await raw(v1.id)).body();
    const metadata = await sourceFile(v1.id);
    expect(metadata.expected_sha256).toBe(sha256(baseline));
    await page.goto(own);
    await expect(page.getByRole('button',{ name:'Thêm nhận xét',exact:true })).toBeEnabled();
    await expect(article.getByRole('table')).toBeVisible();
    await expect(page.getByRole('combobox',{ name:'Bố cục',exact:true })).toHaveValue('');
    const rubricBox = page.getByRole('region',{ name:'Điểm theo rubric',exact:true });
    await expect(rubricBox.getByRole('combobox')).toHaveCount(5);
    const words = article.locator('[data-review-start]').filter({ hasText:quote });
    await expect(words).toHaveCount(2);
    const start = Number(await words.nth(1).getAttribute('data-review-start'));
    await words.nth(1).evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new PointerEvent('pointerup',{ bubbles:true }));
    });
    await page.getByRole('combobox',{ name:'Màu đánh dấu' }).selectOption('green');
    await page.getByRole('button',{ name:'Thêm nhận xét',exact:true }).click();
    await page.getByLabel('Nhận xét cho đoạn chọn').fill('Chọn đúng lần xuất hiện thứ hai.');
    await page.getByRole('button',{ name:'Lưu nhận xét',exact:true }).click();
    await expect(words.nth(0).locator('mark')).toHaveCount(0);
    await expect(words.nth(1).locator('mark')).toHaveClass('review-mark-green');
    await expect(words.nth(1).locator('mark')).toHaveText(quote);
    const autosave = saveResponse(page,v1.id);
    await page.getByRole('combobox',{ name:'Ý tưởng',exact:true }).selectOption('full');
    expect(await responseBody(await autosave)).toMatchObject({ state:'committed' });
    await expect(page.getByText('Đã lưu nháp chấm trên Drive.',{ exact:true })).toBeVisible();
    const scored = await getDraft(v1.id);
    expect(scored.draft.scores).toEqual([{ criterionId:'criterion_0',levelId:'full',value:'2.00' }]);
    expect(scored.draft.comments[0]).toMatchObject({ color:'green',body:'Chọn đúng lần xuất hiện thứ hai.',anchor:{
      start,end:start+quote.length,exact:quote,projectionSha256:sha256(projectMarkdown(first).text)
    } });
    expect((await (await raw(v1.id)).body())).toEqual(baseline);
    const v1Draft = await head(v1.id);
    const drive = await fake('inspect');
    expect(drive.files.find(file => file.id === v1Draft.drive_file_id)).toMatchObject({ mimeType:'text/markdown',name:expect.stringMatching(/^review-draft-.*\.md$/) });
    expect(drive.files.some(file => /\.(json|yaml)$/.test(file.name))).toBe(false);

    await page.reload();
    await expect(article.locator('mark')).toHaveText(quote);
    await expect(article.locator('[data-review-start]').filter({ hasText:quote }).nth(0).locator('mark')).toHaveCount(0);
    await expect(page.getByRole('combobox',{ name:'Ý tưởng',exact:true })).toHaveValue('full');
    await expect(page.getByRole('combobox',{ name:'Bố cục',exact:true })).toHaveValue('');
    const v2 = await submit('Bản nộp mới với dẫn chứng.');
    await page.goto('/reviews');
    const rows = page.locator('.review-queue > li');
    await expect(rows.nth(0)).toContainText('Lần nộp 2');
    await expect(rows.nth(0)).toContainText('Chờ chấm');
    await expect(rows.nth(1)).toContainText('Lần nộp 1');
    await rows.nth(1).getByRole('link',{ name:'Tiếp tục chấm' }).click();
    await page.getByRole('button',{ name:'Tiếp tục chấm tại đây',exact:true }).click();
    await page.getByRole('dialog').getByRole('button',{ name:'Chuyển quyền chấm',exact:true }).click();
    await expect(page.getByRole('button',{ name:'Rà lỗi',exact:true })).toBeEnabled();
    await page.getByRole('button',{ name:'Rà lỗi',exact:true }).click();
    const suggestion = page.getByRole('region',{ name:'Gợi ý rà lỗi' }).getByRole('listitem').filter({ hasText:'xử dụng' });
    await expect(suggestion).toContainText('sử dụng');
    expect(await getDraft(v1.id)).toEqual(scored);
    await page.getByText('Chọn đoạn bằng bàn phím',{ exact:true }).click();
    const keyboard = page.getByRole('combobox',{ name:'Đoạn trong bài',exact:true });
    await keyboard.selectOption({ label:'Dòng cuối' });
    await page.getByRole('button',{ name:'Tô màu đoạn chọn',exact:true }).press('Enter');
    await expect(article.getByRole('cell',{ name:'Dòng cuối' }).locator('mark')).toHaveText('Dòng cuối');
    await suggestion.getByRole('button',{ name:'Dùng gợi ý' }).click();
    await expect(page.getByLabel('Nhận xét cho đoạn chọn')).toHaveValue('Kiểm tra cách viết “sử dụng”.');
    const secondSave = saveResponse(page,v1.id);
    await page.getByRole('button',{ name:'Lưu nhận xét',exact:true }).click();
    expect(await responseBody(await secondSave)).toMatchObject({ state:'committed' });
    await expect(page.getByText('Đã lưu nháp chấm trên Drive.',{ exact:true })).toBeVisible();
    const latestV1 = await getDraft(v1.id), pinnedV1 = await head(v1.id);
    expect(latestV1.draft.scores).toEqual(scored.draft.scores);
    expect(latestV1.draft.comments).toHaveLength(3);
    expect((await (await raw(v1.id)).body())).toEqual(baseline);
    expect((await student.page.request.get(`/api/submissions/${v1.id}/review`)).status()).toBe(403);
    expect((await admin.page.request.get(`/api/submissions/${v1.id}/review`)).status()).toBe(403);
    const outside = await provision('teacher','outside_reviewer');
    expect((await outside.page.request.get(`/api/submissions/${v1.id}/review`)).status()).toBe(404);

    const altered = Buffer.from(baseline.toString('utf8').replace('ở đầu','ở đây'));
    await fake('alter',{ id:metadata.drive_file_id,base64:altered.toString('base64') });
    const changed = saveResponse(page,v1.id);
    await page.getByLabel('Nhận xét chung (không bắt buộc)').fill('Bản này cần giữ cục bộ khi nguồn xung đột.');
    expect((await responseBody(await changed,409)).error).toBe('SUBMISSION_CONFLICT');
    await expect(rubricBox.getByRole('alert')).toContainText('Bản nộp đã thay đổi trên Drive');
    expect(await head(v1.id)).toEqual(pinnedV1);
    await page.goto(`/reviews/${v2.id}`);
    const v2Save = saveResponse(page,v2.id);
    await page.getByRole('combobox',{ name:'Chính tả',exact:true }).selectOption('full');
    expect(await responseBody(await v2Save)).toMatchObject({ state:'committed' });
    await expect(page.getByText('Đã lưu nháp chấm trên Drive.',{ exact:true })).toBeVisible();
    expect((await getDraft(v2.id)).draft.scores).toEqual([{ criterionId:'criterion_4',levelId:'full',value:'2.00' }]);
    await fake('alter',{ id:metadata.drive_file_id,base64:baseline.toString('base64') });
    expect(await getDraft(v1.id)).toEqual(latestV1);
  },{ rubric });
});
