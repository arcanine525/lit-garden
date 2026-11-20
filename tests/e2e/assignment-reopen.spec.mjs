import { randomInt, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { origin } from './auth-fixture.mjs';
import { post, responseBody, withStudentWork } from './student-work-fixture.mjs';

// Hold the first transaction after it has locked the teacher and class. Start
// the second request and verify PostgreSQL says it is blocked by the first.
async function overlap(db,name,table,event,predicate,first,second) {
  const guard = await db.connect();
  const key = randomInt(100_000_000,2_000_000_000);
  const pending = [];
  let installed = false;
  const waiting = `SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=$1 AND objsubid=1 AND NOT granted`;
  try {
    await guard.query('SELECT pg_advisory_lock($1)',[key]);
    await db.query(`CREATE FUNCTION garden.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF ${predicate} THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${name} BEFORE ${event} ON garden.${table} FOR EACH ROW EXECUTE FUNCTION garden.${name}()`);
    installed = true;
    pending.push(first());
    await expect.poll(async () => (await db.query(waiting,[key])).rowCount).toBe(1);
    pending.push(second());
    await expect.poll(async () => (await db.query(`SELECT EXISTS (
      SELECT 1 FROM (${waiting}) first_waiter JOIN pg_stat_activity activity
        ON first_waiter.pid=ANY(pg_blocking_pids(activity.pid))
    ) AS queued`,[key])).rows[0].queued).toBe(true);
    await guard.query('SELECT pg_advisory_unlock($1)',[key]);
    for (const response of await Promise.all(pending)) await responseBody(response);
  } finally {
    try {
      await guard.query('SELECT pg_advisory_unlock($1)',[key]);
      await Promise.allSettled(pending);
      if (installed) await db.query(`DROP TRIGGER ${name} ON garden.${table}; DROP FUNCTION garden.${name}()`);
    } finally { guard.release(); }
  }
}

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T22 reopening grants exactly one recipient and event for each eligible student across roster races', async ({ browser }) => {
  test.setTimeout(145_000);
  await withStudentWork(browser,async ({ student,teacher,admin,db,tag,publish,classroom,provision }) => {
    const { classId } = classroom;
    const classes = data => post(teacher.page,'/api/classes',data);
    const assignment = (actor,target) => actor.page.request.get(target.api).then(responseBody);
    const change = (target,action,expectedVersion) => post(teacher.page,target.api,{ action,expectedVersion });
    const closed = async target => responseBody(await change(target,'close',(await assignment(teacher,target)).version));
    const state = async target => (await db.query('SELECT accepting,version FROM garden.assignments WHERE id=$1',[target.id])).rows[0];
    const membership = (actor,action) => classes({ action,classId,studentId:actor.id });
    async function requestJoin(actor,room = classroom) {
      await responseBody(await post(actor.page,'/api/classes',{ action:'join',code:room.joinCode }));
      const { requests } = await responseBody(await teacher.page.request.get('/api/classes'));
      return requests.find(request => request.username === actor.username && request.class_id === room.classId).id;
    }
    const approve = requestId => classes({ action:'approve',requestId });
    const grants = async (target,actor) => (await db.query(`SELECT id,assigned_at,next_submission_no FROM garden.recipients
      WHERE assignment_id=$1 AND student_id=$2`,[target.id,actor.id])).rows;
    const events = async (target,actor) => (await db.query(`SELECT id,event_operation_id FROM garden.notifications
      WHERE event_kind='assigned' AND user_id=$2 AND target_id=$1`,[target.id,actor.id])).rows;
    async function counts(target,actor,count) {
      expect(await grants(target,actor)).toHaveLength(count);
      expect(await events(target,actor)).toHaveLength(count);
    }

    const dueAt = '2026-01-01T00:00:00.000Z';
    const core = await publish('Mở lại và giao bổ sung ' + tag,dueAt,'Nội dung tham chiếu.');
    const clientId = randomUUID();
    const writer = await responseBody(await post(student.page,core.draftApi,{ action:'acquire',clientId }));
    await responseBody(await post(student.page,core.api + '/submissions',{ action:'submit',key:randomUUID(),clientId,
      epoch:writer.epoch,baseVersion:writer.version,draft:{ markdown:'Bản nộp trước khi đóng.',explanation:'' } }));
    const before = { recipients:await grants(core,student),notices:await events(core,student),history:(await assignment(student,core)).timings };
    expect(before.history).toHaveLength(1);
    const initial = await closed(core);
    const approved = await provision('student','reopen_approved');
    await responseBody(await approve(await requestJoin(approved)));
    const unapproved = await provision('student','reopen_pending');
    await requestJoin(unapproved);
    const removed = await provision('student','reopen_removed');
    await responseBody(await approve(await requestJoin(removed)));
    await responseBody(await membership(removed,'remove_student'));
    const anotherClass = await responseBody(await classes({ action:'save_class',name:'Lớp khác ' + tag,year:'2026–2027' }),201);
    const outsider = await provision('student','reopen_outsider');
    await responseBody(await approve(await requestJoin(outsider,anotherClass)));
    const newStudents = [approved,unapproved,removed,outsider];
    for (const actor of newStudents) await counts(core,actor,0);

    const fault = 'fixture_reopen_reject_' + tag;
    await db.query(`CREATE FUNCTION garden.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.target_id='${core.id}'::uuid AND NEW.event_kind='assigned' THEN RAISE EXCEPTION 'Fixture event failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${fault} BEFORE INSERT ON garden.notifications FOR EACH ROW EXECUTE FUNCTION garden.${fault}()`);
    try {
      expect((await change(core,'reopen',initial.version)).status()).toBe(503);
      expect(await state(core)).toEqual(initial);
      await counts(core,approved,0);
    } finally { await db.query(`DROP TRIGGER ${fault} ON garden.notifications; DROP FUNCTION garden.${fault}()`); }

    const page = teacher.page;
    await page.goto(`/assignments/${core.id}`);
    await page.getByRole('button',{ name:'Mở lại bài',exact:true }).click();
    const dialog = page.getByRole('dialog',{ name:'Mở lại bài này?' });
    await expect(dialog).toContainText('giao bổ sung cho học sinh đang thuộc lớp và chưa nhận bài này');
    await expect(dialog).toContainText('Mỗi em sẽ nhận một thông báo bài mới.');
    const confirm = dialog.getByRole('button',{ name:'Mở lại và giao bổ sung' });
    const path = origin + core.api;
    const reopenRequests = [];
    page.on('request',request => {
      if (request.url() === path && request.method() === 'POST' && request.postDataJSON()?.action === 'reopen') {
        reopenRequests.push(request.postDataJSON());
      }
    });
    let lost;
    const drop = async route => {
      if (route.request().method() !== 'POST') return route.continue();
      lost = await route.fetch();
      await route.abort('failed');
    };
    await page.route(path,drop);
    await confirm.click();
    await expect(dialog.getByRole('alert')).toHaveText('Chưa xác nhận được thay đổi. Hãy thử lại.');
    expect(lost.status()).toBe(200);
    const granted = await grants(core,approved);
    const notified = await events(core,approved);
    await counts(core,approved,1);
    await page.unroute(path,drop);
    await confirm.click();
    await expect(page.getByText('Đã mở lại bài.',{ exact:true })).toBeVisible();
    expect(reopenRequests).toEqual(Array(2).fill({ action:'reopen',expectedVersion:initial.version }));
    expect(await grants(core,approved)).toEqual(granted);
    expect(await events(core,approved)).toEqual(notified);
    expect(await grants(core,student)).toEqual(before.recipients);
    expect(await events(core,student)).toEqual(before.notices);
    expect((await assignment(student,core)).timings).toEqual(before.history);
    expect(await assignment(approved,core)).toMatchObject({ accepting:true,dueAt });
    for (const actor of [unapproved,removed,outsider]) {
      await counts(core,actor,0);
      expect((await actor.page.request.get(core.api)).status()).toBe(404);
    }

    for (const [index,[transition,reopenFirst]] of [
      ['approve',false],['approve',true],['readmit_student',false],['readmit_student',true],['remove_student',false],['remove_student',true]
    ].entries()) {
      const target = await publish('Thứ tự giao ' + index);
      const seal = await closed(target);
      const learner = await provision('student','race_' + index);
      const request = await requestJoin(learner);
      if (transition !== 'approve') await responseBody(await approve(request));
      if (transition === 'readmit_student') await responseBody(await membership(learner,'remove_student'));
      await counts(target,learner,0);
      const reopen = () => change(target,'reopen',seal.version);
      const roster = () => transition === 'approve' ? approve(request) : membership(learner,transition);
      const gate = 'fixture_reopen_' + tag + '_' + index;
      if (reopenFirst) await overlap(db,gate,'assignments','UPDATE',`NEW.id='${target.id}'::uuid AND NEW.accepting`,reopen,roster);
      else await overlap(db,gate,'memberships','INSERT OR UPDATE',`NEW.class_id='${classId}'::uuid AND NEW.student_id='${learner.id}'::uuid`,roster,reopen);
      expect(await state(target)).toMatchObject({ accepting:true });
      await counts(target,learner,transition === 'remove_student' && !reopenFirst ? 0 : 1);
      const access = await learner.page.request.get(target.api);
      expect(access.status()).toBe(transition === 'remove_student' ? 404 : 200);
      if (transition === 'remove_student') expect((await learner.page.request.get(target.draftApi)).status()).toBe(404);
    }

    const archive = await closed(core);
    await responseBody(await classes({ action:'archive_class',classId }));
    expect((await responseBody(await change(core,'reopen',archive.version),409)).error).toBe('CLASS_INACTIVE');
    await responseBody(await classes({ action:'restore_class',classId }));
    const disclosure = await responseBody(await change(core,'publish_reference',archive.version));
    expect((await responseBody(await change(core,'reopen',disclosure.version),409)).error).toBe('REFERENCE_ALREADY_PUBLIC');
    const remaining = await publish('Khóa giáo viên');
    const seal = await closed(remaining);
    await responseBody(await post(admin.page,'/api/admin/accounts',{ kind:'suspend_teacher',userId:teacher.id,key:randomUUID() }));
    expect((await change(remaining,'reopen',seal.version)).status()).toBe(401);
    expect(await state(remaining)).toEqual(seal);
  });
});
