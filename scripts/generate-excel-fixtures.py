"""Deterministic XLSX fixtures and offline template; Python standard library only."""
from pathlib import Path
import csv
import io
import struct
import zipfile
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)
COLUMNS = ["student_id", "school", "grade", "subject", "topic", "textbook", "score", "max_score", "hours"]
# Match the canonical CSV template, not an independent schema.
COLUMNS = next(csv.reader((ROOT / "public/data/template.csv").open(encoding="utf-8-sig")))
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def cell(value, ref):
    if value is None:
        return f'<c r="{ref}"/>'
    if isinstance(value, tuple):
        kind, raw = value
        if kind == "formula":
            return f'<c r="{ref}"><f>{escape(raw)}</f><v>10</v></c>'
        if kind == "date":
            return f'<c r="{ref}" s="1"><v>{raw}</v></c>'
    if isinstance(value, bool):
        return f'<c r="{ref}" t="b"><v>{int(value)}</v></c>'
    if isinstance(value, (int, float)):
        return f'<c r="{ref}"><v>{value}</v></c>'
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'


class StreamingBuffer(io.BytesIO):
    def seek(self, *args):
        raise io.UnsupportedOperation("streaming ZIP")


def workbook(sheets, raw_sheet=None, streaming=False):
    entries = {
        "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheets) + 1)) + '</Types>',
        "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<workbook xmlns="{NS}" xmlns:r="{RELS}"><sheets>' + ''.join(f'<sheet name={quoteattr(name)} sheetId="{i}" r:id="rId{i}"/>' for i, (name, rows) in enumerate(sheets, 1)) + '</sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="rId{i}" Type="{RELS}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets) + 1)) + f'<Relationship Id="styles" Type="{RELS}/styles" Target="styles.xml"/></Relationships>',
        "xl/styles.xml": f'<styleSheet xmlns="{NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
    }
    for index, (_, rows) in enumerate(sheets, 1):
        content = ''.join(f'<row r="{r}">' + ''.join(cell(value, f'{chr(65 + c)}{r}') for c, value in enumerate(row)) + '</row>' for r, row in enumerate(rows, 1))
        entries[f"xl/worksheets/sheet{index}.xml"] = f'<worksheet xmlns="{NS}"><dimension ref="A1:{chr(64 + len(COLUMNS))}{max(1,len(rows))}"/><sheetData>{content}</sheetData></worksheet>'
    if raw_sheet is not None:
        entries['xl/worksheets/sheet1.xml'] = raw_sheet
    out = StreamingBuffer() if streaming else io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, '<?xml version="1.0" encoding="UTF-8"?>' + content)
    return out.getvalue()


