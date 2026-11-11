import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

// User-path regressions introduced by the design refinement. Calculation,
// upload failures, exports and axe checks live in the existing test scripts.
const baseURL = process.env.OQY_BASE_URL || 'http://127.0.0.1:5173';
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.CHROME_PATH || (existsSync(systemChrome) ? systemChrome : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const outputDirectory = new URL('../artifacts/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const report = {
  recordedAt: new Date().toISOString(),
  baseURL,
  browser: await browser.version(),
  status: 'running',
  scope: 'Keyboard disclosure/skip-link, current navigation, narrow and intermediate reflow, long imported labels, reduced motion. The 720 CSS-pixel viewport at DPR 2 models the available layout width of a 1440-pixel window at 200% zoom; it is not a native browser zoom or screen-reader certification.',
  checks: [],
  pageErrors: [],
};
const views = [
  ['overview', 'Обзор программы'],
  ['books', 'Сравнение учебников'],
  ['plan', 'Планирование часов'],
  ['data', 'Источники данных'],
  ['method', 'Методология'],
];
const record = (name, detail = {}) => report.checks.push({ name, status: 'pass', ...detail });
const ready = async page => {
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(baseURL);
  await expect(page.locator('.metric strong').first()).toHaveText('144');
};
const noDocumentOverflow = async page => {
  const size = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }));
  expect(size.documentWidth).toBeLessThanOrEqual(size.width);
  return size;
};

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await ready(page);
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  record('Skip-link bypasses navigation and moves keyboard focus to main content');

  const fractions = page.getByRole('button', { name: /Дроби/ });
  await fractions.focus();
  await expect(fractions).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(fractions).toHaveAttribute('aria-expanded', 'true');
  const detailId = await fractions.getAttribute('aria-controls');
  expect(detailId).toBeTruthy();
  const details = page.locator('.topic-detail');
  await expect(details).toHaveAttribute('id', detailId);
  await expect(details).toContainText('144 учеников');
  await expect(details).toBeInViewport();
  await page.keyboard.press('Space');
  await expect(fractions).toHaveAttribute('aria-expanded', 'false');
  await expect(details).toHaveCount(0);
  await expect(fractions).toBeFocused();
  record('Topic details open with Enter and collapse with Space without losing focus');

  await page.keyboard.press('Enter');
  const close = page.getByRole('button', { name: 'Закрыть подробности', exact: true });
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveCount(0);
  await expect(fractions).toBeFocused();
  record('Closing topic details returns keyboard focus to the originating topic');
  await context.close();

  for (const viewport of [
    { width: 320, height: 740 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 720, height: 450, deviceScaleFactor: 2 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor || 1,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await ready(page);
    const label = `${viewport.width}x${viewport.height}${viewport.deviceScaleFactor ? '@2x' : ''}`;
    for (const [id, name] of views) {
      const navigation = page.getByRole('button', { name, exact: true });
      await navigation.click();
      await expect(navigation).toHaveAttribute('aria-current', 'page');
      const size = await noDocumentOverflow(page);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (id === 'overview') {
        const topic = page.locator('.topic-row').first();
        const bounds = await topic.boundingBox();
        expect(bounds.width).toBeGreaterThan(100);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        const reduced = await topic.evaluate(element => ({
          animation: getComputedStyle(element).animationName,
          transition: getComputedStyle(element).transitionDuration,
        }));
        expect(reduced.animation).toBe('none');
        expect(reduced.transition.split(',').every(value => parseFloat(value) === 0)).toBe(true);
        await page.screenshot({ path: new URL(`design-check-${label}.png`, outputDirectory).pathname, fullPage: true });
      }
      record('Navigation and content reflow', { viewport: label, view: id, ...size });
    }

    // Valid source values must wrap without determining the page's width.
    const long = 'ОченьДлинноеНазвание'.repeat(10);
    const csv = 'student_id,school,grade,subject,topic,textbook,score,max_score,hours\n'
      + `Long,${long},7,${long},${long},${long},10,20,5\n`;
    await page.locator('input[type=file]').setInputFiles({ name: `${long}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByRole('status')).toContainText('Загружено');
    for (const [id, name] of views.filter(([id]) => id !== 'method')) {
      await page.getByRole('button', { name, exact: true }).click();
      await noDocumentOverflow(page);
    }
    record('Long labels and filename fit overview, books, plan and data', { viewport: label, labelCharacters: long.length });
    await context.close();
  }
  expect(report.pageErrors).toEqual([]);
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(new URL('design-check.json', outputDirectory), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
