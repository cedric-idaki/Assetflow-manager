import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FORMATS, PDF_ROW_LIMIT, buildExportModel, buildDocumentModel, columnWidths,
  exportReportCSV, exportReportXLSX, exportReport, renderReportPDF,
} from './reportExport';
import { buildReport } from './reportQuery';
import { sourceByKey } from '../config/reportSchema';

const payments = sourceByKey('payments');

const RAN_AT = new Date(2026, 8, 2, 9, 15, 0); // 2 Sep 2026

/** A run result shaped exactly the way useReportBuilder puts one in state. */
const runResult = (definition, rows, extra = {}) => {
  const report = buildReport(rows, payments, definition);
  return {
    source: payments,
    definition,
    report,
    coverage: ['Paid on is within 1 Aug 2026 and 31 Aug 2026'],
    dropped: [],
    ranAt: RAN_AT,
    ...extra,
  };
};

const DETAIL = {
  sourceKey: 'payments',
  fields: ['payment_date', 'amount', 'payment_method'],
  filters: [],
  aggregates: [],
  groupBy: null,
  period: { preset: 'this_month' },
  sort: null,
};

const ROWS = [
  { id: 'a', payment_date: '2026-08-30', amount: 1000, payment_method: 'mpesa' },
  { id: 'b', payment_date: '2026-08-31', amount: 2500.5, payment_method: 'bank_transfer' },
];

describe('FORMATS', () => {
  it('offers exactly the three the screen promises', () => {
    expect(FORMATS.map((f) => f.value)).toEqual(['xlsx', 'csv', 'pdf']);
    FORMATS.forEach((f) => {
      expect(f.label).toBeTruthy();
      // A format with no hint is a menu row the reader has to guess at.
      expect(f.hint).toBeTruthy();
      expect(f.extension).toBe(f.value);
    });
  });
});

describe('buildExportModel', () => {
  it('returns nothing when there is no run to export', () => {
    expect(buildExportModel(null)).toBeNull();
    expect(buildExportModel({})).toBeNull();
  });

  it('names the file after the saved report and the day it ran', () => {
    const model = buildExportModel(runResult(DETAIL, ROWS), { name: 'August M-Pesa takings' });
    expect(model.title).toBe('August M-Pesa takings');
    expect(model.fileBase).toBe('august_m_pesa_takings_2026-09-02');
  });

  it('falls back to the source label for an unsaved report', () => {
    const model = buildExportModel(runResult(DETAIL, ROWS));
    expect(model.title).toBe(`${payments.label} report`);
  });

  it('writes the coverage into the file as provenance', () => {
    // A table of numbers with no statement of what was excluded is a table that
    // gets quoted out of context, so the filters travel IN the file.
    const model = buildExportModel(runResult(DETAIL, ROWS));
    expect(model.notes).toContain('Paid on is within 1 Aug 2026 and 31 Aug 2026');
    expect(model.notes[0]).toMatch(/^Report: /);
    expect(model.notes.at(-1)).toContain('2 records');
  });

  it('says so in the file when columns were dropped', () => {
    const model = buildExportModel(runResult(DETAIL, ROWS, { dropped: ['Reference'] }));
    expect(model.notes.join(' ')).toContain('left out: Reference');
  });

  it('carries a letterhead even for a tenant with no company profile', () => {
    const model = buildExportModel(runResult(DETAIL, ROWS), { company: null });
    expect(model.issuer.name).toBeTruthy();
  });

  it('uses the tenant company name when there is one', () => {
    const model = buildExportModel(runResult(DETAIL, ROWS), {
      company: { name: 'Ararat Motors Ltd', kra_pin: 'P051234567X' },
    });
    expect(model.issuer.name).toBe('Ararat Motors Ltd');
    expect(model.issuer.lines.join(' ')).toContain('P051234567X');
  });

  it('keeps the enum options so a stored value never reaches a file', () => {
    const model = buildExportModel(runResult(DETAIL, ROWS));
    const method = model.sections[0].columns.find((c) => c.key === 'payment_method');
    expect(method.options).toBeTruthy();
  });

  it('is one section — a report is a document with a single table', () => {
    const model = buildExportModel(runResult(DETAIL, ROWS));
    expect(model.sections).toHaveLength(1);
    expect(model.sections[0].heading).toBeNull();
  });

  it('reports the run row count, not the section length', () => {
    // A grouped report shows N groups but was computed over every matching row.
    // The file has to say which number it is talking about.
    const grouped = {
      ...DETAIL,
      fields: [],
      groupBy: { field: 'payment_method', granularity: null },
      aggregates: [{ fn: 'sum', field: 'amount' }],
    };
    const model = buildExportModel(runResult(grouped, ROWS));
    expect(model.sections[0].rows).toHaveLength(2);  // two methods
    expect(model.rowCount).toBe(2);                  // and two payments behind them
    expect(model.notes.join(' ')).toContain('2 records');
  });
});

