import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { migrate, migrationPool } from '../infra/db/migrate.mjs';

const output = process.argv[2];
if (!output) throw Error('Usage: node --env-file=.env.local scripts/t35-visual.mjs OUTPUT_DIRECTORY');
const directory = resolve(output);
await mkdir(directory,{ recursive:true });
const fixture = 'garden_visual_' + randomBytes(6).toString('hex');
const local = migrationPool();
try {
  await local.query(`CREATE DATABASE ${fixture}`);
  try {
    const visual = migrationPool(fixture);
    try { await migrate(visual); } finally { await visual.end(); }
    process.exitCode = await new Promise((resolve,reject) => {
      const test = spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','tests/visual/playwright.config.ts'],{
        stdio:'inherit',
        env:{ ...process.env,APP_DB_NAME:fixture,T35_OUTPUT:directory,PLAYWRIGHT_CHANNEL:'chrome',NEXT_TELEMETRY_DISABLED:'1' }
      });
      test.once('error',reject);
      test.once('exit',code => resolve(code ?? 1));
    });
  } finally { await local.query(`DROP DATABASE ${fixture} WITH (FORCE)`); }
} finally { await local.end(); }
