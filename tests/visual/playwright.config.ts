import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  outputDir: process.env.T35_OUTPUT + '/playwright',
  timeout: 240_000,
  webServer: { command:'npm run start',cwd:process.cwd(),url:'http://127.0.0.1:3000/api/health',timeout:60_000 }
});
