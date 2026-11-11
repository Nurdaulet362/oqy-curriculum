import readXlsxFile from "read-excel-file/universal";
import type { ExcelWorkbook } from "./excel";

export const MAX_EXCEL_EXPANDED_BYTES = 32 * 1024 * 1024;
export const MAX_EXCEL_ENTRIES = 2000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const invalid = () => new Error("Excel-файл повреждён или использует неподдерживаемый ZIP-формат. Сохраните книгу заново в .xlsx.");
const limited = () => new Error("Книга Excel слишком сложная: максимум 32 МБ после распаковки, 20 листов, 20 000 строк и 9 столбцов на лист. Удалите лишнее оформление или сохраните нужный лист в CSV.");
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

function inspectXml(name: string, bytes: Uint8Array) {
  const xml = decoder.decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw invalid();
  if (/<(?:[\w.-]+:)?f(?:\s|\/|>)/.test(xml)) throw new Error("Книга содержит формулы. Скопируйте результаты и вставьте только значения перед импортом: сохранённые результаты формул не используются.");
  if (name === "xl/workbook.xml" && [...xml.matchAll(/<(?:[\w.-]+:)?sheet(?:\s|\/|>)/g)].length > 20) throw limited();
  // Check cell coordinates in every XML part: relationships can redirect a
  // worksheet to a nonstandard path, so filenames are not a security boundary.
  let rows = 0;
  let cells = 0;
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?(row|c|dimension)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
    const [, tag, attributes] = match;
    if (tag === "row" && ++rows > 20001) throw limited();
    if (tag === "c" && ++cells > 180009) throw limited();
    const attribute = tag === "dimension" ? "ref" : "r";
    const attributeValues = new Map<string, string>();
    for (const attr of attributes.matchAll(/(?:^|\s)([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      if (attributeValues.has(attr[1])) throw invalid();
      attributeValues.set(attr[1], attr[2] ?? attr[3]);
    }
    const value = attributeValues.get(attribute);
    if (value === undefined) {
      if (tag === "c") throw invalid();
      continue;
    }
    if (tag === "row") {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 20001) throw limited();
    } else {
      for (const coordinate of value.split(":")) {
        if (!/^[A-I][1-9]\d*$/.test(coordinate) || Number(coordinate.slice(1)) > 20001) throw limited();
      }
    }
  }
}

/** Verify real decompressed lengths, CRC and XML bounds before the XLSX parser allocates sheet arrays. */
export async function inspectExcelArchive(buffer: ArrayBuffer): Promise<void> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 22 || bytes.length > MAX_FILE_BYTES) throw invalid();
  const view = new DataView(buffer);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw invalid();
  // fflate chooses the last EOCD signature without validating its comment
  // length. Ensure it will use exactly the directory inspected here, and never
  // switch to a ZIP64 directory via a locator embedded in an entry comment.
  for (let candidate = bytes.length - 22; candidate > end; candidate--) {
    if (view.getUint32(candidate, true) === 0x06054b50) throw invalid();
  }
  if (end >= 20 && view.getUint32(end - 20, true) === 0x07064b50) throw invalid();
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (!count || count > MAX_EXCEL_ENTRIES) throw limited();
  if (view.getUint16(end + 8, true) !== count || centralStart + centralSize !== end) throw invalid();
  const names = new Set<string>();
  let offset = centralStart;
  let expandedTotal = 0;
  let declaredTotal = 0;
  let worksheetCount = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw invalid();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressed = view.getUint32(offset + 20, true);
    const expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (flags & ~(method === 8 ? 0x080e : 0x0808) || ![0, 8].includes(method) || compressed === 0xffffffff || expanded === 0xffffffff || localOffset === 0xffffffff || view.getUint16(offset + 34, true)) throw invalid();
    if (offset + 46 + nameLength + extraLength + commentLength > end) throw invalid();
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || names.has(name)) throw invalid();
    names.add(name);
    if (/vbaProject|activeX|externalLinks|macrosheets/i.test(name)) throw new Error("Книга содержит макросы или внешние связи. Сохраните обычный .xlsx только со значениями.");
    if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name) && ++worksheetCount > 20) throw limited();
    declaredTotal += expanded;
    if (declaredTotal > MAX_EXCEL_EXPANDED_BYTES) throw limited();
    if (localOffset + 30 > centralStart || view.getUint32(localOffset, true) !== 0x04034b50) throw invalid();
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressed > centralStart || view.getUint16(localOffset + 8, true) !== method || view.getUint16(localOffset + 6, true) !== flags) throw invalid();
    if (decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) !== name) throw invalid();
    const expected = [crc, compressed, expanded];
    for (let field = 0; field < expected.length; field++) {
      const localValue = view.getUint32(localOffset + 14 + field * 4, true);
      if (localValue !== expected[field] && (!(flags & 8) || localValue !== 0)) throw invalid();
    }
    if (flags & 8) {
      let descriptor = dataStart + compressed;
      if (descriptor + 12 > centralStart) throw invalid();
      if (view.getUint32(descriptor, true) === 0x08074b50) descriptor += 4;
      if (descriptor + 12 > centralStart || expected.some((value, field) => view.getUint32(descriptor + field * 4, true) !== value)) throw invalid();
    }
    const compressedBytes = bytes.slice(dataStart, dataStart + compressed);
    const chunks: Uint8Array[] = [];
    let actual = 0;
    if (method === 0) {
      chunks.push(compressedBytes);
      actual = compressedBytes.length;
    } else {
      const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          actual += value.length;
          if (actual > expanded || expandedTotal + actual > MAX_EXCEL_EXPANDED_BYTES) {
            await reader.cancel();
            throw limited();
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    if (actual !== expanded || expandedTotal + actual > MAX_EXCEL_EXPANDED_BYTES) throw invalid();
    expandedTotal += actual;
    const contents = new Uint8Array(actual);
    let writeOffset = 0;
    for (const chunk of chunks) { contents.set(chunk, writeOffset); writeOffset += chunk.length; }
    if (crc32(contents) !== crc) throw invalid();
    if (/\.(?:xml|rels)$/i.test(name)) inspectXml(name, contents);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end || !names.has("[Content_Types].xml") || !names.has("xl/workbook.xml") || !worksheetCount) throw invalid();
}

export async function decodeExcelBuffer(buffer: ArrayBuffer): Promise<ExcelWorkbook> {
  try {
    await inspectExcelArchive(buffer);
    const sheets = await readXlsxFile(buffer, { trim: false });
    if (!sheets.length || sheets.length > 20) throw limited();
    for (const sheet of sheets) {
      if (sheet.data.length > 20001 || sheet.data.some(row => row.length > 9)) throw limited();
    }
    return { sheets: sheets.map(({ sheet, data }) => ({ name: sheet, data })) };
  } catch (error) {
    if (error instanceof Error && /^(Excel|Книга)/.test(error.message)) throw error;
    throw invalid();
  }
}
