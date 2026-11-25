import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { scenes, viewports } from '../../prototypes/editor/baselines/catalog.js';

export const fixedTime = new Date('2026-11-20T02:41:00.000Z');
const manifestPath = 'docs/design/baselines/manifest.json';
const approved = '9bbd164f0c97c0a016fd7cf53801a3c02fa9e9b7fd816ccd578d47e3763838fd';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function prepareCaptures(browser) {
  const output = process.env.T35_OUTPUT;
  const files = await readFile(manifestPath);
  expect(hash(files)).toBe(approved);
  const manifest = JSON.parse(files);
  expect(manifest).toHaveLength(87);
  for (const row of manifest) expect(hash(await readFile(join('docs/design/baselines',row.file)))).toBe(row.sha256);
  await mkdir(join(output,'full'),{ recursive:true });
  await mkdir(join(output,'viewport'),{ recursive:true });
  const evidence = { baselineSha256:approved,chrome:browser.version(),platform:process.platform,measurements:[],checks:[] };
  const flush = () => writeFile(join(output,'capture.json'),JSON.stringify(evidence,null,2) + '\n');

  async function capture(id,page,description,expected = true) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const shell = page.locator('main#app-main');
      const appScene = !['login','password'].includes(id);
      if (appScene) await expect(shell).toBeVisible();
      await expect.poll(() => page.evaluate(() => {
        const main = document.querySelector('#app-main');
        return {
          width:innerWidth,height:innerHeight,
          mainPadding:main ? getComputedStyle(main).paddingTop : null
        };
      }),{ message:`${id}: wait for viewport styles` }).toEqual({
        ...viewport,mainPadding:appScene ? viewport.width <= 760 ? '18px' : viewport.width <= 1150 ? '25px' : '28px' : null
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
        const images = Array.from(document.images);
        for (const img of images) if (img.loading === 'lazy') img.loading = 'eager';
        await Promise.all(images.map(img => img.decode().catch(() => {})));
        const active = document.activeElement;
        if (!document.querySelector('dialog[open]') && active instanceof HTMLElement
            && active.matches('input, textarea, [contenteditable="true"]')) active.blur();
        window.scrollTo(0,0);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const name = `${id}-${viewport.width}.png`;
      await page.screenshot({ path:join(output,'viewport',name),animations:'disabled' });
      const geometry = await page.evaluate(() => ({
        windowWidth:innerWidth,contentWidth:document.documentElement.scrollWidth,
        contentHeight:document.documentElement.scrollHeight,
        panels:Array.from(document.querySelectorAll('main .app-panel')).filter(panel => panel.getClientRects().length)
          .map(panel => {
            const box = panel.getBoundingClientRect();
            return { top:box.top + scrollY,height:box.height };
          }),
        dpr:devicePixelRatio,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
        blockedImages:Array.from(document.images).filter(img => !img.naturalWidth).length
      }));
      expect(geometry.dpr, name).toBe(1);
      expect(geometry.reducedMotion, name).toBe(true);
      expect(geometry.blockedImages, name).toBe(0);
      expect(geometry.contentWidth, name).toBe(viewport.width);
      await page.screenshot({ path:join(output,'full',name),animations:'disabled',fullPage:true });
      if (appScene) await expect(shell).toBeVisible();
      evidence.measurements.push({ id,viewport:[viewport.width,viewport.height],description,expected,...geometry });
      await flush();
    }
  }

  async function check(name,run) {
    try { await run(); evidence.checks.push({ name,passed:true }); }
    catch (error) { evidence.checks.push({ name,passed:false,error:String(error.message).slice(0,1600) }); }
    await flush();
  }

  return { capture,check,async finish() {
    expect([...new Set(evidence.measurements.map(row => row.id))].sort()).toEqual(scenes.map(row => row.id).sort());
    expect(evidence.measurements).toHaveLength(87);
    await flush();
  } };
}
