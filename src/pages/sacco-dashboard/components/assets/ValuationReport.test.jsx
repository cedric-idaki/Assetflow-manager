import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ValuationReport from './ValuationReport';

/**
 * The report's central design claim is that A CONFIDENT NUMBER IS NOT ENOUGH.
 * The register reports every asset at coalesce(current_value, book_value), so a
 * book with four valuations out of four hundred assets still produces a
 * healthy-looking "current value" total that is almost entirely an accountant's
 * residual. These tests exist to hold the line that the caveat is never dropped
 * — a future tidy-up that removes the coverage line or rounds the revaluation
 * gap to KES 0 would be wrong in a way no visual review catches, because with a
 * fully-valued seed dataset the two read the same.
 */

const downloadCSV = vi.fn();
vi.mock('../../../../utils/exportUtils', () => ({
  downloadCSV: (...args) => downloadCSV(...args),
  toCSV: () => '',
}));

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('../../../../components/Toast', () => ({ useToast: () => toast }));

const valuationMock = vi.fn();
vi.mock('../../../../hooks/useAssetValuation', () => ({
  useAssetValuation: (...args) => valuationMock(...args),
}));

const TOTALS = {
  heldAssets: 400,
  valuedAssets: 4,
  unvaluedAssets: 396,
  staleValuations: 0,
  totalCost: 88000000,
  totalDepreciation: 31000000,
  totalBookValue: 57000000,
  totalCurrentValue: 63500000,
  valuedCurrentValue: 54000000,
  valuedBookValue: 47500000,
  unvaluedBookValue: 9500000,
  revaluationDelta: 6500000,
  byBasis: {
    professional: { count: 2, value: 50000000 },
    internal:     { count: 2, value: 4000000  },
  },
  lastValuedOn: '2026-06-01',
};

const CATEGORIES = [
  {
    category: 'land_buildings', assetCount: 2, valuedCount: 2, staleCount: 0,
    totalCost: 60000000, totalDepreciation: 12000000, totalBookValue: 48000000,
    totalCurrentValue: 54000000, valuedCurrentValue: 54000000, valuedBookValue: 47500000,
    revaluationDelta: 6500000,
  },
  {
    category: 'motor_vehicles', assetCount: 9, valuedCount: 0, staleCount: 0,
    totalCost: 28000000, totalDepreciation: 19000000, totalBookValue: 9500000,
    totalCurrentValue: 9500000, valuedCurrentValue: 0, valuedBookValue: 0,
    revaluationDelta: 0,
  },
];

const renderReport = (over = {}) => {
  const value = {
    totals: { ...TOTALS, ...over.totals },
    byCategory: over.byCategory || CATEGORIES,
    loading: false,
    error: null,
    loadedAt: new Date('2026-08-31T09:00:00.000Z'),
    refresh: vi.fn(),
    ...('loading' in over ? { loading: over.loading } : {}),
    ...('error' in over ? { error: over.error } : {}),
  };
  valuationMock.mockReturnValue(value);
  return { ...render(<ValuationReport />), value };
};

beforeEach(() => vi.clearAllMocks());

/**
 * The stat card carrying `label`.
 *
 * The headline figures and the table's total row are deliberately the same
 * numbers, and two of the card labels are also column headings, so an unscoped
 * getByText matches both — and a test that passes only because two elements
 * agree is not testing either of them. The <p> is the card's label; the <th> of
 * the same name belongs to the table.
 */
const statCard = (label) => {
  const el = screen.getAllByText(label).find((n) => n.tagName === 'P');
  if (!el) throw new Error(`No stat card labelled "${label}"`);
  return el.closest('.bg-card');
};

/** The revaluation line, which is the only place a signed figure is a verdict. */
const revaluationLine = () =>
  screen.getByText(/^Revaluation (surplus|deficit)$|^In line with book value$/).parentElement;

describe('asset valuation — the headline', () => {
  it('reports cost, depreciation, book value and current value from the whole book', () => {
    renderReport();
    expect(within(statCard('At cost')).getByText('KES 88,000,000')).toBeInTheDocument();
    expect(within(statCard('Less depreciation')).getByText('KES 31,000,000')).toBeInTheDocument();
    expect(within(statCard('Net book value')).getByText('KES 57,000,000')).toBeInTheDocument();
    expect(within(statCard('Current value')).getByText('KES 63,500,000')).toBeInTheDocument();
  });

  it('never shows the current value without saying how much of it is a valuation', () => {
    renderReport();
    // 54,000,000 of 63,500,000 — 85% — rests on a recorded valuation, and the
    // caveat rides on the same card as the figure rather than in a footnote.
    expect(within(statCard('Current value')).getByText(/85.0% of it from a recorded valuation/))
      .toBeInTheDocument();
    // Valued and at-book shown against each other on one line, not in separate
    // cards where only the flattering half gets read.
    const split = screen.getByText(/from 4 recorded valuations/).closest('div');
    expect(within(split).getByText('KES 54,000,000')).toBeInTheDocument();
    expect(within(split).getByText('KES 9,500,000')).toBeInTheDocument();
  });

  it('separates the share of assets valued from the share of value valued', () => {
    renderReport();
    // 1% of the assets carry 85% of the money. Reporting either alone misleads.
    expect(screen.getByText(/1.0% of the assets held carry a recorded valuation, covering 85.0% of the reported value/))
      .toBeInTheDocument();
  });

  it('says plainly when nothing has been valued at all', () => {
    renderReport({
      totals: {
        valuedAssets: 0, unvaluedAssets: 400, valuedCurrentValue: 0,
        valuedBookValue: 0, unvaluedBookValue: 57000000,
        totalCurrentValue: 57000000, revaluationDelta: 0, byBasis: {},
      },
    });
    expect(screen.getByText(/No asset carries a recorded valuation/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing valued — this is book value/)).toBeInTheDocument();
  });
});