BASE = [123, 'Школа 01', 7, 'Математика', 'Дроби', 'Оқулық A', 5, 10, 6]
# The source project's actual schema has 9 columns; accepted shape follows CSV_COLUMNS.
rows = [COLUMNS, BASE, ['0007', 'Школа 01', 7, 'Математика', 'Дроби', 'Оқулық B', 8, 10, 6]]
fixtures = {
    'valid.xlsx': workbook([('Результаты', rows)]),
    'multi-sheet.xlsx': workbook([('Пустой', []), ('Результаты', rows)]),
    'empty.xlsx': workbook([('Пустой', [])]),
    'headers-only.xlsx': workbook([('Результаты', [COLUMNS])]),
    'invalid-score.xlsx': workbook([('Результаты', [COLUMNS, BASE[:6] + [11, 10, 6]])]),
    'duplicate-header.xlsx': workbook([('Результаты', [COLUMNS[:-1] + ['score'], BASE])]),
    'duplicate-result.xlsx': workbook([('Результаты', [COLUMNS, BASE, BASE])]),
    'formula.xlsx': workbook([('Результаты', [COLUMNS, BASE[:6] + [('formula', '5+5'), 10, 6]])]),
    'date.xlsx': workbook([('Результаты', [COLUMNS, BASE[:6] + [('date', 46000), 46000, 6]])]),
    'boolean.xlsx': workbook([('Результаты', [COLUMNS, BASE[:6] + [True, 10, 6]])]),
    'huge-coordinate.xlsx': workbook([('Результаты', rows)], f'<worksheet xmlns="{NS}"><sheetData><row r="999999999"><c r="A999999999"><v>1</v></c></row></sheetData></worksheet>'),
}
fixtures['coordinate-decoy.xlsx'] = workbook([('Результаты', rows)], f'''<worksheet xmlns="{NS}"><sheetData><row x='> r="1"' r="999999999"><c r="A1"><v>1</v></c></row></sheetData></worksheet>''')
fixtures['entity-coordinate.xlsx'] = workbook([('Результаты', rows)], f'<worksheet xmlns="{NS}"><sheetData><row r="&#57;&#57;&#57;&#57;&#57;&#57;"><c r="A1"><v>1</v></c></row></sheetData></worksheet>')
known_rows = [COLUMNS] + [[f'S{i}', 'Школа 01', 7, 'Математика', 'Статистика', 'Учебник A', score, 100, 4] for i, score in enumerate([0, 10, 20, 100], 1)]
fixtures['known-stats.xlsx'] = workbook([('Статистика', known_rows)])
fixtures['multi-valid.xlsx'] = workbook([('Первый', known_rows), ('Второй', [COLUMNS, ['Second', 'Школа 02', 7, 'Математика', 'Статистика', 'Учебник B', 80, 100, 4]])])
fixtures['invalid-headers.xlsx'] = workbook([('Результаты', [['unknown'] + COLUMNS[1:], BASE])])
for name, size in [('oversized-metadata.xlsx', 33 * 1024 * 1024), ('dishonest-size.xlsx', 1)]:
    contents = bytearray(fixtures['valid.xlsx'])
    offset = 0
    while True:
        offset = contents.find(b'PK\x01\x02', offset)
        if offset < 0:
            raise RuntimeError('Missing central directory')
        name_len = struct.unpack_from('<H', contents, offset + 28)[0]
        entry_name = bytes(contents[offset + 46:offset + 46 + name_len]).decode()
        if entry_name == 'xl/worksheets/sheet1.xml':
            struct.pack_into('<I', contents, offset + 24, size)
            break
        offset += 46 + name_len
    # Keep local and central declarations consistent to exercise real inflate bounds.
    local_offset = struct.unpack_from('<I', contents, offset + 42)[0]
    struct.pack_into('<I', contents, local_offset + 22, size)
    fixtures[name] = bytes(contents)

fixtures['descriptor-valid.xlsx'] = workbook([('Результаты', rows)], streaming=True)
for label, field in [('crc', 14), ('compressed', 18), ('expanded', 22), ('flags', 6)]:
    contents = bytearray(fixtures['valid.xlsx'])
    contents[field] ^= 1
    fixtures[f'local-mismatch-{label}.xlsx'] = bytes(contents)
contents = bytearray(fixtures['descriptor-valid.xlsx'])
descriptor = contents.index(b'PK\x07\x08')
contents[descriptor + 4] ^= 1
fixtures['descriptor-mismatch.xlsx'] = bytes(contents)
contents = bytearray(fixtures['valid.xlsx'])
end = len(contents) - 22
# A fake EOCD in the real comment is selected by fflate, but has an invalid length.
struct.pack_into('<H', contents, end + 20, 22)
fake_end = bytearray(22)
fake_end[:4] = b'PK\x05\x06'
struct.pack_into('<H', fake_end, 20, 1)
contents += fake_end
fixtures['ambiguous-eocd.xlsx'] = bytes(contents)
contents = bytearray(fixtures['valid.xlsx'])
end = len(contents) - 22
last_central = contents.rfind(b'PK\x01\x02')
# An apparent ZIP64 locator hidden inside the last central entry comment.
zip64 = bytearray(56)
zip64[:4] = b'PK\x06\x06'
locator = struct.pack('<IIQI', 0x07064b50, 0, end, 1)
struct.pack_into('<H', contents, last_central + 32, 76)
struct.pack_into('<I', contents, end + 12, struct.unpack_from('<I', contents, end + 12)[0] + 76)
contents[end:end] = zip64 + locator
fixtures['hidden-zip64-locator.xlsx'] = bytes(contents)
for name, contents in fixtures.items():
    (OUT / name).write_bytes(contents)
with (ROOT / 'public/data/template.csv').open(encoding='utf-8-sig', newline='') as source:
    data = list(csv.reader(source))
for row in data[1:]:
    for column in ['score', 'max_score', 'hours']:
        at = COLUMNS.index(column)
        row[at] = float(row[at])
(ROOT / 'public/data/template.xlsx').write_bytes(workbook([('Результаты', data)]))
print(f'Generated {len(fixtures)} XLSX fixtures and public/data/template.xlsx')
