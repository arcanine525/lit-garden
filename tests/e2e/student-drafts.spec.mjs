import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { origin } from './auth-fixture.mjs';
import { lastCell, post, responseBody, withStudentWork, writeSource } from './student-work-fixture.mjs';

const table = '| Viết | Tiếng Việt |\n| - | - |\n| Đầu | Ô cuối |';
const waitForSave = (page,path) => page.waitForResponse(response => response.url() === origin + path &&
  response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save',{ timeout:12_000 });
const download = async (page,label) => {
  const received = page.waitForEvent('download');
  await page.getByRole('button',{ name:label,exact:true }).click();
  const file = await received;
  expect(file.suggestedFilename()).toMatch(/\.md$/);
  return readFile(await file.path(),'utf8');
};

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T19 draft leases fence delayed uploads and retain local Unicode edits across reconnect', async ({ browser }) => {
  test.setTimeout(110_000);
  await withStudentWork(browser,async ({ student,teacher,db,fake,publish }) => {
    const assignment = await publish('Bài tập viết trong vườn');
    const other = await publish('Một bài khác');
    const { id,api,draftApi,url } = assignment;
    const a = student.page, b = await student.newSession();
    const lease = (page,action,clientId,epoch) => post(page,draftApi,{ action,clientId,epoch });
    const read = page => page.request.get(draftApi).then(responseBody);
    const first = randomUUID(), second = randomUUID();
    const writer = await responseBody(await lease(a,'acquire',first));
    const renew = await responseBody(await lease(a,'renew',first,writer.epoch));
    expect(renew.epoch).toBe(writer.epoch);
    expect(Date.parse(renew.until)).toBeGreaterThan(Date.parse(writer.until));
    expect((await lease(b,'acquire',second)).status()).toBe(423);
    await db.query(`UPDATE garden.document_streams SET lease_until=now()-interval '1 second' WHERE lease_session_id=$1`,[first]);
    expect((await responseBody(await lease(a,'renew',first,writer.epoch),409)).error).toBe('STALE_WRITER');
    const assigned = await responseBody(await lease(b,'acquire',second));
    expect(BigInt(assigned.epoch)).toBeGreaterThan(BigInt(writer.epoch));
    expect((await lease(a,'release',first,writer.epoch)).status()).toBe(409);
    await responseBody(await lease(b,'release',second,assigned.epoch));

    await a.goto(`/assignments/${id}`);
    await a.getByRole('link',{ name:'Mở nháp bài viết' }).click();
    await expect(a.getByRole('button',{ name:'Ngừng viết ở đây' })).toBeEnabled();
    await writeSource(a,table);
    await a.getByLabel('Giải thích (tùy chọn)').fill('Giải thích đã lưu.');
    await a.getByRole('button',{ name:'Đồng bộ nháp',exact:true }).click();
    await expect(a.getByText('Đã đồng bộ nháp lên Drive.',{ exact:true })).toBeVisible();
    const baseline = await read(a);
    expect(baseline.draft.markdown).toContain('Ô cuối');
    expect(baseline.draft.explanation).toBe('Giải thích đã lưu.');

    await b.goto(url);
    await expect(b.getByText('Nháp đang được viết ở nơi khác.')).toBeVisible();
    await expect(b.getByLabel('Giải thích (tùy chọn)')).toHaveValue('Giải thích đã lưu.');
    await expect(b.getByLabel('Giải thích (tùy chọn)')).toHaveAttribute('readonly','');
    await expect(b.getByRole('cell',{ name:'Ô cuối' })).toBeVisible();
    await b.getByRole('button',{ name:'Tiếp tục viết tại đây' }).click();
    const dialog = b.getByRole('dialog');
    await expect(dialog).toContainText('có thể còn nội dung chưa đồng bộ');

    await a.getByLabel('Giải thích (tùy chọn)').fill('Giải thích chưa đồng bộ của A.');
    const old = lastCell(a);
    await old.click();
    await old.press('End');
    await fake('fault',{ operation:'upload',afterCommit:true,hold:true });
    const oldResponse = waitForSave(a,draftApi);
    await a.keyboard.insertText(' của A tiếng Việt ắ');
    await expect(old).toBeFocused();
    await expect.poll(async () => (await fake('inspect')).holds).toEqual(['upload']);
    await expect(old).toBeFocused();
    expect((await read(b)).draft).toEqual(baseline.draft);

    await dialog.getByRole('button',{ name:'Chuyển quyền viết',exact:true }).click();
    await expect(b.getByRole('button',{ name:'Ngừng viết ở đây' })).toBeEnabled();
    await b.getByLabel('Giải thích (tùy chọn)').fill('Giải thích của B.');
    const current = lastCell(b);
    await current.click();
    await current.press('End');
    const saveB = waitForSave(b,draftApi);
    await b.keyboard.insertText(' của B tiếng Việt ễ');
    const response = await saveB;
    await responseBody(response);
    const request = response.request().postDataJSON();
    expect(request.draft.markdown).toContain('Ô cuối của B tiếng Việt ễ');
    await expect(current).toBeFocused();
    await expect(b.getByText('Đã đồng bộ nháp lên Drive.',{ exact:true })).toBeVisible();
    expect((await read(a)).draft).toEqual(request.draft);
    const head = (await db.query(`SELECT o.drive_file_id,ds.version FROM garden.student_drafts d
      JOIN garden.recipients r ON r.id=d.recipient_id JOIN garden.document_streams ds ON ds.id=d.stream_id
      JOIN garden.drive_objects o ON o.id=ds.head_object_id WHERE r.assignment_id=$1`,[id])).rows[0];
    const drive = await fake('inspect');
    expect(drive.holds).toEqual(['upload']);
    expect(drive.files.find(file => file.id === head.drive_file_id)?.name).toMatch(/^draft-g2-/);

    await fake('release',{ operation:'upload' });
    const late = await oldResponse;
    expect((await responseBody(late,409)).error).toBe('STALE_WRITER');
    expect(late.request().postDataJSON().draft.markdown).toContain('Ô cuối của A tiếng Việt ắ');
    await expect(a.getByText('Quyền viết đã chuyển. Bạn vẫn có thể tải phần chưa đồng bộ.')).toBeVisible();
    const abandoned = await db.query(`SELECT op.state,o.lifecycle FROM garden.operations op JOIN garden.drive_objects o
      ON o.operation_id=op.id WHERE op.idempotency_key=$1`,[late.request().postDataJSON().key]);
    expect(abandoned.rows).toEqual([{ state:'rejected',lifecycle:'orphan' }]);
    expect(await read(a)).toMatchObject({ version:'2',draft:request.draft });
    const oldLease = late.request().postDataJSON();
    const obsolete = await responseBody(await post(a,draftApi,{
      action:'renew',clientId:oldLease.clientId,epoch:oldLease.epoch
    }),409);
    expect(obsolete.error).toBe('STALE_WRITER');
    const third = await student.newSession();
    expect(await read(third)).toMatchObject({ version:'2',draft:request.draft });

    await a.evaluate(() => {
      window.connectionEvents = [];
      for (const name of ['offline','online']) window.addEventListener(name,() => window.connectionEvents.push(name));
    });
    await a.context().setOffline(true);
    const offline = await download(a,'Tải nháp của tôi (.md)');
    expect(offline).toContain('Ô cuối của A tiếng Việt ắ');
    expect(offline).toContain('Giải thích chưa đồng bộ của A.');
    await a.context().setOffline(false);
    await expect.poll(() => a.evaluate(() => window.connectionEvents)).toEqual(['offline','online']);
    expect(await download(a,'Tải nháp của tôi (.md)')).toBe(offline);

    await a.goto(other.url);
    await expect(a.getByRole('button',{ name:'Ngừng viết ở đây' })).toBeEnabled();
    await expect(a.getByRole('button',{ name:'Tải bản lưu trên thiết bị (.md)' })).toHaveCount(0);
    await a.goto(url);
    await expect(a.getByLabel('Giải thích (tùy chọn)')).toHaveValue(request.draft.explanation);
    expect(await download(a,'Tải bản lưu trên thiết bị (.md)')).toBe(offline);
    await expect(a.getByRole('cell',{ name:'Ô cuối của B tiếng Việt ễ' })).toBeVisible();
    await fake('fault',{ operation:'read',status:504,reason:'backendError' });
    await a.reload();
    await expect(a.getByText(/Chưa mở được nháp từ Drive/)).toBeVisible();
    await expect(a.getByRole('cell',{ name:'Ô cuối của B tiếng Việt ễ' })).toBeVisible();
    await expect(a.getByLabel('Giải thích (tùy chọn)')).toHaveValue('Giải thích của B.');
    expect(await download(a,'Tải bản lưu trên thiết bị (.md)')).toBe(offline);

    await teacher.page.goto(`/assignments/${id}`);
    await expect(teacher.page.getByRole('link',{ name:/nháp bài viết/i })).toHaveCount(0);
    await teacher.page.goto(url);
    await expect(teacher.page.getByRole('heading',{ name:'404',exact:true })).toBeVisible();
    await expect(teacher.page.getByRole('region',{ name:'Nháp bài viết' })).toHaveCount(0);
    expect((await teacher.page.request.get(draftApi)).status()).toBe(403);
    expect((await lease(teacher.page,'takeover',randomUUID())).status()).toBe(403);
    const { version } = await responseBody(await teacher.page.request.get(api));
    await responseBody(await post(teacher.page,api,{ action:'close',expectedVersion:version }));
    expect(await read(b)).toMatchObject({ writable:false,draft:request.draft });
    expect((await lease(b,'takeover',randomUUID())).status()).toBe(409);
  });
});
