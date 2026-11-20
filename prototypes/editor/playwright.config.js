import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4311', channel: 'chrome', viewport: { width: 1200, height: 900 }, locale: 'vi-VN', trace: 'retain-on-failure' },
  reporter: [['list']],
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4311', reuseExistingServer: !process.env.CI, timeout: 60000 }
});
