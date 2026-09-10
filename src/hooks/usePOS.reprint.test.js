import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn(), getUser: vi.fn() }, rpc: vi.fn() },
  getCurrentUser: vi.fn(),
  invokeSupabaseFunction: vi.fn(),
}));

const { isMissingColumnError } = await import('./usePOS');

const REPRINT = ['receipt_number', 'vat_percent'];

describe('isMissingColumnError', () => {
  it('recognises PostgREST reporting an unknown column on write', () => {
    expect(isMissingColumnError(
      { code: 'PGRST204', message: "Could not find the 'receipt_number' column of 'sales' in the schema cache" },
      REPRINT,
    )).toBe(true);
  });

  it('recognises Postgres reporting the column does not exist', () => {
    expect(isMissingColumnError(
      { code: '42703', message: 'column "vat_percent" of relation "sales" does not exist' },
      REPRINT,
    )).toBe(true);
  });

  it('does NOT swallow a constraint violation', () => {
    // This is the whole reason the check is narrow. A retry that dropped the
    // reprint columns on any failure would quietly record sales that broke a
    // real constraint, or mask a genuine error as a schema lag.
    expect(isMissingColumnError(
      { code: '23505', message: 'duplicate key value violates unique constraint "sales_invoice_number_key"' },
      REPRINT,
    )).toBe(false);
    expect(isMissingColumnError({ code: '23503', message: 'foreign key violation' }, REPRINT)).toBe(false);
    expect(isMissingColumnError({ code: '42501', message: 'permission denied for table sales' }, REPRINT)).toBe(false);
  });

  it('does NOT fire for a missing column we were not writing', () => {
    // A schema-cache error naming some other column is a real bug, not
    // something to retry around.
    expect(isMissingColumnError(
      { code: 'PGRST204', message: "Could not find the 'agent_id' column of 'sales' in the schema cache" },
      REPRINT,
    )).toBe(false);
  });

  it('handles a missing or empty error without throwing', () => {
    expect(isMissingColumnError(null, REPRINT)).toBe(false);
    expect(isMissingColumnError(undefined, REPRINT)).toBe(false);
    expect(isMissingColumnError({}, REPRINT)).toBe(false);
    expect(isMissingColumnError({ code: 'PGRST204' }, REPRINT)).toBe(false);
  });
});

/**
 * eTIMS must never be able to stop a customer getting their receipt.
 *
 * The reprint fetches the sale's KRA filing so the compliant copy can carry the
 * receipt signature. That lookup touches a table which, on this project, may not
 * exist yet — the migrations have run ahead of and behind the live schema in
 * both directions — and is issued through a query builder whose methods a given
 * client version may not implement.
 *
 * Both are survivable; neither may take the receipt down with it. The second is
 * the sharp one, because an unimplemented builder method throws SYNCHRONOUSLY,
 * before any promise exists, so chaining a rejection handler onto the query does
 * not catch it.
 */
const { supabase } = await import('../lib/supabase');
const { fetchSaleForReprint } = await import('./usePOS');

describe('fetchSaleForReprint tolerates eTIMS being unavailable', () => {
  const SALE = { id: 's1', invoice_number: 'INV-1', client: null, asset: null };

  /** A builder for everything the reprint needs EXCEPT eTIMS. */
  const okBuilder = (rows) => {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => Promise.resolve({ data: rows, error: null }),
      maybeSingle: () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] : rows, error: null }),
      single: () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] : rows, error: null }),
    };
    return b;
  };

  const mountWithEtims = (etimsBuilder) => {
    supabase.from.mockImplementation((table) => {
      if (table === 'sales') return okBuilder(SALE);
      if (table === 'etims_invoices') return etimsBuilder();
      return okBuilder([]);
    });
  };

  it('still returns the receipt when the eTIMS table rejects the query', async () => {
    mountWithEtims(() => {
      const b = {
        select: () => b, eq: () => b, neq: () => b,
        maybeSingle: () => Promise.resolve({
          data: null,
          error: { code: '42P01', message: 'relation "etims_invoices" does not exist' },
        }),
      };
      return b;
    });

    const out = await fetchSaleForReprint('s1');
    expect(out.sale).toEqual(SALE);
    expect(out.etims).toBeNull();
  });

  it('still returns the receipt when the query builder throws before any promise exists', async () => {
    // .neq is simply absent — the exact shape that broke the reprint outright
    // when the lookup was chained into Promise.all instead of wrapped.
    mountWithEtims(() => {
      const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: null }) };
      return b;
    });

    const out = await fetchSaleForReprint('s1');
    expect(out.sale).toEqual(SALE);
    expect(out.etims).toBeNull();
  });

  it('returns the filing when there is one', async () => {
    mountWithEtims(() => {
      const b = {
        select: () => b, eq: () => b, neq: () => b,
        maybeSingle: () => Promise.resolve({
          data: { status: 'sent', receipt_signature: 'ABCD1234', environment: 'production' },
          error: null,
        }),
      };
      return b;
    });

    const out = await fetchSaleForReprint('s1');
    expect(out.etims.receipt_signature).toBe('ABCD1234');
  });
});
