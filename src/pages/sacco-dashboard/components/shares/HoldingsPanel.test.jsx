import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The share register. sacco_shares is a DIMENSION table — one row per member,
// and the whole module resolves holdings out of it with find(). Capping it did
// not just hide rows, it corrupted the register (a member past the cap read as
// having no holding, so editing them inserted a SECOND row and a transfer
// skipped debiting them). These cover that it is now whole, that the display
// is paged rather than the data, and that a member's history is read per
// member instead of filtered out of a truncated array.

vi.mock('../../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// Rows the fake database returns per table, and the filters it was asked for.
let TABLES = {};
const asked = [];

const builder = (table) => {
  const ops = { table, eq: [], or: null };
  const b = {
    select: () => b,
    eq: (c, v) => { ops.eq.push([c, v]); return b; },
    or: (f) => { ops.or = f; return b; },
    order: () => b,
    range: (from, to) => {
      asked.push(ops);
      const rows = (TABLES[table] || []).filter((r) =>
        ops.eq.every(([c, v]) => String(r[c] ?? '') === String(v)));
      return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
    },
  };
  return b;
};

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: (table) => builder(table) },
}));

const HoldingsPanel = (await import('./HoldingsPanel')).default;

const member = (i) => ({
  id: `m${i}`, full_name: `Holder ${String(i).padStart(4, '0')}`,
  member_no: `MEM-${String(i).padStart(4, '0')}`, kyc_status: 'verified', status: 'active',
});

const holding = (i, over = {}) => ({
  id: `h${i}`, member_id: `m${i}`,
  member: { id: `m${i}`, full_name: `Holder ${String(i).padStart(4, '0')}`, member_no: `MEM-${String(i).padStart(4, '0')}` },
  shares_held: 100, locked_shares: 0, par_value: 100, is_frozen: false,
  total_invested: 10000, avg_buy_price: 100, realized_gain: 0, dividends_earned: 0,
  ...over,
});

const OV = { effective: 100, totalIssued: 100000, shareholders: 0, memberOwned: 0, treasuryPool: 0 };

const buildCtx = (n, over = {}) => ({
  shares: Array.from({ length: n }, (_, i) => holding(i + 1)),
  sharesTruncated: false,
  members: Array.from({ length: n }, (_, i) => member(i + 1)),
  certificates: [],
  dividendAllocations: [],
  dividends: [],
  listings: [],
  transfers: [],
  shareSettings: null,
  sacco: { id: 's1', name: 'Umoja Sacco' },
  saveShares: vi.fn(),
  freezeMember: vi.fn(),
  reissueCertificate: vi.fn(),
  exportCSV: vi.fn(),
  ...over,
});

const pagerNav = () => screen.getByRole('navigation', { name: /pagination/i });

beforeEach(() => {
  TABLES = {};
  asked.length = 0;
  vi.clearAllMocks();
});

describe('share register — paging', () => {
  it('renders one page of holders while counting every one of them', () => {
    render(<HoldingsPanel ctx={buildCtx(600)} ov={{ ...OV, shareholders: 600 }} />);

    expect(screen.getByText('Holder 0001')).toBeInTheDocument();
    expect(screen.queryByText('Holder 0026')).not.toBeInTheDocument();
    expect(pagerNav()).toHaveTextContent('1–25');
    expect(pagerNav()).toHaveTextContent('600');
  });

  // The register is the whole book, so the money above the table must add up
  // over all 600 holders — not over the 25 being rendered.
  it('totals the whole register, not the page', () => {
    render(<HoldingsPanel ctx={buildCtx(600)} ov={{ ...OV, shareholders: 600 }} />);

    // 600 holders × 100 shares.
    const held = screen.getByText('Member-owned shares').closest('.bg-card');
    expect(held).toHaveTextContent('60,000');
  });

  it('reaches a holder far past the old 500-row cap', () => {
    render(<HoldingsPanel ctx={buildCtx(600)} ov={{ ...OV, shareholders: 600 }} />);
    expect(screen.queryByText('Holder 0588')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'MEM-0588' } });

    expect(screen.getByText('Holder 0588')).toBeInTheDocument();
  });

  it('exports every holder rather than the visible page', () => {
    const ctx = buildCtx(600);
    render(<HoldingsPanel ctx={ctx} ov={{ ...OV, shareholders: 600 }} />);

    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    expect(ctx.exportCSV.mock.calls[0][0]).toHaveLength(600);
  });

  it('says so out loud if the register ever exceeds the fetch ceiling', () => {
    render(<HoldingsPanel ctx={buildCtx(3, { sharesTruncated: true })} ov={OV} />);
    expect(screen.getByText(/not fully loaded/i)).toBeInTheDocument();
  });

  it('hides the pager when every holder fits on one page', () => {
    render(<HoldingsPanel ctx={buildCtx(8)} ov={{ ...OV, shareholders: 8 }} />);
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
  });
});

describe('share register — member portfolio', () => {
  // A holder's own trade history used to be filtered out of a 1,000-row array,
  // so a long-standing member's portfolio silently began mid-history.
  it('reads that member\'s own history instead of filtering a loaded array', async () => {
    TABLES = {
      sacco_share_transactions: [
        { id: 't1', member_id: 'm2', txn_type: 'purchase', shares: 50, amount: 5000, created_at: '2026-01-02' },
      ],
      sacco_share_listings: [],
      sacco_share_transfers: [],
    };

    render(<HoldingsPanel ctx={buildCtx(3)} ov={{ ...OV, shareholders: 3 }} />);
    fireEvent.click(screen.getByText('Holder 0002'));

    await waitFor(() => {
      const txnQuery = asked.find((a) => a.table === 'sacco_share_transactions');
      expect(txnQuery).toBeTruthy();
      // Scoped to this member at the database, not filtered afterwards.
      expect(txnQuery.eq).toContainEqual(['member_id', 'm2']);
    });
  });

  it('shows a loading state rather than an empty history while it reads', async () => {
    TABLES = { sacco_share_transactions: [], sacco_share_listings: [], sacco_share_transfers: [] };

    render(<HoldingsPanel ctx={buildCtx(3)} ov={{ ...OV, shareholders: 3 }} />);
    fireEvent.click(screen.getByText('Holder 0002'));

    // "Never traded" and "still loading" must not look the same.
    expect(screen.getByText(/loading this member's full trading history/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/loading this member's full trading history/i)).not.toBeInTheDocument());
  });
});
