import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The treasurer's side. These cover the controls that stop money being quietly
// rewritten: settled entries can only be reversed, a reversal needs a reason,
// and the search actually narrows the ledger.
//
// The ledger reads a page at a time from Postgres now, so the fake below is a
// small query engine rather than an array — filtering, searching, ordering and
// ranging have to really happen for these assertions to mean anything.

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// The rows the fake database holds for the current test.
let TABLE = [];

const SETTLED = ['completed', 'paid'];

// '\%' etc. arrive escaped from sanitizeSearchTerm; undo that to compare text.
const unescapeTerm = (t) => t.replace(/\\([%_*])/g, '$1');

const matchesOr = (rowObj, orFilter) => orFilter
  .split(',')
  .some((clause) => {
    const [col, , pattern] = clause.split('.');
    const needle = unescapeTerm(pattern.replace(/^%|%$/g, '')).toLowerCase();
    return String(rowObj[col] ?? '').toLowerCase().includes(needle);
  });

const builder = () => {
  const ops = { eq: [], gte: [], lte: [], or: null, order: null };
  const b = {
    select: (_cols, opt) => { ops.count = opt?.count; return b; },
    eq:  (c, v) => { ops.eq.push([c, v]); return b; },
    gte: (c, v) => { ops.gte.push([c, v]); return b; },
    lte: (c, v) => { ops.lte.push([c, v]); return b; },
    or:  (f) => { ops.or = f; return b; },
    order: (c, o) => { ops.order = [c, o?.ascending]; return b; },
    range: (from, to) => {
      let rows = TABLE.filter((r) =>
        ops.eq.every(([c, v]) => String(r[c] ?? '') === String(v)) &&
        ops.gte.every(([c, v]) => Number(r[c] ?? 0) >= Number(v)) &&
        ops.lte.every(([c, v]) => Number(r[c] ?? 0) <= Number(v)) &&
        (!ops.or || matchesOr(r, ops.or)));

      const count = rows.length;
      return Promise.resolve({ data: rows.slice(from, to + 1), count, error: null });
    },
  };
  return b;
};

// Applies the same filter semantics the summary function does in SQL.
const summaryFor = (p) => {
  const rows = TABLE.filter((r) => {
    if (p.p_member && r.member_id !== p.p_member) return false;
    if (p.p_method && (r.payment_method || '') !== p.p_method) return false;
    if (p.p_status && r.status !== p.p_status) return false;
    if (p.p_min != null && Number(r.amount) < p.p_min) return false;
    if (p.p_max != null && Number(r.amount) > p.p_max) return false;
    if (p.p_search) {
      const needle = unescapeTerm(p.p_search).toLowerCase();
      const hay = ['txn_no', 'reference', 'notes', 'contribution_type', 'received_by_name']
        .map((c) => String(r[c] ?? '')).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  return [{
    entry_count: rows.length,
    settled_amount: rows.filter((r) => SETTLED.includes(r.status))
      .reduce((s, r) => s + Number(r.amount || 0), 0),
  }];
};

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => builder(),
    rpc: (name, params) => {
      if (name === 'sacco_contributions_filtered_summary') {
        return Promise.resolve({ data: summaryFor(params || {}), error: null });
      }
      if (name === 'sacco_contributions_by_type') {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === 'sacco_contributions_by_member') {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: { message: `no such rpc ${name}` } });
    },
  },
}));

const ContributionsTab = (await import('./ContributionsTab')).default;

const member = (id, name, no) => ({ id, full_name: name, member_no: no, monthly_contribution: 1000 });

const row = (over = {}) => ({
  id: 'c1', txn_no: 'CTR-00000001', member_id: 'm1',
  member: { id: 'm1', full_name: 'Jane Wanjiku', member_no: 'MEM-001' },
  amount: 1000, contribution_type: 'monthly', account: 'deposits',
  payment_method: 'cash', status: 'completed', channel: 'admin',
  paid_at: '2026-08-01T09:00:00Z', paid_date: '2026-08-01', period_month: '2026-08-01',
  reference: 'SLIP-1', received_by_name: 'Treasurer', penalty_amount: 0,
  created_at: '2026-08-01T09:00:00Z',
  ...over,
});

