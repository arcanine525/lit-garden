import { expect, test } from '@playwright/test';
import { origin } from './auth-fixture.mjs';
import { responseBody, withStudentWork, writeSource } from './student-work-fixture.mjs';

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });

test('T21 local focus clock pauses, blooms, stays independent between assignments and is excluded from submissions', async ({ browser }) => {
  test.setTimeout(85_000);
  await withStudentWork(browser,async ({ student,db,publish }) => {
    const first = await publish('Bài tập đồng hồ');
    const second = await publish('Bài tập khác');
    const page = student.page;
    await page.setViewportSize({ width:390,height:844 });
    const now = Date.now();
    await page.clock.install({ time:now });
    const open = page.getByRole('button',{ name:'Bật đồng hồ làm bài',exact:true });
    const hide = page.getByRole('button',{ name:'Ẩn đồng hồ làm bài',exact:true });
    const panel = page.getByRole('region',{ name:'Đồng hồ tập trung',exact:true });
    const time = panel.getByRole('timer',{ name:'Thời gian tập trung' });
    const stage = panel.getByRole('status');
    const goal = panel.getByRole('spinbutton',{ name:'Mốc nở hoa (phút)' });
    const noTimerPayload = [];
    page.on('request',request => {
      if (request.method() === 'POST' && request.url().startsWith(origin + '/api/assignments/')) {
        const body = request.postDataJSON();
        if (['save','submit'].includes(body?.action)) noTimerPayload.push(body);
      }
    });
    const seconds = duration => page.clock.fastForward(duration*1000);

    const navigate = async url => {
      const response = await page.goto(url);
      expect(response?.status(),page.url()).toBe(200);
      // Let the streamed page and its hydration run while the test clock is paused.
      await page.clock.runFor(100);
      await expect(page.getByRole('heading',{ name:'Viết bài',exact:true })).toBeVisible();
    };
    await navigate(first.url);
    await expect(open).toBeEnabled();
    await page.clock.pauseAt(now+10_000);
    await expect(open).toHaveAttribute('aria-expanded','false');
    await expect(panel).toBeHidden();
    await open.focus();
    await open.press('Enter');
    await expect(hide).toBeFocused();
    await expect(time).toHaveText('00:00:00');
    await expect(stage).toHaveText('Mầm');
    await expect(goal).toHaveValue('30');
    const box = await panel.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await goal.fill('1');
    await goal.press('Tab');
    await seconds(21);
    await expect(time).toHaveText('00:00:21');
    await expect(stage).toHaveText('Chồi');
    await panel.getByRole('button',{ name:'Tạm dừng',exact:true }).click();
    await seconds(25);
    await expect(time).toHaveText('00:00:21');
    await panel.getByRole('button',{ name:'Tiếp tục',exact:true }).click();
    await seconds(20);
    await expect(time).toHaveText('00:00:41');
    await expect(stage).toHaveText('Nụ');
    await hide.click();
    await expect(panel).toBeHidden();
    await seconds(33);
    await open.click();
    await expect(time).toHaveText('00:01:14');
    await expect(stage).toHaveText('Hoa');
    await expect(goal).toHaveValue('1');
    await seconds(35);
    await expect(stage).toHaveText('Hoa');
    await expect(time).toHaveText('00:01:49');

    await navigate(second.url);
    await expect(panel).toBeHidden();
    await open.click();
    await expect(goal).toHaveValue('30');
    await expect(time).toHaveText('00:00:00');
    await seconds(4);
    await expect(time).toHaveText('00:00:04');
    await navigate(first.url);
    await expect(panel).toBeVisible();
    await expect(goal).toHaveValue('1');
    await expect(time).toHaveText('00:01:53');
    expect(noTimerPayload).toEqual([]);

    await goal.fill('241');
    await goal.press('Tab');
    await expect(goal).toHaveValue('240');
    await goal.fill('-1');
    await goal.press('Tab');
    await expect(goal).toHaveValue('1');
    await panel.getByRole('button',{ name:'Đặt lại',exact:true }).click();
    await hide.click();
    await seconds(7);
    await open.click();
    await expect(time).toHaveText('00:00:00');
    await expect(stage).toHaveText('Mầm');
    await panel.getByRole('button',{ name:'Bắt đầu',exact:true }).click();
    await seconds(8);
    await expect(time).toHaveText('00:00:08');

    const takeover = page.getByRole('button',{ name:'Tiếp tục viết tại đây',exact:true });
    await expect(takeover).toBeVisible();
    await takeover.click();
    await page.getByRole('dialog').getByRole('button',{ name:'Chuyển quyền viết',exact:true }).click();
    await writeSource(page,'Bài viết cạnh đồng hồ.');
    const submit = page.waitForResponse(response => response.url() === origin + first.api + '/submissions' &&
      response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'submit');
    await page.getByRole('button',{ name:'Nộp bài',exact:true }).click();
    const { id } = await responseBody(await submit);
    expect(noTimerPayload).toEqual([{ action:'submit',key:expect.any(String),clientId:expect.any(String),epoch:expect.any(String),
      baseVersion:'0',draft:{ markdown:'Bài viết cạnh đồng hồ.',explanation:'' } }]);
    await seconds(20);
    await expect(time).toHaveText('00:00:08');
    await expect(panel.getByRole('button',{ name:'Tiếp tục',exact:true })).toBeVisible();
    const file = await page.request.get('/api/content/submissions/' + id);
    expect(file.status()).toBe(200);
    const envelope = /^---\ngarden: ([^\n]+)\n---\n/.exec(await file.text());
    expect(Object.keys(JSON.parse(envelope[1])).sort()).toEqual(['acceptedAt','assignmentId','explanation','id','recipientId','schema']);
    const { rows:[row] } = await db.query('SELECT to_jsonb(submissions) AS metadata FROM garden.submissions WHERE id=$1',[id]);
    expect(Object.keys(row.metadata)).toEqual(expect.arrayContaining(['submission_no','submitted_at']));
    expect(Object.keys(row.metadata).some(key => /clock|elapsed|duration|focus/.test(key))).toBe(false);
  });
});
