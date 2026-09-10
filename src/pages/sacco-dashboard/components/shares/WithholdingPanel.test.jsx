import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WithholdingPanel from './WithholdingPanel';
import SharesTab from './index';
import {
  outstanding, onMarket, heldBack, isLiveWithholding,
  withholdingOverview, memberWithholding, memberPosition,
} from './_util';

// Share withholding & sale.
//
// The thing that would actually hurt here is a withheld share being counted
// twice, counted in the wrong bucket, or — worst — reading as free to trade.
// A member whose 300 shares are held as loan security must not be able to sell
// them, and the society must be able to say at any moment how many shares it
// is holding and what they are worth.

vi.mock('../../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return { ...actual, ResponsiveContainer: ({ children }) => <div style={{ width: 800, height: 300 }}>{children}</div> };
});

const PRICE = 135;

const wh = (over = {}) => ({
  id: 'w1', ref_no: 'WH-000001', member_id: 'm1',
  member: { id: 'm1', full_name: 'Jane Wanjiku', member_no: 'MEM-001' },
  shares: 300, released_shares: 0, sold_shares: 0, listed_shares: 0,
  reason_type: 'loan_security', reason: 'Security for loan LN-0042',
  reference: 'LN-0042', unit_value: 120, proceeds: 0,
  status: 'withheld', withheld_on: '2026-08-20', closed_on: null, notes: null,
  created_at: '2026-08-20T08:00:00Z',
  ...over,
});

const evt = (over = {}) => ({
  id: 'e1', withholding_id: 'w1', member_id: 'm1', event_type: 'withheld',
  shares: 300, outstanding_after: 300, price_per_share: 120, amount: 36000,
  reason: 'Security for loan LN-0042', actor_name: 'Grace Treasurer',
  created_at: '2026-08-20T08:00:00Z',
  ...over,
});

const holding = (over = {}) => ({
  id: 'h1', member_id: 'm1',
  member: { id: 'm1', full_name: 'Jane Wanjiku', member_no: 'MEM-001' },
  shares_held: 500, locked_shares: 0, withheld_shares: 300, par_value: 100,
  is_frozen: false, total_invested: 60000, avg_buy_price: 120,
  realized_gain: 0, dividends_earned: 0,
  ...over,
});

const OV = { effective: PRICE, totalIssued: 10000, par: 100 };

const buildCtx = (over = {}) => ({
  withholdings: [wh()],
  withholdingEvents: [evt()],
  shares: [holding()],
  members: [
    { id: 'm1', full_name: 'Jane Wanjiku', member_no: 'MEM-001', status: 'active' },
    { id: 'm2', full_name: 'Peter Otieno', member_no: 'MEM-002', status: 'active' },
  ],
  listings: [],
  shareSettings: { par_value: 100, price_floor_is_par: true },
  withholdShares: vi.fn().mockResolvedValue({}),
  releaseWithholding: vi.fn().mockResolvedValue({}),
  listWithheldShares: vi.fn().mockResolvedValue({}),
  exportCSV: vi.fn(),
  ...over,
});

const openRecord = (ref = 'WH-000001') => fireEvent.click(screen.getByText(ref));

// The panel nests a confirm dialog inside the record dialog, and both carry a
// button with the same verb. Every assertion below names the dialog it means.
const dialog = (title) => screen.getByText(title, { exact: false }).closest('.bg-card');

// A <StatCard>'s headline figure, by its label — the same number often appears
// again in the table below, so the card has to be named.
const cardValue = (label) => screen.getByText(label).closest('.bg-card').querySelector('.text-2xl').textContent;

// <Stat> renders the label and its figure as adjacent <p> elements. Scoped to
// the stats row, because "Sold" is also an event name down in the history.
const stats = (d) => within(d).getByText('Still held').closest('.grid');
const stat = (d, label) => within(stats(d)).getByText(label).nextElementSibling.textContent;

beforeEach(() => vi.clearAllMocks());

/* ─────────────────────────────────────────────────────────────────────────── */

