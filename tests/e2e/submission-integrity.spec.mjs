import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { post, responseBody, withStudentWork } from './student-work-fixture.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T23 same-session verification detects changed bytes and freezes only the affected submission', async ({ browser }) => {
  test.setTimeout(85_000);
  await withStudentWork(browser,async ({ student,teacher,admin,db,fake,publish }) => {
    const assignment = await publish('Đối chiếu hai bản nộp');
    const clientId = randomUUID();
    const lease = await responseBody(await post(student.page,assignment.draftApi,{ action:'acquire',clientId }));
    const submit = async (markdown,explanation) => responseBody(await post(student.page,assignment.api + '/submissions',{
      action:'submit',key:randomUUID(),clientId,epoch:lease.epoch,baseVersion:lease.version,draft:{ markdown,explanation }
    }));
    const v1 = await submit('Văn bản gốc tiếng Việt, lần một.','Ký hiệu A trong giải thích.');
    const v2 = await submit('Văn bản tiếng Việt, lần hai.','Bổ sung dẫn chứng.');
    const verify = (id,page = teacher.page) => page.request.get(`/api/submissions/${id}/verify`);
    const read = id => teacher.page.request.get(`/api/content/submissions/${id}`);
    const status = async id => (await db.query(`SELECT o.drive_file_id,o.integrity,o.expected_sha256,o.verified_drive_version,o.byte_size,
      garden.can_review_submission($2,s.id) AS review FROM garden.submissions s
      JOIN garden.drive_objects o ON o.id=s.object_id WHERE s.id=$1`,[id,teacher.id])).rows[0];
    const checked = await read(v1.id);
    expect(checked.status()).toBe(200);
    expect(checked.headers()['cache-control']).toBe('no-store');
    const original = await checked.body();
    const before = await status(v1.id);
    expect(before).toMatchObject({ integrity:'ok',expected_sha256:hash(original),review:true });
    expect(await responseBody(await verify(v1.id))).toEqual({ verified:true,submissionSha256:hash(original) });
    for (const actor of [student,admin]) expect((await verify(v1.id,actor.page)).status()).toBe(404);

    const changed = Buffer.from(original.toString('utf8').replace('Ký hiệu A','Ký hiệu B'));
    expect(changed.length).toBe(original.length);
    expect(hash(changed)).not.toBe(hash(original));
    expect(changed.toString().split('\n---\n')[1]).toBe(original.toString().split('\n---\n')[1]);
    await fake('alter',{ id:before.drive_file_id,base64:changed.toString('base64') });
    expect((await responseBody(await verify(v1.id),409)).error).toBe('SUBMISSION_CONFLICT');
    expect((await read(v1.id)).status()).toBe(409);
    expect(await status(v1.id)).toEqual({ ...before,integrity:'conflict',review:false });
    expect(await responseBody(await verify(v2.id))).toMatchObject({ verified:true });
    expect(await status(v2.id)).toMatchObject({ integrity:'ok',review:true });

    const second = await status(v2.id);
    await fake('alter',{ id:second.drive_file_id,patch:{ name:'renamed-without-content-change.md',version:'2' } });
    expect(await responseBody(await verify(v2.id))).toEqual({ verified:true,submissionSha256:second.expected_sha256 });
    expect(await status(v2.id)).toEqual({ ...second,verified_drive_version:'2' });
    await fake('alter',{ id:before.drive_file_id,patch:{ trashed:true } });
    expect((await responseBody(await verify(v1.id),404)).error).toBe('SUBMISSION_MISSING');
    expect(await status(v1.id)).toMatchObject({ integrity:'missing',expected_sha256:hash(original),review:false });
    await fake('alter',{ id:before.drive_file_id,patch:{ trashed:false } });
    for (const [code,reason] of [[403,'insufficientFilePermissions'],[404,'notFound']]) {
      await fake('fault',{ operation:'read',status:code,reason });
      expect((await responseBody(await verify(v1.id),503)).error).toBe('SUBMISSION_UNAVAILABLE');
      expect(await status(v1.id)).toMatchObject({ integrity:'unavailable',expected_sha256:hash(original),review:false });
    }
    expect(await responseBody(await verify(v2.id))).toMatchObject({ verified:true });
    await fake('alter',{ id:before.drive_file_id,base64:original.toString('base64') });
    expect(await responseBody(await verify(v1.id))).toEqual({ verified:true,submissionSha256:hash(original) });
    expect(await status(v1.id)).toEqual(before);
    const { rows } = await db.query(`SELECT target_id,outcome FROM garden.audit_events WHERE action_code='INTEGRITY'
      AND target_id IN ($1,$2) ORDER BY id`,[v1.id,v2.id]);
    expect(rows).toEqual(['failure','failure','unknown','success'].map(outcome => ({ target_id:v1.id,outcome })));
  });
});
