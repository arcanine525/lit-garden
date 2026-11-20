import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { enter, key, origin, setPassword } from './auth-fixture.mjs';

const post = (page, data) => page.request.post('/api/classes', { data, headers: { Origin: origin } });
const nav = page => page.getByRole('navigation', { name: 'Điều hướng chính' });

test('T15 responsive role shell, local fonts, keyboard dialogs, and loading retry', async ({ browser }) => {
  test.setTimeout(70_000);
  const db = migrationPool();
  const keycloak = await keycloakAdmin();
  const tag = randomBytes(6).toString('hex');
  const contexts = [], accounts = [];
  let classId, releaseLoad, releaseArchive;
  const capture = process.env.T15_CAPTURE_DIR;

  async function login(role, viewport) {
    const context = await browser.newContext({ baseURL: origin, viewport, reducedMotion: 'reduce' });
    contexts.push(context);
    const page = await context.newPage();
    const username = `shell_${role}_${tag}`;
    const password = key();
    const name = { teacher: 'Cô An', student: 'Bình', admin: 'Quản trị viên' }[role];
    accounts.push(await provisionIdentity(keycloak,db,{ name, username, role, password }));
    await enter(page,username,password);
    await expect.poll(async () => page.evaluate(async () => {
      await document.fonts.ready;
      return ['Lora','Be Vietnam Pro'].every(name => [...document.fonts].some(face => face.family.includes(name) && face.status === 'loaded'));
    })).toBe(true);
    await setPassword(page,key());
    await expect(nav(page)).toBeVisible();
    return page;
  }

  async function saveShot(page, name) {
    if (!capture) return;
    await mkdir(capture,{ recursive: true });
    await page.screenshot({ path: join(capture,name + '.png'), animations: 'disabled' });
  }

  async function geometry(page, width, height, sidebar) {
    await page.setViewportSize({ width,height });
    await expect.poll(() => page.evaluate(() => [innerWidth, document.documentElement.scrollWidth])).toEqual([width,width]);
    const active = nav(page).locator('[aria-current="page"]');
    await expect(active).toHaveCount(1);
    const side = page.locator('.app-sidebar');
    const bottom = page.locator('.app-bottom-nav');
    if (sidebar) {
      await expect(bottom).toBeHidden();
      await expect.poll(async () => (await side.boundingBox())?.width).toBe(sidebar);
      expect((await page.locator('.app-topbar').boundingBox()).height).toBe(76);
    } else {
      await expect(side).toBeHidden();
      const box = await bottom.boundingBox();
      expect(box.y + box.height).toBe(height);
      expect(box.width).toBe(width);
      expect((await active.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
  }

  try {
    const teacher = await login('teacher',{ width: 1440,height: 900 });
    await expect(teacher.getByRole('heading', { name: 'Góc vườn của Cô An' })).toBeVisible();
    await expect(teacher.getByText('Cô An · Giáo viên')).toBeVisible();
    await expect(nav(teacher).getByRole('link',{ name: 'Kết nối Google Drive' })).toBeVisible();
    await expect(nav(teacher).getByRole('link',{ name: 'Quản lý tài khoản' })).toHaveCount(0);
    await expect.poll(async () => teacher.evaluate(async () => {
      await document.fonts.ready;
      const families = [...document.fonts];
      const image = document.querySelector('.app-hero-image');
      await image?.decode();
      return getComputedStyle(document.querySelector('h1')).fontFamily.includes('Lora') &&
        families.some(face => face.family.includes('Lora') && face.status === 'loaded') &&
        families.some(face => face.family.includes('Be Vietnam Pro') && face.status === 'loaded') &&
        image?.naturalWidth > 0;
    })).toBe(true);
    for (const [width,height,sidebar] of [[1440,900,235],[768,1024,205],[390,844,0]]) {
      await geometry(teacher,width,height,sidebar);
      await saveShot(teacher,`teacher-home-${width}`);
    }
    await teacher.keyboard.press('Tab');
    const skip = teacher.getByRole('link',{ name: 'Đến nội dung chính' });
    await expect(skip).toBeFocused();
    expect(await skip.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    await teacher.keyboard.press('Enter');
    await expect(teacher.getByRole('main')).toBeFocused();

    const added = await post(teacher,{ action: 'save_class', name: 'Lớp 10A', year: '2026–2027' });
    expect(added.status()).toBe(201);
    classId = (await added.json()).classId;
    const loading = new Promise(resolve => { releaseLoad = resolve; });
    const archiving = new Promise(resolve => { releaseArchive = resolve; });
    let seen = 0;
    await teacher.route('**/api/classes', async route => {
      const method = route.request().method();
      if (method === 'GET' && ++seen === 1) {
        await loading;
        return route.fulfill({ status: 503,json: { error: 'UNAVAILABLE' } });
      }
      if (method === 'POST' && route.request().postDataJSON()?.action === 'archive_class') await archiving;
      return route.continue();
    });

    await nav(teacher).getByRole('link',{ name: 'Lớp học',exact: true }).click();
    await expect(teacher.getByRole('heading',{ name: 'Lớp học của tôi' })).toBeVisible();
    await expect(teacher.getByText('Đang tải lớp học…')).toBeVisible();
    releaseLoad();
    await expect(teacher.getByRole('main').getByRole('alert')).toHaveText('Chưa tải được lớp học.');
    await saveShot(teacher,'classes-error-390');
    await teacher.getByRole('button',{ name: 'Thử lại',exact: true }).click();
    await teacher.getByRole('region',{ name:'Lớp 10A',exact:true }).getByRole('button',{ name:'Mở lớp' }).click();
    const trigger = teacher.getByRole('button',{ name: 'Lưu trữ lớp',exact: true });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await teacher.keyboard.press('Enter');
    const dialog = teacher.getByRole('dialog',{ name: 'Lưu trữ Lớp 10A?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button',{ name: 'Hủy' })).toBeFocused();
    await teacher.keyboard.press('Tab');
    await expect(dialog.getByRole('button',{ name: 'Xác nhận lưu trữ' })).toBeFocused();
    await teacher.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await teacher.keyboard.press('Enter');
    await saveShot(teacher,'classes-archive-dialog-390');
    await dialog.getByRole('button',{ name: 'Xác nhận lưu trữ' }).click();
    await expect(dialog).toHaveAttribute('aria-busy','true');
    await expect(dialog.getByRole('button',{ name: 'Đang lưu…' })).toBeDisabled();
    await teacher.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    releaseArchive();
    await expect(dialog).toBeHidden();
    await expect(teacher.getByRole('status')).toHaveText('Đã lưu trữ lớp.');
    await teacher.evaluate(() => window.scrollTo(0,document.documentElement.scrollHeight));
    const lastPanel = teacher.getByRole('button',{ name:'Khôi phục lớp' });
    const [content, dock] = await Promise.all([lastPanel.boundingBox(),nav(teacher).boundingBox()]);
    expect(content.y + content.height).toBeLessThan(dock.y);

    const student = await login('student',{ width: 390,height: 844 });
    await expect(nav(student).getByRole('link',{ name: 'Tham gia lớp' })).toBeVisible();
    await expect(nav(student).getByRole('link',{ name: 'Kết nối Google Drive' })).toHaveCount(0);
    await expect(nav(student).getByRole('link',{ name: 'Quản lý tài khoản' })).toHaveCount(0);
    await geometry(student,390,844,0);
    await saveShot(student,'student-home-390');

    const operator = await login('admin',{ width: 768,height: 1024 });
    await expect(nav(operator).getByRole('link',{ name: 'Quản lý tài khoản' })).toBeVisible();
    await expect(nav(operator).getByRole('link',{ name: 'Quản lý rubric mẫu' })).toBeVisible();
    await expect(nav(operator).getByRole('link',{ name: /Lớp học|Kết nối Google Drive/ })).toHaveCount(0);
    await geometry(operator,768,1024,205);
    await saveShot(operator,'admin-home-768');
    for (const page of [teacher,student,operator]) {
      await expect(page.getByRole('link',{ name: /demo|trải nghiệm|AI/i })).toHaveCount(0);
      await expect(page.getByRole('button',{ name: /\bAI\b/ })).toHaveCount(0);
    }
  } finally {
    releaseLoad?.();
    releaseArchive?.();
    try {
      for (const context of contexts) await context.close();
      const ids = accounts.map(account => account.id);
      await db.query('DELETE FROM garden.audit_events WHERE actor_id=ANY($1)',[ids]);
      if (classId) await db.query('DELETE FROM garden.classes WHERE id=$1',[classId]);
      await db.query('DELETE FROM garden.students WHERE id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.teachers WHERE id=ANY($1)',[ids]);
      await db.query('DELETE FROM garden.users WHERE id=ANY($1)',[ids]);
      for (const account of accounts) await keycloak('/users/' + account.subject,'DELETE');
    } finally {
      await db.end();
    }
  }
});
