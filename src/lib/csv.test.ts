import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, parseCSV, rowsToCSV } from "./csv";
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
});
