import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'artifacts');
await mkdir(out, { recursive: true });
const baseURL = process.env.OQY_BASE_URL || 'http://127.0.0.1:5173';
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.CHROME_PATH || (existsSync(systemChrome) ? systemChrome : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const scans = [];
const interactionChecks = [];
const failures = [];
const views = [
  ['overview', 'Обзор программы'],
  ['books', 'Сравнение учебников'],
  ['plan', 'Планирование часов'],
  ['data', 'Источники данных'],
  ['method', 'Методология'],
];
const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const started = new Date().toISOString();
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const viewportName = `${viewport.width}x${viewport.height}`;
    await page.goto(baseURL);
    await expect(page.locator('.metric').first().locator('strong')).toHaveText('144');
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      const style = getComputedStyle(el);
      return { tag: el.tagName, text: el.textContent.trim().slice(0, 80), outline: style.outline, visible: el.matches(':focus-visible') && style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0 };
    });
    interactionChecks.push({ viewport: viewportName, check: 'keyboard focus indicator', ...focus });
    if (!focus.visible) failures.push(`${viewportName}: no visible keyboard focus indicator`);
    for (const [id, label] of views) {
      const navButton = page.getByRole('button', { name: label, exact: true });
      await expect(navButton).toBeVisible();
      await navButton.click();
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      if (overflow.document > overflow.viewport) failures.push(`${viewportName}/${id}: horizontal document overflow ${overflow.document}px`);
      const table = page.locator('.table-wrap');
      if (await table.count() && await table.evaluate(el => el.scrollWidth > el.clientWidth)) {
        await table.focus();
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
        interactionChecks.push({ viewport: viewportName, view: id, check: 'keyboard horizontal table scroll', status: 'pass' });
        await table.evaluate(el => { el.scrollLeft = 0; });
      }
      const results = await new AxeBuilder({ page }).withTags(tags).analyze();
      const violations = results.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, failureSummary: n.failureSummary })) }));
      scans.push({ viewport: viewportName, view: id, overflow, violations, passes: results.passes.length, incomplete: results.incomplete.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })) });
      if (violations.length) failures.push(`${viewportName}/${id}: ${violations.length} axe violations`);
      if (id === 'overview') await page.screenshot({ path: path.join(out, viewport.width === 1440 ? 'desktop.png' : 'mobile.png'), fullPage: true });
      if (id === 'method' && viewport.width === 390) interactionChecks.push({ viewport: viewportName, check: 'mobile methodology navigation', status: 'pass' });
    }
    await context.close();
  }
  const failureContext = await browser.newContext({ viewport: viewports[0] });
  const page = await failureContext.newPage();
  page.setDefaultTimeout(10000);
  await page.route('**/data/demo.csv', route => route.abort('failed'));
  await page.goto(baseURL);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Пока нет результатов' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть демо', exact: true })).toBeVisible();
  interactionChecks.push({ check: 'initial demo fetch failure', status: 'pass', observation: 'Error and empty state visible with retry action; no fabricated analytics.' });
  await page.unroute('**/data/demo.csv');
  await page.getByRole('button', { name: 'Открыть демо', exact: true }).click();
  await expect(page.locator('.metric').first().locator('strong')).toHaveText('144');
  interactionChecks.push({ check: 'empty-state retry recovery', status: 'pass', observation: 'Retry loads the 144-student demonstration dataset.' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const demoCSV = await readFile(path.join(root, 'public/data/demo.csv'), 'utf8');
  await page.route('**/data/demo.csv', async route => { await gate; await route.fulfill({ status: 200, contentType: 'text/csv', body: demoCSV }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status')).toContainText('Обрабатываем данные');
  await expect(page.getByRole('button', { name: 'Загрузить CSV / Excel', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('.metric').first().locator('strong')).toHaveText('144');
  interactionChecks.push({ check: 'loading state and completion', status: 'pass', observation: 'Loading status and disabled upload shown while demo response is held; analysis appears after release.' });
  await failureContext.close();
} catch (error) {
  failures.push(String(error));
} finally {
  const report = { status: failures.length ? 'fail' : 'pass', recordedAt: started, baseURL, browser: await browser.version(), scope: 'Automated axe WCAG 2/2.1 A/AA checks; keyboard focus style, document overflow, navigation, loading and initial network-failure recovery. Not a complete manual accessibility certification.', tags, targetViewports: viewports.map(v => `${v.width}x${v.height}`), scans, interactionChecks, failures };
  await writeFile(path.join(out, 'accessibility.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, scans: scans.length, violations: scans.flatMap(s => s.violations.map(v => ({ viewport: s.viewport, view: s.view, id: v.id, nodes: v.nodes.map(n => n.target) }))), interactionChecks, failures }, null, 2));
  await browser.close();
}
if (failures.length) process.exitCode = 1;