describe('withholding arithmetic', () => {
  it('splits a withholding into exactly two live buckets that add back up', () => {
    // 300 taken, 40 released, 60 sold → 200 outstanding, of which 80 are on the
    // market. Held back is whatever is left. The two must never overlap.
    const w = wh({ shares: 300, released_shares: 40, sold_shares: 60, listed_shares: 80 });

    expect(outstanding(w)).toBe(200);
    expect(onMarket(w)).toBe(80);
    expect(heldBack(w)).toBe(120);
    expect(heldBack(w) + onMarket(w)).toBe(outstanding(w));
  });

  it('never reports more on the market than is still outstanding', () => {
    // A stale listed_shares (a sale settled but the row has not been re-read)
    // must not inflate the position past what is actually left.
    const w = wh({ shares: 100, sold_shares: 90, listed_shares: 100 });

    expect(outstanding(w)).toBe(10);
    expect(onMarket(w)).toBe(10);
    expect(heldBack(w)).toBe(0);
  });

  it('treats a fully disposed record as closed and drops it from the live position', () => {
    const done = wh({ id: 'w9', shares: 50, released_shares: 50, status: 'closed' });
    expect(isLiveWithholding(done)).toBe(false);

    const wo = withholdingOverview([wh(), done], PRICE, 10000);
    expect(wo.outstanding).toBe(300);           // only the live one
    expect(wo.count).toBe(1);
    expect(wo.releasedShares).toBe(50);         // lifetime figures still include it
  });

  it('values the outstanding position at today\'s price, and separately at what it cost', () => {
    const wo = withholdingOverview(
      [wh({ shares: 300, unit_value: 120 })], PRICE, 10000,
    );

    expect(wo.outstanding).toBe(300);
    expect(wo.value).toBe(300 * PRICE);       // 40,500 today
    expect(wo.bookValue).toBe(300 * 120);     // 36,000 when it was taken
    expect(wo.ownership).toBeCloseTo(3, 5);   // 300 of 10,000 in issue
  });

  it('counts each member once however many holds they have', () => {
    const wo = withholdingOverview([
      wh({ id: 'a', shares: 100 }),
      wh({ id: 'b', shares: 200 }),
      wh({ id: 'c', shares: 50, member_id: 'm2' }),
    ], PRICE, 10000);

    expect(wo.members).toBe(2);
    expect(wo.count).toBe(3);
    expect(wo.outstanding).toBe(350);
  });

  it('adds a member\'s holds together for the register', () => {
    const mine = memberWithholding([
      wh({ id: 'a', shares: 100 }),
      wh({ id: 'b', shares: 200, listed_shares: 50 }),
      wh({ id: 'c', shares: 999, member_id: 'm2' }),
    ], 'm1');

    expect(mine.outstanding).toBe(300);
    expect(mine.heldBack).toBe(250);
    expect(mine.onMarket).toBe(50);
  });
});

describe('withheld shares are not free to trade', () => {
  it('takes withheld shares out of the free figure, not just out of escrow', () => {
    // 500 held, 100 escrowed behind an open sell order, 300 withheld by the
    // society. Only 100 are genuinely the member's to sell. Before withholding
    // existed this read 400 — the number an order form would have offered.
    const p = memberPosition(holding({ shares_held: 500, locked_shares: 100, withheld_shares: 300 }), PRICE, 10000);

    expect(p.held).toBe(500);
    expect(p.locked).toBe(100);
    expect(p.withheld).toBe(300);
    expect(p.free).toBe(100);
  });

  it('never reports a negative free balance if the counters drift', () => {
    const p = memberPosition(holding({ shares_held: 100, locked_shares: 80, withheld_shares: 80 }), PRICE, 10000);
    expect(p.free).toBe(0);
  });
});

