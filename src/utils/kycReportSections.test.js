import { describe, it, expect } from 'vitest';
import {
  SECTION, SECTION_GROUP, KYC_REPORTS,
  sectionsForReport, buildKycSections, kycExportSections, reportTitleOf,
} from './kycReportSections';

const DATA = {
  kpis: {
    totalClients: 257, verifiedCount: 234, verificationRate: 91,
    renewalPending: 47, renewalRate: 65, avgVerifyDays: 2.4, overallCompliance: 89,
  },
  trend:      [{ month: 'Sep', verified: 78, pending: 15, rejected: 7 }],
  expiry:     [{ bucket: '≤ 30 Days', count: 24 }],
  aging:      [{ segment: 'Business', current: 45, days30: 18, days60: 12, days90: 8 }],
  renewals:   [{ week: 'W1', completed: 12, pending: 8 }],
  docTypes:   [{ type: 'National ID', rate: 94, count: 312 }],
  compliance: [{ segment: 'Corporate', score: 96 }],
};

const headings = (sections) => sections.map((s) => s.heading);

describe('the catalogue', () => {
  it('gives every section a toggle group', () => {
    // A section with no group is a section no checkbox can ever turn off, and
    // one that silently disappears from every export.
    Object.values(SECTION).forEach((key) => {
      expect(SECTION_GROUP[key], key).toBeTruthy();
    });
  });

  it('only ever names sections that are actually built', () => {
    const built = Object.keys(buildKycSections(DATA));
    Object.entries(KYC_REPORTS).forEach(([report, keys]) => {
      keys.forEach((key) => expect(built, `${report} → ${key}`).toContain(key));
    });
  });

  it('covers every button on the screen', () => {
    // These are the strings the dashboard passes. A rename on either side that
    // is not made on both silently falls back to the full report.
    [
      'KYC Full Report', 'KYC Verification Summary', 'Document Expiry Report',
      'Renewal Status Report', 'Aging Analysis Report', 'Compliance Score Report',
      'Verification Time Report', 'Verification Trend', 'Expiry Timeline',
      'Aging Analysis', 'Renewal Tracking', 'Document Type Rates', 'Compliance Scores',
    ].forEach((name) => expect(KYC_REPORTS, name).toHaveProperty(name));
  });

  it('falls back to the whole dashboard for a name it does not know', () => {
    // Too much rather than the wrong thing: an unrecognised target must never
    // produce a file that is silently missing the table somebody asked for.
    expect(sectionsForReport('Something New')).toEqual(KYC_REPORTS['KYC Full Report']);
  });
});

describe('buildKycSections', () => {
  it('turns the KPI block into rows, not one wide line', () => {
    const kpis = buildKycSections(DATA)[SECTION.kpis];
    expect(kpis.rows).toHaveLength(6);
    expect(kpis.rows[2]).toMatchObject({ metric: 'Verification rate', value: '91%' });
  });

  it('gives each chart its own series as a table', () => {
    const built = buildKycSections(DATA);
    expect(built[SECTION.trend].columns.map((c) => c.label))
      .toEqual(['Month', 'Verified', 'Pending', 'Rejected']);
    expect(built[SECTION.trend].rows).toBe(DATA.trend);
  });

  it('marks the count columns numeric so they right-align and stay numbers', () => {
    const built = buildKycSections(DATA);
    const aging = built[SECTION.aging].columns;
    expect(aging[0].numeric).toBe(false);
    expect(aging.slice(1).every((c) => c.numeric)).toBe(true);
  });

  it('does not fall over on a screen with no data yet', () => {
    const built = buildKycSections({});
    expect(built[SECTION.trend].rows).toEqual([]);
    expect(built[SECTION.kpis].rows).toHaveLength(6);
  });
});

describe('kycExportSections', () => {
  it('gives a named report only its own tables', () => {
    // This is the whole bug: every button used to produce the entire dashboard.
    expect(headings(kycExportSections(DATA, { report: 'Document Expiry Report' })))
      .toEqual(['Document Expiry Timeline', 'Aging Analysis by Client Segment']);
  });

  it('gives a chart download that chart alone', () => {
    expect(headings(kycExportSections(DATA, { report: 'Compliance Scores' })))
      .toEqual(['Compliance Score by Segment']);
  });

  it('gives the full report everything', () => {
    expect(kycExportSections(DATA, { report: 'KYC Full Report' })).toHaveLength(7);
  });

  it('honours the summary toggle', () => {
    const off = kycExportSections(DATA, {
      report: 'KYC Full Report', options: { includeSummary: false },
    });
    expect(headings(off)).not.toContain('KPI Summary');
    expect(off).toHaveLength(6);
  });

  it('honours the chart-data toggle', () => {
    const off = kycExportSections(DATA, {
      report: 'KYC Full Report', options: { includeCharts: false },
    });
    // The KPI block and the segment breakdown survive; the five series do not.
    expect(headings(off)).toEqual(['KPI Summary', 'Aging Analysis by Client Segment']);
  });

  it('honours the segment-breakdown toggle', () => {
    const off = kycExportSections(DATA, {
      report: 'Aging Analysis Report', options: { includeRawData: false },
    });
    expect(off).toEqual([]);
  });

  it('returns nothing when every toggle is off, rather than everything', () => {
    // Falling back to the full dashboard here would hand the user a file they
    // explicitly emptied. The caller says so instead.
    expect(kycExportSections(DATA, {
      report: 'KYC Full Report',
      options: { includeSummary: false, includeCharts: false, includeRawData: false },
    })).toEqual([]);
  });

  it('leaves out a section that has no rows', () => {
    const thin = { ...DATA, compliance: [], renewals: [] };
    expect(headings(kycExportSections(thin, { report: 'KYC Full Report' })))
      .not.toContain('Compliance Score by Segment');
  });

  it('defaults every toggle on when none were given', () => {
    expect(kycExportSections(DATA, { report: 'KYC Full Report', options: {} })).toHaveLength(7);
    expect(kycExportSections(DATA, { report: 'KYC Full Report' })).toHaveLength(7);
  });
});

describe('reportTitleOf', () => {
  it('strips the format suffix the buttons used to bake in', () => {
    expect(reportTitleOf('KYC Full Report – PDF')).toBe('KYC Full Report');
    expect(reportTitleOf('Document Expiry Report – Excel')).toBe('Document Expiry Report');
  });

  it('leaves a plain name alone', () => {
    expect(reportTitleOf('Verification Trend')).toBe('Verification Trend');
  });

  it('falls back rather than producing an untitled file', () => {
    expect(reportTitleOf('')).toBe('KYC Full Report');
    expect(reportTitleOf(null)).toBe('KYC Full Report');
  });
});
