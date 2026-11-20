import { expect, test } from '@playwright/test';

test('T06: loads the application and verifies PostgreSQL, Keycloak OIDC and the local Drive mock', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Vườn Văn');
  await expect(page.getByRole('heading', { name: 'Vườn Văn' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');

  const result = await page.evaluate(async () => {
    const response = await fetch('/api/health');
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  });
  expect(result).toEqual({
    status: 200,
    cache: 'no-store',
    body: { status: 'ready', checks: { database: true, oidc: true, driveMock: true } }
  });
});
