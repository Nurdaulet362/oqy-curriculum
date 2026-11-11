import Papa from "papaparse";
import type { ParseResult, ResultRow } from "./types";

export const CSV_COLUMNS = [
  "student_id",
  "school",
  "grade",
  "subject",
  "topic",
  "textbook",
  "score",
  "max_score",
  "hours",
] as const;
const TEXT_COLUMNS = [
  "student_id",
  "school",
  "grade",
  "subject",
  "topic",
  "textbook",
] as const;
const NUMBER_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const INVALID_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\uFFFD]/u;
// Keep invalid characters for validation instead of silently erasing them at
// cell boundaries. The optional file-level UTF-8 BOM is handled separately.
const normalizeCell = (value: string) =>
  (INVALID_TEXT.test(value) ? value : value.trim()).normalize("NFC");
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_TOPICS_PER_COHORT = 200;
export const MAX_BOOKS_PER_COHORT = 20;
const MAX_ROWS = 20000;
const MAX_ERRORS = 25;

/** Strict, all-or-nothing import. No invalid or duplicate rows are silently dropped. */
export function parseCSV(text: string): ParseResult {
  if (!text.trim())
    return {
      rows: [],
      errors: ["CSV-файл пуст. Загрузите шаблон и заполните результаты."],
    };
  if (
    text.length > MAX_CSV_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES
  )
    return {
      rows: [],
      errors: ["Файл слишком большой. Максимум: 5 МБ в UTF-8 и 20 000 строк."],
    };
  const parsed = Papa.parse<Record<string, string>>(
    text.replace(/^\uFEFF/, ""),
    {
      header: true,
      skipEmptyLines: "greedy",
      delimitersToGuess: [",", ";"],
      transformHeader: normalizeCell,
      transform: normalizeCell,
    },
  );
  const errors: string[] = [];
  const fields = parsed.meta.fields ?? [];
  const missing = CSV_COLUMNS.filter((column) => !fields.includes(column));
  const extra = fields.filter(
    (column) => !(CSV_COLUMNS as readonly string[]).includes(column),
  );
  if (missing.length)
    errors.push(`Отсутствуют столбцы: ${missing.join(", ")}.`);
  if (extra.length)
    errors.push(
      `Неизвестные столбцы: ${extra.join(", ")}. Используйте шаблон без ФИО и контактов.`,
    );
  if (new Set(fields).size !== fields.length)
    errors.push("Заголовки столбцов не должны повторяться.");
  for (const error of parsed.errors.slice(0, MAX_ERRORS))
    errors.push(
      `Строка ${(error.row ?? 0) + 2}: некорректная структура CSV (${error.code}).`,
    );
  if (parsed.data.length > MAX_ROWS)
    errors.push(
      `Слишком много строк: ${parsed.data.length}. Максимум — 20 000.`,
    );
  if (!parsed.data.length)
    errors.push("В CSV есть заголовок, но нет результатов.");
  if (errors.length) return { rows: [], errors: errors.slice(0, MAX_ERRORS) };

  const rows: ResultRow[] = [];
  const seen = new Set<string>();
  const hoursByTopic = new Map<string, number>();
  const studentIdentity = new Map<string, { school: string; grade: string }>();
  const cohorts = new Map<string, { topics: Set<string>; books: Set<string> }>();
  for (const [index, source] of parsed.data.entries()) {
    const line = index + 2;
    let valid = true;
    const fail = (message: string) => {
      valid = false;
      if (errors.length < MAX_ERRORS) errors.push(`Строка ${line}: ${message}`);
    };
    for (const column of TEXT_COLUMNS) {
      const value = source[column];
      if (!value || value.length > 200 || INVALID_TEXT.test(value))
        fail(
          `«${column}» должен содержать от 1 до 200 символов без управляющих, невидимых или повреждённых символов. Сохраните CSV в UTF-8.`,
        );
    }
    for (const column of ["score", "max_score", "hours"] as const) {
      if (
        !NUMBER_PATTERN.test(source[column] ?? "") ||
        !Number.isFinite(Number(source[column]))
      )
        fail(
          `«${column}» должен быть неотрицательным числом (десятичный разделитель — точка).`,
        );
    }
    const score = Number(source.score),
      max_score = Number(source.max_score),
      hours = Number(source.hours);
    if (!(max_score > 0)) fail("«max_score» должен быть больше нуля.");
    if (score < 0 || score > max_score)
      fail("«score» должен быть от 0 до max_score.");
    if (!Number.isInteger(hours) || hours < 1 || hours > 500)
      fail("«hours» должен быть целым числом от 1 до 500.");
    // A file represents one snapshot: stable global student IDs cannot refer
    // to different schools or grades, even when their topics do not overlap.
    const identity = studentIdentity.get(source.student_id);
    if (
      identity &&
      (identity.school !== source.school || identity.grade !== source.grade)
    )
      fail(
        "один student_id указан в разных школах или классах. Используйте глобально уникальный ID и один срез данных.",
      );
    else if (!identity)
      studentIdentity.set(source.student_id, {
        school: source.school,
        grade: source.grade,
      });
    // Bound the comparison matrix and keep every accepted default plan within
    // the engine's 100,000-hour ceiling (200 topics × at most 500 hours).
    const cohortKey = JSON.stringify([source.grade, source.subject]);
    const cohort = cohorts.get(cohortKey) ?? {
      topics: new Set<string>(),
      books: new Set<string>(),
    };
    cohort.topics.add(source.topic);
    cohort.books.add(source.textbook);
    cohorts.set(cohortKey, cohort);
    if (cohort.topics.size > MAX_TOPICS_PER_COHORT)
      fail(
        `в одном классе и предмете допускается не более ${MAX_TOPICS_PER_COHORT} тем. Разделите учебные программы на отдельные файлы.`,
      );
    if (cohort.books.size > MAX_BOOKS_PER_COHORT)
      fail(
        `в одном классе и предмете допускается не более ${MAX_BOOKS_PER_COHORT} учебников. Разделите данные на отдельные файлы.`,
      );
    const rowKey = JSON.stringify([
      source.student_id,
      source.subject,
      source.topic,
    ]);
    if (seen.has(rowKey))
      fail(
        "повтор результата ученика по той же теме и предмету. Оставьте один результат.",
      );
    seen.add(rowKey);
    // Hours describe one shared curriculum. Grade/subject distinguish separate plans.
    const topicKey = JSON.stringify([
      source.grade,
      source.subject,
      source.topic,
    ]);
    if (hoursByTopic.has(topicKey) && hoursByTopic.get(topicKey) !== hours)
      fail(
        "число часов одной темы в одном классе и предмете должно совпадать.",
      );
    hoursByTopic.set(topicKey, hours);
    if (valid)
      rows.push({
        student_id: source.student_id,
        school: source.school,
        grade: source.grade,
        subject: source.subject,
        topic: source.topic,
        textbook: source.textbook,
        score,
        max_score,
        hours,
      });
  }
  if (errors.length) return { rows: [], errors };
  return { rows, errors: [] };
}

/** Prevent spreadsheet formula execution when exporting user-controlled text. */
export function rowsToCSV(rows: ResultRow[]): string {
  return Papa.unparse(
    {
      fields: [...CSV_COLUMNS],
      data: rows.map((row) => CSV_COLUMNS.map((column) => row[column])),
    },
    { escapeFormulae: true, newline: "\r\n" },
  );
}
