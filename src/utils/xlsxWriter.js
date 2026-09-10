/**
 * XLSX WRITER — a real Excel workbook, with no library.
 *
 * ── WHY NOT A LIBRARY ────────────────────────────────────────────────────────
 *
 * Nothing in this app has ever written an .xlsx — the one screen with an
 * "Export Excel" button hands back a .csv (see KYCMetricsDashboard), and the
 * report builder offered CSV alone. A CSV cannot say that a column is money, a
 * date, or a number: Excel guesses, and its guesses are why a KRA PIN loses its
 * leading zero and 03/04 becomes a March date for one reader and an April date
 * for the next. The whole point of an Excel export over a CSV is TYPED cells.
 *
 * The obvious way to get them is SheetJS off a CDN, the way jsPdfLoader fetches
 * jsPDF. It was not taken here: an .xlsx is a ZIP of six small XML parts, we
 * only ever WRITE one, and writing it ourselves keeps a third-party script out
 * of a page that renders tenant payroll — and keeps the output assertable in a
 * test (see xlsxWriter.test.js) rather than trusting a minified blob.
 *
 * ── WHAT IT PRODUCES ─────────────────────────────────────────────────────────
 *
 * One sheet: a bold frozen header with an autofilter, typed body rows, an
 * optional totals row ruled off above, and optional provenance notes below a
 * blank row. Deliberately not a general-purpose spreadsheet API — it writes the
 * shape a REPORT has, and nothing else.
 *
 * Entries are deflated when the browser has CompressionStream and stored
 * uncompressed when it does not. Both are valid ZIP; the fallback just makes a
 * larger file, which is the right trade against failing the download.
 */

const enc = new TextEncoder();

// ── XML ──────────────────────────────────────────────────────────────────────
/**
 * Escape for XML content and attributes.
 *
 * The control-character strip is not cosmetic: a stray NUL or unit separator in
 * a tenant-entered name is illegal in XML 1.0, and Excel does not skip the cell —
 * it refuses the whole workbook as corrupt. One bad character in one row would
 * otherwise cost the entire export.
 */
export const xmlEscape = (value) =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 0 → A, 25 → Z, 26 → AA. */
export const colLetter = (index) => {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
};

// ── Dates ────────────────────────────────────────────────────────────────────
const EXCEL_EPOCH = Date.UTC(1899, 11, 30); // the 1900 system, Lotus bug included

/**
 * A Date as an Excel serial.
 *
 * Built from the LOCAL calendar components on purpose. An Excel serial carries
 * no timezone, so converting through UTC would move a payment made at 01:00 in
 * Nairobi onto the previous day for anyone who opened the file — the row would
 * disagree with the screen it was exported from.
 */
export const toSerial = (value, withTime = false) => {
  // new Date(null) is the 1970 epoch, not an invalid date, so a NULL column
  // would silently export as 01/01/1970 in every row that has none.
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const days = (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EXCEL_EPOCH) / 86400000;
  if (!withTime) return days;
  return days + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
};

/** 'YYYY-MM' → the first of that month, so Excel can sort and filter it as a date. */
const monthSerial = (value) => {
  const [y, m] = String(value ?? '').split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return toSerial(new Date(y, m - 1, 1));
};

// ── Styles ───────────────────────────────────────────────────────────────────
/**
 * Style slots, by index into cellXfs below. Referenced by name everywhere else
 * so the numbers live in exactly one place.
 */
export const STYLE = {
  general:      0,
  header:       1,
  date:         2,
  datetime:     3,
  money:        4,
  number:       5,
  month:        6,
  totalText:    7,
  totalMoney:   8,
  totalNumber:  9,
  note:        10,
  title:       11,
  sectionHead: 12,
};

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="5">'
  +   '<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>'
  +   '<numFmt numFmtId="165" formatCode="dd/mm/yyyy\\ hh:mm"/>'
  +   '<numFmt numFmtId="166" formatCode="#,##0.00"/>'
  +   '<numFmt numFmtId="167" formatCode="#,##0.####"/>'
  +   '<numFmt numFmtId="168" formatCode="mmm\\ yyyy"/>'
  + '</numFmts>'
  + '<fonts count="4">'
  +   '<font><sz val="11"/><name val="Calibri"/></font>'
  +   '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF1D4ED8"/></font>'
  +   '<font><sz val="9"/><name val="Calibri"/><color rgb="FF64748B"/></font>'
  +   '<font><b/><sz val="13"/><name val="Calibri"/><color rgb="FF0F172A"/></font>'
  + '</fonts>'
  + '<fills count="3">'
  +   '<fill><patternFill patternType="none"/></fill>'
  +   '<fill><patternFill patternType="gray125"/></fill>'
  +   '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F0FE"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="2">'
  +   '<border><left/><right/><top/><bottom/><diagonal/></border>'
  +   '<border><left/><right/><top style="thin"><color rgb="FF94A3B8"/></top><bottom/><diagonal/></border>'
  + '</borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="13">'
  +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  +   '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  +   '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  +   '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  +   '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  +   '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  +   '<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  +   '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>'
  +   '<xf numFmtId="166" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'
  +   '<xf numFmtId="167" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'
  +   '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  +   '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  +   '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

