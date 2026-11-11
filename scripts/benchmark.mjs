/** Run with Node >=22.18 (built-in TypeScript type stripping): node scripts/benchmark.mjs */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { analyze } from '../src/lib/analytics.ts';
import { parseCSV } from '../src/lib/csv.ts';

const file = new URL('../public/data/demo.csv', import.meta.url);
const contents = readFileSync(file, 'utf8');
const parsed = parseCSV(contents);
if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
const iterations = 100;
const warmupIterations = 20;
for (let i = 0; i < warmupIterations; i++) analyze(parsed.rows);
const timings = [];
let result;
for (let i = 0; i < iterations; i++) {
  const start = performance.now();
  result = analyze(parsed.rows);
  timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
const round = value => Number(value.toFixed(4));
const report = {
  measuredAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  workload: { dataset: 'public/data/demo.csv', synthetic: true, rows: parsed.rows.length, sha256: createHash('sha256').update(contents).digest('hex'), engineSha256: createHash('sha256').update(readFileSync(new URL('../src/lib/analytics.ts', import.meta.url))).digest('hex') },
  methodology: { operation: 'analyze(parsed.rows)', iterations, warmupIterations, timingScope: 'Analytics only; excludes CSV parsing, browser rendering, file I/O and page startup.', percentile: 'nearest rank', limitation: 'Local synthetic-data timing; not a production load test or evidence of educational efficacy.' },
  timingMs: { median: round((timings[49] + timings[50]) / 2), p95: round(timings[Math.ceil(0.95 * iterations) - 1]), min: round(timings[0]), max: round(timings.at(-1)) },
  metrics: { students: result.students, schools: result.schools, mean: round(result.mean), mastery: round(result.mastery), totalHours: result.totalHours, recommendedTotal: result.recommendedTotal, commonTopics: result.commonTopics, topics: result.topics, books: result.books },
  validation: { acceptedRows: parsed.rows.length, errors: parsed.errors, hoursConserved: result.totalHours === result.recommendedTotal, integerPositiveHours: result.topics.every(topic => Number.isInteger(topic.recommendedHours) && topic.recommendedHours >= 1) },
  model: { used: false, requests: 0, tokens: 0, paidResourcesLaunched: false },
};
mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
writeFileSync(new URL('../artifacts/benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report.timingMs, ...report.metrics, topics: result.topics.map(({ topic, currentHours, recommendedHours, delta }) => ({ topic, currentHours, recommendedHours, delta })) }, null, 2));
