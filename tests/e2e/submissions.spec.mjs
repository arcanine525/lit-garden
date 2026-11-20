import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { lastCell, post, responseBody, withStudentWork, writeSource } from './student-work-fixture.mjs';

async function unusedPort() {
  const socket = createServer().listen(0,'127.0.0.1');
  await once(socket,'listening');
  const port = socket.address().port;
  await new Promise((success,reject) => socket.close(error => error ? reject(error) : success()));
  return port;
}

async function restartableApp(port) {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
    stdio:'ignore',env:{ ...process.env,APP_ORIGIN:origin,NEXT_TELEMETRY_DISABLED:'1' }
  });
  const exit = once(child,'exit');
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exit;
  }
  try {
    await expect.poll(() => fetch(origin + '/api/health').then(response => response.status,() => 0),{ timeout:15_000 }).toBe(200);
    return { origin, pid:child.pid, stop };
  } catch (error) { await stop(); throw error; }
}

async function status(page, path, action) {
  return page.waitForResponse(response => response.url() === path && response.request().method() === 'POST' &&
    response.request().postDataJSON()?.action === action,{ timeout:14_000 });
}

const table = '| Viết | Tiếng Việt |\n| - | - |\n| Đầu | Ô cuối |';
test.use({ actionTimeout:10_000,navigationTimeout:15_000 });

