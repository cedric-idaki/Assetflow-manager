import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AssetRegisterTab from './index';

/**
 * The register's central design claim is that THE HEADLINE FIGURES DO NOT COME
 * FROM THE TABLE. The table is one page; the totals are a server aggregate over
 * the whole book. These tests exist mostly to hold that line — a future
 * refactor that "simplifies" the KPI row into a reduce over `assets` would be
 * wrong in a way no visual review catches, because with a small seed dataset
 * the two agree.
 */

const downloadCSV = vi.fn();
vi.mock('../../../../utils/exportUtils', () => ({
  downloadCSV: (...args) => downloadCSV(...args),
  toCSV: () => '',
}));

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('../../../../components/Toast', () => ({ useToast: () => toast }));

vi.mock('../../../../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

const registerMock = vi.fn();
vi.mock('../../../../hooks/useAssetRegister', async (importOriginal) => {
  // SORT_OPTIONS and the bucket constants are plain data the components read;
  // only the hook itself needs replacing.
  const actual = await importOriginal();
  return { ...actual, useAssetRegister: (...args) => registerMock(...args) };
});

const asset = (i, over = {}) => ({
  id: `a${i}`,
  asset_tag: `FA-${String(i).padStart(4, '0')}`,
  asset_name: `Asset ${String(i).padStart(4, '0')}`,
  category: 'motor_vehicles',
  description: null,
  status: 'in_use',
  location: 'Head office',
  acquisition_date: '2025-03-01',
  cost: 1000000,
  residual_value: 0,
  accumulated_depreciation: 400000,
  book_value: 600000,
  current_value: null,
  valuation_date: null,
  valuation_basis: null,
  useful_life_years: 5,
  method: 'straight_line',
  gl_code: '1330',
  is_disposed: false,
  ...over,
});

const page = (n) => Array.from({ length: n }, (_, i) => asset(i + 1));

const buildRegister = (over = {}) => {
  const rows = over.rows || page(25);
  const base = {
    adminId: 'admin-1',
    assets: rows,
    canPost: true,
    error: null,
    summary: {
      totalAssets: 412,
      inService: 380,
      disposed: 20,
      needsAttention: 12,
      totalCost: 88000000,
      totalDepreciation: 31000000,
      totalBookValue: 57000000,
      totalCurrentValue: 63500000,
      valuedAssets: 40,
      undocumented: 7,
      expiringDocuments: 3,
      byCategory: { motor_vehicles: { count: 9, cost: 40000000, value: 26000000 } },
      byStatus: { in_use: 380, disposed: 20, under_maintenance: 12 },
      ...over.summary,
    },
    summaryLoading: false,
    pager: {
      rows,
      total: 412,
      page: 0,
      setPage: vi.fn(),
      pageCount: 17,
      from: 1,
      to: 25,
      loading: false,
      error: null,
      refresh: vi.fn(),
    },
    refresh: vi.fn(),
    createAsset: vi.fn(),
    updateAsset: vi.fn(),
    disposeAsset: vi.fn(),
    revalueAsset: vi.fn(),
    deleteAsset: vi.fn(),
    listDocuments: vi.fn(async () => []),
    listEvents: vi.fn(async () => []),
    uploadDocument: vi.fn(),
    deleteDocument: vi.fn(),
    fetchAllForExport: vi.fn(async () => page(412)),
  };

  // `summary` and `pager` are MERGED rather than replaced, so a test that
  // overrides one field of either does not silently blank the rest — which
  // renders NaN into the KPI cards and makes the failure look like a product
  // bug instead of a harness one.
  return {
    ...base,
    ...over,
    summary: { ...base.summary, ...over.summary },
    pager:   { ...base.pager,   ...over.pager },
  };
};

const ctx = { sacco: { id: 's1', name: 'Umoja Sacco' } };

const renderTab = (over = {}) => {
  const reg = buildRegister(over);
  registerMock.mockReturnValue(reg);
  const utils = render(<AssetRegisterTab ctx={ctx} />);
  return { ...utils, reg };
};

beforeEach(() => vi.clearAllMocks());

describe('asset register — headline figures', () => {
  it('reports totals from the server aggregate, not from the page on screen', () => {
    // The page holds 25 assets at 1,000,000 each. If the KPIs were a reduce
    // over the rows they would read 25,000,000 — the whole book is 88,000,000.
    renderTab();
    expect(screen.getByText('KES 88,000,000')).toBeInTheDocument();
    expect(screen.getByText('KES 57,000,000')).toBeInTheDocument();
    expect(screen.getByText('KES 63,500,000')).toBeInTheDocument();
    expect(screen.queryByText('KES 25,000,000')).not.toBeInTheDocument();
  });

  it('counts assets held from the aggregate, excluding disposals', () => {
    renderTab();
    // 380 in use + 12 needing attention; the 20 disposed are named separately.
    expect(screen.getByText('392')).toBeInTheDocument();
    expect(screen.getByText(/20 disposed or written off/)).toBeInTheDocument();
  });

  it('says when the current-value total is really book value', () => {
    renderTab({ summary: { valuedAssets: 0 } });
    expect(screen.getByText(/Nothing valued yet — this is book value/)).toBeInTheDocument();
  });
});

describe('asset register — the table', () => {
  it('shows one page and states the true total of the whole register', () => {
    renderTab();
    expect(screen.getByText('Asset 0001')).toBeInTheDocument();
    expect(screen.getByText('Asset 0025')).toBeInTheDocument();
    expect(screen.queryByText('Asset 0026')).not.toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: /pagination/i });
    expect(nav).toHaveTextContent('1–25');
    expect(nav).toHaveTextContent('412');
  });

  it('labels which of the two values each row is showing', () => {
    renderTab({
      rows: [
        asset(1, { current_value: null }),
        asset(2, { current_value: 750000, valuation_basis: 'market' }),
      ],
    });
    // A recorded valuation and a fallback to book value must never look alike.
    expect(screen.getByText('book value')).toBeInTheDocument();
    expect(screen.getByText('valued')).toBeInTheDocument();
    expect(screen.getByText('KES 750,000')).toBeInTheDocument();
  });

  it('opens on assets the SACCO still holds, not on everything', () => {
    renderTab();
    expect(registerMock).toHaveBeenCalledWith(ctx.sacco, expect.objectContaining({ status: 'active' }));
  });

  it('passes the filters through to the query rather than filtering in the browser', () => {
    renderTab();
    fireEvent.change(screen.getByDisplayValue('All categories'), { target: { value: 'land_buildings' } });
    expect(registerMock).toHaveBeenLastCalledWith(ctx.sacco, expect.objectContaining({ category: 'land_buildings' }));
  });

  it('tells the user their filters are the reason the table is empty', () => {
    renderTab({ rows: [], pager: { rows: [], total: 0, pageCount: 1, from: 0, to: 0 } });
    fireEvent.change(screen.getByDisplayValue('All categories'), { target: { value: 'plant_machinery' } });
    expect(screen.getByText(/Nothing matches those filters/)).toBeInTheDocument();
  });
});

