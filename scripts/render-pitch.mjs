import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.CHROME_PATH || (existsSync(systemChrome) ? systemChrome : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve('public/pitch.html')).href);
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  await mkdir('artifacts', { recursive: true });
  await page.pdf({ path: 'artifacts/OQY-pitch.pdf', printBackground: true, preferCSSPageSize: true });
  console.log('Rendered artifacts/OQY-pitch.pdf from public/pitch.html');
} finally {
  await browser.close();
}
