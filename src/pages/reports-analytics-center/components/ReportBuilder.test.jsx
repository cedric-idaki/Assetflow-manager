import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * These drive the builder the way a user does — click a source, tick columns,
 * add a filter, run — and assert on the query that actually left the component
 * and the table that came back.
 *
 * The Supabase client is a recording stub rather than a mock of the hook,
 * because the thing worth testing here is the whole path: the definition the
 * clicks produce, the plan the engine builds from it, the request fetchAllRows
 * issues, and the shaping of what comes back. Stubbing the hook would test the
 * markup and nothing else.
 */

const ROWS = [
  { id: 'p1', payment_date: '2026-08-05T09:00:00.000Z', amount: 1000, payment_method: 'mpesa', payment_status: 'completed', client: { full_name: 'Achieng' } },
  { id: 'p2', payment_date: '2026-08-11T09:00:00.000Z', amount: 2500, payment_method: 'cash',  payment_status: 'completed', client: { full_name: 'Barasa' } },
  { id: 'p3', payment_date: '2026-08-19T09:00:00.000Z', amount: 500,  payment_method: 'mpesa', payment_status: 'pending',   client: { full_name: 'Chebet' } },
];

/** Every request the component made, in order. */
let requests = [];
let tableRows = ROWS;

/**
 * A chainable stand-in for the Supabase query builder that records what was
 * asked for. `.range()` resolves, because fetchAllRows pages with it — the
 * second page comes back short, which is how it knows to stop.
 */
const makeQuery = (table) => {
  const record = { table, select: null, ops: [], order: null };
  requests.push(record);

  const q = {
    select: (cols) => { record.select = cols; return q; },
    order:  (column, opts) => { record.order = { column, ...opts }; return q; },
    limit:  () => q,
    range:  (from) => Promise.resolve({ data: from === 0 ? tableRows : [], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };

  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'in', 'is', 'not'].forEach((method) => {
    q[method] = (...args) => { record.ops.push({ method, args }); return q; };
  });

  return q;
};

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table) => makeQuery(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));

vi.mock('../../../lib/tenant', () => ({
  getTenantAdminId: () => Promise.resolve('tenant-1'),
}));

const authState = { userProfile: { role: 'admin' }, user: { id: 'user-1' } };
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

const moduleState = { frozen: [] };
vi.mock('../../../contexts/TenantModulesContext', () => ({
  useModules: () => ({ isEnabled: (key) => !moduleState.frozen.includes(key) }),
}));

/**
 * The export path is intercepted at the BROWSER, not at a module boundary.
 *
 * Stubbing saveBlob would not have worked: downloadCSVText calls it through the
 * module's own binding, which an ES module mock cannot reach. Catching the blob
 * where it is handed to the page also means every layer under it — the grid,
 * the quoting, the BOM, the workbook bytes — ran for real, so these assertions
 * are about what lands in the file.
 */
const saved = [];
const captureDownloads = () => {
  saved.length = 0;
  global.URL.createObjectURL = vi.fn((blob) => { saved.push({ blob }); return 'blob:x'; });
  global.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    saved[saved.length - 1].name = this.download;
  });
};

// Imported after the vi.mock calls above, which is what they exist to intercept.
import ReportBuilder from './ReportBuilder';

const lastQueryOn = (table) => [...requests].reverse().find((r) => r.table === table);

/**
 * Open the builder on Payments.
 *
 * The builder opens on the first source the user is offered, which is Clients.
 * These tests are about the payments fixtures, so they say so rather than
 * depending on catalogue order — adding a source above Payments must not
 * silently change what they assert.
 */
const openOnPayments = async (user) => {
  render(<ReportBuilder />);
  await screen.findByText('1 · What are you reporting on?');
  await user.click(screen.getByRole('button', { name: /^Payments/ }));
};

beforeEach(() => {
  requests = [];
  tableRows = ROWS;
  captureDownloads();
  authState.userProfile = { role: 'admin' };
  moduleState.frozen = [];
});

