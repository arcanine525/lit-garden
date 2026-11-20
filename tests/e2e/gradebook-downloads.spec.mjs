import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { expect, test } from '@playwright/test';
import { origin } from './auth-fixture.mjs';
import { post, responseBody, withStudentWork } from './student-work-fixture.mjs';

const rubric = { criteria:[{ id:'idea',label:'Ý tưởng',levels:[
  { id:'full',score:'4',description:'Đạt đầy đủ.' },{ id:'partial',score:'1.01',description:'Cần phát triển thêm.' }
] }] };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function download(page,role,label) {
  const result = page.waitForEvent('download',{ timeout:12_000 });
  await page.getByRole(role,{ name:label,exact:true }).click();
  const file = await result;
  return { name:file.suggestedFilename(),bytes:await readFile(await file.path()) };
}

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T31 exports scoped grade rows and byte-verified Markdown files', async ({ browser }) => {
  test.setTimeout(110_000);
  await withStudentWork(browser,async ({ student,teacher,admin,db,fake,publish,classroom,provision }) => {
    const title = '=Mưa, "nắng" và vườn';
    const owner = teacher.page, writer = student.page;
    const assignment = await publish(title);
    const guest = await provision('teacher','grades_other');
    const peer = await provision('student','grades_peer');
    await responseBody(await post(peer.page,'/api/classes',{ action:'join',code:classroom.joinCode }));
    const { requests } = await responseBody(await owner.request.get('/api/classes'));
    await responseBody(await post(owner,'/api/classes',{ action:'approve',requestId:requests.find(row => row.username === peer.username).id }));
    const { rubric:snapshot } = await responseBody(await owner.request.get(assignment.api));
    expect(snapshot).toMatchObject({ scale:'2.00',max:'4.00',revision:1 });
    await responseBody(await post(admin.page,'/api/rubrics',{ id:snapshot.id,action:'revise',expectedRevision:1,
      label:'Rubric mới',definition:{ criteria:[{ ...rubric.criteria[0],levels:[
        { id:'full',score:'10',description:'Mức điểm mới.' },rubric.criteria[0].levels[1]
      ] }] }
    }));

    const clientId = randomUUID();
    const lease = await responseBody(await post(writer,assignment.draftApi,{ action:'acquire',clientId }));
    const submit = async markdown => responseBody(await post(writer,assignment.api + '/submissions',{
      action:'submit',key:randomUUID(),clientId,epoch:lease.epoch,baseVersion:lease.version,draft:{ markdown,explanation:'' }
    }));
    const essay = '# Vườn Việt\n\nGió thổi ngang hàng cây.';
    const v1 = await submit(essay);
    const v2 = await submit('Bản sau có đoạn kết.');
    const draft = { markdown:'**Bản nháp mới** có dấu.',explanation:'Em thêm một chi tiết.' };
    await responseBody(await post(writer,assignment.draftApi,{ action:'save',key:randomUUID(),clientId,epoch:lease.epoch,
      baseVersion:lease.version,draft }));
    const draftUrl = assignment.draftApi + '?download=1';
    const sourceUrl = `/api/content/submissions/${v1.id}?download=1`;
    const downloadReview = `/api/submissions/${v1.id}/publication/download`;

    const editClient = randomUUID();
    const review = `/api/submissions/${v1.id}/review`;
    const publication = `/api/submissions/${v1.id}/publication`;
    const { epoch } = await responseBody(await post(owner,review,{ action:'acquire',clientId:editClient }));
    const { submissionSha256 } = await responseBody(await owner.request.get(`/api/submissions/${v1.id}/verify`));
    const comment = randomUUID();
    async function save(baseVersion,level,value,body) {
      return responseBody(await post(owner,review,{ action:'save',key:randomUUID(),clientId:editClient,epoch,baseVersion,
        draft:{ scores:[{ criterionId:'idea',levelId:level,value }],overallCommentId:comment,
          comments:[{ id:comment,kind:'overall',body }] }
      }));
    }
    async function publishSaved(saved,basePublication) {
      return responseBody(await post(owner,publication,{ key:randomUUID(),clientId:editClient,epoch,baseVersion:saved.version,
        basePublication,draftHash:saved.hash,submissionSha256 }));
    }
    const saved = await save('0','full','4.00','Nhận xét ở lần trả cũ.');
    expect((await writer.request.get(review)).status()).toBe(403);
    expect((await writer.request.get(downloadReview)).status()).toBe(404);
    const first = await publishSaved(saved,null);
    const currentDraft = await save(saved.version,'partial','1.01','Nhận xét hiện hành.');
    const firstUrl = downloadReview + '?publication=' + first.id;
    const firstBytes = await (await writer.request.get(firstUrl)).text();
    expect(firstBytes).toContain('Nhận xét ở lần trả cũ.');
    expect(firstBytes).not.toContain('Nhận xét hiện hành.');
    const second = await publishSaved(currentDraft,first.id);
    const currentUrl = downloadReview + '?publication=' + second.id;

    const csvUrl = '/api/reviews/grades';
    const csv = await owner.request.get(csvUrl + '?assignment=' + assignment.id);
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-disposition']).toBe('attachment; filename="bang-diem.csv"');
    expect(csv.headers()['cache-control']).toBe('no-store');
    const csvText = await csv.text();
    expect(csvText.startsWith('\uFEFF')).toBe(true);
    expect(csvText).toContain('"' + "'" + '=Mưa, ""nắng"" và vườn"');
    const rows = parse(csvText,{ bom:true,columns:true });
    expect(rows).toEqual([
      expect.objectContaining({ 'Bài giao':"'" + title,'Lần nộp':'1','Điểm':'0.51','Thang điểm':'2.00','Trạng thái':'Đã trả' }),
      expect.objectContaining({ 'Bài giao':"'" + title,'Lần nộp':'2','Điểm':'','Thang điểm':'2.00','Trạng thái':'Chờ chấm' })
    ]);
    expect(csvText).not.toContain('tập trung');
    expect(parse(await (await guest.page.request.get(csvUrl)).text(),{ bom:true,columns:true })).toEqual([]);
    expect((await guest.page.request.get(csvUrl + '?assignment=' + assignment.id)).status()).toBe(404);
    expect((await writer.request.get(csvUrl)).status()).toBe(403);
    expect((await admin.page.request.get(csvUrl)).status()).toBe(403);
    await owner.goto('/reviews');
    await fake('fault',{ operation:'read',status:429,reason:'rateLimitExceeded' });
    const failedCsv = owner.waitForResponse(response => response.url() === origin + csvUrl,{ timeout:12_000 });
    await owner.getByRole('button',{ name:'Tải bảng điểm CSV' }).click();
    expect((await failedCsv).status()).toBe(503);
    await expect(owner.getByRole('main').getByRole('alert')).toHaveText('Chưa tải được bảng điểm. Hãy thử lại.');
    const csvFile = await download(owner,'button','Tải bảng điểm CSV');
    expect(csvFile.name).toBe('bang-diem.csv');
    expect(csvFile.bytes.toString('utf8')).toBe(csvText);

    expect((await writer.request.get(firstUrl)).status()).toBe(404);
    expect((await owner.request.get(firstUrl)).status()).toBe(200);
    expect((await writer.request.get(`/api/submissions/${v2.id}/publication/download`)).status()).toBe(404);
    for (const actor of [peer.page,guest.page,admin.page]) {
      expect((await actor.request.get(sourceUrl)).status()).toBe(404);
      expect((await actor.request.get(currentUrl)).status()).toBe(404);
    }
    await writer.goto(`/results/${v1.id}`);
    const submitted = await download(writer,'link','Tải bài nộp (.md)');
    const reviewed = await download(writer,'link','Tải nhận xét (.md)');
    expect(submitted.name).toMatch(/^bai-nop-.*\.md$/);
    expect(reviewed.name).toMatch(/^nhan-xet-.*\.md$/);
    expect(submitted.bytes.toString('utf8').split('\n---\n')[1]).toBe(essay);
    expect(sha256(submitted.bytes)).toBe(submissionSha256);
    expect(reviewed.bytes.toString('utf8')).toContain('Nhận xét hiện hành.');
    expect(reviewed.bytes.toString('utf8')).not.toContain('Nhận xét ở lần trả cũ.');
    const hash = (await db.query(`SELECT o.expected_sha256 FROM garden.review_publications p
      JOIN garden.drive_objects o ON o.id=p.object_id WHERE p.id=$1`,[second.id])).rows[0].expected_sha256;
    expect(sha256(reviewed.bytes)).toBe(hash);
    expect(await (await writer.request.get(sourceUrl)).body()).toEqual(submitted.bytes);
    expect(await (await writer.request.get(currentUrl)).body()).toEqual(reviewed.bytes);

    const { version } = await responseBody(await owner.request.get(assignment.api));
    await responseBody(await post(owner,assignment.api,{ action:'close',expectedVersion:version }));
    await writer.goto(assignment.url);
    const localDraft = await download(writer,'button','Tải nháp của tôi (.md)');
    expect(localDraft.bytes.toString('utf8')).toContain(draft.markdown);
    expect(await (await writer.request.get(draftUrl)).body()).toEqual(localDraft.bytes);
    expect((await owner.request.get(draftUrl)).status()).toBe(403);
    expect(await (await peer.page.request.get(draftUrl)).text()).not.toContain(draft.markdown);
    await responseBody(await post(owner,'/api/classes',{ action:'remove_student',classId:classroom.classId,studentId:student.id }));
    expect((await writer.request.get(draftUrl)).status()).toBe(404);
    expect(await (await writer.request.get(sourceUrl)).body()).toEqual(submitted.bytes);
    expect(await (await writer.request.get(currentUrl)).body()).toEqual(reviewed.bytes);
    expect((await writer.request.get(firstUrl)).status()).toBe(404);
  },{ rubric });
});
