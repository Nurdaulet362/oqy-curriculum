import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Synthetic, deterministic fixtures. This is not an educational research dataset.
const SEED = 20261111;
let randomState = SEED >>> 0;
function random() {
  randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0;
  return randomState / 4294967296;
}
const columns = ['student_id', 'school', 'grade', 'subject', 'topic', 'textbook', 'score', 'max_score', 'hours'];
const topics = [
  { topic: 'Дроби', target: 52, hours: 6, bookEffect: -4 },
  { topic: 'Линейные уравнения', target: 57, hours: 7, bookEffect: 3 },
  { topic: 'Проценты', target: 66, hours: 5, bookEffect: -2 },
  { topic: 'Геометрические фигуры', target: 77, hours: 6, bookEffect: 4 },
  { topic: 'Степени', target: 72, hours: 5, bookEffect: -1 },
  { topic: 'Статистика', target: 83, hours: 5, bookEffect: 2 },
];
const rows = [];
for (let school = 0; school < 3; school += 1) {
  for (let student = 0; student < 48; student += 1) {
    const ability = (random() - 0.5) * 28;
    const bookIndex = student % 2;
    for (const [topicIndex, topic] of topics.entries()) {
      const noise = (random() - 0.5) * 20;
      const schoolEffect = (school - 1) * 3;
      const bookEffect = topic.bookEffect * (bookIndex === 0 ? 1 : -1);
      const percent = Math.max(5, Math.min(100, topic.target + ability + noise + schoolEffect + bookEffect));
      const maximum = [20, 50, 100][topicIndex % 3];
      rows.push({
        student_id: `DEMO-${String(school * 48 + student + 1).padStart(3, '0')}`,
        school: `Школа ${String(school + 1).padStart(2, '0')}`,
        grade: '7',
        subject: 'Математика',
        topic: topic.topic,
        textbook: bookIndex === 0 ? 'Оқулық A' : 'Оқулық B',
        score: Math.round(percent * maximum / 100),
        max_score: maximum,
        hours: topic.hours,
      });
    }
  }
}
function csv(records) {
  const escape = value => `"${String(value).replaceAll('"', '""')}"`;
  return `${columns.join(',')}\n${records.map(row => columns.map(column => escape(row[column])).join(',')).join('\n')}\n`;
}
const output = fileURLToPath(new URL('../public/data/', import.meta.url));
await mkdir(output, { recursive: true });
await writeFile(`${output}demo.csv`, csv(rows), 'utf8');
await writeFile(`${output}template.csv`, csv(rows.slice(0, 6)), 'utf8');
const metrics = {
  seed: SEED,
  records: rows.length,
  students: new Set(rows.map(row => row.student_id)).size,
  schools: new Set(rows.map(row => row.school)).size,
  textbooks: new Set(rows.map(row => row.textbook)).size,
  totalTopicHours: topics.reduce((sum, topic) => sum + topic.hours, 0),
  mean: Number((rows.reduce((sum, row) => sum + row.score / row.max_score * 100, 0) / rows.length).toFixed(2)),
  topics: topics.map(topic => {
    const subset = rows.filter(row => row.topic === topic.topic);
    return { topic: topic.topic, count: subset.length, mean: Number((subset.reduce((sum, row) => sum + row.score / row.max_score * 100, 0) / subset.length).toFixed(2)) };
  }),
};
if (rows.length !== 864 || metrics.students !== 144 || metrics.totalTopicHours !== 34) throw new Error('Unexpected fixture dimensions');
if (new Set(rows.map(row => `${row.student_id}|${row.subject}|${row.topic}`)).size !== rows.length) throw new Error('Duplicate results');
if (rows.some(row => row.score < 0 || row.score > row.max_score)) throw new Error('Score out of range');
console.log(JSON.stringify(metrics, null, 2));