describe('asset register — compliance line', () => {
  it('names what the register knows is missing', () => {
    renderTab();
    expect(screen.getByText(/no supporting document/)).toBeInTheDocument();
    expect(screen.getByText(/expired or expiring within 60 days/)).toBeInTheDocument();
    expect(screen.getByText(/under maintenance or impaired/)).toBeInTheDocument();
  });

  it('stays quiet when there is nothing to chase', () => {
    renderTab({ summary: { undocumented: 0, expiringDocuments: 0, needsAttention: 0 } });
    expect(screen.queryByText(/no supporting document/)).not.toBeInTheDocument();
  });
});

describe('asset register — export', () => {
  it('exports the whole register, never the page on screen', async () => {
    const { reg } = renderTab();
    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => expect(downloadCSV).toHaveBeenCalled());
    expect(reg.fetchAllForExport).toHaveBeenCalled();
    expect(downloadCSV.mock.calls[0][0]).toHaveLength(412);
  });

  it('refuses to write an empty file and says why', async () => {
    renderTab({ fetchAllForExport: vi.fn(async () => []) });
    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('There is nothing to export yet.'));
    expect(downloadCSV).not.toHaveBeenCalled();
  });
});

describe('asset register — registering an asset', () => {
  const openForm = () => fireEvent.click(screen.getByText('Register asset'));

  it('will not save a form the register cannot use', () => {
    const { reg } = renderTab();
    openForm();
    fireEvent.click(screen.getByText('Add to register'));
    expect(reg.createAsset).not.toHaveBeenCalled();
    expect(screen.getByText('Give the asset a name.')).toBeInTheDocument();
    expect(screen.getByText('Enter the purchase value.')).toBeInTheDocument();
  });

  it('saves a complete form and reports the tag it was given', async () => {
    const created = { asset_tag: 'FA-0007', id: 'a7' };
    const { reg } = renderTab({ createAsset: vi.fn(async () => ({ asset: created, posted: null })) });

    openForm();
    const dialog = screen.getByText('Register an asset').closest('div').parentElement;
    fireEvent.change(within(dialog).getByPlaceholderText(/Toyota Hiace/), { target: { value: 'Office block' } });
    fireEvent.change(within(dialog).getAllByPlaceholderText('0.00')[0], { target: { value: '4500000' } });
    fireEvent.click(screen.getByText('Add to register'));

    await waitFor(() => expect(reg.createAsset).toHaveBeenCalled());
    expect(reg.createAsset.mock.calls[0][0]).toMatchObject({ asset_name: 'Office block', cost: '4500000' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('FA-0007 added to the register.'));
  });

  it('says out loud when the asset was registered but the purchase was not posted', async () => {
    const { reg } = renderTab({
      createAsset: vi.fn(async () => ({
        asset: { asset_tag: 'FA-0008' },
        posted: { ok: false, reason: 'Period is closed' },
      })),
    });

    openForm();
    const dialog = screen.getByText('Register an asset').closest('div').parentElement;
    fireEvent.change(within(dialog).getByPlaceholderText(/Toyota Hiace/), { target: { value: 'Server' } });
    fireEvent.change(within(dialog).getAllByPlaceholderText('0.00')[0], { target: { value: '300000' } });
    fireEvent.click(screen.getByText('Add to register'));

    await waitFor(() => expect(reg.createAsset).toHaveBeenCalled());
    // Never reported as a plain success: a treasurer who ticked the box needs
    // to know the journal is missing.
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      'Period is closed',
      'FA-0008 registered, but the purchase was not posted',
    ));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('does not offer ledger posting when the chart of accounts is not seeded', () => {
    renderTab({ canPost: false });
    openForm();
    expect(screen.getByText(/Unavailable until the Finance Hub chart of accounts/)).toBeInTheDocument();
  });
});
