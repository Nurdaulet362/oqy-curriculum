import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, MAX_CSV_BYTES, parseCSV, rowsToCSV } from "./csv";
import { analyze } from "./analytics";
const header = CSV_COLUMNS.join(",");
const valid = "s1,School,7,Math,Fractions,Book A,7,10,4";

describe("CSV import and export", () => {
  it("reads UTF-8 BOM, semicolons and quoted delimiters", () => {
    const result = parseCSV(
      "\uFEFF" +
        header.replaceAll(",", ";") +
        "\n" +
        's1;Школа;7;Математика;"Дроби; часть 1";Книга;7;10;4',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0].topic).toBe("Дроби; часть 1");
    expect(result.rows[0].score).toBe(7);
  });
  it("round-trips regular records", () => {
    const rows = parseCSV(header + "\n" + valid).rows;
    expect(parseCSV(rowsToCSV(rows)).rows).toEqual(rows);
  });
  it("rejects missing, extra/PII and duplicate columns", () => {
    for (const text of [
      "student_id\ns1",
      header + ",name\n" + valid + ",John",
      header + ",score\n" + valid + ",7",
    ]) {
      const result = parseCSV(text);
      expect(result.rows).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
  it("rejects malformed numbers, out-of-range scores and hours", () => {
    for (const values of [
      "NaN,10,4",
      "Infinity,10,4",
      "11,10,4",
      "-1,10,4",
      "0,0,4",
      ",10,4",
      "7,10,0",
      "7,10,1.5",
      "7,10,501",
      "0x7,10,4",
    ]) {
      const result = parseCSV(
        header + "\ns1,School,7,Math,Fractions,Book A," + values,
      );
      expect(result.rows).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
  it("rejects the entire file when one row is invalid", () => {
    const result = parseCSV(
      header + "\n" + valid + "\ns2,School,7,Math,Fractions,Book A,99,10,4",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("Строка 3");
  });
  it("rejects duplicates and conflicting topic hours", () => {
    expect(
      parseCSV(header + "\n" + valid + "\n" + valid).errors.some((e) =>
        e.includes("повтор"),
      ),
    ).toBe(true);
    expect(
      parseCSV(
        header + "\n" + valid + "\ns2,School,7,Math,Fractions,Book A,8,10,5",
      ).errors.some((e) => e.includes("должно совпадать")),
    ).toBe(true);
  });
  it("allows separate grade plans with different hours", () => {
    expect(
      parseCSV(
        header + "\n" + valid + "\ns2,School,8,Math,Fractions,Book A,8,10,5",
      ).errors,
    ).toEqual([]);
  });
  it("handles empty files and header-only files", () => {
    expect(parseCSV("").errors.length).toBeGreaterThan(0);
    expect(parseCSV(header).errors.length).toBeGreaterThan(0);
  });
  it("rejects oversize datasets", () => {
    const text =
      header +
      "\n" +
      Array.from({ length: 20001 }, (_, i) =>
        valid.replace("s1,", `s${i},`),
      ).join("\n");
    expect(parseCSV(text).errors.some((e) => e.includes("20 000"))).toBe(true);
  });
  it("neutralizes spreadsheet formula cells on export", () => {
    const rows = parseCSV(header + "\n" + valid).rows;
    rows[0].school = '=HYPERLINK("https://example.com")';
    expect(rowsToCSV(rows)).toContain("'=HYPERLINK");
  });
  it("normalizes canonical Unicode variants before duplicate detection and comparison", () => {
    const sameTopic = parseCSV(
      header + "\ns1,S,7,M,й,A,5,10,4\ns1,S,7,M,и\u0306,A,8,10,4",
    );
    expect(sameTopic.rows).toEqual([]);
    expect(sameTopic.errors.some((error) => error.includes("повтор"))).toBe(true);
    const books = parseCSV(
      header + "\ns1,S,7,M,й,A,5,10,4\ns2,S,7,M,и\u0306,B,8,10,4",
    );
    expect(books.errors).toEqual([]);
    expect(analyze(books.rows).commonTopics).toEqual(["й"]);
    expect(analyze(books.rows).topics).toHaveLength(1);
  });
  it("rejects conflicting schools or grades for the same global student ID", () => {
    for (const next of [
      "s1,Other school,7,Math,Geometry,Book A,8,10,4",
      "s1,School,8,Math,Geometry,Book A,8,10,4",
    ]) {
      const result = parseCSV(header + "\n" + valid + "\n" + next);
      expect(result.rows).toEqual([]);
      expect(result.errors.some((error) => error.includes("student_id"))).toBe(true);
    }
  });
  it("rejects more than 200 topics or 20 textbooks per grade and subject", () => {
    const topics = parseCSV(header + "\n" + Array.from({ length: 201 }, (_, i) =>
      `s1,S,7,M,T${i},A,5,10,500`,
    ).join("\n"));
    expect(topics.rows).toEqual([]);
    expect(topics.errors.some((error) => error.includes("200 тем"))).toBe(true);
    const books = parseCSV(header + "\n" + Array.from({ length: 21 }, (_, i) =>
      `s${i},S,7,M,T,B${i},5,10,4`,
    ).join("\n"));
    expect(books.rows).toEqual([]);
    expect(books.errors.some((error) => error.includes("20 учебников"))).toBe(true);
  });
  it("accepts the maximum topic count and default hour budget", () => {
    const result = parseCSV(header + "\n" + Array.from({ length: 200 }, (_, i) =>
      `s1,S,7,M,T${i},A,5,10,500`,
    ).join("\n"));
    expect(result.errors).toEqual([]);
    expect(analyze(result.rows).recommendedTotal).toBe(100000);
  });
  it("enforces UTF-8 bytes rather than JavaScript string length", () => {
    const text = header + "\n" + "я".repeat(MAX_CSV_BYTES / 2);
    expect(text.length).toBeLessThan(MAX_CSV_BYTES);
    const result = parseCSV(text);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      "Файл слишком большой. Максимум: 5 МБ в UTF-8 и 20 000 строк.",
    ]);
  });
  it("rejects invisible identity variants and Unicode control characters", () => {
    for (const character of ["\u200b", "\u200e", "\u0085", "\t", "\ud800"]) {
      const result = parseCSV(header + "\n" + valid + "\n" +
        `s1${character},School,7,Math,Fractions,Book A,8,10,4`);
      expect(result.rows).toEqual([]);
      expect(result.errors.some((error) => error.includes("невидимых"))).toBe(true);
    }
  });
  it("rejects replacement characters produced by corrupted UTF-8 decoding", () => {
    const result = parseCSV(header + "\n" + valid.replace("School", "Шко\ufffdла"));
    expect(result.rows).toEqual([]);
    expect(result.errors.some((error) => error.includes("UTF-8"))).toBe(true);
  });
});
