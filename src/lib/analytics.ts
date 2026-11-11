import { quantileSorted, standardDeviation } from "simple-statistics";
import type { Analysis, BookStat, Distribution, ResultRow, TopicStat } from "./types";

// Remove floating-point noise at percentage decision boundaries (e.g. 5.81 / 8.3).
const roundPercent = (value: number) => Number(value.toFixed(10));
const average = (values: number[]) =>
  values.length
    ? roundPercent(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
const percent = (row: ResultRow) => roundPercent((row.score / row.max_score) * 100);
const uniqueStudents = (rows: ResultRow[]) =>
  new Set(rows.map((row) => row.student_id)).size;
const mastery = (rows: ResultRow[]) =>
  rows.length
    ? (rows.filter((row) => percent(row) >= 70).length / rows.length) * 100
    : 0;

/** Describe normalized observations without estimating a wider population.
 * simple-statistics 8 uses Type 7 quantiles: interpolate at zero-based index
 * (n - 1) * p. Standard deviation divides squared deviations by n, not n - 1.
 * Every observation has equal weight, including multiple topics for a student.
 * Each group is sorted once; total work is O(n log n), with bounded O(n) memory. */
function distribution(values: number[]): Distribution {
  const bins = ["0–<20%", "20–<40%", "40–<60%", "60–<80%", "80–100%"]
    .map((label) => ({ label, count: 0 }));
  for (const value of values) bins[Math.min(4, Math.floor(value / 20))].count++;
  if (!values.length) {
    return { count: 0, median: null, q1: null, q3: null, min: null, max: null, stdDev: null, bins };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    median: roundPercent(quantileSorted(sorted, 0.5)),
    q1: roundPercent(quantileSorted(sorted, 0.25)),
    q3: roundPercent(quantileSorted(sorted, 0.75)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stdDev: roundPercent(standardDeviation(values)),
    bins,
  };
}

export const MAX_PLAN_HOURS = 100000;
const NO_MINIMUM_OVERRIDES: ReadonlyMap<string, number> = new Map();
type UnplannedTopic = Omit<TopicStat, "recommendedHours" | "delta" | "allocation">;

/** Reserve each topic's minimum, then allocate the rest by largest remainders, weighted by
 * current hours × (1 + 3 × gap to 100%). Coefficient 3 expresses a planning
 * priority for difficult topics; it is a heuristic, not a measured causal effect. */
function allocate(topics: UnplannedTopic[], minima: number[], remaining: number): TopicStat[] {
  const weights = topics.map(
    (topic) => topic.currentHours * (1 + (3 * (100 - topic.mean)) / 100),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const quotas = weights.map((weight) => (remaining * weight) / totalWeight);
  const whole = quotas.map(Math.floor);
  const leftover = remaining - whole.reduce((sum, hours) => sum + hours, 0);
  const rank = quotas
    .map((quota, index) => ({ index, fraction: quota - whole[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const roundedUp = new Set(rank.slice(0, leftover).map(({ index }) => index));
  return topics.map((topic, index) => {
    const remainderHour = roundedUp.has(index) ? 1 : 0;
    const recommendedHours = minima[index] + whole[index] + remainderHour;
    return {
      ...topic,
      recommendedHours,
      delta: recommendedHours - topic.currentHours,
      allocation: {
        minimumHours: minima[index],
        weight: weights[index],
        extraQuota: quotas[index],
        extraWholeHours: whole[index],
        remainderHour,
      },
    };
  });
}

/** Analyze a selected subject/grade cohort. Percentage noise is rounded to 10 decimals. */
export function analyze(
  rows: ResultRow[],
  budget?: number,
  minimums: ReadonlyMap<string, number> = NO_MINIMUM_OVERRIDES,
): Analysis {
  if (!rows.length && minimums.size) throw new RangeError("Нет тем для заданных минимумов.");
  if (!rows.length)
    return {
      mean: 0,
      distribution: distribution([]),
      mastery: 0,
      students: 0,
      schools: 0,
      topics: [],
      books: [],
      totalHours: 0,
      minimumTotal: 0,
      recommendedTotal: 0,
      commonTopics: [],
      warnings: ["Нет данных для выбранных фильтров."],
    };
  for (const row of rows) {
    if (
      !Number.isFinite(row.score) ||
      !Number.isFinite(row.max_score) ||
      row.max_score <= 0 ||
      row.score < 0 ||
      row.score > row.max_score ||
      !Number.isInteger(row.hours) ||
      row.hours < 1 ||
      row.hours > 500
    ) {
      throw new RangeError(
        "Некорректные результаты: проверьте баллы и учебные часы.",
      );
    }
  }
  const grouped = new Map<string, ResultRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.topic);
    if (group) group.push(row);
    else grouped.set(row.topic, [row]);
  }
  for (const [topic, minimum] of minimums) {
    if (!grouped.has(topic)) throw new RangeError(`Тема «${topic}» отсутствует в выбранном наборе.`);
    if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > MAX_PLAN_HOURS)
      throw new RangeError(`Минимум для темы «${topic}» должен быть целым числом от 1 до ${MAX_PLAN_HOURS}.`);
  }
  const unplanned = Array.from(
    grouped,
    ([topic, items]): UnplannedTopic => {
      if (new Set(items.map((row) => row.hours)).size > 1)
        throw new RangeError(
          `Тема «${topic}»: учебные часы различаются. Выберите один учебный план.`,
        );
      const values = items.map(percent);
      const mean = average(values);
      return {
        topic,
        mean,
        distribution: distribution(values),
        count: items.length,
        students: uniqueStudents(items),
        mastery: mastery(items),
        currentHours: items[0].hours,
        priority: mean < 50 ? "high" : mean < 70 ? "medium" : "low",
      };
    },
  ).sort((a, b) => a.mean - b.mean || a.topic.localeCompare(b.topic, "ru"));
  const totalHours = unplanned.reduce((sum, topic) => sum + topic.currentHours, 0);
  const selectedBudget = budget ?? totalHours;
  const minima = unplanned.map((topic) => minimums.get(topic.topic) ?? 1);
  const minimumTotal = minima.reduce((sum, minimum) => sum + minimum, 0);
  if (
    !Number.isSafeInteger(selectedBudget) ||
    selectedBudget < minimumTotal ||
    selectedBudget > MAX_PLAN_HOURS
  ) {
    throw new RangeError(
      `Бюджет должен быть целым числом от ${minimumTotal} до ${MAX_PLAN_HOURS} часов.`,
    );
  }
  const topics = allocate(unplanned, minima, selectedBudget - minimumTotal);

  const bookGroups = new Map<string, ResultRow[]>();
  for (const row of rows) {
    const group = bookGroups.get(row.textbook);
    if (group) group.push(row);
    else bookGroups.set(row.textbook, [row]);
  }
  const topicSets = Array.from(
    bookGroups.values(),
    (items) => new Set(items.map((row) => row.topic)),
  );
  const commonTopics =
    topicSets.length >= 2
      ? topics
          .map((topic) => topic.topic)
          .filter((topic) => topicSets.every((set) => set.has(topic)))
      : [];
  const books: BookStat[] = Array.from(bookGroups, ([textbook, items]) => {
    const values = items.map(percent);
    const topicScores = new Map<string, { sum: number; count: number }>();
    for (const item of items) {
      const aggregate = topicScores.get(item.topic) ?? { sum: 0, count: 0 };
      aggregate.sum += percent(item);
      aggregate.count += 1;
      topicScores.set(item.topic, aggregate);
    }
    return {
      textbook,
      mean: average(values),
      distribution: distribution(values),
      adjustedMean: commonTopics.length
        ? average(
            commonTopics.map((topic) => {
              const aggregate = topicScores.get(topic)!;
              return aggregate.sum / aggregate.count;
            }),
          )
        : null,
      count: items.length,
      students: uniqueStudents(items),
      topicCount: topicScores.size,
      comparable: commonTopics.length > 0,
    };
  }).sort((a, b) => (b.adjustedMean ?? b.mean) - (a.adjustedMean ?? a.mean));
  const warnings = [
    "Сравнение наблюдательное: результаты зависят также от состава классов, учителей и условий обучения. Причинный эффект учебника не установлен.",
    "Рекомендации по часам — прозрачная эвристика; решение принимает методист. Улучшение успеваемости не прогнозируется.",
  ];
  if (books.length < 2)
    warnings.push("Для сравнения нужны минимум два учебника.");
  else if (!commonTopics.length)
    warnings.push(
      "У учебников нет общих тем: сопоставимый показатель не рассчитывается.",
    );
  else if (commonTopics.length < topics.length)
    warnings.push(
      `Сравнение учебников ограничено общими темами: ${commonTopics.length} из ${topics.length}.`,
    );
  if (
    topics.some((topic) => topic.students < 10) ||
    books.some((book) => book.students < 10)
  )
    warnings.push(
      "Малая выборка: есть группы с менее чем 10 учениками. Выводы требуют дополнительных данных.",
    );
  if (
    new Set(rows.map((row) => row.subject)).size > 1 ||
    new Set(rows.map((row) => row.grade)).size > 1
  )
    warnings.push(
      "Объединены разные предметы или классы. Выберите один предмет и класс для интерпретации учебного плана.",
    );
  const values = rows.map(percent);
  return {
    mean: average(values),
    distribution: distribution(values),
    mastery: mastery(rows),
    students: uniqueStudents(rows),
    schools: new Set(rows.map((row) => row.school)).size,
    topics,
    books,
    totalHours,
    minimumTotal,
    recommendedTotal: topics.reduce((sum, topic) => sum + topic.recommendedHours, 0),
    commonTopics,
    warnings,
  };
}
