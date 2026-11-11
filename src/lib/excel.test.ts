import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseExcelSheet } from "./excel";
import { decodeExcelBuffer, inspectExcelArchive } from "./excel-reader";
import { parseCSV } from "./csv";

const fixture = (name: string) => {
  const bytes = readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
const parsed = async (name: string) => parseExcelSheet((await decodeExcelBuffer(fixture(name))).sheets[0]);

describe("local XLSX import", () => {
  it("reads numeric IDs and grades and preserves text IDs with leading zeroes", async () => {
    const result = await parsed("valid.xlsx");
    expect(result.errors).toEqual([]);
    expect(result.rows.map(row => row.student_id)).toEqual(["123", "0007"]);
    expect(result.rows.map(row => row.grade)).toEqual(["7", "7"]);
    expect(result.rows.map(row => row.score)).toEqual([5, 8]);
  });
  it("returns all sheets for explicit selection, including an empty first sheet", async () => {
    const workbook = await decodeExcelBuffer(fixture("multi-sheet.xlsx"));
    expect(workbook.sheets.map(sheet => sheet.name)).toEqual(["Пустой", "Результаты"]);
    expect(parseExcelSheet(workbook.sheets[0]).errors.length).toBeGreaterThan(0);
    expect(parseExcelSheet(workbook.sheets[1]).rows).toHaveLength(2);
  });
  it("uses identical validation for out-of-range scores and duplicate student results", async () => {
    for (const name of ["invalid-score.xlsx", "duplicate-result.xlsx", "duplicate-header.xlsx"]) {
      const result = await parsed(name);
      expect(result.rows).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
  it("does not interpret missing numeric cells as zero", async () => {
    const workbook = await decodeExcelBuffer(fixture("valid.xlsx"));
    workbook.sheets[0].data[1][6] = null;
    const result = parseExcelSheet(workbook.sheets[0]);
    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toContain("score");
  });
  it("rejects dates and booleans instead of coercing them to numbers", async () => {
    for (const name of ["date.xlsx", "boolean.xlsx"]) {
      const result = await parsed(name);
      expect(result.rows).toEqual([]);
      expect(result.errors.join(" ")).toContain("даты");
    }
  });
  it("rejects empty sheets and header-only sheets", async () => {
    expect((await parsed("empty.xlsx")).rows).toEqual([]);
    expect((await parsed("empty.xlsx")).errors.length).toBeGreaterThan(0);
    expect((await parsed("headers-only.xlsx")).errors.length).toBeGreaterThan(0);
  });
  it("rejects formulas before cached results can be accepted", async () => {
    await expect(decodeExcelBuffer(fixture("formula.xlsx"))).rejects.toThrow("формулы");
  });
  it("rejects corrupt ZIP and oversized expansion declarations", async () => {
    await expect(decodeExcelBuffer(new TextEncoder().encode("not an xlsx").buffer)).rejects.toThrow("повреждён");
    await expect(inspectExcelArchive(fixture("oversized-metadata.xlsx"))).rejects.toThrow("слишком сложная");
  });
  it("bounds actual decompressed output even if the ZIP lies about its size", async () => {
    await expect(inspectExcelArchive(fixture("dishonest-size.xlsx"))).rejects.toThrow("слишком сложная");
  });
  it("rejects inconsistent local CRC, sizes and flags", async () => {
    for (const field of ["crc", "compressed", "expanded", "flags"]) {
      await expect(decodeExcelBuffer(fixture(`local-mismatch-${field}.xlsx`))).rejects.toThrow("повреждён");
    }
  });
  it("accepts streamed ZIP data descriptors and rejects inconsistent descriptor CRC", async () => {
    expect((await parsed("descriptor-valid.xlsx")).rows).toHaveLength(2);
    await expect(decodeExcelBuffer(fixture("descriptor-mismatch.xlsx"))).rejects.toThrow("повреждён");
  });
  it("prevents fflate from selecting an uninspected EOCD or ZIP64 directory", async () => {
    for (const name of ["ambiguous-eocd.xlsx", "hidden-zip64-locator.xlsx"]) {
      await expect(inspectExcelArchive(fixture(name))).rejects.toThrow("повреждён");
    }
  });
  it("accepts an ordinary ZIP archive comment", async () => {
    const original = new Uint8Array(fixture("valid.xlsx"));
    const comment = new TextEncoder().encode("Created locally");
    const bytes = new Uint8Array(original.length + comment.length);
    bytes.set(original);
    bytes.set(comment, original.length);
    new DataView(bytes.buffer).setUint16(original.length - 2, comment.length, true);
    expect(parseExcelSheet((await decodeExcelBuffer(bytes.buffer)).sheets[0]).rows).toHaveLength(2);
  });
  it("rejects enormous sparse sheet coordinates before parser allocation", async () => {
    await expect(decodeExcelBuffer(fixture("huge-coordinate.xlsx"))).rejects.toThrow("слишком сложная");
  });
  it("bounds coordinates despite quoted attribute decoys and entity encoding", async () => {
    for (const name of ["coordinate-decoy.xlsx", "entity-coordinate.xlsx"]) {
      await expect(decodeExcelBuffer(fixture(name))).rejects.toThrow("слишком сложная");
    }
  });
  it("ships an Excel template with the same rows as the CSV template", async () => {
    const file = readFileSync(new URL("../../public/data/template.xlsx", import.meta.url));
    const workbook = await decodeExcelBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    const excel = parseExcelSheet(workbook.sheets[0]);
    const csv = parseCSV(readFileSync(new URL("../../public/data/template.csv", import.meta.url), "utf8"));
    expect(excel.errors).toEqual([]);
    expect(excel.rows).toEqual(csv.rows);
  });
});
