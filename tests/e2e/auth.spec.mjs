import { createHash, randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';

const key = () => randomBytes(15).toString('hex');
const sessionHash = value => createHash('sha256').update(value).digest('hex');
const origin = 'http://127.0.0.1:3000';

async function enter(page, username, password) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vào khu vườn của mình' })).toBeVisible();
  await expect(page.getByText(/trải nghiệm|demo/i)).toHaveCount(0);
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

async function setPassword(page, password) {
  await expect(page.getByRole('heading', { name: 'Đổi mật khẩu', exact: true })).toBeVisible();
  await expect(page.locator('nav, a[href]')).toHaveCount(0);
  await expect.poll(async () => (await page.request.get(origin + '/api/me')).status()).toBe(401);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill(password);
  await page.getByLabel('Nhập lại mật khẩu mới').fill(password);
  await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
}

async function fixture(run, role) {
  const admin = await keycloakAdmin();
  const db = migrationPool();
  const username = `fixture_${randomBytes(6).toString('hex')}`;
  const password = key();
  let identity;
  try {
    identity = await provisionIdentity(admin, db, { username, name: 'Người thử nghiệm', role, password });
    await run({ db, admin, username, password, identity });
  } finally {
    try {
      if (identity) {
        await db.query('DELETE FROM garden.students WHERE id=$1', [identity.id]);
        await db.query('DELETE FROM garden.teachers WHERE id=$1', [identity.id]);
        await db.query('DELETE FROM garden.users WHERE id=$1', [identity.id]);
        await admin(`/users/${identity.subject}`, 'DELETE');
      }
    } finally {
      await db.end();
    }
  }
}

test('T08 student without email changes temporary password before the API creates a session', async ({ page, context }) => {
  await fixture(async ({ admin, username, password, identity, db }) => {
    const keycloakUser = await admin(`/users/${identity.subject}`);
    expect(keycloakUser.email).toBeFalsy();
    expect(keycloakUser.requiredActions).toContain('UPDATE_PASSWORD');
    expect((await page.request.get('/api/me')).status()).toBe(401);
    await enter(page, username, password);
    const permanent = key();
    await setPassword(page, permanent);
    await expect(page.getByText('Người thử nghiệm · Học sinh')).toBeVisible();
    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toEqual({
      user: { id: identity.id, username, display_name: 'Người thử nghiệm', role: 'student' }
    });

    const cookie = (await context.cookies(origin)).find(item => item.name === 'garden_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
    const rejected = await page.request.post('/auth/logout', { headers: { Origin: 'https://example.invalid' }, maxRedirects: 0 });
    expect(rejected.status()).toBe(403);
    expect((await page.request.get('/api/me')).status()).toBe(200);

    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    const confirm = page.getByRole('button', { name: /sign out|log out|logout|đăng xuất/i });
    if (new URL(page.url()).origin !== origin) await confirm.click();
    await expect(page).toHaveURL(origin + '/');
    await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
    expect((await page.request.get('/api/me', { headers: { Cookie: `garden_session=${cookie.value}` } })).status()).toBe(401);
    const stored = await db.query('SELECT count(*) FROM garden.app_sessions WHERE handle_digest=$1', [sessionHash(cookie.value)]);
    expect(stored.rows[0].count).toBe('0');
  }, 'student');
});

test('T08 creates the admin from the operator secret and rejects expired teacher sessions', async ({ page, context }) => {
  await fixture(async ({ admin, username, password, db }) => {
    const [keycloakBootstrap] = await admin(`/users?username=${encodeURIComponent(process.env.APP_BOOTSTRAP_USER)}&exact=true`);
    const linked = await db.query('SELECT role,status FROM garden.users WHERE oidc_subject=$1 AND oidc_issuer=$2',
      [keycloakBootstrap.id, process.env.KEYCLOAK_ISSUER]);
    expect(linked.rows).toEqual([{ role: 'admin', status: 'active' }]);
    await enter(page, username, password);
    await setPassword(page, key());
    await expect(page.getByText('Người thử nghiệm · Giáo viên')).toBeVisible();
    const me = await page.request.get('/api/me');
    expect((await me.json()).user.role).toBe('teacher');
    const cookie = (await context.cookies(origin)).find(item => item.name === 'garden_session');
    const expired = await db.query("UPDATE garden.app_sessions SET expires_at=now()-interval '1 second' WHERE handle_digest=$1",
      [sessionHash(cookie.value)]);
    expect(expired.rowCount).toBe(1);
    expect((await page.request.get('/api/me')).status()).toBe(401);
    await page.reload();
    await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  }, 'teacher');
});

test('T08 an administrator receives the admin role from the linked Keycloak identity', async ({ page }) => {
  await fixture(async ({ username, password }) => {
    await enter(page, username, password);
    await setPassword(page, key());
    await expect(page.getByText('Người thử nghiệm · Quản trị viên')).toBeVisible();
    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(200);
    expect((await me.json()).user.role).toBe('admin');
  }, 'admin');
});
