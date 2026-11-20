import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

export async function unusedPort() {
  const socket = createServer().listen(0,'127.0.0.1');
  await once(socket,'listening');
  const port = socket.address().port;
  await new Promise((success,reject) => socket.close(error => error ? reject(error) : success()));
  return port;
}

export async function restartableApp(port) {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
    stdio:'ignore',env:{ ...process.env,APP_ORIGIN:origin,NEXT_TELEMETRY_DISABLED:'1' }
  });
  const exit = once(child,'exit');
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exit;
  }
  try {
    await expect.poll(() => fetch(origin + '/api/health').then(response => response.status,() => 0),{ timeout:15_000 }).toBe(200);
    return { origin,pid:child.pid,stop };
  } catch (error) { await stop(); throw error; }
}
