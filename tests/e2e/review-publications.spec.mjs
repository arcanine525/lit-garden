import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { origin } from './auth-fixture.mjs';
import { post, responseBody, withStudentWork } from './student-work-fixture.mjs';

const criteria = ['Ý tưởng','Bố cục','Dẫn chứng','Diễn đạt','Chính tả'];
const rubric = { criteria:criteria.map((label,index) => ({ id:'criterion_' + index,label,levels:[
  { id:'half',score:'1',description:'Cần phát triển thêm.' },{ id:'full',score:'2',description:'Đạt yêu cầu.' }
] })) };
const waitForDraft = (page,id,action) => page.waitForResponse(response => response.url() === origin + `/api/submissions/${id}/review` &&
  response.request().method() === 'POST' && response.request().postDataJSON()?.action === action,{ timeout:14_000 });
const waitForReturn = (page,id) => page.waitForResponse(response => response.url() === origin + `/api/submissions/${id}/publication` &&
  response.request().method() === 'POST',{ timeout:14_000 });

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T25 publishes and republishes immutable reviews, while students see only the current release', async ({ browser }) => {
  test.setTimeout(135_000);
  await withStudentWork(browser,async ({ student,teacher,db,fake,publish,tag }) => {
    const assignment = await publish('Hai bản nộp, hai kết quả');
    const clientId = randomUUID(), page = teacher.page;
    const lease = await responseBody(await post(student.page,assignment.draftApi,{ action:'acquire',clientId }));
    const submit = async markdown => responseBody(await post(student.page,assignment.api + '/submissions',{
      action:'submit',key:randomUUID(),clientId,epoch:lease.epoch,baseVersion:lease.version,draft:{ markdown,explanation:'' }
    }));
    const v1 = await submit('**Buổi sáng đầu tiên.** Hoa nở trong vườn.');
    const v2 = await submit('**Buổi sáng thứ hai.** Có thêm tiếng chim.');
    const endpoint = id => `/api/submissions/${id}/publication`;
    const published = async (actor,id,publication = '') => responseBody(await actor.page.request.get(endpoint(id) + publication));
    const pointer = async id => (await db.query('SELECT current_publication_id FROM garden.submissions WHERE id=$1',[id])).rows[0].current_publication_id;
    const rows = async id => (await db.query(`SELECT p.id,p.revision,o.drive_file_id,o.expected_sha256 FROM garden.review_publications p
      JOIN garden.drive_objects o ON o.id=p.object_id WHERE p.submission_id=$1 ORDER BY p.revision`,[id])).rows;
    const events = async id => (await db.query(`SELECT event_operation_id,user_id FROM garden.notifications
      WHERE target_id=$1 AND event_kind='returned' ORDER BY created_at,id`,[id])).rows;
    const button = name => page.getByRole('button',{ name,exact:true });
    const scores = async (labels,level = 'full') => {
      for (const label of labels) await page.getByRole('combobox',{ name:label,exact:true }).selectOption(level);
    };
    expect(await published(student,v1.id)).toEqual({ publication:null });
    const opened = waitForDraft(page,v1.id,'acquire');
    await page.goto(`/reviews/${v1.id}`);
    const grantResponse = await opened;
    const granted = await responseBody(grantResponse);
    await expect(button('Trả bài')).toBeDisabled();
    const partial = waitForDraft(page,v1.id,'save');
    await scores(criteria.slice(0,4));
    const saved = await responseBody(await partial);
    await expect(button('Trả bài')).toBeDisabled();
    const source = await responseBody(await page.request.get(`/api/submissions/${v1.id}/verify`));
    const invalid = { key:randomUUID(),clientId:grantResponse.request().postDataJSON().clientId,epoch:granted.epoch,
      baseVersion:saved.version,draftHash:saved.hash,basePublication:null,submissionSha256:source.submissionSha256 };
    expect((await responseBody(await post(page,endpoint(v1.id),invalid),422)).error).toBe('RUBRIC_INCOMPLETE');
    expect(await rows(v1.id)).toEqual([]);

    const ready = waitForDraft(page,v1.id,'save');
    await scores(criteria.slice(4));
    await responseBody(await ready);
    await expect(button('Trả bài')).toBeEnabled();
    await expect(page.getByLabel('Nhận xét chung (không bắt buộc)')).toHaveValue('');
    await fake('fault',{ operation:'upload',afterCommit:true,status:504,reason:'backendError' });
    const pending = waitForReturn(page,v1.id);
    await button('Trả bài').click();
    const timed = await pending;
    expect(await responseBody(timed,202)).toEqual({ state:'unknown' });
    const attempt = timed.request().postDataJSON();
    const candidate = async () => (await db.query(`SELECT o.drive_file_id,o.expected_sha256,o.lifecycle,op.state FROM garden.operations op
      JOIN garden.drive_objects o ON o.operation_id=op.id WHERE op.idempotency_key=$1`,[attempt.key])).rows[0];
    const pendingFile = await candidate();
    expect(pendingFile).toMatchObject({ lifecycle:'candidate',state:'unknown' });
    expect((await fake('inspect')).files.find(file => file.id === pendingFile.drive_file_id)).toMatchObject({ name:expect.stringMatching(/^review-pub-.*\.md$/) });
    expect(await pointer(v1.id)).toBeNull();
    expect(await events(v1.id)).toEqual([]);
    expect(await published(student,v1.id)).toEqual({ publication:null });

    const fault = 'fixture_publication_' + tag;
    await db.query(`CREATE FUNCTION garden.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.submission_id='${v1.id}'::uuid THEN RAISE EXCEPTION 'Fixture publication finalization failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${fault} BEFORE INSERT ON garden.review_publications FOR EACH ROW EXECUTE FUNCTION garden.${fault}()`);
    try {
      const failed = waitForReturn(page,v1.id);
      await button('Thử trả lại').click();
      const result = await failed;
      expect(result.request().postDataJSON()).toEqual(attempt);
      await responseBody(result,202);
      expect(await candidate()).toEqual(pendingFile);
      expect(await rows(v1.id)).toEqual([]);
      expect(await events(v1.id)).toEqual([]);
    } finally { await db.query(`DROP TRIGGER ${fault} ON garden.review_publications; DROP FUNCTION garden.${fault}()`); }
    const committed = waitForReturn(page,v1.id);
    await button('Thử trả lại').evaluate(element => { element.click(); element.click(); });
    const final = await committed;
    const first = await responseBody(final);
    expect(final.request().postDataJSON()).toEqual(attempt);
    await expect(page.getByText('Đã trả bài.',{ exact:true })).toBeVisible();
    expect(await responseBody(await post(page,endpoint(v1.id),attempt))).toEqual(first);
    expect(await pointer(v1.id)).toBe(first.id);
    expect(await rows(v1.id)).toEqual([{ id:first.id,revision:1,drive_file_id:pendingFile.drive_file_id,expected_sha256:pendingFile.expected_sha256 }]);
    expect(await events(v1.id)).toEqual([{ event_operation_id:first.id,user_id:student.id }]);
    expect(await pointer(v2.id)).toBeNull();
    const previous = await published(student,v1.id);
    expect(previous).toEqual({ publication:expect.objectContaining({ id:first.id,revision:1,overallCommentId:null,total:2 }) });

    const edited = waitForDraft(page,v1.id,'save');
    await scores(criteria.slice(0,1),'half');
    await page.getByLabel('Nhận xét chung (không bắt buộc)').fill('Góp ý từ lần trả thứ hai.');
    await responseBody(await edited);
    expect(await published(student,v1.id)).toEqual(previous);
    await student.page.goto(`/results/${v1.id}`);
    await expect(student.page.getByRole('heading',{ name:'Kết quả đã trả' })).toBeVisible();
    await expect(student.page.getByText('Góp ý từ lần trả thứ hai.')).toHaveCount(0);
    const republished = waitForReturn(page,v1.id);
    await button('Trả lại bài').click();
    const second = await responseBody(await republished);
    await expect(page.getByText('Đã trả lại bài.',{ exact:true })).toBeVisible();
    const now = await published(student,v1.id);
    expect(now).toEqual({ publication:expect.objectContaining({ id:second.id,revision:2,total:1.8 }) });
    expect(await pointer(v1.id)).toBe(second.id);
    expect(await rows(v1.id)).toHaveLength(2);
    expect(await events(v1.id)).toHaveLength(2);
    await student.page.reload();
    await expect(student.page.getByText('Góp ý từ lần trả thứ hai.')).toBeVisible();
    await expect(student.page.getByRole('heading',{ name:'Lịch sử trả bài' })).toHaveCount(0);
    expect((await student.page.request.get(`${endpoint(v1.id)}?publication=${first.id}`)).status()).toBe(404);
    await student.page.goto(`/results/${v1.id}?publication=${first.id}`);
    await expect(student.page.getByRole('heading',{ name:'404',exact:true })).toBeVisible();
    const inspector = await teacher.newSession();
    await inspector.goto(`/results/${v1.id}`);
    await expect(inspector.getByRole('heading',{ name:'Lịch sử trả bài' })).toBeVisible();
    await inspector.getByRole('link',{ name:'Lần trả 1',exact:true }).click();
    await expect(inspector.getByText('Góp ý từ lần trả thứ hai.')).toHaveCount(0);
    expect((await published(teacher,v1.id,`?publication=${first.id}`)).publication).toEqual(previous.publication);

    const base = await page.request.get(`/api/content/submissions/${v1.id}`).then(response => response.body());
    const { drive_file_id } = (await db.query(`SELECT o.drive_file_id FROM garden.submissions s JOIN garden.drive_objects o
      ON o.id=s.object_id WHERE s.id=$1`,[v1.id])).rows[0];
    await fake('alter',{ id:drive_file_id,base64:Buffer.from(base.toString().replace('Hoa nở','Hoa rơi')).toString('base64') });
    const conflicted = waitForReturn(page,v1.id);
    await button('Trả lại bài').click();
    expect((await responseBody(await conflicted,409)).error).toBe('SUBMISSION_CONFLICT');
    await expect(page.getByRole('region',{ name:'Điểm theo rubric' }).getByRole('alert')).toContainText('Bản nộp đã thay đổi trên Drive');
    expect(await pointer(v1.id)).toBe(second.id);
    expect(await events(v1.id)).toHaveLength(2);
    expect(await rows(v1.id)).toHaveLength(2);

    await page.goto(`/reviews/${v2.id}`);
    await scores(criteria);
    const next = waitForReturn(page,v2.id);
    await button('Trả bài').click();
    const third = await responseBody(await next);
    expect(await pointer(v2.id)).toBe(third.id);
    expect(await events(v2.id)).toHaveLength(1);
    expect((await published(student,v2.id)).publication).toMatchObject({ id:third.id,submissionId:v2.id,revision:1 });
    const finals = (await fake('inspect')).files.filter(file => /^review-pub-/.test(file.name));
    expect(finals).toHaveLength(3);
    expect(finals.every(file => file.mimeType === 'text/markdown')).toBe(true);
  },{ rubric });
});
