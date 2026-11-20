import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env.local')) loadEnvFile('.env.local');

export default defineConfig({
  testDir: 'tests/e2e',
  // The identity recovery test temporarily pauses this local stack's Keycloak.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh'
  },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:3000/api/health',
    timeout: 60_000
  }
});
