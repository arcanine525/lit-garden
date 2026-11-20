import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { prepareWorkspace, storeCandidate } from '../../src/server/drive/storage.ts';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';

const post = (page, data, path = '/api/drive') => page.request.post(path, { data, headers: { Origin: origin } });
const call = async (sub, action, args = {}) => {
  const response = await fetch(process.env.DRIVE_MOCK_URL + '/fake/control', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.APP_DRIVE_FAKE_CLIENT_SECRET,
      'Content-Type': 'application/json' }, body: JSON.stringify({ sub, action, ...args })
  });
  expect(response.status).toBe(200);
  return response.json();
};

test('T14 Drive connection checks identity and retries a pinned folder, serving private bytes through the app', async ({ browser }) => {
  test.setTimeout(90_000);
  const db = migrationPool();
  const admin = await keycloakAdmin();
  const accounts = [], contexts = [];
  const slug = randomBytes(6).toString('hex');
  const sub = 'owner_' + slug, anotherSub = 'other_' + slug;
  const classId = randomUUID(), rubric = randomUUID(), stream = randomUUID(), assignment = randomUUID();
  const recipient = randomUUID(), submission = randomUUID(), operation = randomUUID();
  const markdown = Buffer.from('## Bài viết\n\nMột bài viết riêng tư.\n');

  async function login(role, name) {
    const username = 'drive_' + name + '_' + slug;
    const password = key();
    const identity = await provisionIdentity(admin,db,{ username,name,role,password });
    accounts.push(identity);
    const context = await browser.newContext({ baseURL: origin });
    contexts.push(context);
    const page = await context.newPage();
    await enter(page,username,password);
    await setPassword(page,key());
    await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(200);
    return { page, id: identity.id };
  }

  async function consent(teacher, subject, button) {
    const page = teacher.page;
    await page.goto('/drive');
    await page.getByRole('button', { name: button }).click();
    await expect(page.getByRole('heading', { name: 'Drive giả lập' })).toBeVisible();
    await page.getByLabel('Danh tính Drive thử').fill(subject);
    await page.getByRole('button', { name: 'Cho phép' }).click();
    await expect(page.getByRole('heading', { name: 'Kết nối Google Drive' })).toBeVisible();
  }

  try {
    const owner = await login('teacher','owner');
    const outsider = await login('teacher','outsider');
    const student = await login('student','student');
    const otherStudent = await login('student','another');
    const operator = await login('admin','admin');
    const image = Buffer.from(await student.page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const context = canvas.getContext('2d');
      context.fillStyle = '#276749';
      context.fillRect(0,0,2,2);
      return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64');
    for (const user of [student,operator]) {
      expect((await user.page.request.get('/api/drive')).status()).toBe(403);
      expect((await user.page.request.get('/api/drive?view=picker')).status()).toBe(403);
      expect((await post(user.page,{ action: 'finish' })).status()).toBe(403);
    }
    await db.query('INSERT INTO garden.classes(id,teacher_id,name,school_year,join_code_digest) VALUES($1,$2,$3,$4,$5)',
      [classId,owner.id,'T14 test','2026–2027',randomBytes(32).toString('hex')]);
    await expect(prepareWorkspace(owner.id,{ classId })).rejects.toMatchObject({ code: 'DRIVE_SETUP_REQUIRED' });
    expect((await db.query('SELECT 1 FROM garden.drive_folders WHERE teacher_id=$1',[owner.id])).rowCount).toBe(0);

    let callback;
    owner.page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname === '/api/drive/callback') callback = url;
    });
    await consent(owner,sub,'Cấp quyền Drive');
    await expect(owner.page.getByRole('button', { name: 'Chọn thư mục cha' })).toBeVisible();
    expect(callback).toBeTruthy();
    const replay = await owner.page.request.get(callback.href,{ maxRedirects: 0 });
    expect(replay.status()).toBe(303);
    expect(new URL(replay.headers()['location']).searchParams.get('connect')).toBe('DRIVE_CALLBACK_EXPIRED');
    const picker = await owner.page.request.get('/api/drive?view=picker');
    expect(picker.headers()['cache-control']).toBe('no-store');
    const options = await picker.json();
    const parent = options.folders[0].id;
    expect(Object.keys(options)).toEqual(['folders']);
    expect((await post(owner.page,{ action: 'finish', parent: 'not-my-folder' })).status()).toBe(404);
    await call(sub,'alter',{ id: parent, patch: { ownedByMe: false } });
    const forbidden = await post(owner.page,{ action: 'finish', parent });
    expect(forbidden.status()).toBe(403);
    expect(await forbidden.json()).toEqual({ error: 'DRIVE_PARENT_FORBIDDEN' });
    await call(sub,'alter',{ id: parent, patch: { ownedByMe: true } });
    await call(sub,'fault',{ operation: 'generate', status: 403, reason: 'storageQuotaExceeded' });
    const quota = await post(owner.page,{ action: 'finish', parent });
    expect(quota.status()).toBe(503);
    expect(await quota.json()).toEqual({ error: 'DRIVE_QUOTA' });

    await call(sub,'fault',{ operation: 'create', status: 504, reason: 'backendError', afterCommit: true });
    await owner.page.getByRole('button', { name: 'Chọn thư mục cha' }).click();
    await owner.page.getByRole('button', { name: 'Dùng thư mục này' }).click();
    await expect(owner.page.getByRole('button', { name: 'Xác minh thư mục' })).toBeVisible();
    const pending = (await db.query('SELECT app_folder_id FROM garden.drive_setups WHERE teacher_id=$1',[owner.id])).rows[0];
    expect(pending.app_folder_id).toBeTruthy();
    expect((await db.query('SELECT 1 FROM garden.drive_connections WHERE teacher_id=$1',[owner.id])).rowCount).toBe(0);
    expect((await call(sub,'inspect')).files.filter(file => file.name === 'Vườn Văn').map(file => file.id)).toEqual([pending.app_folder_id]);
    await owner.page.getByRole('button', { name: 'Xác minh thư mục' }).click();
    await expect(owner.page.getByRole('status')).toHaveText('Đã xác minh thư mục Vườn Văn trên Drive.');
    const saved = (await db.query('SELECT * FROM garden.drive_connections WHERE teacher_id=$1',[owner.id])).rows[0];
    expect(saved).toMatchObject({ google_subject: sub, parent_folder_id: parent, app_folder_id: pending.app_folder_id, state: 'ready',
      granted_scopes: ['openid','https://www.googleapis.com/auth/drive.file'], token_key_id: 'local-v1' });
    expect(Object.keys(JSON.parse(saved.refresh_token_ciphertext.toString())).sort()).toEqual(['bytes','nonce','tag','v','wrappedKey']);
    expect((await (await owner.page.request.get('/api/drive')).json())).toEqual({ state: 'ready', pending: null, provider: 'fake' });

    await db.query('INSERT INTO garden.rubric_templates(id,revision,label,definition,created_by) VALUES($1,1,$2,$3,$4)',
      [rubric,'T14 test','{}',operator.id]);
    await db.query("INSERT INTO garden.document_streams(id,teacher_id,kind) VALUES($1,$2,'assignment')",[stream,owner.id]);
    await db.query('INSERT INTO garden.assignments(id,teacher_id,class_id,draft_stream_id,rubric_template_id,rubric_template_revision) VALUES($1,$2,$3,$4,$5,1)',
      [assignment,owner.id,classId,stream,rubric]);
    await db.query("INSERT INTO garden.memberships(class_id,student_id,state) VALUES($1,$2,'active'),($1,$3,'active')",
      [classId,student.id,otherStudent.id]);
    await db.query('INSERT INTO garden.recipients(id,assignment_id,class_id,teacher_id,student_id) VALUES($1,$2,$3,$4,$5)',
      [recipient,assignment,classId,owner.id,student.id]);
    await db.query(`INSERT INTO garden.operations(id,actor_id,teacher_id,kind,target_kind,target_id,idempotency_key,request_digest,expected_version)
      VALUES($1,$2,$3,'submit','recipient',$4,$1,repeat('a',64),0)`,[operation,student.id,owner.id,recipient]);

    const address = { classId, assignmentId: assignment, studentId: student.id };
    const workspace = await prepareWorkspace(owner.id,address);
    expect((await prepareWorkspace(owner.id,address)).folderId).toBe(workspace.folderId);
    const folderMap = (await db.query('SELECT kind,folder_id,parent_folder_id FROM garden.drive_folders WHERE teacher_id=$1',[owner.id])).rows;
    const folder = kind => folderMap.find(item => item.kind === kind);
    expect(folderMap).toHaveLength(3);
    expect(folder('class').parent_folder_id).toBe(saved.app_folder_id);
    expect(folder('assignment').parent_folder_id).toBe(folder('class').folder_id);
    expect(folder('student').parent_folder_id).toBe(folder('assignment').folder_id);
    const file = { operationId: operation, slot: 'document', name: 'submission.md', mimeType: 'text/markdown', bytes: markdown };
    await call(sub,'fault',{ operation: 'upload', status: 504, reason: 'backendError', afterCommit: true });
    await expect(storeCandidate(workspace,file)).rejects.toMatchObject({ code: 'DRIVE_UNAVAILABLE' });
    const content = await storeCandidate(workspace,file);
    expect(await storeCandidate(workspace,file)).toBe(content);
    await expect(storeCandidate(workspace,{ ...file, bytes: Buffer.from('Sai') })).rejects.toMatchObject({ code: 'DRIVE_INTEGRITY' });
    const asset = await storeCandidate(workspace,{ ...file, slot: 'asset', name: 'portrait.png', mimeType: 'image/png', bytes: image });
    const unrelated = await storeCandidate(workspace,{ ...file, slot: 'asset', slotIndex: 1, name: 'unrelated.png', mimeType: 'image/png', bytes: image });
    await db.query("UPDATE garden.drive_objects SET lifecycle='referenced' WHERE operation_id=$1",[operation]);
    await db.query("UPDATE garden.operations SET state='committed' WHERE id=$1",[operation]);
    await db.query('INSERT INTO garden.submissions(id,recipient_id,teacher_id,submission_no,operation_id,object_id,submitted_at) VALUES($1,$2,$3,1,$4,$5,now())',
      [submission,recipient,owner.id,operation,content]);
    await db.query('INSERT INTO garden.submission_assets(submission_id,asset_id,teacher_id) VALUES($1,$2,$3)',[submission,asset,owner.id]);
    const path = '/api/content/submissions/' + submission;
    const assetPath = path + '/assets/' + asset;
    const result = await student.page.request.get(path);
    expect(result.status()).toBe(200);
    expect(await result.body()).toEqual(markdown);
    expect(result.headers()['cache-control']).toBe('no-store');
    const photo = await student.page.request.get(assetPath);
    expect(photo.status()).toBe(200);
    expect(await photo.body()).toEqual(image);
    expect(photo.headers()['content-type']).toBe('image/png');
    expect(await student.page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return [image.naturalWidth,image.naturalHeight];
    },assetPath)).toEqual([2,2]);
    expect((await student.page.request.get(path + '/assets/' + unrelated)).status()).toBe(404);
    expect((await owner.page.request.get(path)).status()).toBe(200);
    for (const peer of [outsider, otherStudent, operator]) {
      expect((await peer.page.request.get(path)).status()).toBe(404);
      expect((await peer.page.request.get(assetPath)).status()).toBe(404);
    }
    const fixtureFiles = (await call(sub,'inspect')).files;
    expect(fixtureFiles.filter(file => file.appProperties?.resource === content)).toHaveLength(1);
    expect(fixtureFiles.every(file => file.permissions.every(item => item.type === 'user'))).toBe(true);
    const storedAsset = fixtureFiles.find(file => file.appProperties?.resource === asset);
    await call(sub,'alter',{ id: storedAsset.id, patch: { parents: [parent] } });
    const moved = await student.page.request.get(assetPath);
    expect(moved.status()).toBe(409);
    expect(await moved.json()).toEqual({ error: 'DRIVE_INTEGRITY' });
    await call(sub,'alter',{ id: storedAsset.id, patch: { parents: storedAsset.parents } });

    await call(sub,'revoke');
    const revoked = await student.page.request.get(path);
    expect(revoked.status()).toBe(409);
    expect(await revoked.json()).toEqual({ error: 'DRIVE_RECONNECT' });
    await consent(owner,anotherSub,'Kết nối lại Drive');
    await expect(owner.page.getByRole('status')).toHaveText('Hãy kết nối lại tài khoản Google đã dùng để lưu dữ liệu.');
    const untouched = (await db.query('SELECT * FROM garden.drive_connections WHERE teacher_id=$1',[owner.id])).rows[0];
    expect(untouched.google_subject).toBe(sub);
    expect(untouched.refresh_token_ciphertext).toEqual(saved.refresh_token_ciphertext);
    expect(untouched.app_folder_id).toBe(saved.app_folder_id);
    expect(untouched.data_started_at).toBeInstanceOf(Date);
    await consent(owner,sub,'Kết nối lại Drive');
    await owner.page.getByRole('button', { name: 'Xác minh thư mục' }).click();
    await expect(owner.page.getByRole('status')).toHaveText('Đã xác minh thư mục Vườn Văn trên Drive.');
    expect(await (await student.page.request.get(path)).body()).toEqual(markdown);
    expect((await call(sub,'inspect')).files.filter(file => file.name === 'Vườn Văn')).toHaveLength(1);
    expect((await post(operator.page,{ kind: 'suspend_teacher', userId: owner.id, key: randomUUID() },'/api/admin/accounts')).status()).toBe(200);
    expect((await owner.page.request.get('/api/drive')).status()).toBe(401);
    expect(await (await student.page.request.get(path)).body()).toEqual(markdown);
  } finally {
    try {
      for (const context of contexts) await context.close();
      const ids = accounts.map(account => account.id);
      await db.query('DELETE FROM garden.audit_events WHERE actor_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.identity_operations WHERE actor_id=ANY($1) OR target_user_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.submission_assets WHERE submission_id=$1',[submission]);
      await db.query('DELETE FROM garden.submissions WHERE id=$1',[submission]);
      await db.query('DELETE FROM garden.drive_objects WHERE operation_id=$1',[operation]);
      await db.query('DELETE FROM garden.operations WHERE id=$1',[operation]);
      await db.query('DELETE FROM garden.recipients WHERE id=$1',[recipient]);
      await db.query('DELETE FROM garden.assignments WHERE id=$1',[assignment]);
      await db.query('DELETE FROM garden.document_streams WHERE id=$1',[stream]);
      await db.query('DELETE FROM garden.rubric_templates WHERE id=$1',[rubric]);
      await db.query('DELETE FROM garden.memberships WHERE class_id=$1',[classId]);
      await db.query('DELETE FROM garden.classes WHERE id=$1',[classId]);
      await db.query('DELETE FROM garden.drive_folders WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_setups WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_oauth_attempts WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.drive_connections WHERE teacher_id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.students WHERE id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.teachers WHERE id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.users WHERE id=ANY($1)',[ids]);
      for (const account of accounts) await admin('/users/' + account.subject,'DELETE');
      for (const subject of [sub,anotherSub]) await call(subject,'reset');
    } finally {
      await db.end();
    }
  }
});