describe('the register on screen', () => {
  it('states the quantity and the value of what is withheld, split by where it sits', () => {
    render(<WithholdingPanel ctx={buildCtx({
      withholdings: [
        wh({ id: 'w1', shares: 300 }),                          // 300 held back
        wh({ id: 'w2', ref_no: 'WH-000002', shares: 100, listed_shares: 100 }), // 100 on the market
      ],
    })} ov={OV} />);

    expect(screen.getByText('Shares withheld')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('300 held · 100 on the market')).toBeInTheDocument();

    // 400 × KES 135 = KES 54,000, in the stat card and again in the
    // when-withheld/today comparison — the same figure, twice, on purpose.
    expect(screen.getByText('Value withheld')).toBeInTheDocument();
    expect(screen.getAllByText('KES 54,000')).toHaveLength(2);
    expect(screen.getByText(`At KES ${PRICE} per share`)).toBeInTheDocument();
    expect(screen.getByText('KES 48,000')).toBeInTheDocument();   // 400 × KES 120 when taken
  });

  it('takes its headline figures from the database, not from the fetched page', async () => {
    // The browser holds one page of a long register. Reducing over it would say
    // 300 shares are withheld when the society is actually holding 12,400 —
    // understating exactly the number this screen exists to state.
    const ctx = buildCtx({
      getWithholdingSummary: vi.fn().mockResolvedValue({
        unit_value: PRICE, withheld_shares: 11400, listed_shares: 1000,
        outstanding_shares: 12400, withheld_value: 1674000, book_value: 1488000,
        members_affected: 37, live_count: 44, released_shares: 900,
        sold_shares: 600, proceeds: 81000, ownership_pct: 4.2,
      }),
    });
    render(<WithholdingPanel ctx={ctx} ov={OV} />);

    // Before the RPC answers, the fetched page is all there is.
    expect(cardValue('Shares withheld')).toBe('300');

    await waitFor(() => expect(cardValue('Shares withheld')).toBe('12,400'));
    expect(screen.getByText('11,400 held · 1,000 on the market')).toBeInTheDocument();
    expect(screen.getByText('KES 1.67M')).toBeInTheDocument();
    expect(cardValue('Members affected')).toBe('37');
    expect(screen.getByText('44 open records · 4.2% of shares in issue')).toBeInTheDocument();
    expect(screen.getByText('600 sold · 900 released back')).toBeInTheDocument();
  });

  it('still renders the position from what it has if the summary RPC is absent', async () => {
    // A database where the migration has not been applied yet.
    const ctx = buildCtx({
      getWithholdingSummary: vi.fn().mockRejectedValue(new Error('function does not exist')),
    });
    render(<WithholdingPanel ctx={ctx} ov={OV} />);

    await waitFor(() => expect(ctx.getWithholdingSummary).toHaveBeenCalled());
    expect(cardValue('Shares withheld')).toBe('300');
    expect(screen.getByText('WH-000001')).toBeInTheDocument();
  });

  it('says plainly when nothing is being held back', () => {
    render(<WithholdingPanel ctx={buildCtx({ withholdings: [] })} ov={OV} />);

    expect(screen.getByText('Nothing is being held back')).toBeInTheDocument();
    expect(screen.getByText('No shares are being withheld')).toBeInTheDocument();
  });

  it('hides closed records behind the filter but keeps them reachable', () => {
    const ctx = buildCtx({
      withholdings: [
        wh(),
        wh({ id: 'w2', ref_no: 'WH-000002', shares: 50, released_shares: 50, status: 'closed' }),
      ],
    });
    render(<WithholdingPanel ctx={ctx} ov={OV} />);

    expect(screen.getByText('WH-000001')).toBeInTheDocument();
    expect(screen.queryByText('WH-000002')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Closed$/ }));
    expect(screen.getByText('WH-000002')).toBeInTheDocument();
    expect(screen.queryByText('WH-000001')).not.toBeInTheDocument();
  });

  it('reports what has been recovered by selling withheld shares', () => {
    render(<WithholdingPanel ctx={buildCtx({
      withholdings: [wh({ shares: 300, sold_shares: 120, proceeds: 16000, released_shares: 30 })],
    })} ov={OV} />);

    expect(screen.getByText('Recovered by sale')).toBeInTheDocument();
    expect(screen.getByText('KES 16,000')).toBeInTheDocument();
    expect(screen.getByText('120 sold · 30 released back')).toBeInTheDocument();
  });
});

