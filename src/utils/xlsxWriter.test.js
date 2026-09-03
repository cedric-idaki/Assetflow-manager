import { describe, it, expect } from 'vitest';
import {
  xmlEscape, colLetter, toSerial, cellXml, sheetXml,
  crc32, zip, buildWorkbook, safeSheetName, STYLE,
} from './xlsxWriter';

const dec = new TextDecoder();

// Built from char codes rather than written literally: a source file carrying a
// raw NUL is a source file the next editor silently strips it out of.
const NUL = String.fromCharCode(0);
const UNIT_SEP = String.fromCharCode(31);

describe('xmlEscape', () => {
  it('escapes the five characters that break XML', () => {
    expect(xmlEscape('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('strips control characters rather than emitting them', () => {
    // Excel does not skip a bad cell, it refuses the workbook. One NUL in one
    // tenant-entered name would otherwise cost the whole export.
    expect(xmlEscape(`Wanjir${NUL}u`)).toBe('Wanjiru');
    expect(xmlEscape(`a${UNIT_SEP}b`)).toBe('ab');
  });

  it('keeps tabs and newlines, which are legal', () => {
    expect(xmlEscape('a\tb\nc')).toBe('a\tb\nc');
  });

  it('renders null and undefined as nothing', () => {
    expect(xmlEscape(null)).toBe('');
    expect(xmlEscape(undefined)).toBe('');
  });
});

describe('colLetter', () => {
  it('counts in base-26 the way Excel does', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
    // The rollover is where a naive base-26 goes wrong: there is no zero digit,
    // so 26 is AA and not BA.
    expect(colLetter(26)).toBe('AA');
    expect(colLetter(27)).toBe('AB');
    expect(colLetter(51)).toBe('AZ');
    expect(colLetter(52)).toBe('BA');
    expect(colLetter(701)).toBe('ZZ');
  });
});

describe('toSerial', () => {
  it('puts the epoch where Excel puts it', () => {
    // 1 Mar 1900 is serial 61. The anchor is 30 Dec 1899 rather than the 31st
    // because Excel believes 1900 was a leap year — the Lotus bug it inherited.
    // That makes every date from 1 Mar 1900 on agree with Excel, and the two
    // months before it off by one, which no report in this app reaches.
    expect(toSerial(new Date(1900, 2, 1))).toBe(61);
  });

  it('reproduces a known modern date', () => {
    expect(toSerial(new Date(2026, 7, 30))).toBe(46264);
  });

  it('carries the clock only when asked', () => {
    const noon = new Date(2026, 7, 30, 12, 0, 0);
    expect(toSerial(noon)).toBe(46264);
    expect(toSerial(noon, true)).toBeCloseTo(46264.5, 6);
  });

  it('uses local calendar components, not UTC', () => {
    // A serial carries no timezone. Reading it in UTC would move an early
    // morning timestamp onto the previous day for anyone east of Greenwich, so
    // the file would disagree with the screen it came from.
    const early = new Date(2026, 7, 30, 1, 0, 0);
    expect(Math.floor(toSerial(early, true))).toBe(toSerial(new Date(2026, 7, 30)));
  });

  it('returns null for something that is not a date', () => {
    expect(toSerial('not a date')).toBeNull();
  });

  it('refuses a blank rather than reporting 1970', () => {
    // new Date(null) is the epoch, not an invalid date. Without the guard, a
    // nullable date column exports as 01/01/1970 in every row that has none.
    expect(toSerial(null)).toBeNull();
    expect(toSerial(undefined)).toBeNull();
    expect(toSerial('')).toBeNull();
  });
});

describe('cellXml', () => {
  it('writes money as a number, not a formatted string', () => {
    // The whole reason an Excel export exists over a CSV: the column has to add
    // up in the reader's own spreadsheet.
    const xml = cellXml('B2', 1234.5, 'money');
    expect(xml).toBe(`<c r="B2" s="${STYLE.money}"><v>1234.5</v></c>`);
    expect(xml).not.toContain('KES');
  });

  it('writes a date as a serial with a date format', () => {
    expect(cellXml('A2', '2026-08-30', 'date'))
      .toBe(`<c r="A2" s="${STYLE.date}"><v>46264</v></c>`);
  });

  it('writes a month as the first of that month', () => {
    expect(cellXml('A2', '2026-08', 'month'))
      .toBe(`<c r="A2" s="${STYLE.month}"><v>46235</v></c>`);
  });

  it('falls back to text when a date value will not parse', () => {
    const xml = cellXml('A2', 'sometime in August', 'date');
    expect(xml).toContain('t="inlineStr"');
    expect(xml).toContain('sometime in August');
  });

  it('writes booleans the way the screen reads them', () => {
    expect(cellXml('A2', true, 'boolean')).toContain('>Yes<');
    expect(cellXml('A2', false, 'boolean')).toContain('>No<');
  });

  it('omits a blank cell entirely', () => {
    // A present-but-empty cell counts for COUNTA and for the blanks filter, so
    // an absent phone number would read as a phone number.
    expect(cellXml('A2', null, 'text')).toBe('');
    expect(cellXml('A2', undefined, 'money')).toBe('');
    expect(cellXml('A2', '', 'text')).toBe('');
  });

  it('keeps a literal zero, which is not blank', () => {
    expect(cellXml('A2', 0, 'money')).toContain('<v>0</v>');
    expect(cellXml('A2', false, 'boolean')).not.toBe('');
  });

  it('escapes tenant text inside the cell', () => {
    expect(cellXml('A2', 'Mills & Co <Ltd>', 'text'))
      .toContain('Mills &amp; Co &lt;Ltd&gt;');
  });

  it('uses the ruled bold styles on a totals row', () => {
    expect(cellXml('B9', 100, 'money', { total: true })).toContain(`s="${STYLE.totalMoney}"`);
    expect(cellXml('A9', 'Total', 'text', { total: true })).toContain(`s="${STYLE.totalText}"`);
  });

  it('still styles the word Total when it lands in a typed column', () => {
    // The totals line puts "Total" in the FIRST column whatever that column is,
    // and in most reports the first column is the date. Falling back to text
    // must not also fall back out of the totals styling, or the total row loses
    // its rule and its bold on exactly the reports that have one.
    ['date', 'datetime', 'month', 'boolean'].forEach((type) => {
      expect(cellXml('A9', 'Total', type, { total: true }), type)
        .toContain(`s="${STYLE.totalText}"`);
    });
  });
});

describe('sheetXml', () => {
  const columns = [
    { label: 'Client', type: 'text' },
    { label: 'Paid on', type: 'date' },
    { label: 'Amount', type: 'money' },
  ];
  const rows = [
    ['Achieng', '2026-08-30', 1000],
    ['Otieno', '2026-08-31', 2500.75],
  ];
  const one = (extra = {}) => sheetXml({ sections: [{ columns, rows, ...extra.section }], ...extra.sheet });

  it('puts the header on row 1 when there is no title', () => {
    const xml = one();
    expect(xml).toContain('<row r="1" ht="18" customHeight="1">');
    expect(xml).toContain(`<c r="A1" s="${STYLE.header}"`);
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2"');
  });

  it('moves the header below a title, and freezes and filters from there', () => {
    // The freeze and the autofilter must follow the header rather than assume
    // row 1, or the title row is what gets frozen and the filter covers nothing.
    const xml = one({ sheet: { title: 'August payments' } });
    expect(xml).toContain(`<c r="A1" s="${STYLE.title}"`);
    expect(xml).toContain(`<c r="A3" s="${STYLE.header}"`);
    expect(xml).toContain('<pane ySplit="3" topLeftCell="A4"');
    expect(xml).toContain('<autoFilter ref="A3:C5"/>');
  });

  it('filters over the body only, never over the totals row', () => {
    const xml = one({ section: { totals: ['Total', null, 3500.75] } });
    // Rows 2-3 are the body; the totals land on row 4 and must stay out of it,
    // or sorting the sheet sorts the total into the middle of the data.
    expect(xml).toContain('<autoFilter ref="A1:C3"/>');
    expect(xml).toContain(`<c r="C4" s="${STYLE.totalMoney}"><v>3500.75</v></c>`);
  });

  it('leaves a blank row between the table and its provenance', () => {
    const xml = one({ sheet: { notes: ['Report: August payments', '2 records'] } });
    // Body ends on row 3, so the notes start on row 5.
    expect(xml).toContain('<row r="5">');
    expect(xml).toContain('<row r="6">');
    expect(xml).not.toContain('<row r="4">');
  });

  it('emits no autofilter when there are no rows to filter', () => {
    expect(sheetXml({ sections: [{ columns, rows: [] }] })).not.toContain('autoFilter');
  });

  it('keeps the schema element order Excel requires', () => {
    const xml = one({ section: { totals: ['Total', null, 1] } });
    const at = (tag) => xml.indexOf(tag);
    expect(at('<dimension')).toBeLessThan(at('<sheetViews'));
    expect(at('<sheetViews')).toBeLessThan(at('<cols'));
    expect(at('<cols')).toBeLessThan(at('<sheetData'));
    expect(at('<sheetData')).toBeLessThan(at('<autoFilter'));
  });

  it('survives a column count past Z', () => {
    const wide = Array.from({ length: 28 }, (_, i) => ({ label: `C${i}`, type: 'text' }));
    const xml = sheetXml({ sections: [{ columns: wide, rows: [wide.map((_, i) => `v${i}`)] }] });
    expect(xml).toContain('<c r="AB2"');
    expect(xml).toContain('ref="A1:AB2"');
  });
});

describe('sheetXml with several sections', () => {
  const kpis = {
    heading: 'KPI Summary',
    columns: [{ label: 'Metric', type: 'text' }, { label: 'Value', type: 'text' }],
    rows: [['Verification rate', '91%']],
  };
  const trend = {
    heading: 'Verification Trend',
    columns: [
      { label: 'Month', type: 'text' },
      { label: 'Verified', type: 'number' },
      { label: 'Pending', type: 'number' },
    ],
    rows: [['Sep', 78, 15], ['Oct', 82, 12]],
  };

  it('stacks them with a heading and a blank row between', () => {
    const xml = sheetXml({ sections: [kpis, trend] });
    // KPI: heading r1, header r2, one row r3. Blank r4. Trend heading r5,
    // header r6, rows r7-r8.
    expect(xml).toContain(`<c r="A1" s="${STYLE.sectionHead}" t="inlineStr"><is><t xml:space="preserve">KPI Summary</t>`);
    expect(xml).toContain(`<c r="A2" s="${STYLE.header}"`);
    expect(xml).not.toContain('<row r="4">');
    expect(xml).toContain(`<c r="A5" s="${STYLE.sectionHead}" t="inlineStr"><is><t xml:space="preserve">Verification Trend</t>`);
    expect(xml).toContain(`<c r="A6" s="${STYLE.header}"`);
    expect(xml).toContain('<c r="B8"');
  });

  it('offers neither a freeze nor a filter once there is more than one table', () => {
    // Both name ONE header row. On a stacked sheet a filter anchored to the
    // first section would hide rows belonging to the second, which is worse
    // than not offering one at all.
    const xml = sheetXml({ sections: [kpis, trend] });
    expect(xml).not.toContain('<pane');
    expect(xml).not.toContain('autoFilter');
  });

  it('sizes each column for the widest section that uses it', () => {
    // One <cols> serves the sheet, so a narrow first section must not clip a
    // wide one below it.
    const xml = sheetXml({
      sections: [
        { columns: [{ label: 'A', type: 'text' }], rows: [['x']] },
        { columns: [{ label: 'A', type: 'text', width: 40 }], rows: [['y']] },
      ],
    });
    expect(xml).toContain('<col min="1" max="1" width="40"');
  });

  it('takes its width from the widest section, not the last one', () => {
    const xml = sheetXml({ sections: [kpis, trend] });
    expect(xml).toContain('ref="A1:C8"');
  });
});

describe('zip', () => {
  const FIXED = new Date(2026, 8, 2, 10, 30, 0);

  it('stamps the signatures a reader looks for', async () => {
    const bytes = await zip([{ name: 'a.txt', data: 'hello' }], FIXED);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // The end-of-central-directory record closes the file.
    expect(Array.from(bytes.slice(-22, -18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it('counts every entry in the central directory', async () => {
    const bytes = await zip([
      { name: 'a.txt', data: 'one' },
      { name: 'b.txt', data: 'two' },
      { name: 'c.txt', data: 'three' },
    ], FIXED);
    const view = new DataView(bytes.buffer, bytes.byteLength - 22, 22);
    expect(view.getUint16(8, true)).toBe(3);   // entries on this disk
    expect(view.getUint16(10, true)).toBe(3);  // entries total
  });

  it('records the uncompressed size and CRC of the original bytes', async () => {
    const data = 'the quick brown fox';
    const bytes = await zip([{ name: 'a.txt', data }], FIXED);
    const view = new DataView(bytes.buffer);
    // A deflated entry still has to declare the CRC and length of what went IN,
    // or every unzipper reports the archive as corrupt.
    expect(view.getUint32(14, true)).toBe(crc32(new TextEncoder().encode(data)));
    expect(view.getUint32(22, true)).toBe(data.length);
  });
});

describe('crc32', () => {
  it('matches the published check value', () => {
    // The standard CRC-32 of "123456789".
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('is zero for nothing', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('safeSheetName', () => {
  it('drops the characters Excel refuses in a tab name', () => {
    expect(safeSheetName('Payments [Q3]/2026')).toBe('Payments  Q3  2026');
  });

  it('caps at the 31 characters Excel allows', () => {
    expect(safeSheetName('x'.repeat(50))).toHaveLength(31);
  });

  it('falls back rather than producing an unnamed sheet', () => {
    expect(safeSheetName('')).toBe('Report');
    expect(safeSheetName(null)).toBe('Report');
  });
});

describe('buildWorkbook', () => {
  it('packs every part an .xlsx needs', async () => {
    const bytes = await buildWorkbook({
      sheetName: 'Payments',
      columns: [{ label: 'Amount', type: 'money' }],
      rows: [[100]],
    });
    // The names live in the local headers as plain bytes whether or not the
    // bodies were deflated, so they are readable without unzipping.
    const text = dec.decode(bytes);
    ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml',
    ].forEach((part) => expect(text).toContain(part));
  });

  it('lists exactly those six entries in the central directory', async () => {
    const bytes = await buildWorkbook({
      sheetName: 'Loans/Arrears',
      columns: [{ label: 'A', type: 'text' }],
      rows: [],
    });
    // Read the end-of-central-directory record rather than scanning for text:
    // the part BODIES are deflated wherever the runtime has CompressionStream,
    // so a string search would pass or fail on the environment.
    const view = new DataView(bytes.buffer, bytes.byteLength - 22, 22);
    expect(view.getUint16(10, true)).toBe(6);
  });
});