// Whole-book figures come from the aggregate now, not from the rows on screen.
const statsFor = (rows) => ({
  totalContributions: rows.length,
  settledContributions: rows.filter((r) => SETTLED.includes(r.status)).length,
  totalSavings: rows.filter((r) => SETTLED.includes(r.status)).reduce((s, r) => s + Number(r.amount || 0), 0),
  contributionsThisMonth: 0,
  pendingContributions: rows.filter((r) => r.status === 'pending').length,
  pendingContribAmount: rows.filter((r) => r.status === 'pending').reduce((s, r) => s + Number(r.amount || 0), 0),
  totalPenalties: rows.reduce((s, r) => s + Number(r.penalty_amount || 0), 0),
});

const buildCtx = (over = {}) => {
  const rows = over.contributions || [row()];
  TABLE = rows;
  const ctx = {
    members: [member('m1', 'Jane Wanjiku', 'MEM-001'), member('m2', 'Peter Otieno', 'MEM-002')],
    stats: statsFor(rows),
    contributionTypes: [],
    contributionAudit: [],
    recordContribution: vi.fn(),
    approveContribution: vi.fn(),
    reverseContribution: vi.fn(),
    editContribution: vi.fn(),
    createContributionType: vi.fn(),
    updateContributionType: vi.fn(),
    exportCSV: vi.fn(),
    getCollections: vi.fn().mockResolvedValue([]),
    getDefaulters: vi.fn().mockResolvedValue([]),
    getMemberContributionStats: vi.fn().mockResolvedValue(null),
    ...over,
  };
  delete ctx.contributions;
  return ctx;
};

const ledgerCard = () => screen.getByText('Contributions ledger').closest('div').parentElement;