describe('buildDocumentModel', () => {
  const kpis = {
    heading: 'KPI Summary',
    columns: [{ key: 'metric', label: 'Metric', type: 'text' },
      { key: 'value', label: 'Value', type: 'text' }],
    rows: [{ metric: 'Verification rate', value: '91%' }],
  };
  const trend = {
    heading: 'Verification Trend',
    columns: [{ key: 'month', label: 'Month', type: 'text' },
      { key: 'verified', label: 'Verified', type: 'number', numeric: true }],
    rows: [{ month: 'Sep', verified: 78 }, { month: 'Oct', verified: 82 }],
  };

  it('keeps every section that has columns', () => {
    const model = buildDocumentModel({ title: 'KYC report', sections: [kpis, trend] });
    expect(model.sections.map((s) => s.heading)).toEqual(['KPI Summary', 'Verification Trend']);
  });

  it('drops a section with nothing in it rather than printing an empty heading', () => {
    // A report the user narrowed to one section must not carry five empty
    // tables with headings and no rows under them.
    const model = buildDocumentModel({
      title: 'KYC report',
      sections: [kpis, null, { heading: 'Nothing', columns: [] }],
    });
    expect(model.sections).toHaveLength(1);
  });

  it('counts the rows across every section', () => {
    const model = buildDocumentModel({ title: 'KYC report', sections: [kpis, trend] });
    expect(model.rowCount).toBe(3);
  });

  it('names the file after the document and the day', () => {
    const model = buildDocumentModel({
      title: 'KYC Full Report', sections: [kpis], generatedAt: RAN_AT,
    });
    expect(model.fileBase).toBe('kyc_full_report_2026-09-02');
  });
});

describe('columnWidths', () => {
  const columns = [
    { key: 'note',   label: 'Note',   type: 'text' },
    { key: 'n',      label: 'No.',    type: 'number', numeric: true },
  ];

  it('gives the wide column more of the page than the narrow one', () => {
    // An even split is the tempting default and it is wrong: a long description
    // wraps to four lines while a count column holds a column of air.
    const rows = [{ note: 'x'.repeat(60), n: 1 }];
    const [wide, narrow] = columnWidths(columns, rows, 240);
    expect(wide).toBeGreaterThan(narrow);
  });

  it('always fills exactly the width it was given', () => {
    const rows = [{ note: 'short', n: 1 }];
    const total = columnWidths(columns, rows, 240).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(240, 6);
  });

  it('never lets one runaway column swallow the page', () => {
    const rows = [{ note: 'x'.repeat(4000), n: 1 }];
    const [wide, narrow] = columnWidths(columns, rows, 240);
    expect(narrow).toBeGreaterThan(20);
    expect(wide / narrow).toBeLessThan(6);
  });

  it('measures a sample, not every row', () => {
    // Laying out one page must not mean measuring 25,000 strings.
    const rows = Array.from({ length: 5000 }, (_, i) => ({ note: 'ab', n: i }));
    rows[4999].note = 'x'.repeat(200); // past the sample: deliberately unseen
    const [wide] = columnWidths(columns, rows, 240, 10);
    const [wideIfSeen] = columnWidths(columns, rows.slice(4999), 240, 10);
    expect(wide).toBeLessThan(wideIfSeen);
  });
});

