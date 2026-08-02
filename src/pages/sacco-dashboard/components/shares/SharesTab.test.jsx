import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SharesTab from './index';
import { marketOverview, memberPosition, marketIsOpen, remaining } from './_util';

// The share market. These cover the things that would quietly cost a member
// money if they broke: the headline numbers a CEO reads in ten seconds, the
// escrow that stops the same share being sold twice, and the guards on
// settlement, reversal and dividends.

vi.mock('../../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// Recharts needs a real width/height; jsdom reports zero, so the charts render
// empty. Stubbing the container keeps the panels mountable without them.
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return { ...actual, ResponsiveContainer: ({ children }) => <div style={{ width: 800, height: 300 }}>{children}</div> };
});

const member = (id, name, no, over = {}) => ({
  id, full_name: name, member_no: no, status: 'active', kyc_status: 'verified', ...over,
});

const holding = (over = {}) => ({
  id: 'h1', member_id: 'm1', member: { id: 'm1', full_name: 'Jane Wanjiku', member_no: 'MEM-001' },
  shares_held: 500, locked_shares: 0, par_value: 100, is_frozen: false,
  total_invested: 60000, avg_buy_price: 120, realized_gain: 0, dividends_earned: 0,
  first_purchase_date: '2026-01-10', last_trade_date: '2026-07-01',
  ...over,
});

const order = (over = {}) => ({
  id: 'l1', side: 'sell', seller_member_id: 'm2', seller_is_treasury: false,
  buyer_member_id: null, buyer_is_treasury: false,
  seller: { id: 'm2', full_name: 'Peter Otieno' },
  shares: 200, filled_shares: 0, price_per_share: 135, status: 'open',
  expiry_date: null, created_at: '2026-08-01T08:00:00Z',
  ...over,
});

const trade = (over = {}) => ({
  id: 't1', seller_member_id: 'm2', buyer_member_id: 'm1',
  seller_is_treasury: false, buyer_is_treasury: false,
  shares: 100, price: 13500, price_per_share: 135, buyer_fee: 0, seller_fee: 0,
  status: 'settled', trade_type: 'market',
  created_at: '2026-08-01T09:00:00Z', settled_at: '2026-08-01T09:00:00Z',
  ...over,
});

const buildCtx = (over = {}) => ({
  sacco: { id: 's1', name: 'Umoja Sacco' },
  members: [member('m1', 'Jane Wanjiku', 'MEM-001'), member('m2', 'Peter Otieno', 'MEM-002')],
  shares: [holding()],
  treasury: { id: 'tr1', treasury_shares: 15000, authorized_shares: 200000, par_value: 100, issued_shares: 100000, retired_shares: 0, frozen_shares: 0 },
  sharePrices: [
    { id: 'p1', market_value: 135, effective_date: '2026-08-01' },
    { id: 'p2', market_value: 130, effective_date: '2026-07-31' },
  ],
  listings: [], transfers: [], shareTxns: [], certificates: [],
  dividends: [], dividendAllocations: [], shareAudit: [],
  shareSettings: {
    par_value: 100, min_holding: 0, max_holding_shares: 0, max_holding_percent: 0,
    trading_fee_percent: 0, commission_percent: 0, dividend_tax_percent: 0, votes_per_share: 0,
    allow_member_transfers: true, require_transfer_approval: false, auto_settle: true,
    allow_partial_fills: true, price_floor_is_par: true, lock_in_days: 0,
    market_open_time: '00:00', market_close_time: '00:00', market_days: [0, 1, 2, 3, 4, 5, 6],
    trading_suspended: false, require_kyc_to_trade: true, large_trade_threshold: 0,
    certificate_prefix: 'CERT',
  },
  // Engine actions
  setMarketValue: vi.fn(), saveTreasury: vi.fn(), saveShares: vi.fn(),
  issueShares: vi.fn(), retireShares: vi.fn(), adjustTreasury: vi.fn(), freezeMember: vi.fn(),
  placeOrder: vi.fn(), updateOrder: vi.fn(), cancelOrder: vi.fn(),
  executeOrder: vi.fn().mockResolvedValue({ status: 'settled' }),
  approveShareTransfer: vi.fn(), rejectShareTransfer: vi.fn(), reverseTrade: vi.fn(),
  directTransfer: vi.fn(), reissueCertificate: vi.fn(), expireOrders: vi.fn(),
  declareDividend: vi.fn(), calculateDividend: vi.fn(), payDividend: vi.fn(), cancelDividend: vi.fn(),
  saveShareSettings: vi.fn(), setTradingSuspended: vi.fn(),
  getShareRegister: vi.fn().mockResolvedValue([]),
  getShareAlerts: vi.fn().mockResolvedValue([]),
  exportCSV: vi.fn(),
  ...over,
});

