import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "artifacts");
await mkdir(out, { recursive: true });
const baseURL = process.env.OQY_BASE_URL || "http://127.0.0.1:5173";
const systemChrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
  process.env.CHROME_PATH ||
  (existsSync(systemChrome) ? systemChrome : undefined);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const steps = [];
const started = performance.now();
const mark = (name, details = {}) =>
  steps.push({
    name,
    elapsedSeconds: +((performance.now() - started) / 1000).toFixed(3),
    ...details,
  });
const shot = (name) =>
  page.screenshot({ path: path.join(out, `e2e-${name}.png`), fullPage: true });
let report;
try {
  await page.goto(baseURL);
  await expect(
    page.getByText("3 школы · 864 результатов", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".metric").first().locator("strong")).toHaveText(
    "144",
  );
  await expect(page.locator(".topic-row")).toHaveCount(6);
  await shot("overview");
  mark("overview", { students: 144, rows: 864, topics: 6 });
  await page
    .getByRole("button", { name: /Дроби/, exact: false })
    .click();
  await expect(page.locator(".topic-detail")).toContainText("144 учеников");
  await page.getByRole("button", { name: "Закрыть подробности" }).click();
  mark("topic details");
  await page
    .getByRole("button", { name: "Сравнение учебников", exact: true })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(2);
  await expect(page.getByText("6 общих тем", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Разница в результатах не доказывает влияние учебника.", {
      exact: false,
    }),
  ).toBeVisible();
  await shot("books");
  mark("textbook comparison", { books: 2, commonTopics: 6 });
  await page
    .getByRole("button", { name: "Планирование часов", exact: true })
    .click();
  await expect(page.getByLabel("Бюджет часов")).toHaveValue("34");
  await expect(page.locator("tfoot td").nth(3)).toHaveText("34");
  mark("default plan", { totalHours: 34 });
  await page.getByLabel("Бюджет часов").fill("2");
  await page.getByLabel("Бюджет часов").press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Введите целое число от 6",
  );
  await expect(page.locator("tfoot td").nth(3)).toHaveText("34");
  mark("invalid budget rejected", { previousBudgetRetained: 34 });
  await page.getByLabel("Бюджет часов").fill("40");
  await page.getByLabel("Бюджет часов").press("Enter");
  await expect(page.locator("tfoot td").nth(3)).toHaveText("40");
  const proposedHours = await page
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((r) => Number(r.querySelectorAll("td")[3].textContent)),
    );
  expect(proposedHours.reduce((a, b) => a + b, 0)).toBe(40);
  expect(proposedHours.every((n) => Number.isInteger(n) && n >= 1)).toBe(true);
  await shot("plan");
  mark("40-hour plan", { proposedHours });
  const reportDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать отчёт", exact: true })
    .click();
  const reportDownload = await reportDownloadPromise;
  report = JSON.parse(await readFile(await reportDownload.path(), "utf8"));
  expect(report.analysis.recommendedTotal).toBe(40);
  expect(report.analysis.students).toBe(144);
  expect(report.source).toBe("Демонстрационный набор");
  const planDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать план CSV", exact: true })
    .click();
  const planDownload = await planDownloadPromise;
  const planCSV = await readFile(await planDownload.path(), "utf8");
  expect(
    planCSV
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\n"),
  ).toHaveLength(7);
  expect(planCSV).toContain("recommended_hours");
  mark("exports verified", {
    report: reportDownload.suggestedFilename(),
    plan: planDownload.suggestedFilename(),
  });
  await page
    .getByRole("button", { name: "Источники данных", exact: true })
    .click();
  await page
    .getByLabel("CSV или Excel с результатами")
    .setInputFiles({
      name: "invalid.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("wrong,header\n1,2"),
    });
  await expect(page.getByRole("alert")).toContainText(
    "Отсутствуют столбцы",
  );
  await expect(page.locator(".data-info")).toContainText(
    "864 результатов · 144 учеников",
  );
  await shot("invalid-csv");
  mark("invalid CSV rejected", { previousRowsRetained: 864 });
  await page
    .getByLabel("CSV или Excel с результатами")
    .setInputFiles(path.join(root, "public/data/template.csv"));
  await expect(page.getByRole("status")).toContainText(
    "Загружено 6 результатов",
  );
  await expect(page.locator(".metric").first().locator("strong")).toHaveText(
    "1",
  );
  await expect(page.locator(".dataset-description")).toHaveText("template.csv");
  mark("valid CSV imported", { rows: 6, students: 1 });
  await page
    .getByRole("button", { name: "Сравнение учебников", exact: true })
    .click();
  await expect(page.locator(".book-score")).toHaveText("—");
  mark("single textbook cannot be compared");
  await page
    .getByRole("button", { name: "Источники данных", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Восстановить демо-набор", exact: true })
    .click();
  await expect(page.locator(".data-info")).toContainText(
    "864 результатов · 144 учеников",
  );
  await page
    .getByRole("button", { name: "Обзор программы", exact: true })
    .click();
  await expect(page.locator(".metric").first().locator("strong")).toHaveText(
    "144",
  );
  mark("demo restored");
  const walkthroughSeconds = +((performance.now() - started) / 1000).toFixed(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await shot("mobile");
  expect(errors).toEqual([]);
  const result = {
    status: "pass",
    baseURL,
    recordedAt: new Date().toISOString(),
    walkthroughSeconds,
    timingScope:
      "Automated functional walkthrough, includes screenshot writes and downloads; not a human speech rehearsal or performance benchmark.",
    browser: await browser.version(),
    viewports: ["1440x1000", "390x844"],
    steps,
    pageErrors: errors,
    exportedReport: report,
  };
  await rm(path.join(out, "e2e-failure.png"), { force: true });
  await writeFile(
    path.join(out, "e2e.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        status: result.status,
        walkthroughSeconds,
        steps: steps.length,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await shot("failure").catch(() => {});
  await writeFile(
    path.join(out, "e2e.json"),
    JSON.stringify(
      {
        status: "fail",
        recordedAt: new Date().toISOString(),
        steps,
        pageErrors: errors,
        error: String(error),
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await browser.close();
}
