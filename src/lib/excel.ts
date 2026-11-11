import Papa from "papaparse";
import { CSV_COLUMNS, MAX_CSV_BYTES, parseCSV } from "./csv";
import type { ParseResult } from "./types";

export interface ExcelSheet {
  name: string;
  data: unknown[][];
}
export interface ExcelWorkbook {
  sheets: ExcelSheet[];
}
export const EXCEL_TIMEOUT_MS = 20000;

/** Read locally in a disposable worker. A newer import can cancel the worker. */
export async function loadExcel(file: File, options: { signal?: AbortSignal } = {}): Promise<ExcelWorkbook> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Поддерживается только .xlsx. Сохраните книгу в формате Excel .xlsx или CSV.");
  if (!file.size || file.size > MAX_CSV_BYTES) throw new Error("Excel-файл должен быть непустым и не больше 5 МБ.");
  if (options.signal?.aborted) throw new DOMException("Импорт отменён", "AbortError");
  const buffer = await file.arrayBuffer();
  if (options.signal?.aborted) throw new DOMException("Импорт отменён", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./excel.worker.ts", import.meta.url), { type: "module" });
    const finish = (error?: Error, workbook?: ExcelWorkbook) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(workbook!);
    };
    const abort = () => finish(new DOMException("Импорт отменён", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Чтение Excel заняло слишком долго. Удалите лишние листы и оформление или сохраните данные в CSV.")), EXCEL_TIMEOUT_MS);
    worker.onmessage = ({ data }: MessageEvent<{ workbook?: ExcelWorkbook; error?: string }>) => {
      if (data.error) finish(new Error(data.error));
      else if (data.workbook?.sheets) finish(undefined, data.workbook);
      else finish(new Error("Не удалось прочитать Excel. Сохраните книгу заново в .xlsx или CSV."));
    };
    worker.onerror = () => finish(new Error("Не удалось прочитать Excel. Сохраните книгу заново в .xlsx или CSV."));
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.postMessage(buffer, [buffer]);
  });
}

/** Same all-or-nothing validation as CSV, including schema, IDs and hour limits. */
export function parseExcelSheet(sheet: ExcelSheet): ParseResult {
  if (!sheet.data.length) return { rows: [], errors: ["Лист пуст. Выберите другой лист или заполните шаблон."] };
  if (sheet.data.length > 20001) return { rows: [], errors: ["На листе больше 20 000 строк данных. Разделите набор на несколько файлов."] };
  const matrix: string[][] = [];
  const errors: string[] = [];
  for (const [rowIndex, row] of sheet.data.entries()) {
    if (!Array.isArray(row) || row.length > CSV_COLUMNS.length) {
      errors.push(`Строка ${rowIndex + 1}: используйте ровно 9 столбцов из шаблона.`);
      if (errors.length >= 25) break;
      continue;
    }
    const cells = row.map((value, columnIndex) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "string") return value;
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (errors.length < 25) errors.push(`Строка ${rowIndex + 1}, столбец ${columnIndex + 1}: даты, логические значения и ошибки Excel не поддерживаются. Введите текст или число.`);
      return "";
    });
    while (cells.length < CSV_COLUMNS.length) cells.push("");
    matrix.push(cells);
  }
  if (errors.length) return { rows: [], errors };
  return parseCSV(Papa.unparse(matrix, { newline: "\n", escapeFormulae: false }));
}
