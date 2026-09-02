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
