import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { analyze } from '../src/lib/analytics.ts';
import { parseCSV } from '../src/lib/csv.ts';
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const dataPath = 'public/data/demo.csv';
const parsed = parseCSV(readFileSync(dataPath, 'utf8'));
assert.deepEqual(parsed.errors, []);
const analysis = analyze(parsed.rows);
const ids = [...new Set(parsed.rows.map(r => r.student_id))].sort();
const expected = Array.from({ length: 144 }, (_, i) => `DEMO-${String(i + 1).padStart(3, '0')}`);
assert.deepEqual(ids, expected);
const keys = new Set(parsed.rows.map(r => JSON.stringify([r.student_id, r.subject, r.topic])));
assert.equal(keys.size, parsed.rows.length);
assert.equal(analysis.topics.reduce((s, t) => s + t.count, 0), parsed.rows.length);
assert.equal(analysis.books.reduce((s, b) => s + b.count, 0), parsed.rows.length);
assert.equal(analysis.recommendedTotal, 34);
const constrained = analyze(parsed.rows, 34, new Map([['Дроби', 9]]));
assert.equal(constrained.minimumTotal, 14);
assert.equal(constrained.recommendedTotal, 34);
assert.deepEqual(constrained.topics.map(topic => topic.recommendedHours), [13, 6, 4, 4, 4, 3]);
const planningExample = {
  budgetHours: 34,
  minimumTotal: constrained.minimumTotal,
  recommendedTotal: constrained.recommendedTotal,
  topics: constrained.topics.map(({ topic, currentHours, recommendedHours, delta, allocation }) =>
    ({ topic, currentHours, recommendedHours, delta, allocation })),
};
const sourceHashes = { sha256: hash(dataPath), engineSha256: hash('src/lib/analytics.ts'), parserSha256: hash('src/lib/csv.ts') };
const report = {
  project: 'OQY — Data-Driven Curriculum',
  source: {
    file: dataPath, synthetic: true, description: 'Сохранённый результат на синтетических данных; не результаты реальных школьников.',
    generatedAt: new Date().toISOString(), ...sourceHashes,
    filters: { subject: 'Математика', grade: '7', school: 'Все школы', textbook: 'Все учебники' }, budgetHours: 34,
    validation: { acceptedRows: parsed.rows.length, parseErrors: [], uniqueRecordKeys: keys.size, duplicateRecordKeys: 0, uniqueStudentIds: ids.length, expectedStudentIds: expected.length, sourceIdsMatchGenerator: true, studentIds: ids },
    method: { score: '100 × score / max_score; numerical noise rounded to 10 decimal places', mastery: 'share of rows >=70%', distribution: 'normalized observations; Type 7 quartiles; population standard deviation (divisor n); bins [0,20),[20,40),[40,60),[60,80),[80,100]', books: 'equal-weight mean over common topics', hours: 'reserve topic minima (default 1); distribute remaining hours by largest remainders; weight=currentHours*(1+3*(100-mean)/100)', limitations: 'Descriptive, synthetic; no causal efficacy or educational outcome claim.' },
    planningExample,
  }, analysis,
};
const files = ['artifacts/OQY-pitch.pdf', 'artifacts/demo-report.json', 'artifacts/demo-plan.csv', 'public/data/demo.csv', 'public/pitch.html', 'src/lib/analytics.ts', 'src/lib/csv.ts', 'src/lib/types.ts', 'src/lib/excel.ts', 'src/lib/excel-reader.ts', 'src/lib/excel.worker.ts', 'public/data/template.xlsx', 'package-lock.json', 'package.json', 'src/App.tsx', 'src/components/DistributionSummary.tsx', 'src/components/ResultTable.tsx', 'src/components/PlanTable.tsx', 'src/components/BookComparisonTable.tsx', 'artifacts/features-check.json', 'docs/VALIDATION.md', 'docs/FEATURE-UPDATE.md', 'public/THIRD-PARTY-NOTICES.txt'];
files.push('src/components/TopicMinimums.tsx', 'src/components/planning.css');
if (process.argv.includes('--check')) {
  const saved = JSON.parse(readFileSync('artifacts/demo-report.json', 'utf8'));
  for (const [key, value] of Object.entries(sourceHashes)) assert.equal(saved.source[key], value, `stale ${key}`);
  assert.deepEqual(saved.analysis, analysis, 'Saved analysis differs from current code');
  assert.deepEqual(saved.source.planningExample, planningExample, 'Saved planning example differs from current code');
  const benchmark = JSON.parse(readFileSync('artifacts/benchmark.json', 'utf8'));
  assert.equal(benchmark.workload.engineSha256, sourceHashes.engineSha256, 'stale benchmark engine');
  assert.equal(benchmark.workload.sha256, sourceHashes.sha256, 'stale benchmark data');
  const manifest = JSON.parse(readFileSync('artifacts/submission-manifest.json', 'utf8'));
  for (const item of manifest.files) assert.equal(hash(item.path), item.sha256, `stale manifest ${item.path}`);
  console.log('Evidence matches current input, engine, parser, analysis and manifest.');
} else {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/demo-report.json', JSON.stringify(report, null, 2) + '\n');
  const plan = analysis.topics.map(t => ({ source: 'synthetic_demo', subject: 'Математика', grade: '7', school_filter: 'Все школы', topic: t.topic, students: t.students, mean_percent: t.mean.toFixed(4), current_hours: t.currentHours, recommended_hours: t.recommendedHours, delta_hours: t.delta }));
  writeFileSync('artifacts/demo-plan.csv', '\uFEFF' + Papa.unparse(plan, { escapeFormulae: true, newline: '\n' }) + '\n');
  const manifest = { project: 'OQY', files: files.map(path => ({ path, bytes: readFileSync(path).length, sha256: hash(path) })), submission: 'Participant submits form; no receipt claimed', repository: 'https://github.com/Nurdaulet362/oqy-curriculum', visibility: 'private' };
  writeFileSync('artifacts/submission-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log('Regenerated current demo report, plan and manifest. Run npm run benchmark after an engine change.');
}
