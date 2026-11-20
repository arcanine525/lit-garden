import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { semantic } from '../../prototypes/editor/src/markdown.js';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';

const md = [
  '## Bài viết tiếng Việt', '', '**Đậm** và *nghiêng*.  ', 'Xuống dòng cứng.', '',
  '- Một mục', '- Hai mục', '', '3. Mục số', '', '> Trích lời của cô.', '',
  '[Tài liệu][nguon]', '', '[nguon]: https://example.org/tai-lieu "Nguồn"', '',
  '| Cột A | Cột B |', '| :--- | ---: |', '| Hàng cuối | Ô cuối |'
].join('\n');
const validate = (page, markdown, assignmentId) => page.request.post('/api/editor/validate',{
  data: { markdown, assignmentId }, headers: { Origin: origin }
});
const lease = (page, reference) => page.request.post(reference + '/lease',{ headers: { Origin: origin } });
const upload = (page, bytes, assignment, id = randomUUID()) => page.request.post('/api/assets',{
  data: bytes, headers: { Origin: origin, 'Content-Type': 'image/png', 'X-Garden-Assignment': assignment, 'Idempotency-Key': id }
});

async function downloaded(download) {
  const stream = await download.createReadStream();
  const bytes = [];
  for await (const chunk of stream) bytes.push(chunk);
  return Buffer.concat(bytes).toString();
}

async function paste(editor, { text, html }) {
  await editor.evaluate((root, args) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain',args.text);
    clipboard.setData('text/html',args.html);
    root.dispatchEvent(new ClipboardEvent('paste',{ bubbles: true, cancelable: true, clipboardData: clipboard }));
  }, { text, html });
}

test('T16 round-trips Markdown and exports the active table cell with focus intact', async ({ page }) => {
  const db = migrationPool();
  const kc = await keycloakAdmin();
  const username = 'edit_' + randomBytes(6).toString('hex');
  const password = key();
  const account = await provisionIdentity(kc,db,{ username, password, name: 'Bình', role: 'student' });
  try {
    await enter(page,username,password);
    await setPassword(page,key());
    await page.getByRole('navigation',{ name: 'Điều hướng chính' }).getByRole('link',{ name: 'Soạn Markdown' }).click();
    const surface = page.locator('.garden-editor');
    const editor = surface.locator('.garden-editor-text[data-lexical-editor="true"]');
    const status = surface.getByRole('status');
    await expect(editor).toBeVisible();
    await expect(surface.getByRole('button',{ name: 'Trực quan' })).toHaveAttribute('aria-pressed','true');
    await expect(surface.getByRole('button',{ name: 'Chèn ảnh' })).toHaveCount(0);
    await surface.getByRole('button',{ name: 'Mã Markdown' }).click();
    await surface.getByRole('textbox',{ name: 'Mã Markdown' }).fill(md);
    await surface.getByRole('button',{ name: 'Trực quan' }).click();
    await expect(editor.getByRole('heading',{ name: 'Bài viết tiếng Việt' })).toBeVisible();
    await expect(editor.locator('strong')).toHaveText('Đậm');
    await expect(editor.locator('em')).toHaveText('nghiêng');
    await expect(editor.locator('ul li')).toHaveCount(2);
    await expect(editor.locator('ol')).toHaveAttribute('start','3');
    await expect(editor.locator('blockquote')).toHaveText('Trích lời của cô.');
    await expect(editor.getByRole('link',{ name: 'Tài liệu' })).toHaveAttribute('href','https://example.org/tai-lieu');

    const last = editor.locator('tbody tr').last().locator('td:not([data-tool-cell]) [contenteditable="true"]').last();
    await last.click();
    await last.press('End');
    await page.keyboard.insertText(' tiếng Việt cuối ắ');
    await expect(last).toHaveText('Ô cuối tiếng Việt cuối ắ');
    const downloading = page.waitForEvent('download');
    await last.press('Control+s');
    const current = await downloaded(await downloading);
    expect(semantic(current)).toEqual(semantic(md.replace('Ô cuối','Ô cuối tiếng Việt cuối ắ')));
    await expect(last).toBeFocused();

    await surface.getByRole('button',{ name: 'Mã Markdown' }).click();
    const source = surface.getByRole('textbox',{ name: 'Mã Markdown' });
    expect(semantic(await source.inputValue())).toEqual(semantic(current));
    await surface.getByRole('button',{ name: 'Kiểm tra Markdown' }).click();
    await expect(status).toHaveText('Markdown hợp lệ.');
    await source.fill('<u>Đoạn gạch chân</u>');
    await surface.getByRole('button',{ name: 'Trực quan' }).click();
    await expect(source).toHaveValue('<u>Đoạn gạch chân</u>');
    expect((await validate(page,'<u>Đoạn gạch chân</u>')).status()).toBe(422);
    expect((await validate(page,'<span style="color:red">Đổi màu</span>')).status()).toBe(422);
    expect((await validate(page,'[không an toàn](javascript:alert%281%29)')).status()).toBe(422);
    expect((await validate(page,'![ảnh](/api/assets/' + randomUUID() + ')')).status()).toBe(422);
    await source.fill('Bắt đầu.');
    await surface.getByRole('button',{ name: 'Trực quan' }).click();
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Control+u');
    await expect(status).toContainText('không hỗ trợ gạch chân');
    await paste(editor,{ text: 'Ảnh ngoài', html: '<img src="https://example.org/remote.png">' });
    await expect(status).toHaveText('Học sinh chỉ có thể soạn nội dung chữ.');
    await paste(editor,{ text: ' chữ dán', html: '<span style="color:red"><u> chữ dán</u></span>' });
    await expect(editor).toContainText('chữ dán');
    await expect(editor.locator('u,span[style*="color"],img')).toHaveCount(0);
  } finally {
    try {
      await db.query('DELETE FROM garden.students WHERE id=$1',[account.id]);
      await db.query('DELETE FROM garden.users WHERE id=$1',[account.id]);
      await kc('/users/' + account.subject,'DELETE');
    } finally { await db.end(); }
  }
});

