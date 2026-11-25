import { expect, test } from '@playwright/test';

test('T06: loads the application and verifies PostgreSQL, Keycloak OIDC and the local Drive mock', async ({ page, request }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Đăng nhập · Vườn Văn');
  await expect(page.getByRole('heading', { name: 'Vào khu vườn của mình' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');

  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({
    status: 'ready', checks: { database: true, oidc: true, driveMock: true }
  });
});
