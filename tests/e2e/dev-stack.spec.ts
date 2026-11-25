import { expect, test } from '@playwright/test';

test('T06: loads the application and verifies PostgreSQL, Keycloak OIDC and the local Drive mock', async ({ page, request }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Đăng nhập · Vườn Văn');
  await expect(page.getByRole('heading', { name: 'Vào khu vườn của mình' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');

  for (const [width,height,inputWidth] of [[1440,900,350],[768,1024,304],[390,844,330]]) {
    await page.setViewportSize({ width,height });
    await expect(page.getByText('Không gian sáng tạo và kết nối')).toBeVisible();
    await expect(page.getByLabel('Tên đăng nhập')).toHaveCSS('width',inputWidth + 'px');
    await expect(page.locator('.art p')).toHaveCSS('font-size',width <= 760 ? '30px' : '45px');
    await expect(page.locator('.art p')).toHaveCSS('font-weight','700');
    await expect(page.getByRole('button',{ name:'Đăng nhập' })).toBeInViewport();
  }

  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({
    status: 'ready', checks: { database: true, oidc: true, driveMock: true }
  });
});