const goTo = (label) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`, 'i') }));

describe('share market — the ten-second read', () => {
  beforeEach(() => vi.clearAllMocks());

  it('splits the issue into treasury and member-owned, and values the whole issue', () => {
    render(<SharesTab ctx={buildCtx()} />);

    // 500 member-held + 15,000 treasury = 15,500 in issue at KES 135 = 2,092,500.
    expect(screen.getByText('Total shares issued')).toBeInTheDocument();
    expect(screen.getByText('15,500')).toBeInTheDocument();
    expect(screen.getByText('15,000')).toBeInTheDocument();   // treasury
    expect(screen.getByText('500')).toBeInTheDocument();      // member-owned
    expect(screen.getByText('KES 2.09M')).toBeInTheDocument();
  });

  it('counts only today\'s settled trades under "Today\'s trades"', () => {
    const today = new Date().toISOString().slice(0, 10);
    const ov = marketOverview(buildCtx({
      transfers: [
        trade({ id: 'today', settled_at: `${today}T10:00:00Z` }),
        trade({ id: 'old', settled_at: '2026-07-01T10:00:00Z' }),
        trade({ id: 'unsettled', status: 'pending', settled_at: null, created_at: `${today}T11:00:00Z` }),
      ],
    }));

    expect(ov.todaysTrades).toHaveLength(1);
    expect(ov.settled).toHaveLength(2);
    expect(ov.pendingTransfers).toHaveLength(1);
  });

  it('surfaces an unpublished price and a pending approval as things needing attention', () => {
    render(<SharesTab ctx={buildCtx({
      sharePrices: [],
      transfers: [trade({ status: 'pending', settled_at: null })],
    })} />);

    expect(screen.getByText('Needs your attention')).toBeInTheDocument();
    expect(screen.getByText(/No market value has been published/)).toBeInTheDocument();
    expect(screen.getByText(/1 transfer waiting for approval/)).toBeInTheDocument();
  });

  it('reports the market as closed while trading is suspended, and says why', () => {
    render(<SharesTab ctx={buildCtx({
      shareSettings: { ...buildCtx().shareSettings, trading_suspended: true, suspension_reason: 'Pending AGM revaluation' },
    })} />);

    expect(screen.getByText('Trading suspended')).toBeInTheDocument();
    expect(screen.getByText('Pending AGM revaluation')).toBeInTheDocument();
  });
});

describe('share market — holdings and cost basis', () => {
  beforeEach(() => vi.clearAllMocks());

  it('values a holding against the published price, not par', () => {
    // 500 shares bought at an average of 120 = 60,000 invested; worth 67,500 at 135.
    const p = memberPosition(holding(), 135, 15500);
    expect(p.value).toBe(67500);
    expect(p.unrealized).toBe(7500);
    expect(Math.round(p.unrealizedPct * 100) / 100).toBe(12.5);
  });

  it('never counts escrowed shares as free to sell', () => {
    const p = memberPosition(holding({ shares_held: 500, locked_shares: 200 }), 135, 15500);
    expect(p.held).toBe(500);
    expect(p.locked).toBe(200);
    expect(p.free).toBe(300);
  });

  it('shows each holder\'s average buy price and unrealised gain in the register', () => {
    render(<SharesTab ctx={buildCtx()} />);
    goTo('Holdings');

    expect(screen.getByText('Share register')).toBeInTheDocument();
    const row = screen.getByText('Jane Wanjiku').closest('tr');
    expect(within(row).getByText('KES 120')).toBeInTheDocument();     // avg buy price
    expect(within(row).getByText('KES 67,500')).toBeInTheDocument();  // current value
    expect(within(row).getByText(/\+KES 7,500/)).toBeInTheDocument(); // unrealised gain
  });
});

describe('share market — the order book', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ranks asks cheapest-first and bids highest-first, and quotes the spread', () => {
    render(<SharesTab ctx={buildCtx({
      listings: [
        order({ id: 'ask-high', price_per_share: 150 }),
        order({ id: 'ask-low', price_per_share: 138 }),
        order({ id: 'bid-low', side: 'buy', seller_member_id: null, buyer_member_id: 'm1', price_per_share: 125 }),
        order({ id: 'bid-high', side: 'buy', seller_member_id: null, buyer_member_id: 'm1', price_per_share: 132 }),
      ],
    })} />);
    goTo('Marketplace');

    // Scoped to the stat cards — the same prices also appear in the book rows.
    const card = (label) => screen.getByText(label).closest('div.bg-card');
    expect(within(card('Best ask')).getByText('KES 138')).toBeInTheDocument();   // cheapest ask
    expect(within(card('Best bid')).getByText('KES 132')).toBeInTheDocument();   // highest bid
    expect(within(card('Spread')).getByText('KES 6')).toBeInTheDocument();       // 138 − 132
  });

  it('reports what is left on a partly filled order, not the original size', () => {
    expect(remaining(order({ shares: 200, filled_shares: 75 }))).toBe(125);
    expect(remaining(order({ shares: 200, filled_shares: 200 }))).toBe(0);
    expect(remaining(order({ shares: 200, filled_shares: 500 }))).toBe(0);
  });

  it('settles a fill through the engine rather than moving shares itself', async () => {
    const ctx = buildCtx({ listings: [order()] });
    render(<SharesTab ctx={ctx} />);
    goTo('Marketplace');

    fireEvent.click(screen.getByText('Fill (buy)'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm1' } });
    fireEvent.click(screen.getByRole('button', { name: /Execute & settle/i }));

    await waitFor(() => expect(ctx.executeOrder).toHaveBeenCalled());
    const [listing, opts] = ctx.executeOrder.mock.calls[0];
    expect(listing.id).toBe('l1');
    expect(opts.member_id).toBe('m1');
    expect(opts.shares).toBe('200');
  });

  it('queues trades for approval instead of settling when the society requires it', () => {
    render(<SharesTab ctx={buildCtx({
      shareSettings: { ...buildCtx().shareSettings, require_transfer_approval: true },
      transfers: [trade({ status: 'pending', settled_at: null })],
    })} />);
    goTo('Marketplace');

    expect(screen.getByText('Transfers awaiting approval')).toBeInTheDocument();
    expect(screen.getByText('This society reviews every trade before it settles')).toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('demands a reason before reversing a settled trade', async () => {
    const ctx = buildCtx({ transfers: [trade()] });
    render(<SharesTab ctx={ctx} />);
    goTo('Marketplace');

    fireEvent.click(screen.getByText('Reverse'));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm/i }));

    // No reason typed → the engine is never called.
    await waitFor(() => expect(ctx.reverseTrade).not.toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/keyed against the wrong member/i), {
      target: { value: 'Booked against the wrong member' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Confirm/i }));
    await waitFor(() => expect(ctx.reverseTrade).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }), 'Booked against the wrong member',
    ));
  });
});

describe('share market — treasury and dividends', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps listed treasury shares out of the free-to-trade pool', () => {
    render(<SharesTab ctx={buildCtx({
      listings: [order({ id: 'house', seller_member_id: null, seller_is_treasury: true, shares: 4000 })],
    })} />);
    goTo('Treasury');

    expect(screen.getByText('Free to trade')).toBeInTheDocument();
    expect(screen.getByText('11,000')).toBeInTheDocument();          // 15,000 − 4,000 listed
    expect(screen.getByText('4,000 already listed')).toBeInTheDocument();
  });

  it('refuses an inventory correction with no reason', async () => {
    const ctx = buildCtx();
    render(<SharesTab ctx={ctx} />);
    goTo('Treasury');

    fireEvent.click(screen.getByText('Adjust inventory'));
    fireEvent.change(screen.getByPlaceholderText('500'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /^Confirm/i }));

    await waitFor(() => expect(ctx.adjustTreasury).not.toHaveBeenCalled());
  });

  it('previews the dividend pool before anything is committed', () => {
    render(<SharesTab ctx={buildCtx()} />);
    goTo('Dividends');

    fireEvent.click(screen.getByRole('button', { name: /Declare dividend/i }));
    fireEvent.change(screen.getByPlaceholderText('20000000'), { target: { value: '20000000' } });
    fireEvent.change(screen.getByPlaceholderText('15'), { target: { value: '15' } });

    // 15% of 20M = 3M, spread over the 500 member-held shares = 6,000 per share.
    expect(screen.getByText('KES 3,000,000')).toBeInTheDocument();
    expect(screen.getByText('KES 6,000')).toBeInTheDocument();
  });

  it('offers Calculate on a declared dividend and Pay only once it is calculated', () => {
    const { rerender } = render(<SharesTab ctx={buildCtx({
      dividends: [{ id: 'd1', period_label: 'FY2026', status: 'declared', basis: 'profit_percent',
        profit_amount: 20000000, dividend_percent: 15, dividend_per_share: 0,
        record_date: '2026-12-31', payment_date: '2027-01-15', payout_method: 'cash',
        total_payable: 0, total_tax: 0, members_count: 0 }],
    })} />);
    goTo('Dividends');
    expect(screen.getByText('Calculate')).toBeInTheDocument();
    expect(screen.queryByText('Pay')).not.toBeInTheDocument();

    rerender(<SharesTab ctx={buildCtx({
      dividends: [{ id: 'd1', period_label: 'FY2026', status: 'calculated', basis: 'profit_percent',
        profit_amount: 20000000, dividend_percent: 15, dividend_per_share: 6000,
        record_date: '2026-12-31', payment_date: '2027-01-15', payout_method: 'cash',
        total_payable: 3000000, total_tax: 0, members_count: 1 }],
    })} />);
    goTo('Dividends');
    expect(screen.getByText('Pay')).toBeInTheDocument();
    expect(screen.queryByText('Calculate')).not.toBeInTheDocument();
  });
});

describe('share market — market hours', () => {
  it('treats equal open and close times as always open', () => {
    expect(marketIsOpen({ market_open_time: '00:00', market_close_time: '00:00', market_days: [0, 1, 2, 3, 4, 5, 6] })).toBe(true);
  });

  it('closes the market on a day that is not a trading day', () => {
    const everyDayButToday = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== new Date().getDay());
    expect(marketIsOpen({ market_open_time: '00:00', market_close_time: '00:00', market_days: everyDayButToday })).toBe(false);
  });

  it('stays closed while trading is suspended, whatever the hours say', () => {
    expect(marketIsOpen({
      market_open_time: '00:00', market_close_time: '00:00',
      market_days: [0, 1, 2, 3, 4, 5, 6], trading_suspended: true,
    })).toBe(false);
  });
});