describe('asset valuation — the revaluation gap', () => {
  it('names a surplus, signs it, and says what it is measured against', () => {
    renderReport();
    expect(screen.getByText('Revaluation surplus')).toBeInTheDocument();
    expect(within(revaluationLine()).getByText('+KES 6,500,000')).toBeInTheDocument();
    // Measured over the valued assets only — never over the whole book, which
    // would net 396 zeroes in and report a surplus the SACCO never had.
    expect(screen.getByText(/across the 4 valued assets, whose book value is KES 47,500,000/))
      .toBeInTheDocument();
  });

  it('names a shortfall a deficit rather than a negative surplus', () => {
    renderReport({ totals: { revaluationDelta: -1250000 } });
    expect(screen.getByText('Revaluation deficit')).toBeInTheDocument();
    expect(within(revaluationLine()).getByText('KES -1,250,000')).toBeInTheDocument();
  });

  it('reports no gap at all when nothing is valued, rather than a tidy zero', () => {
    renderReport({ totals: { valuedAssets: 0, revaluationDelta: 0 } });
    expect(screen.queryByText(/Revaluation surplus|Revaluation deficit/)).not.toBeInTheDocument();
  });

  it('says the gap has not been posted, because a revaluation needs a journal', () => {
    renderReport();
    expect(screen.getByText(/Not posted — a revaluation is an equity movement/)).toBeInTheDocument();
  });
});

describe('asset valuation — by category', () => {
  it('lists each category with its own cost, depreciation and value', () => {
    renderReport();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Land & Buildings')).toBeInTheDocument();
    expect(within(table).getByText('KES 60,000,000')).toBeInTheDocument();
    expect(within(table).getByText('KES 48,000,000')).toBeInTheDocument();
  });

  it('marks a category whose value is entirely book value', () => {
    renderReport();
    expect(screen.getByText('none valued — at book value')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 valued')).toBeInTheDocument();
  });

  it('takes the total row from the server aggregate, not from summing the rows', () => {
    // The two category rows add to 88,000,000 at cost. The whole-book total
    // deliberately disagrees; the row that must win is the one Postgres
    // computed over every asset.
    renderReport({ totals: { totalCost: 90000000 } });
    const totalRow = screen.getByText('Total').closest('tr');
    expect(within(totalRow).getByText('KES 90,000,000')).toBeInTheDocument();
    expect(within(totalRow).getByText('400')).toBeInTheDocument();
  });

  it('excludes disposals and says so, so nobody reads it as everything ever owned', () => {
    renderReport();
    expect(screen.getByText(/Disposed, written-off and lost assets are excluded/)).toBeInTheDocument();
  });
});

describe('asset valuation — basis and staleness', () => {
  it('says what the valuations rest on, in the vocabulary the form uses', () => {
    renderReport();
    expect(screen.getByText('Professional valuer')).toBeInTheDocument();
    expect(screen.getByText('Internal estimate')).toBeInTheDocument();
    expect(screen.getByText('KES 50,000,000')).toBeInTheDocument();
  });

  it('warns that a stale valuation is being quoted as today’s value', () => {
    renderReport({ totals: { staleValuations: 3 } });
    expect(screen.getByText(/valuations are over a year old/)).toBeInTheDocument();
  });

  it('stays quiet when every valuation is current', () => {
    renderReport();
    expect(screen.queryByText(/over a year old/)).not.toBeInTheDocument();
  });
});

describe('asset valuation — export', () => {
  it('exports every category plus the server total row', async () => {
    renderReport();
    fireEvent.click(screen.getByText('Export CSV'));

    await waitFor(() => expect(downloadCSV).toHaveBeenCalled());
    const rows = downloadCSV.mock.calls[0][0];
    expect(rows).toHaveLength(3);
    expect(rows[rows.length - 1].Category).toBe('TOTAL');
  });

  it('refuses to write an empty file and says why', () => {
    renderReport({ byCategory: [] });
    // The button is disabled, so the guard is the thing under test rather than
    // the click: an empty register must not produce a header-only CSV.
    expect(screen.getByText('Export CSV').closest('button')).toBeDisabled();
    expect(downloadCSV).not.toHaveBeenCalled();
  });
});

describe('asset valuation — when the aggregate is unavailable', () => {
  it('says the figures could not be loaded rather than reporting zeroes as fact', () => {
    renderReport({ error: 'Could not load the valuation totals.' });
    expect(screen.getByText('Could not load the valuation totals.')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('invites the first asset instead of reporting a valuation of nothing', () => {
    renderReport({
      totals: {
        heldAssets: 0, valuedAssets: 0, unvaluedAssets: 0, totalCost: 0,
        totalDepreciation: 0, totalBookValue: 0, totalCurrentValue: 0,
        valuedCurrentValue: 0, valuedBookValue: 0, unvaluedBookValue: 0,
        revaluationDelta: 0, byBasis: {}, lastValuedOn: null,
      },
      byCategory: [],
    });
    expect(screen.getByText('Nothing to value yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing registered yet')).toBeInTheDocument();
  });
});
