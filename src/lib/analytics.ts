import type { Analysis, BookStat, ResultRow, TopicStat } from "./types";

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

/** Whole-hour allocation: one hour per topic, then largest remainders, weighted by
 * current hours × (1 + 3 × gap to 100%). Coefficient 3 expresses a planning
 * priority for difficult topics; it is a heuristic, not a measured causal effect. */
function allocate(topics: TopicStat[], budget: number): number[] {
  if (!topics.length) return [];
  const remaining = budget - topics.length;
  const weights = topics.map(
    (topic) => topic.currentHours * (1 + (3 * (100 - topic.mean)) / 100),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const quotas = weights.map((weight) => (remaining * weight) / totalWeight);
  const result = quotas.map((quota) => 1 + Math.floor(quota));
  const leftover = budget - result.reduce((sum, hours) => sum + hours, 0);
  const rank = quotas
    .map((quota, index) => ({ index, fraction: quota - Math.floor(quota) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < leftover; index++) result[rank[index].index] += 1;
  return result;
}

/** Analyze a selected subject/grade cohort. Values are percentages, without rounding. */
export function analyze(rows: ResultRow[], budget?: number): Analysis {
  if (!rows.length)
    return {
      mean: 0,
      mastery: 0,
      students: 0,
      schools: 0,
      topics: [],
      books: [],
      totalHours: 0,
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
  const topics: TopicStat[] = Array.from(
    grouped,
    ([topic, items]): TopicStat => {
      if (new Set(items.map((row) => row.hours)).size > 1)
        throw new RangeError(
          `Тема «${topic}»: учебные часы различаются. Выберите один учебный план.`,
        );
      const mean = average(items.map(percent));
      return {
        topic,
        mean,
        count: items.length,
        students: uniqueStudents(items),
        mastery: mastery(items),
        currentHours: items[0].hours,
        recommendedHours: 0,
        delta: 0,
        priority: mean < 50 ? "high" : mean < 70 ? "medium" : "low",
      };
    },
  ).sort((a, b) => a.mean - b.mean || a.topic.localeCompare(b.topic, "ru"));
  const totalHours = topics.reduce((sum, topic) => sum + topic.currentHours, 0);
  const selectedBudget = budget ?? totalHours;
  if (
    !Number.isSafeInteger(selectedBudget) ||
    selectedBudget < topics.length ||
    selectedBudget > 100000
  ) {
    throw new RangeError(
      `Бюджет должен быть целым числом от ${topics.length} до 100000 часов.`,
    );
  }
  const allocation = allocate(topics, selectedBudget);
  topics.forEach((topic, index) => {
    topic.recommendedHours = allocation[index];
    topic.delta = allocation[index] - topic.currentHours;
  });

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
    const topicScores = new Map<string, { sum: number; count: number }>();
    for (const item of items) {
      const aggregate = topicScores.get(item.topic) ?? { sum: 0, count: 0 };
      aggregate.sum += percent(item);
      aggregate.count += 1;
      topicScores.set(item.topic, aggregate);
    }
    return {
      textbook,
      mean: average(items.map(percent)),
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
  return {
    mean: average(rows.map(percent)),
    mastery: mastery(rows),
    students: uniqueStudents(rows),
    schools: new Set(rows.map((row) => row.school)).size,
    topics,
    books,
    totalHours,
    recommendedTotal: allocation.reduce((sum, hours) => sum + hours, 0),
    commonTopics,
    warnings,
  };
}
