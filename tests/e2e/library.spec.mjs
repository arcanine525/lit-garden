import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { origin } from './auth-fixture.mjs';
import { post, responseBody, withStudentWork, writeSource } from './student-work-fixture.mjs';

function pdfFixture() {
  const text = 'BT /F1 12 Tf 10 20 Td (Vuon Van) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index,object] of objects.entries()) { offsets.push(source.length); source += `${index+1} 0 obj\n${object}\nendobj\n`; }
  const xref = source.length;
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10,'0')} 00000 n \n`).join('') +
    `trailer\n<< /Root 1 0 R /Size ${offsets.length} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T27 library content, favorites and private images follow live class shares', async ({ browser }) => {
  test.setTimeout(120_000);
  await withStudentWork(browser,async ({ student,teacher,admin,db,fake,classroom,provision }) => {
    const owner = teacher.page;
    const list = async (page,favorites = false) => (await responseBody(await page.request.get('/api/library' + (favorites ? '?favorites=1' : '')))).items;
    const share = (id,classIds) => post(owner,`/api/library/${id}`,{ action:'share',classIds });
    const open = id => `/library/${id}`;
    const read = id => `/api/library/${id}`;
    const download = id => `/api/library/${id}/download`;
    const seedClass = (page,name) => post(page,'/api/classes',{ action:'save_class',name,year:'2026–2027' }).then(response => responseBody(response,201));
    const other = await seedClass(owner,'Lớp đọc tài liệu khác');
    const peer = await provision('student','library_peer');
    await responseBody(await post(peer.page,'/api/classes',{ action:'join',code:other.joinCode }));
    const { requests } = await responseBody(await owner.request.get('/api/classes'));
    await responseBody(await post(owner,'/api/classes',{ action:'approve',requestId:requests.find(request => request.username === peer.username).id }));
    const otherTeacher = await provision('teacher','library_other');
    const foreign = await seedClass(otherTeacher.page,'Lớp thuộc giáo viên khác');

    await owner.goto('/library');
    await owner.getByRole('button',{ name:'Thêm tài liệu',exact:true }).click();
    await owner.waitForURL(/\/library\/[\w-]+\/edit$/);
    const id = new URL(owner.url()).pathname.split('/')[2];
    expect((await student.page.request.get(read(id))).status()).toBe(404);
    await owner.getByLabel('Tên tài liệu',{ exact:true }).fill('Ngữ liệu có ảnh riêng');
    await owner.getByLabel('Nguồn',{ exact:true }).fill('Tư liệu lớp');
    await expect(owner.getByRole('combobox',{ name:'Loại tài liệu' }).locator('option')).toHaveText(['Soạn Markdown','Tệp PDF','Tệp TXT']);
    await writeSource(owner,'# Đọc trước khi viết\n\n[Trang học](https://example.org/hoc)');
    const png = Buffer.from(await owner.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 5; canvas.height = 4;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#286540'; ctx.fillRect(0,0,5,4);
      return canvas.toDataURL('image/png').split(',')[1];
    }),'base64');
    const upload = owner.waitForResponse(response => response.url() === origin+'/api/assets' && response.request().method() === 'POST');
    await owner.getByLabel('Chọn ảnh riêng tư').setInputFiles({ name:'vuon.png',mimeType:'image/png',buffer:png });
    const { reference } = await responseBody(await upload,201);
    await expect.poll(() => owner.locator('.garden-editor-text img').evaluate(node => node.naturalWidth)).toBe(5);
    await owner.getByRole('button',{ name:'Lưu tài liệu',exact:true }).click();
    await owner.waitForURL(origin+open(id));
    await expect(owner.getByRole('heading',{ name:'Ngữ liệu có ảnh riêng' })).toBeVisible();
    await expect(owner.getByRole('link',{ name:'Trang học' })).toHaveAttribute('href','https://example.org/hoc');
    await expect(owner.getByText('Riêng tư.',{ exact:true })).toBeVisible();
    expect(await list(student.page)).toEqual([]);
    expect((await student.page.request.get(read(id))).status()).toBe(404);
    expect((await student.page.request.get(download(id))).status()).toBe(404);
    expect((await post(student.page,reference+'/lease',{})).status()).toBe(404);
    expect((await share(id,[classroom.classId,foreign.classId])).status()).toBe(403);
    expect((await otherTeacher.page.request.get(read(id))).status()).toBe(404);
    expect((await admin.page.request.get(read(id))).status()).toBe(404);

    const options = owner.getByRole('group',{ name:'Chia sẻ theo lớp' });
    await options.getByRole('checkbox').filter({ visible:true }).first().waitFor();
    const yourClass = options.getByRole('checkbox',{ name:/Lớp tập viết/ });
    const anotherClass = options.getByRole('checkbox',{ name:'Lớp đọc tài liệu khác' });
    await yourClass.check();
    await options.getByRole('button',{ name:'Lưu chia sẻ' }).click();
    await expect(owner.getByText('Đã lưu chia sẻ.',{ exact:true })).toBeVisible();
    expect((await peer.page.request.get(read(id))).status()).toBe(404);
    expect((await peer.page.request.get(download(id))).status()).toBe(404);
    expect((await post(peer.page,reference+'/lease',{})).status()).toBe(404);
    await peer.page.goto(open(id));
    await expect(peer.page.getByRole('heading',{ name:'404',exact:true })).toBeVisible();
    await anotherClass.check();
    await options.getByRole('button',{ name:'Lưu chia sẻ' }).click();
    await expect(owner.getByText('Đã lưu chia sẻ.',{ exact:true })).toBeVisible();
    const body = await responseBody(await peer.page.request.get(read(id)));
    expect(body.markdown).toContain(reference);
    const attachment = await peer.page.request.get(download(id));
    expect(attachment.headers()['content-disposition']).toContain('.md');
    expect(await attachment.text()).toBe(body.markdown);
    const firstLease = await responseBody(await post(student.page,reference+'/lease',{}));
    const secondLease = await responseBody(await post(peer.page,reference+'/lease',{}));
    expect((await student.page.request.get(firstLease.url)).status()).toBe(200);
    expect((await peer.page.request.get(firstLease.url)).status()).toBe(403);
    await student.page.goto(open(id));
    await expect.poll(() => student.page.locator('.markdown-document img').evaluate(node => node.naturalWidth)).toBe(5);
    await student.page.getByRole('button',{ name:'Yêu thích',exact:true }).click();
    await expect(student.page.getByRole('button',{ name:'Yêu thích',exact:true })).toHaveAttribute('aria-pressed','true');
    expect((await list(student.page,true)).map(item => item.id)).toEqual([id]);

    async function createFile(title,format,bytes,mimeType) {
      const next = randomUUID();
      await responseBody(await post(owner,'/api/library',{ id:next }),201);
      const saved = await owner.request.put(read(next),{ headers:{ Origin:origin },multipart:{ key:randomUUID(),version:'0',title,format,
        file:{ name:format === 'pdf' ? 'fixture.pdf' : 'fixture.txt',mimeType,buffer:bytes } } });
      await responseBody(saved);
      return next;
    }
    const txtBytes = Buffer.from('Một tệp TXT tiếng Việt.\nDòng cuối.\n');
    const txt = await createFile('Tệp chữ', 'text',txtBytes,'text/plain');
    const pdfBytes = pdfFixture();
    const pdf = await createFile('Tệp đọc PDF','pdf',pdfBytes,'application/pdf');
    await responseBody(await share(txt,[classroom.classId]));
    await responseBody(await share(pdf,[classroom.classId]));
    await student.page.goto(open(txt));
    await expect(student.page.locator('pre')).toHaveText(/Một tệp TXT tiếng Việt/);
    expect(await (await student.page.request.get(download(txt))).body()).toEqual(txtBytes);
    const pdfFrame = student.page.waitForResponse(response => response.url() === origin+download(pdf)+'?inline=1');
    await student.page.goto(open(pdf));
    await expect(student.page.locator('iframe[title="Tài liệu PDF"]')).toBeVisible();
    expect((await pdfFrame).headers()['content-type']).toBe('application/pdf');
    expect(await (await student.page.request.get(download(pdf))).body()).toEqual(pdfBytes);
    await student.page.goto('/library?favorites=1');
    await expect(student.page.getByRole('link',{ name:'Ngữ liệu có ảnh riêng' })).toBeVisible();
    await expect(student.page.getByRole('link',{ name:'Tệp chữ' })).toHaveCount(0);
    await expect(student.page.getByRole('link',{ name:'Tệp đọc PDF' })).toHaveCount(0);

    const bad = randomUUID();
    await responseBody(await post(owner,'/api/library',{ id:bad }),201);
    const put = multipart => owner.request.put(read(bad),{ headers:{ Origin:origin },multipart:{ key:randomUUID(),version:'0',title:'Không hợp lệ',...multipart } });
    expect((await put({ format:'link',sourceLabel:'https://example.org' })).status()).toBe(422);
    expect((await put({ format:'pdf',file:{ name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('<html>fake</html>') } })).status()).toBe(415);
    const files = (await fake('inspect')).files;
    expect(files.filter(file => /^library-.*\.md$/.test(file.name))).toHaveLength(3);
    expect(files.some(file => file.mimeType === 'application/pdf')).toBe(true);
    expect(files.some(file => file.mimeType === 'text/plain')).toBe(true);

    await responseBody(await post(owner,'/api/classes',{ action:'remove_student',classId:classroom.classId,studentId:student.id }));
    expect((await student.page.request.get(download(id))).status()).toBe(404);
    expect((await student.page.request.get(firstLease.url)).status()).toBe(404);
    expect((await post(student.page,reference+'/lease',{})).status()).toBe(404);
    expect(await list(student.page,true)).toEqual([]);
    expect((await db.query('SELECT 1 FROM garden.library_favorites WHERE item_id=$1 AND user_id=$2',[id,student.id])).rowCount).toBe(1);
    expect((await peer.page.request.get(secondLease.url)).status()).toBe(200);
    await responseBody(await share(id,[]));
    expect((await peer.page.request.get(secondLease.url)).status()).toBe(404);
    expect((await peer.page.request.get(download(id))).status()).toBe(404);
    await peer.page.goto(open(id));
    await expect(peer.page.getByRole('heading',{ name:'404',exact:true })).toBeVisible();
  });
});