describe('withholding shares', () => {
  it('refuses to withhold more than the member has free', async () => {
    // 500 held, 100 already escrowed, 300 already withheld → 100 free.
    const ctx = buildCtx({ shares: [holding({ shares_held: 500, locked_shares: 100, withheld_shares: 300 })] });
    render(<WithholdingPanel ctx={ctx} ov={OV} />);

    fireEvent.click(screen.getByRole('button', { name: /Withhold shares/i }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'm1' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '150' } });

    expect(screen.getByText(/Only 100 of this member/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Withhold$/i }));
    await waitFor(() => expect(ctx.withholdShares).not.toHaveBeenCalled());
  });

  it('will not withhold without a reason on the record', async () => {
    const ctx = buildCtx({ shares: [holding({ withheld_shares: 0 })] });
    render(<WithholdingPanel ctx={ctx} ov={OV} />);

    fireEvent.click(screen.getByRole('button', { name: /Withhold shares/i }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'm1' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /^Withhold$/i }));

    await waitFor(() => expect(ctx.withholdShares).not.toHaveBeenCalled());
  });

  it('sends the whole record to the engine and shows the value being taken', async () => {
    const ctx = buildCtx({ shares: [holding({ withheld_shares: 0 })] });
    render(<WithholdingPanel ctx={ctx} ov={OV} />);

    fireEvent.click(screen.getByRole('button', { name: /Withhold shares/i }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'm1' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '200' } });

    // 200 × KES 135 — the treasurer sees what they are taking out of circulation.
    expect(screen.getByText('KES 27,000')).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'court_order' } });
    fireEvent.change(screen.getByPlaceholderText(/Security for loan/i), { target: { value: 'Order 22/2026' } });
    fireEvent.change(screen.getByPlaceholderText(/Loan no\./i), { target: { value: 'CASE-9' } });
    fireEvent.click(screen.getByRole('button', { name: /^Withhold$/i }));

    await waitFor(() => expect(ctx.withholdShares).toHaveBeenCalledTimes(1));
    expect(ctx.withholdShares).toHaveBeenCalledWith(expect.objectContaining({
      member_id: 'm1', shares: '200', reason_type: 'court_order',
      reason: 'Order 22/2026', reference: 'CASE-9',
    }));
  });

  it('offers each holder with the free figure the engine will actually accept', () => {
    render(<WithholdingPanel ctx={buildCtx({
      shares: [holding({ shares_held: 500, locked_shares: 100, withheld_shares: 300 })],
    })} ov={OV} />);

    fireEvent.click(screen.getByRole('button', { name: /Withhold shares/i }));
    expect(screen.getByRole('option', { name: /Jane Wanjiku \(MEM-001\) — 100 free of 500/ })).toBeInTheDocument();
  });
});