// ── The writers ──────────────────────────────────────────────────────────────
/**
 * Catch what a writer actually hands the browser.
 *
 * The name alone is not the interesting half — a .xlsx of formatted strings is
 * a CSV wearing a costume — so the blob is kept and read back.
 */
const captureDownload = () => {
  const saved = [];
  global.URL.createObjectURL = vi.fn((blob) => { saved.push({ blob }); return 'blob:x'; });
  global.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    saved[saved.length - 1].name = this.download;
  });
  return saved;
};

describe('exportReportCSV', () => {
  let saved;
  beforeEach(() => { saved = captureDownload(); });
  afterEach(() => vi.restoreAllMocks());

  it('writes a .csv named after the report', async () => {
    const model = buildExportModel(runResult(DETAIL, ROWS), { name: 'August takings' });
    expect(exportReportCSV(model)).toBe(true);
    expect(saved[0].name).toBe('august_takings_2026-09-02.csv');
  });

  it('carries the header, the rows, the total and the provenance', async () => {
    const model = buildExportModel(runResult(DETAIL, ROWS), { name: 'August takings' });
    exportReportCSV(model);
    const text = await saved[0].blob.text();
    const lines = text.split('\r\n');

    expect(lines[0]).toContain('"Amount"');
    // Numbers stay bare so a spreadsheet reading the CSV still gets a number.
    expect(lines[1]).toContain('"1000"');
    expect(lines[2]).toContain('"2500.5"');
    // The enum reaches the file as the label the user picked it by.
    expect(text).toContain('"Mpesa"');
    expect(text).not.toContain('"bank_transfer"');
    // The total lands under its own column, not in the first one.
    expect(text).toContain('"Total","3500.5"');
    expect(text).toContain('Paid on is within 1 Aug 2026 and 31 Aug 2026');
  });
});

describe('exportReportXLSX', () => {
  let saved;
  beforeEach(() => { saved = captureDownload(); });
  afterEach(() => vi.restoreAllMocks());

  it('writes an .xlsx named after the report', async () => {
    const model = buildExportModel(runResult(DETAIL, ROWS), { name: 'August takings' });
    await exportReportXLSX(model);
    expect(saved[0].name).toBe('august_takings_2026-09-02.xlsx');
    expect(saved[0].blob.type)
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('puts money in as a number and the date as a serial', async () => {
    // The whole reason this format exists over a CSV. jsdom has no
    // CompressionStream, so the parts are stored and readable as text.
    const model = buildExportModel(runResult(DETAIL, ROWS), { name: 'August takings' });
    await exportReportXLSX(model);
    const xml = await saved[0].blob.text();

    expect(xml).toContain('<v>2500.5</v>');
    expect(xml).not.toContain('KES 2,500.5');
    // Matched as a pattern, not a fixed serial: 'Paid on' is a datetime, so
    // the fraction is the reader's own offset and a literal would fail in CI.
    expect(xml).toMatch(/<c r="A4" s="3"><v>46\d{3}(\.\d+)?<\/v><\/c>/);
    expect(xml).toContain('<v>3500.5</v>');      // the total, still a number
    expect(xml).toContain('Mpesa');              // the enum, still a label
    expect(xml).toContain('Paid on is within');  // the provenance rides along
  });
});

describe('exportReport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses without a model rather than writing an empty file', async () => {
    await expect(exportReport(null, 'csv')).rejects.toThrow(/Run the report first/);
  });
});

describe('renderReportPDF', () => {
  it('refuses a report too long to be a document, and names the way out', async () => {
    // Silently printing the first thousand rows is the failure that matters:
    // a truncated PDF is indistinguishable from a complete one once printed.
    const many = Array.from({ length: PDF_ROW_LIMIT + 1 }, (_, i) => ({
      id: String(i), payment_date: '2026-08-30', amount: 1, payment_method: 'mpesa',
    }));
    const model = buildExportModel(runResult(DETAIL, many));
    await expect(renderReportPDF(model)).rejects.toThrow(/Excel or CSV/);
  });

  it('refuses politely when there is nothing to render', async () => {
    await expect(renderReportPDF(null)).rejects.toThrow(/nothing to export/);
  });
});
