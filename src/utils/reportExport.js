/**
 * REPORT EXPORT — one built report, three files.
 *
 * The report builder answers questions nobody wrote a screen for, which means
 * its answers leave the app: into a board pack, an auditor's folder, a KRA
 * submission, a spreadsheet somebody re-cuts by hand. Until now the only way
 * out was a CSV, and a CSV is the wrong file for two of those three.
 *
 *   CSV    the interchange format. Every row, no formatting, opens anywhere.
 *   Excel  the working format. TYPED cells — money sums, dates sort, the
 *          header freezes and filters — so the reader can keep working.
 *   PDF    the evidence format. Fixed layout, letterhead, the provenance
 *          printed on the page, and it looks the same for everyone.
 *
 * ── ONE MODEL, THREE WRITERS ─────────────────────────────────────────────────
 *
 * `buildExportModel` is pure: it turns a run result into the exact CONTENT of
 * the export — title, columns, rows, totals, the provenance lines — and the
 * writers below only paint it. Same split as accountingDocument.js, for the
 * same reason: what the file SAYS is assertable in a test rather than inferred
 * from something that landed in Downloads.
 *
 * The three writers disagree about values on purpose. Excel gets RAW values so
 * a money column arrives as a number Excel can add; the PDF gets DISPLAY
 * strings because it is a picture of the table; CSV keeps the middle position
 * it already had (numbers bare, dates as ISO) so nothing that already consumes
 * these files breaks.
 */

import { downloadCSVText, toCSVGrid, saveBlob } from './exportUtils';
import { formatCell, cellLabel } from './reportQuery';
import { buildWorkbook, XLSX_MIME } from './xlsxWriter';
import { loadJsPDF, pdfSafeText } from './jsPdfLoader';
import { normaliseIssuer } from './accountingDocument';

/**
 * How many rows a PDF will paint before it refuses.
 *
 * The row ceiling upstream is 25,000, which is a fine Excel file and roughly
 * seven hundred pages of PDF — long enough that the tab stops responding while
 * jsPDF walks it. Refusing with a message that names the two formats which DO
 * carry every row is honest; quietly printing the first thousand is not, and a
 * truncated PDF is indistinguishable from a complete one once it is printed.
 */
export const PDF_ROW_LIMIT = 5000;

export const FORMATS = [
  { value: 'xlsx', label: 'Excel workbook', extension: 'xlsx', icon: 'Sheet',
    hint: 'Typed cells — totals add up, dates sort, the header filters' },
  { value: 'csv', label: 'CSV file', extension: 'csv', icon: 'FileText',
    hint: 'Plain rows, opens in anything' },
  { value: 'pdf', label: 'PDF document', extension: 'pdf', icon: 'FileType',
    hint: 'Laid out for printing and filing' },
];

/** Every OS refuses a filename carrying these. */
const safeName = (s, fallback = 'report') =>
  (String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || fallback)
    .slice(0, 60);

/**
 * The three dialects, as casts.
 *
 * Excel wants the value ITSELF so a money column adds up; the PDF wants what
 * the screen shows, because it is a picture of the table; the CSV keeps the
 * middle position it already had. Passing the cast around rather than a mode
 * flag is what stops a totals line ending up formatted differently from the
 * rows above it.
 */
const RAW     = (v) => v ?? null;
const DISPLAY = (v, c) => formatCell(v, c.type);
const FOR_CSV = (v, c) => formatCell(v, c.type, { forExport: true });

/**
 * The value one cell contributes to an export.
 *
 * An enum resolves to the label the user picked it by in EVERY dialect — the
 * stored `partially_paid` means nothing to a reader, and a spreadsheet that
 * groups on it groups on the wrong vocabulary.
 */
const cellValue = (row, column, cast) => {
  const value = row?.[column.key];
  return column.options ? cellLabel(value, column) : cast(value, column);
};

/**
 * A report's totals as one array aligned to its columns.
 *
 * Mirrors the table's own footer: a column with no total gets nothing, except
 * the first, which gets the word — a bold ruled row of blanks with one figure
 * floating in it reads as a stray number rather than a total.
 */
const totalsRow = (report, cast) => {
  if (!report.totals) return null;
  return report.columns.map((c, i) => {
    if (c.key in report.totals) return cast(report.totals[c.key], c);
    return i === 0 ? 'Total' : null;
  });
};

