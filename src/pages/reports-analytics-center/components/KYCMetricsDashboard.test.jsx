import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import KYCMetricsDashboard from './KYCMetricsDashboard';

/**
 * These are about the thing that was broken: every one of this screen's
 * thirteen export buttons produced the SAME file — the whole dashboard, as a
 * CSV, whatever format the modal was set to.
 *
 * Downloads are caught where they are handed to the page, so the grid, the
 * quoting and the workbook bytes all ran for real and the assertions are about
 * what actually lands in the file. jsdom has no CompressionStream, so the
 * workbook's parts are stored uncompressed and readable as text — see
 * xlsxWriter.roundtrip.test.js for the deflated path.
 */

// recharts measures its container, which jsdom gives no size, so it renders
// nothing and logs about it. The charts are not what these tests are about.
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal()),
  ResponsiveContainer: ({ children }) => <div style={{ width: 400, height: 220 }}>{children}</div>,
}));

const saved = [];

beforeEach(() => {
  saved.length = 0;
  global.URL.createObjectURL = vi.fn((blob) => { saved.push({ blob }); return 'blob:x'; });
  global.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    saved[saved.length - 1].name = this.download;
  });
  render(<KYCMetricsDashboard />);
});

afterEach(() => vi.restoreAllMocks());

/** Open one export button, optionally untick some sections, and confirm. */
const exportVia = async (user, buttonName, { untick = [], nth = 0 } = {}) => {
  const buttons = screen.getAllByRole('button', { name: buttonName });
  await user.click(buttons[nth]);
  await screen.findByText('Export Report', { selector: 'h3' });

  for (const label of untick) {
    await user.click(screen.getByRole('checkbox', { name: new RegExp(label, 'i') }));
  }

  await user.click(screen.getByRole('button', { name: /^Export Report$/ }));
  await waitFor(() => expect(saved).toHaveLength(1));
  return { ...saved[0], text: await saved[0].blob.text() };
};

describe('picking a format', () => {
  it('writes a workbook when Excel was asked for, not a CSV', async () => {
    const user = userEvent.setup();
    const file = await exportVia(user, /Export Excel/);

    expect(file.name).toMatch(/^kyc_full_report_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(file.text.slice(0, 2)).toBe('PK');
  });

  it('opens on the format the button meant', async () => {
    // The buttons used to bake the format into the report NAME and the modal
    // always opened on PDF, so "Export Excel" showed PDF selected.
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /Export Excel/ })[0]);
    await screen.findByText('Export Report', { selector: 'h3' });
    expect(screen.getByLabelText('Export Format')).toHaveTextContent('Excel workbook');

    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    await user.click(screen.getAllByRole('button', { name: /Export PDF/ })[0]);
    expect(screen.getByLabelText('Export Format')).toHaveTextContent('PDF document');
  });

  it('still offers CSV, and writes a real one', async () => {
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /Export Excel/ })[0]);
    await screen.findByText('Export Report', { selector: 'h3' });

    await user.click(screen.getByLabelText('Export Format'));
    // The Select keeps a hidden native <select> for form submission, so every
    // option label appears twice. The clickable one is the dropdown's, last.
    const options = await screen.findAllByText('CSV file');
    await user.click(options[options.length - 1]);
    await user.click(screen.getByRole('button', { name: /^Export Report$/ }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toMatch(/^kyc_full_report_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(saved[0].blob.type).toMatch(/text\/csv/);
  });
});

describe('picking a report', () => {
  it('gives a named report only its own tables', async () => {
    // The bug: this used to hand back the whole dashboard including the
    // compliance scores and the verification trend.
    const user = userEvent.setup();
    const file = await exportVia(user, /^Excel$/, { nth: 1 });   // Document Expiry Report

    expect(file.name).toMatch(/^document_expiry_report_/);
    expect(file.text).toContain('Document Expiry Timeline');
    expect(file.text).toContain('Aging Analysis by Client Segment');
    expect(file.text).not.toContain('Compliance Score by Segment');
    expect(file.text).not.toContain('Verification Rate Trend');
  });

  it('gives a chart download that chart alone', async () => {
    const user = userEvent.setup();
    const file = await exportVia(user, /^Download$/, { nth: 0 }); // Verification Trend

    expect(file.name).toMatch(/^verification_trend_/);
    expect(file.text).toContain('Verification Rate Trend');
    expect(file.text).not.toContain('KPI Summary');
  });
});

describe('picking what goes in', () => {
  it('leaves the KPI block out when the summary is unticked', async () => {
    const user = userEvent.setup();
    const file = await exportVia(user, /Export Excel/, { untick: ['Summary statistics'] });

    expect(file.text).not.toContain('KPI Summary');
    expect(file.text).toContain('Verification Rate Trend');
  });

  it('leaves the chart series out when chart data is unticked', async () => {
    const user = userEvent.setup();
    const file = await exportVia(user, /Export Excel/, { untick: ['Chart data'] });

    expect(file.text).toContain('KPI Summary');
    expect(file.text).not.toContain('Verification Rate Trend');
    expect(file.text).not.toContain('Compliance Score by Segment');
  });

  it('refuses to write an empty file, and says why', async () => {
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /Export Excel/ })[0]);
    await screen.findByText('Export Report', { selector: 'h3' });

    for (const label of ['Summary statistics', 'Chart data', 'Segment breakdown']) {
      await user.click(screen.getByRole('checkbox', { name: new RegExp(label, 'i') }));
    }

    expect(screen.getByText(/there would be nothing in the file/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Export Report$/ })).toBeDisabled();
    expect(saved).toHaveLength(0);
  });
});

describe('the numbers in the file', () => {
  it('writes counts as numbers Excel can add, not as text', async () => {
    const user = userEvent.setup();
    const file = await exportVia(user, /^Download$/, { nth: 0 });

    // 78 verified in September, as a bare <v> rather than an inline string.
    // The row is not pinned: a heading change would move it without making the
    // cell any less numeric, which is the whole assertion.
    expect(file.text).toMatch(/<c r="B\d+" s="\d+"><v>78<\/v><\/c>/);
    expect(file.text).not.toMatch(/<t xml:space="preserve">78<\/t>/);
  });

  it('carries the provenance so a printed page is dateable', async () => {
    const user = userEvent.setup();
    const file = await exportVia(user, /Export Excel/);
    expect(file.text).toContain('Report: KYC Full Report');
    expect(file.text).toMatch(/generated \d{2}\/\d{2}\/\d{4}/);
  });
});