// ── Cells ────────────────────────────────────────────────────────────────────
/**
 * One cell of XML from a raw value and the column's type.
 *
 * A blank produces NO cell at all rather than an empty one. Excel treats a
 * present-but-empty cell as a value for COUNTA and for the "blanks" filter, so
 * an absent phone number would otherwise count as a phone number.
 */
export const cellXml = (ref, value, type, { total = false } = {}) => {
  const blank = value === null || value === undefined || value === '';
  if (blank) return '';

  const num = (v, style) => (Number.isFinite(v) ? `<c r="${ref}" s="${style}"><v>${v}</v></c>` : '');
  const str = (v, style) =>
    `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;

  // Where a value cannot be typed after all — an unparseable date, or the word
  // "Total" sitting in a date column because that is where the first column is.
  const text = (v) => str(v, total ? STYLE.totalText : STYLE.general);

  switch (type) {
    case 'money':
      return num(Number(value), total ? STYLE.totalMoney : STYLE.money);
    case 'number':
      return num(Number(value), total ? STYLE.totalNumber : STYLE.number);
    case 'date':
      return num(toSerial(value), STYLE.date) || text(value);
    case 'datetime':
      return num(toSerial(value, true), STYLE.datetime) || text(value);
    case 'month':
      return num(monthSerial(value), STYLE.month) || text(value);
    case 'boolean':
      // Yes/No rather than a real boolean cell: the sheet has to read the same
      // way as the screen it came off, and Excel renders booleans as TRUE/FALSE.
      return text(value === true ? 'Yes' : value === false ? 'No' : value);
    default:
      return text(value);
  }
};

/**
 * The worksheet: an optional document title, then one or more SECTIONS, then
 * the provenance notes.
 *
 * A section is `{ heading, columns, rows, totals }` — `columns` is
 * [{ label, type, width }] and `rows` are arrays aligned to it. Most exports
 * have exactly one; a dashboard export is half a dozen stacked down the sheet,
 * which is why this takes a list rather than a single table.
 *
 * The freeze and the autofilter are applied ONLY to a single-section sheet.
 * Both name one header row, and on a stacked sheet there is no such row — a
 * filter over the first section would hide rows belonging to the fourth, which
 * is worse than not offering one.
 *
 * Element order inside <worksheet> is fixed by the schema — cols before
 * sheetData, autoFilter after it — and Excel rejects the file if it slips.
 */
export const sheetXml = ({ sections = [], notes = [], title = null }) => {
  const list = (sections || []).filter(Boolean);

  const parts = [];
  let r = 0;
  const blank = () => { r += 1; };            // a row written as nothing at all
  const push = (xml) => parts.push(xml);

  const textRow = (value, style, height) => {
    r += 1;
    push(
      `<row r="${r}"${height ? ` ht="${height}" customHeight="1"` : ''}>`
      + `<c r="A${r}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
      + '</row>',
    );
  };

  // A title line above everything, when there is one. It sits in A1, then a
  // blank spacer, so the first header row is A3 — the freeze and the autofilter
  // both follow it rather than assuming row 1.
  if (title) {
    textRow(title, STYLE.title, 18);
    blank();
  }

  let headerRow = 0;
  let lastDataRow = 0;

  list.forEach((section, index) => {
    const cols = section.columns || [];
    if (index > 0) blank();
    if (section.heading) textRow(section.heading, STYLE.sectionHead);

    r += 1;
    headerRow = r;
    push(
      `<row r="${r}" ht="18" customHeight="1">`
      + cols.map((c, i) =>
        `<c r="${colLetter(i)}${r}" s="${STYLE.header}" t="inlineStr">`
        + `<is><t xml:space="preserve">${xmlEscape(c.label)}</t></is></c>`).join('')
      + '</row>',
    );

    (section.rows || []).forEach((row) => {
      r += 1;
      push(`<row r="${r}">${cols.map((c, i) => cellXml(`${colLetter(i)}${r}`, row[i], c.type)).join('')}</row>`);
    });
    lastDataRow = r;

    if (section.totals) {
      r += 1;
      push(`<row r="${r}">${cols
        .map((c, i) => cellXml(`${colLetter(i)}${r}`, section.totals[i], c.type, { total: true }))
        .join('')}</row>`);
    }
  });

  // One blank row between the last table and the provenance, so a reader who
  // selects the table does not drag the notes into their pivot.
  const lines = (notes || []).filter(Boolean);
  if (lines.length) blank();
  lines.forEach((note) => textRow(note, STYLE.note));

  // One <cols> serves the whole sheet, so each column takes the widest thing
  // any section puts in it — otherwise a narrow first section would clip a wide
  // one further down.
  const widths = [];
  list.forEach((section) => {
    (section.columns || []).forEach((c, i) => {
      const want = c.width || Math.min(42, Math.max(12, String(c.label ?? '').length + 4, i === 0 ? 18 : 0));
      widths[i] = Math.max(widths[i] || 0, want);
    });
  });

  const lastCol = colLetter(Math.max(0, widths.length - 1));
  const single = list.length === 1 && (list[0].columns || []).length > 0;

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<dimension ref="A1:${lastCol}${Math.max(1, r)}"/>`
    + '<sheetViews><sheetView workbookViewId="0">'
    + (single
      ? `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>`
      : '')
    + '</sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + (widths.length
      ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '')
    + `<sheetData>${parts.join('')}</sheetData>`
    + (single && lastDataRow > headerRow
      ? `<autoFilter ref="A${headerRow}:${lastCol}${lastDataRow}"/>`
      : '')
    + '</worksheet>';
};

// ── ZIP ──────────────────────────────────────────────────────────────────────
let CRC_TABLE = null;
const crcTable = () => {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[i] = c >>> 0;
  }
  return CRC_TABLE;
};

export const crc32 = (bytes) => {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const le16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/** Deflate, or null when the browser has no CompressionStream — then we store. */
const deflateRaw = async (bytes) => {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    const out = new Uint8Array(buffer);
    // A tiny part can deflate LARGER than it started. Storing it is both valid
    // and smaller, so take whichever won.
    return out.length < bytes.length ? out : null;
  } catch {
    return null;
  }
};

/**
 * A ZIP archive from [{ name, data }].
 *
 * Deliberately minimal: no directory entries, no zip64, no encryption. The
 * largest thing this ever packs is one worksheet, and a report that overflows a
 * 4 GB member has already been refused by the row ceiling.
 */
export const zip = async (files, modified = new Date()) => {
  const dosTime = ((modified.getHours() << 11) | (modified.getMinutes() << 5)
    | (modified.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((modified.getFullYear() - 1980) << 9) | ((modified.getMonth() + 1) << 5)
    | modified.getDate()) & 0xffff;

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const raw = typeof file.data === 'string' ? enc.encode(file.data) : file.data;
    // Sequential on purpose: the offsets in the local headers depend on the
    // sizes of the entries already written.
    const packed = await deflateRaw(raw);
    const body = packed || raw;
    const method = packed ? 8 : 0;
    const sum = crc32(raw);

    // Bit 11 marks the filename as UTF-8. Every name here is ASCII, but the
    // flag costs nothing and stops a reader guessing a codepage.
    const local = Uint8Array.from([
      ...le32(0x04034b50), ...le16(20), ...le16(0x0800), ...le16(method),
      ...le16(dosTime), ...le16(dosDate),
      ...le32(sum), ...le32(body.length), ...le32(raw.length),
      ...le16(name.length), ...le16(0),
    ]);
    chunks.push(local, name, body);

    central.push(Uint8Array.from([
      ...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0x0800), ...le16(method),
      ...le16(dosTime), ...le16(dosDate),
      ...le32(sum), ...le32(body.length), ...le32(raw.length),
      ...le16(name.length), ...le16(0), ...le16(0),
      ...le16(0), ...le16(0), ...le32(0), ...le32(offset),
      ...Array.from(name),
    ]));

    offset += local.length + name.length + body.length;
  }

  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = Uint8Array.from([
    ...le32(0x06054b50), ...le16(0), ...le16(0),
    ...le16(central.length), ...le16(central.length),
    ...le32(dirSize), ...le32(offset), ...le16(0),
  ]);

  const all = [...chunks, ...central, end];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  all.forEach((c) => { out.set(c, at); at += c.length; });
  return out;
};

// ── Workbook ─────────────────────────────────────────────────────────────────
/** Excel refuses these in a sheet name, and caps it at 31 characters. */
export const safeSheetName = (name) =>
  (String(name || '').replace(/[[\]:*?/\\]/g, ' ').trim() || 'Report').slice(0, 31);

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  + '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
  + '</Relationships>';

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '</Relationships>';

const workbookXml = (sheetName) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  + `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>`
  + '</workbook>';

/** The finished .xlsx as bytes. */
export const buildWorkbook = async (sheet, { modified } = {}) => {
  const name = safeSheetName(sheet.sheetName);
  return zip([
    { name: '[Content_Types].xml',        data: CONTENT_TYPES },
    { name: '_rels/.rels',                data: ROOT_RELS },
    { name: 'xl/workbook.xml',            data: workbookXml(name) },
    { name: 'xl/_rels/workbook.xml.rels', data: WORKBOOK_RELS },
    { name: 'xl/styles.xml',              data: STYLES_XML },
    { name: 'xl/worksheets/sheet1.xml',   data: sheetXml(sheet) },
  ], modified || new Date());
};

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default buildWorkbook;
