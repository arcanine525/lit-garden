import { test, expect } from '@playwright/test';
import { enter, fixture, key, origin, sessionHash, setPassword } from './auth-fixture.mjs';

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
    await expect(page.getByRole('heading', { name: 'Vào khu vườn của mình' })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Vào khu vườn của mình' })).toBeVisible();
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

test('An invalid callback shows a retry link that starts a fresh login', async ({ page }) => {
  await page.goto('/auth/callback');
  await expect(page.getByText('Chưa đăng nhập được. Hãy thử lại.')).toBeVisible();
  await page.getByRole('link', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vào khu vườn của mình' })).toBeVisible();
});
