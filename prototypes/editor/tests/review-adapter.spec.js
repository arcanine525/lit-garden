import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { readReview, writeReview } from '../src/review.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('T04: editor → submission bytes → review adapter write/read → DOM after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở fixture tích hợp' }).click();
  const rich = page.getByRole('textbox', { name: 'editable markdown' });
  await expect(rich.getByRole('table')).toBeVisible();
  await expect.poll(() => rich.getByRole('img', { name: 'Hoa riêng tư' }).evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Chốt bản nộp mẫu từ editor' }).click();
  await expect(page.getByTestId('contract-context')).toContainText('phiên bản 2');
  const id = new URL(page.url()).searchParams.get('contract');
  const path = `/api/mock/review-fixtures/${id}`;
  const before = await (await page.request.get(path)).json();
  const file = await (await page.request.get(`${path}/submission-file`)).body();
  expect(sha(file)).toBe(before.submissionSha256);
  expect(file.toString()).toContain('garden.submission/1');
  expect(file.toString()).toContain('![Hoa riêng tư](/api/assets/c2fed575-0c3a-47c4-863a-fff392ced1ac)');
  expect(file.toString()).not.toContain('/api/asset-views/');
  expect(before.markdown).toContain('a\u0306\u0301');
  expect(before.markdown).toContain('👩🏽‍🏫');

  const article = page.getByTestId('submission');
  await article.locator('strong').filter({ hasText: 'Hoa nở.' }).evaluate(strong => {
    const range = document.createRange();
    range.selectNodeContents(strong.querySelector('[data-start]'));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    strong.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.getByText(/Vùng chọn UTF-16: \d+–\d+/)).toBeVisible();
  const writePromise = page.waitForResponse(response => response.url().endsWith('/publication') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Công bố qua adapter' }).click();
  const written = await writePromise;
  expect(written.status()).toBe(201);
  const request = written.request().postDataJSON();
  const proposal = readReview(request.proposal);
  const loaded = await (await page.request.get(`${path}/publication`)).json();
  expect(loaded.garden).toMatchObject({
    schema: 'garden.review-publication/1', submissionId: id, version: 2,
    rubricId: before.rubricId, rubricSha256: before.rubricSha256,
    submissionSha256: sha(file), textProjection: 'vv-render-text-v1',
    scores: [{ criterionId: 'images', levelId: 'complete', value: '2.00' }]
  });
  expect(loaded.garden.comments[0]).toMatchObject({
    id: proposal.annotations[0].id,
    anchor: { exact: 'Hoa nở.', projectionSha256: proposal.annotations[0].anchor.textHash }
  });
  expect(loaded.file).toContain('garden.review-publication/1');

  await page.reload();
  await expect(page.getByLabel('Trạng thái review')).toHaveText('Đã đọc công bố qua adapter');
  await expect(page.getByTestId('contract-publication')).toContainText(loaded.garden.id);
  const mark = article.locator('strong mark');
  await expect(mark).toHaveText('Hoa nở.');
  await expect(mark).toHaveAttribute('data-annotation', loaded.garden.comments[0].id);
  await expect(article.locator('mark')).toHaveCount(1);
  await expect.poll(() => article.getByRole('img', { name: 'Hoa riêng tư' }).evaluate(img => img.naturalWidth)).toBeGreaterThan(0);

  const projection = await article.textContent();
  const broken = structuredClone(proposal);
  const emojiStart = projection.indexOf('👩');
  broken.annotations[0].anchor = {
    ...broken.annotations[0].anchor, start: emojiStart + 1, end: emojiStart + 2,
    exact: projection.slice(emojiStart + 1, emojiStart + 2),
    prefix: projection.slice(Math.max(0, emojiStart + 1 - 32), emojiStart + 1),
    suffix: projection.slice(emojiStart + 2, emojiStart + 2 + 32)
  };
  const invalid = await page.request.post(`${path}/publication`, { data: { proposal: writeReview(broken) } });
  expect(invalid.status()).toBe(409);
  expect((await invalid.json()).error).toBe('anchor-conflict');

  const changed = await (await page.request.post(`${path}/external-edit`, { data: {} })).json();
  expect(changed.submissionSha256).not.toBe(sha(file));
  expect(changed.projectionSha256).toBe(sha(Buffer.from(projection)));
  const blocked = await page.request.post(`${path}/publication`, { data: request });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).error).toBe('SUBMISSION_HASH_MISMATCH');
  await page.getByRole('button', { name: 'Nạp review Markdown' }).click();
  await expect(page.getByLabel('Trạng thái review')).toHaveText('SUBMISSION_HASH_MISMATCH');
  await expect(article.locator('mark')).toHaveCount(0);

  await page.request.post(`${path}/external-edit`, { data: { restore: true } });
  expect((await (await page.request.get(`${path}/publication`)).json()).file).toBe(loaded.file);
});