/** A stored totals array recast for one writer. Blanks stay blank. */
const castTotals = (section, cast) =>
  section.totals?.map((v, i) => (v === null || v === undefined ? null : cast(v, section.columns[i]))) || null;

/**
 * The general model: a titled document of one or more SECTIONS.
 *
 * A section is `{ heading, columns, rows, totals }` — `columns` carry the same
 * `{ key, label, type, numeric, options }` shape the report builder uses, and
 * `rows` are plain objects keyed by column key. One section is a report; half a
 * dozen is a dashboard. The writers below never ask which it is.
 */
export const buildDocumentModel = ({
  title, sheetName = null, sections = [], notes = [],
  company = null, generatedAt = new Date(), summary = null,
}) => {
  const list = (sections || []).filter((s) => s && (s.columns || []).length);
  const rowCount = list.reduce((n, s) => n + (s.rows || []).length, 0);

  return {
    title,
    // The letterhead. normaliseIssuer accepts a raw company_profiles row or
    // nothing at all, so a tenant that never filled its profile in still gets a
    // headed document rather than a blank band.
    issuer: normaliseIssuer(company),
    sheetName: sheetName || title,
    fileBase: `${safeName(title)}_${generatedAt.toISOString().slice(0, 10)}`,
    sections: list.map((s) => ({
      heading: s.heading || null,
      columns: (s.columns || []).map((c) => ({
        key: c.key, label: c.label, type: c.type || 'text',
        numeric: Boolean(c.numeric),
        // Carried through so an enum still resolves to the label the user picked
        // it by, in every format — see cellValue.
        options: c.options || null,
      })),
      rows: s.rows || [],
      totals: s.totals || null,
    })),
    notes: (notes || []).filter(Boolean),
    // What the reader is told about the slice in front of them, printed above
    // the first table in the PDF.
    summary: summary || [],
    generatedAt,
    rowCount,
  };
};

/**
 * A finished report-builder run → a one-section document.
 *
 * `result` is what useReportBuilder puts in state: { source, report, coverage,
 * dropped, ranAt }. Nothing here reaches for data the run did not already have,
 * so an export can never show a figure the screen did not.
 */
export const buildExportModel = (result, { name = null, company = null } = {}) => {
  if (!result?.report) return null;
  const { report, source, coverage = [], dropped = [], ranAt } = result;

  const generatedAt = ranAt instanceof Date ? ranAt : new Date();
  const title = name || `${source?.label || 'Custom'} report`;

  // The provenance travels IN the file, not beside it. A table of numbers with
  // no statement of what was excluded is a table that gets quoted out of
  // context in a meeting nobody from this screen is in.
  const notes = [
    `Report: ${title}`,
    ...coverage,
    dropped.length
      ? `Columns that could not be fetched and were left out: ${dropped.join(', ')}`
      : null,
    `${report.rowCount.toLocaleString('en-KE')} record${report.rowCount === 1 ? '' : 's'}`
      + ` · generated ${generatedAt.toLocaleString('en-GB')}`,
  ].filter(Boolean);

  const model = buildDocumentModel({
    title,
    sheetName: source?.label || 'Report',
    sections: [{
      columns: report.columns,
      rows: report.rows,
      totals: totalsRow(report, RAW),
    }],
    notes,
    summary: coverage,
    company,
    generatedAt,
  });

  // The builder's own row count, not the sum of the section: a grouped report
  // shows N groups but was computed over every matching row, and the file has
  // to say which number it is talking about.
  return { ...model, report, coverage, rowCount: report.rowCount };
};

// ── CSV ──────────────────────────────────────────────────────────────────────
/**
 * The tables, then the provenance as trailing rows.
 *
 * Trailing rather than a preamble so a single-table export still parses as a
 * table with its header on line one — the shape this screen has always
 * produced, and the shape anything already consuming these files expects.
 */
export const exportReportCSV = (model) => {
  const grid = [];

  model.sections.forEach((section, index) => {
    if (index > 0) grid.push([]);
    if (section.heading) grid.push([section.heading]);
    grid.push(section.columns.map((c) => c.label));
    section.rows.forEach((row) => {
      grid.push(section.columns.map((c) => cellValue(row, c, FOR_CSV)));
    });
    const totals = castTotals(section, FOR_CSV);
    if (totals) grid.push(totals);
  });

  if (grid.length === 0) return false;
  grid.push([]);
  model.notes.forEach((line) => grid.push([line]));

  return downloadCSVText(toCSVGrid(grid), model.fileBase);
};