test('T16 teacher upload and session-bound image lease verify scope and failure states', async ({ browser, request }) => {
  test.setTimeout(75_000);
  const db = migrationPool();
  const kc = await keycloakAdmin();
  const slug = randomBytes(6).toString('hex');
  const subject = 'assets_' + slug;
  const contexts = [], accounts = [];
  const classId = randomUUID(), assignment = randomUUID(), otherAssignment = randomUUID(), rubric = randomUUID();
  const stream = randomUUID(), otherStream = randomUUID(), operation = randomUUID();
  const provider = async (action, args = {}) => {
    const result = await fetch(process.env.DRIVE_MOCK_URL + '/fake/control',{
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.APP_DRIVE_FAKE_CLIENT_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub: subject, action, ...args })
    });
    expect(result.status).toBe(200);
    return result.json();
  };
  async function signIn(role, suffix) {
    const username = 'asset_' + suffix + '_' + slug;
    const password = key();
    const account = await provisionIdentity(kc,db,{ name: suffix, username, password, role });
    accounts.push(account);
    const context = await browser.newContext({ baseURL: origin });
    contexts.push(context);
    const page = await context.newPage();
    await enter(page,username,password);
    await setPassword(page,key());
    await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(200);
    return { page, id: account.id };
  }

  try {
    const teacher = await signIn('teacher','teacher');
    const student = await signIn('student','student');
    const peer = await signIn('student','peer');
    const operator = await signIn('admin','admin');
    await db.query('INSERT INTO garden.classes(id,teacher_id,name,school_year,join_code_digest) VALUES($1,$2,$3,$4,$5)',
      [classId,teacher.id,'Lớp thử ảnh','2026–2027',randomBytes(32).toString('hex')]);
    await db.query('INSERT INTO garden.rubric_templates(id,revision,label,definition,created_by) VALUES($1,1,$2,$3,$4)',
      [rubric,'Rubric ảnh','{}',operator.id]);
    await db.query("INSERT INTO garden.document_streams(id,teacher_id,kind) VALUES($1,$2,'assignment'),($3,$2,'assignment')",
      [stream,teacher.id,otherStream]);
    await db.query(`INSERT INTO garden.assignments(id,class_id,teacher_id,draft_stream_id,rubric_template_id,rubric_template_revision)
      VALUES($1,$2,$3,$4,$5,1),($6,$2,$3,$7,$5,1)`,[assignment,classId,teacher.id,stream,rubric,otherAssignment,otherStream]);
    const png = Buffer.from(await teacher.page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 5;
      const context = canvas.getContext('2d');
      context.fillStyle = '#39745b';
      context.fillRect(0,0,5,5);
      return canvas.toDataURL('image/png').split(',')[1];
    }),'base64');
    expect((await upload(student.page,png,assignment)).status()).toBe(403);
    expect((await upload(teacher.page,png,assignment)).status()).toBe(409);

    await teacher.page.goto('/drive');
    await teacher.page.getByRole('button',{ name: 'Cấp quyền Drive' }).click();
    await teacher.page.getByLabel('Danh tính Drive thử').fill(subject);
    await teacher.page.getByRole('button',{ name: 'Cho phép' }).click();
    await teacher.page.getByRole('button',{ name: 'Chọn thư mục cha' }).click();
    await teacher.page.getByRole('button',{ name: 'Dùng thư mục này' }).click();
    await expect(teacher.page.getByRole('status')).toContainText('Đã xác minh');
    expect((await upload(teacher.page,Buffer.from('không phải PNG'),assignment)).status()).toBe(415);

    await teacher.page.goto('/editor?assignment=' + assignment);
    const editor = teacher.page.locator('.garden-editor');
    await expect(editor.getByRole('button',{ name: 'Chèn ảnh' })).toBeVisible();
    await provider('fault',{ operation: 'upload', status: 504, reason: 'backendError', afterCommit: true });
    await editor.locator('input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
    await expect(editor.getByRole('status')).toHaveText('Chưa đọc hoặc lưu được ảnh trên Drive. Hãy thử lại.');
    await editor.getByRole('button',{ name: 'Thử tải ảnh lên lại' }).click();
    await expect(editor.getByRole('status')).toHaveText('Đã chèn ảnh riêng tư.');
    await expect.poll(() => editor.locator('.garden-editor-text img').evaluate(image => image.naturalWidth)).toBe(5);
    const exporting = teacher.page.waitForEvent('download');
    await editor.getByRole('button',{ name: 'Tải Markdown' }).click();
    const document = await downloaded(await exporting);
    const reference = /\/api\/assets\/[0-9a-f-]{36}/.exec(document)?.[0];
    expect(reference).toBeTruthy();
    expect(document).not.toMatch(/lease=|blob:|googleapis|drive.google/);
    expect((await validate(teacher.page,document,assignment)).status()).toBe(200);
    expect((await validate(teacher.page,document,otherAssignment)).status()).toBe(422);
    expect((await validate(teacher.page,'![ngoài](https://example.org/ngoai.png)',assignment)).status()).toBe(422);
    expect((await lease(student.page,reference)).status()).toBe(404);
    expect((await lease(operator.page,reference)).status()).toBe(404);
    const authorized = await (await lease(teacher.page,reference)).json();
    expect((await request.get(authorized.url)).status()).toBe(401);
    expect((await student.page.request.get(authorized.url)).status()).toBe(403);
    const blob = await teacher.page.request.get(authorized.url);
    expect(blob.status()).toBe(200);
    expect(blob.headers()['cache-control']).toBe('private, no-store');
    expect(blob.headers()['content-type']).toBe('image/png');

    await provider('fault',{ operation: 'read', status: 404, reason: 'notFound' });
    await editor.getByRole('button',{ name: 'Tải lại ảnh' }).click();
    await expect(editor.getByRole('status')).toHaveText('Không tìm thấy ảnh trên Drive.');
    await expect(editor.locator('.garden-editor-text img')).toHaveAttribute('src','/asset-unavailable.svg');
    await editor.getByRole('button',{ name: 'Tải lại ảnh' }).click();
    await expect.poll(() => editor.locator('.garden-editor-text img').evaluate(image => image.naturalWidth)).toBe(5);

    const id = reference.split('/').at(-1);
    const metadata = (await db.query('SELECT * FROM garden.drive_objects WHERE id=$1',[id])).rows[0];
    expect(metadata).toMatchObject({ teacher_id: teacher.id, mime_type: 'image/png', lifecycle: 'referenced', integrity: 'ok' });
    const stored = (await provider('inspect')).files.filter(file => file.mimeType === 'image/png');
    expect(stored.map(file => file.id)).toEqual([metadata.drive_file_id]);
    expect(stored[0].permissions.map(item => item.type)).toEqual(['user']);
    await db.query(`INSERT INTO garden.operations(id,actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version,state)
      VALUES($1,$2,$2,'assign','assignment',$3,$1,repeat('b',64),0,'committed')`,[operation,teacher.id,assignment]);
    const { rows: pinned } = await db.query(`INSERT INTO garden.drive_objects(teacher_id,operation_id,slot,drive_file_id,parent_drive_id,mime_type,expected_sha256,byte_size)
      VALUES($1,$2,'prompt',$3,$4,'text/markdown',repeat('a',64),1),($1,$2,'rubric',$5,$4,'text/markdown',repeat('b',64),1)
      RETURNING id,slot`,[teacher.id,operation,randomUUID(),metadata.parent_drive_id,randomUUID()]);
    await db.query("UPDATE garden.assignment_assets SET document_part='prompt' WHERE asset_id=$1",[id]);
    await db.query("UPDATE garden.assignments SET state='published', published_at=now(),prompt_object_id=$2,rubric_object_id=$3 WHERE id=$1",
      [assignment,pinned.find(item => item.slot === 'prompt').id,pinned.find(item => item.slot === 'rubric').id]);
    await db.query("INSERT INTO garden.memberships(class_id,student_id,state) VALUES($1,$2,'active'),($1,$3,'active')",
      [classId,student.id,peer.id]);
    expect((await lease(student.page,reference)).status()).toBe(404);
    await db.query('INSERT INTO garden.recipients(assignment_id,class_id,teacher_id,student_id) VALUES($1,$2,$3,$4)',
      [assignment,classId,teacher.id,student.id]);
    expect((await lease(peer.page,reference)).status()).toBe(404);
    const issued = await (await lease(student.page,reference)).json();
    expect(await student.page.evaluate(async url => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image.naturalWidth;
    },issued.url)).toBe(5);
    const handle = new URL(issued.url,origin).searchParams.get('lease');
    await db.query("UPDATE garden.asset_view_leases SET expires_at=now()-interval '1 second' WHERE handle_digest=$1",
      [createHash('sha256').update(handle).digest('hex')]);
    expect((await student.page.request.get(issued.url)).status()).toBe(410);
    const renewed = await (await lease(student.page,reference)).json();
    await provider('revoke');
    expect((await student.page.request.get(renewed.url)).status()).toBe(409);
    await db.query("UPDATE garden.memberships SET state='removed',removed_at=now() WHERE class_id=$1 AND student_id=$2",[classId,student.id]);
    expect((await student.page.request.get(renewed.url)).status()).toBe(404);
  } finally {
    try {
      for (const context of contexts) await context.close();
      const ids = accounts.map(account => account.id);
      await db.query('DELETE FROM garden.assignment_assets WHERE assignment_id IN ($1,$2)',[assignment,otherAssignment]);
      await db.query('DELETE FROM garden.recipients WHERE assignment_id=$1',[assignment]);
      await db.query('DELETE FROM garden.assignments WHERE id IN ($1,$2)',[assignment,otherAssignment]);
      await db.query('DELETE FROM garden.drive_objects WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.operations WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.memberships WHERE class_id=$1',[classId]);
      await db.query('DELETE FROM garden.document_streams WHERE id IN ($1,$2)',[stream,otherStream]);
      await db.query('DELETE FROM garden.rubric_templates WHERE id=$1',[rubric]);
      await db.query('DELETE FROM garden.audit_events WHERE actor_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_folders WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_setups WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_oauth_attempts WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_connections WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.classes WHERE id=$1',[classId]);
      await db.query('DELETE FROM garden.students WHERE id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.teachers WHERE id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.users WHERE id=ANY($1)',[ids]);
      for (const account of accounts) await kc('/users/' + account.subject,'DELETE');
      await provider('reset');
    } finally { await db.end(); }
  }
});
