import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { scenes, viewports } from '../baselines/catalog.js';

const screenshots = fileURLToPath(new URL('../../../docs/design/baselines/', import.meta.url));
const reference = new URL('../../../docs/research/vuon-van-ca-nhan.pages.dev/', import.meta.url);
const capture = process.env.CAPTURE_BASELINES;
const captureIds = new Set(capture?.split(',') ?? []);
const expectedLevels = [
  [/Xác định vấn đề nghị luận/, ['', '0.25', '0']],
  [/Triển khai vấn đề/, ['', '0.75', '0.5', '0.25', '0']],
  [/Sử dụng bằng chứng/, ['', '0.5', '0.25', '0']],
  [/Tổ chức đoạn văn/, ['', '0.25', '0']],
  [/Diễn đạt/, ['', '0.25', '0']]
];

async function checkStudentProgress(page, home) {
  const list = page.getByRole('list', { name: 'Các bài theo bộ lọc' });
  const matchingRows = list.getByRole('listitem');
  const teacher = page.getByRole('combobox', { name: 'Giáo viên', exact: true });
  const schoolClass = page.getByRole('combobox', { name: 'Lớp', exact: true });
  async function expectProgress(mam, hoa, qua) {
    for (const [stage, count] of [['Mầm', mam], ['Hoa', hoa], ['Quả', qua]]) {
      await expect(page.getByRole('region', { name: stage, exact: true })).toContainText(`${count} bài`);
    }
  }

  await expect(matchingRows).toHaveCount(4);
  await expectProgress(1, 1, 1);
  await expect(matchingRows.filter({ hasText: 'Giọt mưa đầu mùa' })).toContainText('Đã đóng · chưa nộp');

  // Check the class filter alone before checking its interaction with teacher.
  await schoolClass.selectOption('10A1');
  await expectProgress(1, 1, 0);
  await expect(matchingRows).toHaveCount(2);
  await expect(matchingRows.filter({ hasText: '10A1 · Cô An' })).toHaveCount(2);
  if (home) await expect(page.getByText('Hạt mầm và trang viết')).toBeVisible();

  await teacher.selectOption('Cô Mai');
  await expect(schoolClass).toHaveValue('');
  await expect(schoolClass.locator('option')).toHaveText(['Tất cả các lớp', '10B1']);
  await expectProgress(0, 0, 1);
  await expect(matchingRows).toHaveCount(2);
  await expect(matchingRows.filter({ hasText: '10B1 · Cô Mai' })).toHaveCount(2);
  await expect(matchingRows.filter({ hasText: 'Đường về nhà' })).toContainText('Đã nhận xét');
  if (home) await expect(page.getByText('Hạt mầm và trang viết')).toHaveCount(0);

  await schoolClass.selectOption('10B1');
  await expectProgress(0, 0, 1);
  await expect(matchingRows.filter({ hasText: 'Đã đóng · chưa nộp' })).toHaveCount(1);
}

async function checkPublicationGate(page, republish) {
  const criteria = page.getByRole('region', { name: 'Tiêu chí chấm' });
  await expect(criteria.getByRole('combobox')).toHaveCount(5);
  const selects = expectedLevels.map(([name]) => criteria.getByRole('combobox', { name }));
  for (const [index, select] of selects.entries()) {
    const values = await select.locator('option').evaluateAll(options => options.map(option => option.value));
    expect(values).toEqual(expectedLevels[index][1]);
  }

  const submit = page.getByRole('button', { name: republish ? 'Trả lại bài' : 'Trả bài', exact: true });
  const progress = page.getByRole('status');
  if (republish) {
    await expect(progress).toContainText('5/5 tiêu chí đã chấm · 2,00 / 2,00 điểm');
    await expect(submit).toBeEnabled();
  } else {
    await expect(progress).toContainText('2/5 tiêu chí đã chấm');
    await expect(submit).toBeDisabled();
    for (const select of selects.slice(2)) await select.selectOption('0');
    await expect(progress).toContainText('5/5 tiêu chí đã chấm · 1,00 / 2,00 điểm');
    await expect(submit).toBeEnabled();
  }

  await page.getByLabel('Nhận xét chung (không bắt buộc)').fill('');
  await expect(submit).toBeEnabled();
  await selects[0].selectOption('');
  await expect(progress).toContainText('4/5 tiêu chí đã chấm');
  await expect(submit).toBeDisabled();
  await selects[0].selectOption('0');
  await expect(submit).toBeEnabled();
}

