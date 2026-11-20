import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { origin } from './auth-fixture.mjs';
import { post, responseBody, withStudentWork, writeSource } from './student-work-fixture.mjs';

const responseFor = (page,path,method) => page.waitForResponse(response => response.url() === origin+path && response.request().method() === method,{ timeout:15_000 });

test.use({ actionTimeout:10_000,navigationTimeout:15_000 });
test('T28 shared library replacement is atomic and deletion reconciles every owned file', async ({ browser }) => {
  test.setTimeout(140_000);
  await withStudentWork(browser,async ({ student,teacher,db,fake,classroom,tag }) => {
    const owner = teacher.page, reader = student.page;
    const item = randomUUID();
    const route = `/api/library/${item}`, url = `/library/${item}`;
    const featured = async (classId = classroom.classId) => (await responseBody(await reader.request.get(`/api/library?featured=1&classId=${classId}`))).items;
    const row = async id => (await db.query('SELECT id,state,version,current_object_id FROM garden.library_items WHERE id=$1',[id])).rows[0];
    const saved = async id => (await db.query(`SELECT o.drive_file_id,o.lifecycle,o.slot,op.state,op.idempotency_key
      FROM garden.drive_objects o JOIN garden.operations op ON op.id=o.operation_id
      WHERE op.target_kind='library' AND op.target_id=$1 ORDER BY o.id`,[id])).rows;
    const other = await responseBody(await post(owner,'/api/classes',{ action:'save_class',name:'Lớp chưa nhận chia sẻ',year:'2026–2027' }),201);
    await responseBody(await post(owner,'/api/library',{ id:item }),201);
    const png = Buffer.from(await owner.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 3;
      canvas.getContext('2d').fillRect(0,0,4,3); return canvas.toDataURL('image/png').split(',')[1];
    }),'base64');
    const { reference } = await responseBody(await owner.request.post('/api/assets',{ data:png,headers:{ Origin:origin,
      'Content-Type':'image/png','X-Garden-Library':item,'Idempotency-Key':randomUUID() } }),201);
    const original = `# Trang cũ\n\n![Ảnh trong tài liệu](${reference})`;
    const replacement = `# Trang mới\n\n![Ảnh trong tài liệu](${reference})`;
    const put = (id,multipart) => owner.request.put(`/api/library/${id}`,{ headers:{ Origin:origin },multipart });
    await responseBody(await put(item,{ key:randomUUID(),version:'0',title:'Tài liệu vườn',format:'markdown',markdown:original }));
    const initial = await row(item);
    await responseBody(await post(owner,route,{ action:'share',classIds:[classroom.classId] }));
    await responseBody(await post(reader,route,{ action:'favorite',favorite:true }));
    const lease = await responseBody(await post(reader,reference+'/lease',{}));
    expect((await reader.request.get(lease.url)).status()).toBe(200);
    expect((await post(owner,route,{ action:'feature',classId:other.classId,slot:1 })).status()).toBe(403);
    await owner.goto(url);
    const placement = owner.getByRole('group',{ name:'Tài liệu nổi bật' });
    await placement.getByRole('combobox').selectOption('1');
    await expect(owner.getByText('Đã lưu tài liệu nổi bật.',{ exact:true })).toBeVisible();
    expect(await featured()).toEqual([expect.objectContaining({ id:item,slot:1,title:'Tài liệu vườn' })]);
    expect(await featured(other.classId)).toEqual([]);

    await owner.getByRole('link',{ name:'Sửa tài liệu' }).click();
    await expect(owner.getByRole('heading',{ name:'Sửa tài liệu' })).toBeVisible();
    await owner.getByLabel('Tên tài liệu',{ exact:true }).fill('Tài liệu vườn mới');
    await writeSource(owner,replacement);
    await reader.goto(url);
    await expect(reader.getByRole('heading',{ name:'Trang cũ' })).toBeVisible();
    await fake('fault',{ operation:'upload',afterCommit:true,status:504,reason:'backendError' });
    const delayed = responseFor(owner,route,'PUT');
    await owner.getByRole('button',{ name:'Lưu thay đổi',exact:true }).click();
    await responseBody(await delayed,202);
    await expect(owner.getByText('Chưa xác nhận tài liệu đã lưu.',{ exact:true })).toBeVisible();
    expect(await row(item)).toEqual(initial);
    expect((await responseBody(await reader.request.get(route))).markdown).toBe(original);
    const firstCandidate = (await saved(item)).find(file => file.state === 'unknown');
    expect(firstCandidate.lifecycle).toBe('candidate');

    const fault = 'fixture_item_update_' + tag;
    await db.query(`CREATE FUNCTION garden.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id='${item}'::uuid AND NEW.current_object_id IS DISTINCT FROM OLD.current_object_id THEN
        RAISE EXCEPTION 'Fixture failed pointer update'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${fault} BEFORE UPDATE ON garden.library_items FOR EACH ROW EXECUTE FUNCTION garden.${fault}()`);
    try {
      const rejected = responseFor(owner,route,'PUT');
      await owner.getByRole('button',{ name:'Thử lưu lại',exact:true }).click();
      await responseBody(await rejected,202);
      expect(await row(item)).toEqual(initial);
      expect((await saved(item)).find(file => file.state === 'unknown')).toEqual(firstCandidate);
      expect(await featured()).toEqual([expect.objectContaining({ id:item,title:'Tài liệu vườn' })]);
    } finally { await db.query(`DROP TRIGGER ${fault} ON garden.library_items; DROP FUNCTION garden.${fault}()`); }
    const retried = responseFor(owner,route,'PUT');
    await owner.getByRole('button',{ name:'Thử lưu lại',exact:true }).click();
    await responseBody(await retried);
    await expect(owner.getByRole('heading',{ name:'Tài liệu vườn mới' })).toBeVisible();
    expect((await saved(item)).find(file => file.idempotency_key === firstCandidate.idempotency_key)).toMatchObject({
      drive_file_id:firstCandidate.drive_file_id,lifecycle:'referenced',state:'committed' });
    expect((await responseBody(await reader.request.get(route))).markdown).toContain('Trang mới');
    expect((await responseBody(await reader.request.get('/api/library?favorites=1'))).items).toEqual([expect.objectContaining({ id:item })]);
    expect(await featured()).toEqual([expect.objectContaining({ id:item,title:'Tài liệu vườn mới' })]);

    const file = randomUUID();
    const textUpload = buffer => ({ name:'tu-lieu.txt',mimeType:'text/plain',buffer:Buffer.from(buffer) });
    await responseBody(await post(owner,'/api/library',{ id:file }),201);
    await responseBody(await put(file,{ key:randomUUID(),version:'0',format:'text',title:'Nguồn văn bản',file:textUpload('Bản cũ.') }));
    await responseBody(await post(owner,`/api/library/${file}`,{ action:'share',classIds:[classroom.classId] }));
    await responseBody(await put(file,{ key:randomUUID(),version:'1',format:'text',title:'Nguồn văn bản',file:textUpload('Bản thay thế.') }));
    const metadata = { key:randomUUID(),version:'2',format:'text',title:'Nguồn đã ghi tên' };
    const updatedFile = await responseBody(await put(file,metadata));
    expect(await responseBody(await put(file,metadata))).toEqual(updatedFile);
    expect(await (await reader.request.get(`/api/library/${file}/download`)).text()).toBe('Bản thay thế.');

    const attempt = { key:randomUUID(),version:(await row(item)).version,format:'markdown',title:'Bản đang gửi',markdown:'# Bản đang gửi' };
    await fake('fault',{ operation:'upload',afterCommit:true,hold:true });
    const oldSave = put(item,attempt).then(response => response.status(),() => 0);
    await expect.poll(async () => (await fake('inspect')).holds).toEqual(['upload']);
    const pinned = (await saved(item)).find(entry => entry.idempotency_key === attempt.key);
    await fake('fault',{ operation:'trash',afterCommit:true,status:504,reason:'backendError' });
    const deleting = responseFor(owner,route,'DELETE');
    await owner.getByRole('button',{ name:'Xóa tài liệu',exact:true }).click();
    await owner.getByRole('dialog').getByRole('button',{ name:'Gỡ và đưa vào thùng rác',exact:true }).click();
    const firstDelete = await deleting;
    const intent = firstDelete.request().postDataJSON();
    await fake('release',{ operation:'upload' });
    expect(await responseBody(firstDelete,202)).toEqual({ state:'deleting',id:item });
    expect(await oldSave).toBeGreaterThanOrEqual(400);
    await expect(owner.getByText('Đã gỡ khỏi thư viện. Drive còn file cần đối chiếu.',{ exact:true })).toBeVisible();
    expect((await row(item)).state).toBe('deleting');
    expect((await reader.request.get(route)).status()).toBe(404);
    expect((await reader.request.get(route+'/download')).status()).toBe(404);
    expect((await reader.request.get(lease.url)).status()).toBe(404);
    expect(await featured()).toEqual([]);
    expect((await responseBody(await reader.request.get('/api/library?favorites=1'))).items).toEqual([]);
    const cleanup = async () => (await db.query(`SELECT f.state,object.drive_file_id FROM garden.library_delete_files f
      JOIN garden.operations op ON op.id=f.operation_id JOIN garden.drive_objects object ON object.id=f.object_id
      WHERE op.kind='library_delete' AND op.target_id=$1 ORDER BY object.drive_file_id`,[item])).rows;
    const partial = await cleanup();
    expect(partial.some(file => file.state === 'unknown')).toBe(true);
    expect(partial.some(file => file.drive_file_id === pinned.drive_file_id)).toBe(true);
    expect((await saved(item)).find(entry => entry.idempotency_key === attempt.key)).toMatchObject({ state:'rejected' });

    const abort = 'fixture_item_delete_' + tag;
    await db.query(`CREATE FUNCTION garden.${abort}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id='${item}'::uuid AND NEW.state='deleted' THEN RAISE EXCEPTION 'Fixture failed delete commit'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${abort} BEFORE UPDATE ON garden.library_items FOR EACH ROW EXECUTE FUNCTION garden.${abort}()`);
    try {
      const retry = () => owner.request.delete(route,{ headers:{ Origin:origin },data:intent });
      await responseBody(await retry(),202);
      expect((await row(item)).state).toBe('deleting');
      expect((await cleanup()).every(file => file.state === 'trashed')).toBe(true);
      expect((await reader.request.get(route)).status()).toBe(404);
    } finally { await db.query(`DROP TRIGGER ${abort} ON garden.library_items; DROP FUNCTION garden.${abort}()`); }
    const cleanupIds = (await cleanup()).map(file => file.drive_file_id);
    const trashed = (await fake('inspect')).files.filter(file => cleanupIds.includes(file.id));
    expect(trashed.every(file => file.trashed)).toBe(true);
    await owner.goto('/library');
    await expect(owner.getByRole('heading',{ name:'Đang đối chiếu thùng rác' })).toBeVisible();
    const done = responseFor(owner,route,'DELETE');
    await owner.getByRole('button',{ name:'Thử chuyển vào thùng rác lại' }).click();
    expect(await responseBody(await done)).toEqual({ state:'deleted',id:item });
    expect((await row(item)).state).toBe('deleted');
    expect((await fake('inspect')).files.filter(file => cleanupIds.includes(file.id))).toEqual(trashed);
    expect(await (await reader.request.get(`/api/library/${file}/download`)).text()).toBe('Bản thay thế.');
  });
});