describe('sacco dashboard — contributions ledger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the receipt number, officer and method on every entry', async () => {
    render(<ContributionsTab ctx={buildCtx()} />);
    expect(await screen.findByText('CTR-00000001')).toBeInTheDocument();
    expect(screen.getByText('Treasurer')).toBeInTheDocument();
    expect(screen.getByText('SLIP-1')).toBeInTheDocument();
  });

  it('offers Approve only on pending entries, and never Edit on settled money', async () => {
    const ctx = buildCtx({
      contributions: [
        row(),                                                        // completed
        row({ id: 'c2', txn_no: 'CTR-2', status: 'pending', channel: 'member_portal' }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);

    // One Approve (the pending row) and one Edit (also the pending row).
    expect(await screen.findByText('Approve')).toBeInTheDocument();
    expect(screen.getAllByText('Approve')).toHaveLength(1);
    expect(screen.getAllByText('Edit')).toHaveLength(1);
    // Reverse is available on both, because neither is already reversed.
    expect(screen.getAllByText('Reverse')).toHaveLength(2);
  });

  it('will not reverse without a reason, and passes the reason through when given', async () => {
    const ctx = buildCtx();
    render(<ContributionsTab ctx={ctx} />);

    fireEvent.click(await screen.findByText('Reverse'));
    fireEvent.click(screen.getByText('Reverse contribution'));
    await waitFor(() => expect(ctx.reverseContribution).not.toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/Cheque bounced/), {
      target: { value: 'Posted to the wrong member' },
    });
    fireEvent.click(screen.getByText('Reverse contribution'));
    await waitFor(() =>
      expect(ctx.reverseContribution).toHaveBeenCalledWith('c1', 'Posted to the wrong member'));
  });

  it('approves a member declaration with the method and reference the treasurer confirms', async () => {
    const ctx = buildCtx({
      contributions: [row({ status: 'pending', channel: 'member_portal', reference: '' })],
    });
    render(<ContributionsTab ctx={ctx} />);

    fireEvent.click(await screen.findByText('Approve'));
    fireEvent.change(screen.getByPlaceholderText('Receipt / slip no.'), { target: { value: 'BNK-42' } });
    fireEvent.click(screen.getByText('Confirm received'));

    await waitFor(() => expect(ctx.approveContribution).toHaveBeenCalled());
    expect(ctx.approveContribution.mock.calls[0][1]).toMatchObject({ reference: 'BNK-42' });
  });

  it('searches the ledger by reference and transaction number', async () => {
    const ctx = buildCtx({
      contributions: [
        row(),
        row({
          id: 'c2', txn_no: 'CTR-00000002', member_id: 'm2', reference: 'MPX99',
          member: { id: 'm2', full_name: 'Peter Otieno', member_no: 'MEM-002' },
        }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);
    const search = await screen.findByPlaceholderText(/Search transaction no/);

    fireEvent.change(search, { target: { value: 'MPX99' } });
    await waitFor(() => expect(screen.queryByText('CTR-00000001')).not.toBeInTheDocument());
    expect(screen.getByText('CTR-00000002')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'CTR-00000001' } });
    await waitFor(() => expect(screen.queryByText('CTR-00000002')).not.toBeInTheDocument());
    expect(screen.getByText('CTR-00000001')).toBeInTheDocument();
  });

  // Member search moved to the dropdown, which matches an id exactly instead of
  // a name by substring — two members called "Peter" no longer collide.
  it('narrows to one member through the member filter', async () => {
    const ctx = buildCtx({
      contributions: [
        row(),
        row({
          id: 'c2', txn_no: 'CTR-00000002', member_id: 'm2',
          member: { id: 'm2', full_name: 'Peter Otieno', member_no: 'MEM-002' },
        }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);
    await screen.findByText('CTR-00000001');

    fireEvent.change(screen.getByDisplayValue('All members'), { target: { value: 'm2' } });

    await waitFor(() => expect(screen.queryByText('CTR-00000001')).not.toBeInTheDocument());
    expect(screen.getByText('CTR-00000002')).toBeInTheDocument();
  });

  it('filters by payment method and only totals settled money', async () => {
    const ctx = buildCtx({
      contributions: [
        row(),                                                                  // cash, completed, 1000
        row({ id: 'c2', txn_no: 'CTR-2', payment_method: 'mpesa', amount: 2500 }),
        row({ id: 'c3', txn_no: 'CTR-3', payment_method: 'mpesa', amount: 9999, status: 'pending' }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);
    await screen.findByText('CTR-00000001');

    fireEvent.change(screen.getByDisplayValue('Any method'), { target: { value: 'mpesa' } });

    // Two M-Pesa rows are shown...
    expect(await screen.findByText(/settled across 2 entries/)).toBeInTheDocument();
    expect(screen.queryByText('CTR-00000001')).not.toBeInTheDocument();
    // ...but the 9,999 pending row is excluded from the settled total.
    const summary = screen.getByText(/settled across 2 entries/).closest('span');
    expect(summary).toHaveTextContent('KES 2,500');
    expect(summary).not.toHaveTextContent('12,499');
  });

  // The figures above the table describe the whole book, so they must not move
  // when a filter narrows what is on screen.
  it('keeps the headline figures on the whole book while a filter is applied', async () => {
    const ctx = buildCtx({
      contributions: [
        row(),
        row({ id: 'c2', txn_no: 'CTR-2', payment_method: 'mpesa', amount: 2500 }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);
    await screen.findByText('CTR-00000001');

    expect(screen.getByText('Total collected').closest('.bg-card')).toHaveTextContent('KES 3,500');

    fireEvent.change(screen.getByDisplayValue('Any method'), { target: { value: 'mpesa' } });
    await waitFor(() => expect(screen.queryByText('CTR-00000001')).not.toBeInTheDocument());

    expect(screen.getByText('Total collected').closest('.bg-card')).toHaveTextContent('KES 3,500');
  });

  it('renders the audit log with the before and after values', async () => {
    const ctx = buildCtx({
      contributionAudit: [{
        id: 'a1', txn_no: 'CTR-00000001', action: 'reversed',
        actor_name: 'Grace Mwangi', actor_role: 'sacco_admin',
        changed_fields: ['status'],
        old_values: { status: 'completed' }, new_values: { status: 'reversed' },
        reason: 'Cheque bounced', created_at: '2026-08-01T10:00:00Z',
      }],
    });
    render(<ContributionsTab ctx={ctx} />);
    fireEvent.click(screen.getByText('Audit log'));

    expect(await screen.findByText('Grace Mwangi')).toBeInTheDocument();
    expect(screen.getByText('Cheque bounced')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getAllByText('reversed').length).toBeGreaterThan(0);
  });

  it('runs the collections and defaulters reports when the Reports tab opens', async () => {
    const ctx = buildCtx({
      getCollections: vi.fn().mockResolvedValue([
        { bucket: '2026-08-01', entries: 2, members: 2, total: 3500, cash: 1000, bank: 0, mpesa: 2500, card: 0, deposits: 3500, share_capital: 0 },
      ]),
      getDefaulters: vi.fn().mockResolvedValue([
        { member_id: 'm2', member_no: 'MEM-002', full_name: 'Peter Otieno', phone: '0700', monthly_contribution: 1000, expected: 5000, contributed: 1000, outstanding: 4000, missed_months: 4, last_paid_at: null },
      ]),
    });
    render(<ContributionsTab ctx={ctx} />);
    fireEvent.click(screen.getByText('Reports'));

    await waitFor(() => expect(ctx.getCollections).toHaveBeenCalled());
    expect(ctx.getCollections.mock.calls[0][0]).toMatchObject({ bucket: 'day' });

    // Peter also appears in the member-statements list, so scope to the card.
    const defaultersCard = (await screen.findByText('Defaulters')).closest('.bg-card');
    expect(within(defaultersCard).getByText('Peter Otieno')).toBeInTheDocument();
    expect(within(defaultersCard).getByText('KES 4,000')).toBeInTheDocument();
    expect(within(defaultersCard).getByText('4')).toBeInTheDocument(); // missed months

    // Switching the bucket re-runs the report at the new granularity.
    fireEvent.click(screen.getByText('Annual'));
    await waitFor(() =>
      expect(ctx.getCollections.mock.calls.at(-1)[0]).toMatchObject({ bucket: 'year' }));
  });

  // Exporting a paged table must export what the filters match across the whole
  // book — a CSV holding one page looks complete and is not.
  it('exports every row the filters match, not the page on screen', async () => {
    const ctx = buildCtx({
      contributions: [
        row(),
        row({ id: 'c2', txn_no: 'CTR-2', member_id: 'm2', member: { id: 'm2', full_name: 'Peter Otieno', member_no: 'MEM-002' } }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);
    await screen.findByText('CTR-00000001');

    fireEvent.change(screen.getByDisplayValue('All members'), { target: { value: 'm2' } });
    await waitFor(() => expect(screen.queryByText('CTR-00000001')).not.toBeInTheDocument());

    fireEvent.click(within(ledgerCard()).getByText('Export'));

    await waitFor(() => expect(ctx.exportCSV).toHaveBeenCalled());
    const [exported] = ctx.exportCSV.mock.calls[0];
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ transaction_no: 'CTR-2', member: 'Peter Otieno' });
  });

  it('pages the ledger rather than rendering the whole book', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      row({ id: `c${i}`, txn_no: `CTR-${String(i).padStart(5, '0')}` }));
    render(<ContributionsTab ctx={buildCtx({ contributions: many })} />);

    await screen.findByText('CTR-00000');
    // 25 rows on screen, and the pager says how many there really are.
    expect(screen.queryByText('CTR-00030')).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: /pagination/i });
    expect(nav).toHaveTextContent('1–25');
    expect(nav).toHaveTextContent('60');
  });
});