// ── EXCEL ────────────────────────────────────────────────────────────────────
export const exportReportXLSX = async (model) => {
  const bytes = await buildWorkbook({
    sheetName: model.sheetName,
    title: model.title,
    sections: model.sections.map((section) => ({
      heading: section.heading,
      columns: section.columns.map((c) => ({
        label: c.label,
        type: c.options ? 'text' : c.type,
        // A money column has to fit "1,234,567.89" plus its header; a datetime
        // needs room for the clock. Sized here rather than left to Excel's
        // default, which clips every figure to ####.
        width: c.type === 'money' ? 16 : c.type === 'datetime' ? 18 : undefined,
      })),
      rows: section.rows.map((row) => section.columns.map((c) => cellValue(row, c, RAW))),
      totals: section.totals,
    })),
    notes: model.notes,
  });

  saveBlob(new Blob([bytes], { type: XLSX_MIME }), `${model.fileBase}.xlsx`);
  return true;
};

// ── PDF ──────────────────────────────────────────────────────────────────────
const M = 12;            // page margin, mm
const BLUE  = [29, 78, 216];
const DARK  = [15, 23, 42];
const GRAY  = [100, 116, 139];
const WHITE = [255, 255, 255];
const TINT  = [232, 240, 254];

/**
 * Column widths, weighted by what is actually in the column.
 *
 * jsPDF has no table layout, so an even split is the tempting default and it is
 * wrong in a report: a 40-character description and a 3-character count get the
 * same space, so one wraps to four lines while the other holds a column of air.
 * Widths come from the widest of the header and a SAMPLE of the rows — the
 * whole set would mean measuring 25,000 strings to lay out one page.
 */
