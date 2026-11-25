import { createHash, randomBytes } from 'node:crypto';
import { expect } from '@playwright/test';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { migrationPool } from '../../infra/db/migrate.mjs';

export const key = () => randomBytes(15).toString('hex');
export const sessionHash = value => createHash('sha256').update(value).digest('hex');
export const origin = 'http://127.0.0.1:3000';

export async function enter(page, username, password) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vào khu vườn của mình' })).toBeVisible();
  await expect(page.getByText(/trải nghiệm|demo/i)).toHaveCount(0);
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

export async function setPassword(page, password) {
  await expect(page.getByRole('heading', { name: 'Đổi mật khẩu', exact: true })).toBeVisible();
  await expect(page.locator('nav, a[href]')).toHaveCount(0);
  await expect.poll(async () => (await page.request.get(origin + '/api/me')).status()).toBe(401);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill(password);
  await page.getByLabel('Nhập lại mật khẩu mới').fill(password);
  await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
}

export async function fixture(run, role) {
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