async function checkAssignmentScale(page) {
  const scale = page.getByRole('spinbutton', { name: 'Thang điểm của bài' });
  await expect(scale).toHaveValue('2');
  await expect(scale).toHaveAttribute('min', '0.25');
  await expect(scale).toHaveAttribute('max', '100');
  await expect(scale).toHaveAttribute('step', '0.25');
  for (const [value, valid] of [['0', false], ['2.1', false], ['2.25', true], ['100', true], ['100.25', false]]) {
    await scale.fill(value);
    expect(await scale.evaluate(input => input.validity.valid)).toBe(valid);
  }
}

for (const viewport of viewports) {
  test(`T05 renders all baseline fixtures at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (capture) await mkdir(screenshots, { recursive: true });
    for (const scene of scenes) {
      await test.step(scene.id, async () => {
        const errors = [];
        const log = error => errors.push(error.message);
        page.on('pageerror', log);
        try {
          await page.goto(`/baselines/?scene=${scene.id}`);
          await expect(page.getByRole('heading', { level: 1, name: scene.title, includeHidden: true })).toBeVisible();
          const rendered = await page.evaluate(async () => {
            await Promise.all([
              document.fonts.load('600 27px Lora', 'Vườn Văn'),
              document.fonts.load('400 14px "Be Vietnam Pro"', 'Tiếng Việt'),
              ...Array.from(document.images, image => image.decode())
            ]);
            await document.fonts.ready;
            const fontFamilies = [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family);
            return {
              width: document.documentElement.scrollWidth, top: scrollY, fontFamilies,
              sidebar: getComputedStyle(document.querySelector('.sidebar') ?? document.body).display,
              bottomNav: getComputedStyle(document.querySelector('.mobile-nav') ?? document.body).display
            };
          });
          expect(errors).toEqual([]);
          expect(rendered.width).toBe(viewport.width);
          expect(rendered.top).toBe(0);
          expect(rendered.fontFamilies).toEqual(expect.arrayContaining(['Lora', 'Be Vietnam Pro']));
          if (scene.role !== 'public' && scene.id !== 'password') {
            expect(rendered.sidebar === 'none').toBe(viewport.width === 390);
            expect(rendered.bottomNav === 'flex').toBe(viewport.width === 390);
          }
          if (scene.id === 'login') await expect(page.getByText(/trải nghiệm|demo/i)).toHaveCount(0);
          if (scene.id === 'assignment-reopen') await expect(page.getByRole('dialog')).toContainText('được giao bổ sung');
          if (scene.id === 'student-source') await expect(page.getByRole('status')).toContainText('Mất kết nối');
          if (scene.id === 'student-result') await expect(page.getByText('Lịch sử công bố')).toHaveCount(0);
          if (scene.id.endsWith('-rubrics') && scene.role !== 'admin') {
            const source = JSON.parse(await readFile(new URL(`${scene.id}-${viewport.width}.json`, reference), 'utf8'));
            const summaries = await page.locator('summary').allTextContents();
            expect(summaries).toHaveLength(5);
            for (const criterion of summaries) expect(source.text).toContain(criterion);
            expect(source.text).not.toContain('Thông báo');
            await expect(page.getByRole('link', { name: 'Thông báo' })).toBeVisible();
          }
          if (capture === '1' || captureIds.has(scene.id)) {
            await page.mouse.move(0, 0);
            await page.screenshot({ path: join(screenshots, `${scene.id}-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
          }
          if (scene.id === 'password') {
            await expect(page.locator('nav, a[href]')).toHaveCount(0);
            await expect(page.getByLabel('Mật khẩu mới', { exact: true })).toBeVisible();
            await expect(page.getByText('Em cần đổi mật khẩu tạm', { exact: false })).toBeVisible();
          }
          if (scene.id === 'student-home' || scene.id === 'garden') await checkStudentProgress(page, scene.id === 'student-home');
          if (scene.id === 'review-draft' || scene.id === 'review-republish') await checkPublicationGate(page, scene.id === 'review-republish');
          if (scene.id === 'assignment-author') await checkAssignmentScale(page);
          if (scene.id === 'assignment-reopen') {
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog')).toHaveCount(0);
          }
        } finally {
          page.off('pageerror', log);
        }
      });
    }
  });
}