export const columnWidths = (columns, rows, available, sample = 60) => {
  const seen = rows.slice(0, sample);
  const weights = columns.map((c) => {
    const longest = seen.reduce(
      (n, row) => Math.max(n, String(cellValue(row, c, DISPLAY) ?? '').length),
      String(c.label ?? '').length,
    );
    // Clamped both ways: a column of UUIDs must not eat the page, and a column
    // headed "No." still needs room for its header.
    return Math.min(38, Math.max(8, longest));
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => (w / total) * available);
};

/**
 * Paints the model and returns the jsPDF instance.
 *
 * Landscape, because a report the user chose the columns of is wider than a
 * voucher. Rendering is separate from saving so the same page could be
 * previewed or attached later without a file landing on a disk first.
 *
 * Each section lays out its own columns — a dashboard export stacks a
 * four-column KPI table above a five-column trend table, and forcing them onto
 * one grid would leave both wrong.
 */
export const renderReportPDF = async (model) => {
  if (!model) throw new Error('There is nothing to export.');
  if (model.rowCount > PDF_ROW_LIMIT) {
    throw new Error(
      `A PDF of ${model.rowCount.toLocaleString('en-KE')} rows is not a document anybody can read. `
      + `PDF is capped at ${PDF_ROW_LIMIT.toLocaleString('en-KE')} rows — export to Excel or CSV, `
      + 'which carry every row, or group the report first.',
    );
  }

  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - M * 2;
  const BOTTOM = H - 14;

  const font  = (style = 'normal', size = 9) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const color = (rgb) => doc.setTextColor(...rgb);
  const fill  = (x, y, w, h, rgb) => { doc.setFillColor(...rgb); doc.rect(x, y, w, h, 'F'); };
  // The two doors text can enter the page by, so nothing bypasses the
  // sanitiser and mangles a whole line.
  const text = (s, x, y, opts) => doc.text(pdfSafeText(s), x, y, opts);
  const wrap = (s, width) => doc.splitTextToSize(pdfSafeText(s), width);

  let Y = 0;

  // ── Header band ────────────────────────────────────────────────────────────
  const band = () => {
    fill(0, 0, W, 22, BLUE);
    font('bold', 13); color(WHITE);
    text(model.issuer?.name || 'Ararat', M, 10);
    font('normal', 7); color([185, 212, 255]);
    text((model.issuer?.lines || []).slice(0, 2).join('  ·  '), M, 15.5);

    font('bold', 12); color(WHITE);
    text(model.title, W - M, 10, { align: 'right' });
    font('normal', 7.5); color([185, 212, 255]);
    text(`${model.rowCount.toLocaleString('en-KE')} record${model.rowCount === 1 ? '' : 's'}`
      + ` · ${model.generatedAt.toLocaleString('en-GB')}`, W - M, 15.5, { align: 'right' });
    Y = 28;
  };

  band();

  // ── Summary ────────────────────────────────────────────────────────────────
  // Printed above the first table, not buried at the end: it is the sentence
  // that tells the reader which slice of the book this is.
  if (model.summary.length) {
    font('normal', 7.5); color(GRAY);
    const lines = wrap(model.summary.join('  ·  '), CW);
    doc.text(lines, M, Y);
    Y += lines.length * 3.6 + 3;
  }

  // ── Sections ───────────────────────────────────────────────────────────────
  model.sections.forEach((section, index) => {
    const cols = section.columns;
    const widths = columnWidths(cols, section.rows, CW);
    const xs = [];
    widths.reduce((x, w, i) => { xs[i] = x; return x + w; }, M);
    const align = (c) => (c.numeric ? 'right' : 'left');
    const cellX = (c, i) => (c.numeric ? xs[i] + widths[i] - 2 : xs[i] + 2);

    const head = () => {
      fill(M, Y, CW, 7, BLUE);
      font('bold', 7.5); color(WHITE);
      cols.forEach((c, i) => text(c.label, cellX(c, i), Y + 4.8, { align: align(c) }));
      Y += 7;
    };

    // A section is never orphaned: if its heading and header row will not fit
    // above the fold with at least one line of body under them, it starts the
    // next page instead of dangling a title at the foot of this one.
    const room = (needed, repeatHead = true) => {
      if (Y + needed <= BOTTOM) return;
      doc.addPage();
      band();
      if (repeatHead) head();
    };

    if (index > 0) Y += 5;
    if (section.heading) {
      room(20, false);
      font('bold', 9.5); color(DARK);
      text(section.heading, M, Y + 4);
      Y += 7;
    }

    room(16, false);
    head();

    if (section.rows.length === 0) {
      font('normal', 9); color(GRAY);
      text('Nothing matched.', M + 3, Y + 6);
      Y += 12;
    }

    section.rows.forEach((row, idx) => {
      const wrapped = cols.map((c, i) => wrap(cellValue(row, c, DISPLAY) ?? '', widths[i] - 4));
      const h = Math.max(6, wrapped.reduce((n, w) => Math.max(n, w.length), 1) * 3.4 + 2.6);

      room(h);
      if (idx % 2 === 1) fill(M, Y, CW, h, [248, 250, 252]);
      font('normal', 7.5); color(DARK);
      cols.forEach((c, i) => doc.text(wrapped[i], cellX(c, i), Y + 4.2, { align: align(c) }));
      Y += h;
    });

    const totals = castTotals(section, DISPLAY);
    if (totals) {
      room(9);
      fill(M, Y, CW, 8, TINT);
      font('bold', 8); color(BLUE);
      cols.forEach((c, i) => text(totals[i] ?? '', cellX(c, i), Y + 5.4, { align: align(c) }));
      Y += 8;
    }
  });

  // ── Provenance footer ──────────────────────────────────────────────────────
  if (Y + 6 + model.notes.length * 3.6 > BOTTOM) { doc.addPage(); band(); }
  Y += 4;
  font('normal', 7); color(GRAY);
  model.notes.forEach((line) => {
    const wrapped = wrap(line, CW);
    doc.text(wrapped, M, Y);
    Y += wrapped.length * 3.2;
  });

  // Page numbers last, once the page count is known.
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    font('normal', 7); color(GRAY);
    text(`Page ${p} of ${pages}`, W - M, H - 7, { align: 'right' });
  }

  return doc;
};

export const exportReportPDF = async (model) => {
  const doc = await renderReportPDF(model);
  doc.save(`${model.fileBase}.pdf`);
  return true;
};

// ── Entry point ──────────────────────────────────────────────────────────────
/**
 * Write the report in one format. Throws with a readable message rather than
 * returning false, because every failure here has something worth telling the
 * user: the CDN did not answer, or the PDF is too long to be a PDF.
 */
export const exportReport = async (model, format) => {
  if (!model) throw new Error('Run the report first.');
  switch (format) {
    case 'xlsx': return exportReportXLSX(model);
    case 'pdf':  return exportReportPDF(model);
    case 'csv':
    default:
      if (!exportReportCSV(model)) throw new Error('There was nothing to write.');
      return true;
  }
};

export default exportReport;
