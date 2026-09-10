/**
 * KYC DASHBOARD EXPORTS (pure)
 *
 * The dashboard has thirteen export buttons — two in the header, one on each
 * chart, and a PDF/Excel pair on each of six named reports. Every one of them
 * used to produce the same file: the WHOLE dashboard, as a CSV, whatever format
 * the modal had been set to. Ask for "Document Expiry Report – PDF" and you got
 * a CSV of the compliance scores as well.
 *
 * So the two questions a download has to answer are separated here and made
 * assertable:
 *
 *   SECTIONS   what is on the screen, as tables. One per KPI block and one per
 *              chart — a chart's export is its series, which is what a reader
 *              opening it in a spreadsheet actually wants.
 *   REPORTS    which of those sections each named report contains.
 *
 * Nothing in this file paints anything. `buildKycSections` hands its result to
 * buildDocumentModel and the writers in reportExport.js take it from there, so
 * the KYC exports and the report builder's produce the same kind of file.
 */

/** Section keys, so a report definition below cannot name one that is not built. */
export const SECTION = {
  kpis:       'kpis',
  trend:      'trend',
  expiry:     'expiry',
  aging:      'aging',
  renewals:   'renewals',
  docTypes:   'docTypes',
  compliance: 'compliance',
};

/**
 * Which of the three modal toggles each section answers to.
 *
 * The toggles were decorative until now — all three were ignored — so this is
 * where they become real. A section belongs to exactly one group.
 */
export const SECTION_GROUP = {
  [SECTION.kpis]:       'summary',
  [SECTION.trend]:      'charts',
  [SECTION.expiry]:     'charts',
  [SECTION.renewals]:   'charts',
  [SECTION.docTypes]:   'charts',
  [SECTION.compliance]: 'charts',
  [SECTION.aging]:      'detail',
};

/**
 * Every named export target, and the sections it means.
 *
 * Keyed by the report title the buttons already use, so the screen keeps its
 * own vocabulary and a new button is a line here rather than a branch in the
 * handler. A target that is not listed falls back to the full report, which is
 * the old behaviour and the safe one — too much rather than the wrong thing.
 */
export const KYC_REPORTS = {
  'KYC Full Report':            Object.values(SECTION),
  'KYC Verification Summary':   [SECTION.kpis, SECTION.trend, SECTION.docTypes],
  'Document Expiry Report':     [SECTION.expiry, SECTION.aging],
  'Renewal Status Report':      [SECTION.kpis, SECTION.renewals],
  'Aging Analysis Report':      [SECTION.aging],
  'Compliance Score Report':    [SECTION.kpis, SECTION.compliance],
  'Verification Time Report':   [SECTION.kpis, SECTION.docTypes],
  // The download button on each chart: that chart's series, and nothing else.
  'Verification Trend':         [SECTION.trend],
  'Expiry Timeline':            [SECTION.expiry],
  'Aging Analysis':             [SECTION.aging],
  'Renewal Tracking':           [SECTION.renewals],
  'Document Type Rates':        [SECTION.docTypes],
  'Compliance Scores':          [SECTION.compliance],
};

export const sectionsForReport = (report) =>
  KYC_REPORTS[report] || KYC_REPORTS['KYC Full Report'];

// `numeric` decides the alignment in the PDF and nothing else — the cell TYPE
// is what makes Excel treat it as a number. Both are stated rather than left to
// default, because a count column that quietly stops being numeric is a column
// that left-aligns against every other table on the page.
const text   = (key, label) => ({ key, label, type: 'text',   numeric: false });
const number = (key, label) => ({ key, label, type: 'number', numeric: true });

/**
 * The dashboard's data as titled tables.
 *
 * `data` is what the screen is rendering — the KPI figures and each chart's
 * series. It is passed in rather than imported so this file does not have to
 * know whether those numbers are the current mock set or, one day, real rows.
 */
export const buildKycSections = (data) => {
  const { kpis = {}, trend = [], expiry = [], aging = [], renewals = [], docTypes = [], compliance = [] } = data || {};

  return {
    [SECTION.kpis]: {
      heading: 'KPI Summary',
      columns: [text('metric', 'Metric'), text('value', 'Value'), text('detail', 'Detail')],
      rows: [
        { metric: 'Total clients', value: kpis.totalClients, detail: '' },
        { metric: 'Verified clients', value: kpis.verifiedCount, detail: '' },
        { metric: 'Verification rate', value: `${kpis.verificationRate}%`, detail: `${kpis.verifiedCount} of ${kpis.totalClients} verified` },
        { metric: 'Renewal completion rate', value: `${kpis.renewalRate}%`, detail: `${kpis.renewalPending} pending` },
        { metric: 'Average verification time', value: `${kpis.avgVerifyDays} days`, detail: '' },
        { metric: 'Overall compliance score', value: `${kpis.overallCompliance}%`, detail: 'Across all client segments' },
      ],
    },

    [SECTION.trend]: {
      heading: 'Verification Rate Trend',
      columns: [text('month', 'Month'), number('verified', 'Verified'),
        number('pending', 'Pending'), number('rejected', 'Rejected')],
      rows: trend,
    },

    [SECTION.expiry]: {
      heading: 'Document Expiry Timeline',
      columns: [text('bucket', 'Bucket'), number('count', 'Documents')],
      rows: expiry,
    },

    [SECTION.aging]: {
      heading: 'Aging Analysis by Client Segment',
      columns: [text('segment', 'Segment'), number('current', 'Current'),
        number('days30', '30 days'), number('days60', '60 days'), number('days90', '90 days')],
      rows: aging,
    },

    [SECTION.renewals]: {
      heading: 'Renewal Completion Tracking',
      columns: [text('week', 'Week'), number('completed', 'Completed'), number('pending', 'Pending')],
      rows: renewals,
    },

    [SECTION.docTypes]: {
      heading: 'Document Type Verification Rates',
      columns: [text('type', 'Document type'), number('rate', 'Rate (%)'), number('count', 'Documents')],
      rows: docTypes,
    },

    [SECTION.compliance]: {
      heading: 'Compliance Score by Segment',
      columns: [text('segment', 'Segment'), number('score', 'Score (%)')],
      rows: compliance,
    },
  };
};

/**
 * The sections one download should carry: the report's own list, narrowed by
 * whichever of the modal's toggles are on.
 *
 * A report reduced to nothing by the toggles returns an empty list rather than
 * quietly falling back to everything — the caller says so instead of handing
 * over a file the user did not ask for.
 */
export const kycExportSections = (data, { report, options = {} } = {}) => {
  const built = buildKycSections(data);
  const wanted = {
    summary: options.includeSummary !== false,
    charts:  options.includeCharts  !== false,
    detail:  options.includeRawData !== false,
  };

  return sectionsForReport(report)
    .filter((key) => wanted[SECTION_GROUP[key]])
    .map((key) => built[key])
    .filter((section) => section && section.rows.length > 0);
};

/** The report name without the format suffix the buttons used to bake in. */
export const reportTitleOf = (target) =>
  String(target || 'KYC Full Report').split('–')[0].trim() || 'KYC Full Report';

export default kycExportSections;