test('T20 explicit submissions retain one immutable version across Drive, DB and process failures', async ({ browser }) => {
  test.setTimeout(115_000);
  await withStudentWork(browser,async ({ student,teacher,db,fake,publish,tag }) => {
    const page = student.page;
    const port = await unusedPort();
    let app = await restartableApp(port);
    let trigger = false;
    const faultName = 'fixture_submission_' + tag;
    async function dropFault() {
      if (!trigger) return;
      await db.query(`DROP TRIGGER ${faultName} ON garden.submissions; DROP FUNCTION garden.${faultName}()`);
      trigger = false;
    }

    try {
      const due = (await db.query("SELECT clock_timestamp()+interval '14 seconds' AS value")).rows[0].value;
      const assignment = await publish('Hai lần tập viết',due.toISOString());
      const api = assignment.api + '/submissions';
      const path = app.origin + api;
      const writes = [];
      page.on('request',request => {
        if (request.url() === path && request.method() === 'POST' && request.postDataJSON()?.action === 'submit') writes.push(request.postDataJSON());
      });
      const history = () => page.request.get(path).then(responseBody).then(value => value.submissions);
      const file = id => page.request.get(`${app.origin}/api/content/submissions/${id}`);
      const pins = async () => (await db.query(`SELECT op.id,op.state,op.accepted_at,o.drive_file_id,o.expected_sha256,o.lifecycle
        FROM garden.operations op JOIN garden.recipients r ON r.id=op.target_id JOIN garden.drive_objects o ON o.operation_id=op.id
        WHERE r.assignment_id=$1 AND op.kind='submit' ORDER BY op.accepted_at`,[assignment.id])).rows;
      const active = (await db.query('SELECT id FROM garden.recipients WHERE assignment_id=$1 AND student_id=$2',[assignment.id,student.id])).rows[0].id;

      await page.goto(app.origin + assignment.url);
      await expect(page.getByRole('button',{ name:'Nộp bài',exact:true })).toBeEnabled();
      await writeSource(page,table);
      await page.getByLabel('Giải thích (tùy chọn)').fill('Giải thích phiên bản một.');
      await expect(page.getByText('Đã đồng bộ nháp lên Drive.',{ exact:true })).toBeVisible();
      expect(writes).toHaveLength(0);
      expect(await history()).toEqual([]);

      const firstResponse = status(page,path,'submit');
      await page.getByRole('button',{ name:'Nộp bài',exact:true }).evaluate(button => { button.click(); button.click(); });
      const first = await responseBody(await firstResponse);
      expect(writes).toHaveLength(1);
      await expect(page.getByText('Đã nộp bài.',{ exact:true })).toBeVisible();
      const firstBytes = await (await file(first.id)).text();
      expect(firstBytes).toContain('Giải thích phiên bản một.');
      expect((await history()).map(item => [item.id,item.number,item.late])).toEqual([[first.id,1,false]]);
      const firstPin = (await pins())[0];
      const replay = await responseBody(await page.request.post(path,{ data:writes[0],headers:{ Origin:app.origin } }));
      expect(replay).toEqual(first);
      const wrong = await responseBody(await page.request.post(path,{ data:{ ...writes[0],draft:{ markdown:'Khác',explanation:'' } },
        headers:{ Origin:app.origin } }),409);
      expect(wrong.error).toBe('KEY_REUSED');

      const review = randomUUID();
      await db.query("INSERT INTO garden.document_streams(id,teacher_id,kind) VALUES($1,$2,'review')",[review,teacher.id]);
      await db.query('INSERT INTO garden.review_drafts(submission_id,teacher_id,stream_id) VALUES($1,$2,$3)',[first.id,teacher.id,review]);
      await expect.poll(async () => (await db.query('SELECT clock_timestamp() > $1 AS late',[due])).rows[0].late,{ timeout:22_000 }).toBe(true);

      await fake('fault',{ operation:'upload',status:504,reason:'backendError',afterCommit:true });
      await page.getByLabel('Giải thích (tùy chọn)').fill('Giải thích phiên bản hai.');
      const end = lastCell(page);
      await end.click();
      await end.press('End');
      await page.keyboard.insertText(' thêm tiếng Việt cuối ắ');
      await expect(end).toBeFocused();
      const pending = status(page,path,'submit');
      await page.getByRole('button',{ name:'Nộp bản mới',exact:true }).click();
      const firstFault = await pending;
      expect(await responseBody(firstFault,202)).toEqual({ state:'unknown' });
      await expect(end).toBeFocused();
      const intent = firstFault.request().postDataJSON();
      expect(intent.draft.markdown).toContain('Ô cuối thêm tiếng Việt cuối ắ');
      expect(intent.draft.explanation).toBe('Giải thích phiên bản hai.');
      expect(writes).toHaveLength(2);
      await expect(page.getByText('Chưa xác nhận đã nộp.',{ exact:false })).toBeVisible();
      expect((await history()).map(item => item.id)).toEqual([first.id]);
      const pendingPin = (await pins())[1];
      expect(pendingPin).toMatchObject({ state:'unknown',lifecycle:'candidate' });
      expect((await fake('inspect')).files.filter(item => item.id === pendingPin.drive_file_id)).toHaveLength(1);

      await db.query(`CREATE FUNCTION garden.${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.recipient_id='${active}'::uuid AND NEW.submission_no=2 THEN RAISE EXCEPTION 'Fixture submission final commit failure'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER ${faultName} BEFORE INSERT ON garden.submissions FOR EACH ROW EXECUTE FUNCTION garden.${faultName}()`);
      trigger = true;
      const dbFailure = status(page,path,'submit');
      await page.getByRole('button',{ name:'Thử nộp lại',exact:true }).click();
      expect(await responseBody(await dbFailure,202)).toEqual({ state:'unknown' });
      expect((await pins())[1]).toEqual(pendingPin);
      expect((await history()).map(item => item.id)).toEqual([first.id]);
      expect((await db.query('SELECT next_submission_no FROM garden.recipients WHERE id=$1',[active])).rows[0].next_submission_no).toBe(2);
      await dropFault();

      const beforeRestart = app.pid;
      await app.stop();
      app = await restartableApp(port);
      expect(app.pid).not.toBe(beforeRestart);
      await page.reload();
      await expect(page.getByRole('button',{ name:'Thử nộp lại',exact:true })).toBeEnabled();
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button',{ name:'Tải lần nộp đang chờ (.md)',exact:true }).click();
      const local = await readFile(await (await downloaded).path(),'utf8');
      expect(local).toContain(intent.draft.markdown);
      expect(local).toContain(intent.draft.explanation);
      expect(writes).toEqual([writes[0],intent,intent]);
      await page.evaluate(() => window.addEventListener('online',() => { window.reconnected = true; }));
      await page.context().setOffline(true);
      await page.context().setOffline(false);
      await expect.poll(() => page.evaluate(() => window.reconnected)).toBe(true);
      expect((await history()).map(item => item.id)).toEqual([first.id]);
      expect(writes).toHaveLength(3);

      let lost;
      const drop = async route => {
        if (route.request().method() !== 'POST' || route.request().postDataJSON()?.action !== 'submit') return route.continue();
        lost = await route.fetch();
        await route.abort('failed');
      };
      await page.route(path,drop);
      await page.getByRole('button',{ name:'Thử nộp lại',exact:true }).click();
      await expect.poll(() => lost?.status()).toBe(200);
      await expect(page.getByText('Chưa xác nhận đã nộp.',{ exact:false })).toBeVisible();
      await page.unroute(path,drop);
      const recovered = status(page,path,'submit');
      await page.getByRole('button',{ name:'Thử nộp lại',exact:true }).click();
      const second = await responseBody(await recovered);
      await expect(page.getByText('Đã nộp bài.',{ exact:true })).toBeVisible();
      expect(writes.slice(1)).toEqual([intent,intent,intent,intent]);
      expect(second.id).toBe(pendingPin.id);
      const savedPins = await pins();
      expect(savedPins).toEqual([firstPin,{ ...pendingPin,state:'committed',lifecycle:'referenced' }]);
      const files = (await fake('inspect')).files.filter(item => item.name.startsWith('submission-'));
      expect(files.map(item => item.id).sort()).toEqual([firstPin.drive_file_id,pendingPin.drive_file_id].sort());
      expect((await (await file(first.id)).text())).toBe(firstBytes);
      const read = await file(second.id);
      expect(read.status()).toBe(200);
      const bytes = await read.text();
      const [,metadata,markdown] = /^---\ngarden: ([^\n]+)\n---\n([\s\S]*)$/.exec(bytes);
      expect(markdown).toBe(intent.draft.markdown);
      expect(JSON.parse(metadata)).toMatchObject({ schema:'garden.submission/1',id:second.id,
        explanation:intent.draft.explanation,acceptedAt:pendingPin.accepted_at.toISOString() });
      expect((await db.query('SELECT stream_id FROM garden.review_drafts WHERE submission_id=$1',[first.id])).rows[0].stream_id).toBe(review);
      const times = await history();
      expect(times.map(item => [item.id,item.number,item.late])).toEqual([[first.id,1,false],[second.id,2,true]]);
      expect(times[1].submittedAt).toBe(pendingPin.accepted_at.toISOString());
      await expect(page.getByRole('listitem').filter({ hasText:'Lần nộp 2' })).toContainText('Nộp muộn');
      const detail = await responseBody(await teacher.page.request.get(assignment.api));
      await responseBody(await post(teacher.page,assignment.api,{ action:'extend_deadline',key:randomUUID(),expectedVersion:detail.version,
        dueAt:new Date(due.getTime()+3_600_000).toISOString() }));
      expect(await history()).toEqual(times.map(item => ({ ...item,late:false })));
      await page.reload();
      await expect(page.getByRole('link',{ name:'Lần nộp 2' })).toBeVisible();
      await expect(page.getByRole('listitem').filter({ hasText:/Lần nộp/ }).filter({ hasText:'Nộp muộn' })).toHaveCount(0);

      const clientId = randomUUID();
      const grant = await responseBody(await page.request.post(app.origin + assignment.draftApi,{
        data:{ action:'takeover',clientId },headers:{ Origin:app.origin } }));
      const stale = { action:'submit',key:randomUUID(),clientId,epoch:grant.epoch,baseVersion:grant.version,
        draft:{ markdown:'Lần không được nộp.',explanation:'' } };
      await fake('fault',{ operation:'upload',afterCommit:true,hold:true });
      const delayed = page.request.post(path,{ data:stale,headers:{ Origin:app.origin } });
      await expect.poll(async () => (await fake('inspect')).holds).toEqual(['upload']);
      await responseBody(await post(teacher.page,'/api/classes',{ action:'archive_class',classId:detail.classId }));
      await responseBody(await post(teacher.page,'/api/classes',{ action:'restore_class',classId:detail.classId }));
      await fake('release',{ operation:'upload' });
      expect((await responseBody(await delayed,409)).error).toBe('SUBMISSION_REJECTED');
      expect((await pins()).at(-1)).toMatchObject({ state:'rejected',lifecycle:'orphan' });
      expect(await history()).toEqual(times.map(item => ({ ...item,late:false })));
    } finally {
      await dropFault();
      await app.stop();
    }
  });
});