describe('choosing what to report on', () => {
  it('offers only sources the role and the tenant modules allow', async () => {
    authState.userProfile = { role: 'accountant' };
    moduleState.frozen = ['accounting'];

    render(<ReportBuilder />);
    await screen.findByText('1 · What are you reporting on?');

    // An accountant gets the commercial sources…
    expect(screen.getByRole('button', { name: /Payments/ })).toBeInTheDocument();
    // …but never the staff pay book,
    expect(screen.queryByRole('button', { name: /Employees/ })).not.toBeInTheDocument();
    // …and not the ledger while accounting is frozen.
    expect(screen.queryByRole('button', { name: /Journal Entries/ })).not.toBeInTheDocument();
  });

  it('tells a role that cannot build reports why, instead of showing an empty tool', async () => {
    authState.userProfile = { role: 'sales_agent' };
    render(<ReportBuilder />);
    expect(await screen.findByText(/not available for your role/i)).toBeInTheDocument();
  });

  it('starts a fresh definition when the source changes', async () => {
    const user = userEvent.setup();
    render(<ReportBuilder />);
    await screen.findByText('1 · What are you reporting on?');

    await user.click(screen.getByRole('button', { name: /Inventory & Assets/ }));
    // Carrying a payments filter onto assets would name a column assets has
    // never had, so the whole definition restarts.
    expect(screen.getByText(/No filters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Selling price' })).toBeInTheDocument();
  });
});

describe('running a report', () => {
  it('queries the chosen table with the tenant, period and sort applied', async () => {
    const user = userEvent.setup();
    await openOnPayments(user);

    await user.click(screen.getByRole('button', { name: /Run report/ }));
    await screen.findByText(/3 records/);

    const req = lastQueryOn('payments');
    expect(req.select).toContain('client:clients(full_name)');
    expect(req.order).toEqual({ column: 'payment_date', ascending: false });
    // The tenant predicate comes from the session, never from the definition.
    expect(req.ops).toContainEqual({ method: 'eq', args: ['admin_id', 'tenant-1'] });
    // Default period is this month, so a bounded range went with it.
    expect(req.ops.filter((o) => o.args[0] === 'payment_date')).toHaveLength(2);
  });

  it('renders the rows and totals the money column', async () => {
    const user = userEvent.setup();
    await openOnPayments(user);

    await user.click(screen.getByRole('button', { name: /Run report/ }));
    await screen.findByText(/3 records/);

    expect(screen.getByText('Achieng')).toBeInTheDocument();
    expect(screen.getByText('Barasa')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('KES 4,000')).toBeInTheDocument();
  });

  it('sends a filter the user built down to the query', async () => {
    const user = userEvent.setup();
    await openOnPayments(user);

    await user.click(screen.getByRole('button', { name: /Add filter/ }));
    await user.selectOptions(screen.getByLabelText('Filter column'), 'amount');
    await user.selectOptions(screen.getByLabelText('Filter condition'), 'gte');
    await user.type(screen.getByLabelText('Filter value'), '1000');

    await user.click(screen.getByRole('button', { name: /Run report/ }));
    await waitFor(() => expect(lastQueryOn('payments').ops)
      .toContainEqual({ method: 'gte', args: ['amount', 1000] }));
  });

  it('does not send a half-filled between, and says the report is fine to run', async () => {
    const user = userEvent.setup();
    await openOnPayments(user);

    await user.click(screen.getByRole('button', { name: /Add filter/ }));
    await user.selectOptions(screen.getByLabelText('Filter column'), 'amount');
    await user.selectOptions(screen.getByLabelText('Filter condition'), 'between');
    await user.type(screen.getByLabelText('Filter value'), '1000');  // upper bound left blank

    await user.click(screen.getByRole('button', { name: /Run report/ }));
    await screen.findByText(/3 records/);

    // Degrading to `>= 1000` would answer a question nobody asked.
    const amountOps = lastQueryOn('payments').ops.filter((o) => o.args[0] === 'amount');
    expect(amountOps).toEqual([]);
  });

  it('groups and sums instead of listing rows', async () => {
    const user = userEvent.setup();
    await openOnPayments(user);

    await user.selectOptions(screen.getByLabelText('Group by'), 'payment_method');

    await user.click(screen.getByRole('button', { name: /Run report/ }));
    await screen.findByText(/3 records/);

    const table = screen.getByRole('table');
    expect(within(table).getByText('Mpesa')).toBeInTheDocument();
    expect(within(table).getByText('Cash')).toBeInTheDocument();
    // Two mpesa rows, one cash row — one line per method, not per payment.
    expect(within(table).queryByText('Achieng')).not.toBeInTheDocument();
  });

  it('says so plainly when nothing matched', async () => {
    const user = userEvent.setup();
    tableRows = [];
    await openOnPayments(user);

    await user.click(screen.getByRole('button', { name: /Run report/ }));
    expect(await screen.findByText(/Nothing matched/)).toBeInTheDocument();
  });
});

describe('exporting', () => {
  /** Run the fixture report, then pick one format off the export menu. */
  const runAndExport = async (user, format) => {
    await openOnPayments(user);
    await user.click(screen.getByRole('button', { name: /Run report/ }));
    await screen.findByText(/3 records/);
    await user.click(screen.getByRole('button', { name: /^Export/ }));
    await user.click(await screen.findByRole('menuitem', { name: new RegExp(format) }));
  };

  it('offers all three formats, each saying what it is for', async () => {
    const user = userEvent.setup();
    await openOnPayments(user);
    await user.click(screen.getByRole('button', { name: /Run report/ }));
    await screen.findByText(/3 records/);
    await user.click(screen.getByRole('button', { name: /^Export/ }));

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Excel workbook'),
      expect.stringContaining('CSV file'),
      expect.stringContaining('PDF document'),
    ]);
  });

  it('hands the CSV the labelled columns and the provenance', async () => {
    const user = userEvent.setup();
    await runAndExport(user, 'CSV file');

    await waitFor(() => expect(saved).toHaveLength(1));
    const { blob, name } = saved[0];
    expect(name).toMatch(/^payments_report_\d{4}-\d{2}-\d{2}\.csv$/);

    // The leading BOM is what makes Excel read the UTF-8 as UTF-8. Checked in
    // BYTES: Blob.text() decodes it away, so a string assertion would pass on a
    // file that never carried one.
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 3)))
      .toEqual([0xef, 0xbb, 0xbf]);

    const text = await blob.text();
    const lines = text.split(String.fromCharCode(13) + String.fromCharCode(10));
    expect(lines[0]).toBe(`"Paid on","Client","Amount","Method","Status"`);
    // Money stays a number in the file — "KES 1,000" is text, and a column of
    // text does not add up in a spreadsheet.
    expect(lines[1]).toContain(`"1000"`);
    // The provenance rides along, so the file cannot be quoted out of context.
    expect(text).toContain(`"Report: Payments report"`);
    expect(text).toMatch(/Paid on between/);
  });

  it('writes a real workbook for the Excel format, not a renamed CSV', async () => {
    const user = userEvent.setup();
    await runAndExport(user, 'Excel workbook');

    await waitFor(() => expect(saved).toHaveLength(1));
    const { blob, name } = saved[0];
    expect(name).toMatch(/^payments_report_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // Not a CSV wearing a costume: a ZIP, whose first bytes are the local
    // file header signature.
    expect((await blob.text()).slice(0, 2)).toBe('PK');
  });
});

describe('saving', () => {
  it('stores the definition without a tenant or an author — the trigger sets those', async () => {
    const user = userEvent.setup();
    const inserted = [];
    const { supabase } = await import('../../../lib/supabase');
    const realFrom = supabase.from;
    supabase.from = (table) => {
      const q = realFrom(table);
      if (table === 'custom_reports') {
        q.insert = (row) => { inserted.push(row); return q; };
        q.update = (row) => { inserted.push(row); return q; };
      }
      return q;
    };

    await openOnPayments(user);

    await user.click(screen.getByRole('button', { name: /^Save report$/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText(/Monthly collections/), 'August collections');
    await user.click(within(dialog).getByRole('button', { name: /Save this report/ }));

    await waitFor(() => expect(inserted).toHaveLength(1));
    expect(inserted[0].name).toBe('August collections');
    expect(inserted[0].source_key).toBe('payments');
    expect(inserted[0].definition.fields).toContain('amount');
    // A client that could send these would be choosing whose books to write into.
    expect(inserted[0].admin_id).toBeUndefined();
    expect(inserted[0].created_by).toBeUndefined();

    supabase.from = realFrom;
  });
});