describe('one record, in full', () => {
  it('shows where every share went and the complete history behind it', () => {
    const ctx = buildCtx({
      withholdings: [wh({ shares: 300, released_shares: 40, sold_shares: 60, listed_shares: 50, proceeds: 7800 })],
      withholdingEvents: [
        evt({ id: 'e4', event_type: 'sold', shares: 60, outstanding_after: 200, price_per_share: 135, amount: 8100 }),
        evt({ id: 'e3', event_type: 'listed', shares: 110, outstanding_after: 260, price_per_share: 135, amount: 14850 }),
        evt({ id: 'e2', event_type: 'released', shares: 40, outstanding_after: 260, price_per_share: 120, amount: 4800 }),
        evt({ id: 'e1', event_type: 'withheld', shares: 300, outstanding_after: 300 }),
      ],
    });
    render(<WithholdingPanel ctx={ctx} ov={OV} />);
    openRecord();

    const d = dialog('WH-000001 — Jane Wanjiku');

    // The four dispositions, each counted once: 300 taken = 40 released +
    // 60 sold + 200 outstanding, and the 200 splits 150 held / 50 listed.
    expect(stat(d, 'Still held')).toBe('150');
    expect(stat(d, 'On the market')).toBe('50');
    expect(stat(d, 'Released back')).toBe('40');
    expect(stat(d, 'Sold')).toBe('60');

    // The full history, each entry stating what was left withheld after it.
    const history = within(d).getByText('History').parentElement;
    expect(within(history).getByText('Withheld')).toBeInTheDocument();
    expect(within(history).getByText('Placed for sale')).toBeInTheDocument();
    expect(within(history).getByText('Released to member')).toBeInTheDocument();
    expect(within(history).getByText('Sold')).toBeInTheDocument();
    expect(within(history).getByText(/300 left withheld/)).toBeInTheDocument();
    expect(within(history).getByText(/200 left withheld/)).toBeInTheDocument();
    // Every entry names who did it — four events, four attributions.
    expect(within(history).getAllByText(/Grace Treasurer/)).toHaveLength(4);

    // Recovered so far, against the reason it was taken — on the record itself
    // and again on the event that started it.
    expect(within(d).getByText('Loan security — Security for loan LN-0042')).toBeInTheDocument();
    expect(within(d).getByText('KES 7,800')).toBeInTheDocument();
  });

  it('releases everything still held when no quantity is given', async () => {
    const ctx = buildCtx();
    render(<WithholdingPanel ctx={ctx} ov={OV} />);
    openRecord();

    fireEvent.click(screen.getByRole('button', { name: /^Release$/i }));
    // The placeholder is the promise: leave it blank and all 300 come back.
    expect(screen.getByPlaceholderText('All 300')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Loan LN-0042 cleared/i), { target: { value: 'Loan cleared' } });
    fireEvent.click(within(dialog('Release withheld shares')).getByRole('button', { name: /^Release$/i }));

    await waitFor(() => expect(ctx.releaseWithholding).toHaveBeenCalledTimes(1));
    expect(ctx.releaseWithholding).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'w1' }),
      { shares: '', reason: 'Loan cleared' },
    );
  });

  it('offers nothing to release or sell once a record is closed', () => {
    render(<WithholdingPanel ctx={buildCtx({
      withholdings: [wh({ shares: 300, released_shares: 300, status: 'closed' })],
    })} ov={OV} />);

    fireEvent.click(screen.getByRole('button', { name: /^All$/ }));
    openRecord();

    expect(screen.queryByRole('button', { name: /^Release$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Place for sale/i })).not.toBeInTheDocument();
  });

  it('places withheld shares for sale at the published price by default', async () => {
    const ctx = buildCtx();
    render(<WithholdingPanel ctx={ctx} ov={OV} />);
    openRecord();

    fireEvent.click(screen.getByRole('button', { name: /Place for sale/i }));

    // Pre-filled with everything still held, at the society's market value.
    expect(screen.getByDisplayValue('300')).toBeInTheDocument();
    expect(screen.getByDisplayValue('135')).toBeInTheDocument();
    expect(screen.getByText(/Offering/)).toHaveTextContent('300');
    expect(screen.getByText(/Offering/)).toHaveTextContent('KES 40,500');

    fireEvent.click(within(dialog('Place withheld shares for sale')).getByRole('button', { name: /Place for sale/i }));

    await waitFor(() => expect(ctx.listWithheldShares).toHaveBeenCalledTimes(1));
    expect(ctx.listWithheldShares).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'w1' }),
      { shares: '300', price: '135', expiry_date: '' },
    );
  });

  it('shows the live sale order against the record it is discharging', () => {
    render(<WithholdingPanel ctx={buildCtx({
      withholdings: [wh({ shares: 300, listed_shares: 120 })],
      listings: [{
        id: 'l1', withholding_id: 'w1', shares: 120, filled_shares: 20,
        price_per_share: 140, status: 'open', expiry_date: '2026-09-30',
      }],
    })} ov={OV} />);
    openRecord();

    const d = dialog('WH-000001 — Jane Wanjiku');
    expect(stat(d, 'On the market')).toBe('120');

    // The order itself: offered at 140, 20 already taken, not yet expired.
    const book = within(d).getByText('On the market now').parentElement;
    expect(within(book).getByText('KES 140')).toBeInTheDocument();
    expect(within(book).getByText('20')).toBeInTheDocument();
    expect(within(book).getByText(/30 Sept? 2026/)).toBeInTheDocument();
  });
});

describe('the tab it lives on', () => {
  it('badges the Withholding tab with the number of open records and opens it', () => {
    const ctx = {
      ...buildCtx({
        withholdings: [
          wh({ id: 'a', shares: 300 }),
          wh({ id: 'b', ref_no: 'WH-000002', shares: 100, member_id: 'm2' }),
          wh({ id: 'c', ref_no: 'WH-000003', shares: 20, released_shares: 20, status: 'closed' }),
        ],
      }),
      sacco: { id: 's1', name: 'Umoja Sacco' },
      treasury: { treasury_shares: 9500, par_value: 100 },
      sharePrices: [{ id: 'p1', market_value: PRICE, effective_date: '2026-08-01' }],
      transfers: [], shareTxns: [], certificates: [],
      dividends: [], dividendAllocations: [], shareAudit: [],
      expireOrders: vi.fn(), setMarketValue: vi.fn(),
    };
    render(<SharesTab ctx={ctx} />);

    const tab = screen.getByRole('button', { name: /^Withholding/ });
    expect(within(tab).getByText('2')).toBeInTheDocument();   // closed one excluded

    fireEvent.click(tab);
    expect(screen.getByText('Withholding register')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
  });
});
