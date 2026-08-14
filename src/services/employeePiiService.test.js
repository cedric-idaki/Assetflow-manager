import { describe, it, expect, vi, beforeEach } from 'vitest';

// Everything here is a thin, careful wrapper over one edge function call. The
// care is the point: the read path must never present a failure as "no data",
// because saving that back erases real values.
const invoke = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args) => invoke(...args) } },
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const {
  PII_FIELDS,
  emptyPii,
  fetchEmployeePii,
  fetchEmployeePiiBatch,
  saveEmployeePii,
  backfillEmployeePii,
} = await import('./employeePiiService');

const ok = (data) => ({ data, error: null });

beforeEach(() => {
  invoke.mockReset();
});

describe('fetchEmployeePii', () => {
  it('returns the decrypted fields for the employee', async () => {
    invoke.mockResolvedValue(
      ok({ values: { 'emp-1': { bank_account: '0112233', nssf_number: 'A99', next_of_kin_id: '12345678' } } }),
    );

    const result = await fetchEmployeePii('emp-1');

    expect(result).toEqual({
      bank_account: '0112233',
      nssf_number: 'A99',
      next_of_kin_id: '12345678',
      ok: true,
    });
    expect(invoke).toHaveBeenCalledWith('employee-pii', {
      body: { action: 'read', userIds: ['emp-1'] },
    });
  });

  it('reports an employee with nothing on file as blank but ok', async () => {
    invoke.mockResolvedValue(ok({ values: {} }));

    const result = await fetchEmployeePii('emp-1');

    expect(result.ok).toBe(true);
    expect(result.bank_account).toBe('');
  });

  it('distinguishes a failed read from an empty record', async () => {
    // The whole reason ok exists. A caller that cannot tell these apart will
    // render blanks and then save them over the real values.
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const result = await fetchEmployeePii('emp-1');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.bank_account).toBe('');
  });

  it('surfaces the function\'s own error message, not the generic transport one', async () => {
    // supabase-js collapses any non-2xx into "Edge Function returned a non-2xx
    // status code", which tells an operator nothing about a missing key.
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'PII_ENC_KEY is not set', code: 'ENC_KEY_MISSING' }) },
      },
    });

    const result = await fetchEmployeePii('emp-1');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('PII_ENC_KEY is not set');
  });

  it('falls back to the transport message when the body is not JSON', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => { throw new Error('not json'); } },
      },
    });

    expect((await fetchEmployeePii('emp-1')).error).toBe(
      'Edge Function returned a non-2xx status code',
    );
  });

  it('treats an error in a 200 body as a failure', async () => {
    invoke.mockResolvedValue(ok({ error: 'That employee is not in your organisation.' }));

    const result = await fetchEmployeePii('emp-1');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('That employee is not in your organisation.');
  });

  it('does not call the function without an id', async () => {
    expect(await fetchEmployeePii('')).toEqual({ ...emptyPii(), ok: true });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('fetchEmployeePiiBatch', () => {
  it('de-duplicates ids and drops empty ones', async () => {
    invoke.mockResolvedValue(ok({ values: {} }));

    await fetchEmployeePiiBatch(['a', 'b', 'a', null, undefined, '']);

    expect(invoke).toHaveBeenCalledWith('employee-pii', {
      body: { action: 'read', userIds: ['a', 'b'] },
    });
  });

  it('short-circuits on an empty list', async () => {
    expect(await fetchEmployeePiiBatch([])).toEqual({ ok: true, values: {} });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports failure rather than returning a plausible empty map', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'nope' } });

    const result = await fetchEmployeePiiBatch(['a']);

    expect(result.ok).toBe(false);
    expect(result.values).toEqual({});
  });
});

describe('saveEmployeePii', () => {
  it('sends only the encrypted fields', async () => {
    invoke.mockResolvedValue(ok({ ok: true, updated: ['bank_account'] }));

    await saveEmployeePii('emp-1', {
      bank_account: '0112233',
      full_name: 'should not be sent',
      basic_salary: 50000,
    });

    expect(invoke).toHaveBeenCalledWith('employee-pii', {
      body: { action: 'write', userId: 'emp-1', fields: { bank_account: '0112233' } },
    });
  });

  it('passes an empty string through, to clear a stored value', async () => {
    invoke.mockResolvedValue(ok({ ok: true, updated: ['nssf_number'] }));

    await saveEmployeePii('emp-1', { nssf_number: '' });

    expect(invoke.mock.calls[0][1].body.fields).toEqual({ nssf_number: '' });
  });

  it('omits fields the caller did not mention, leaving them untouched', async () => {
    invoke.mockResolvedValue(ok({ ok: true, updated: [] }));

    await saveEmployeePii('emp-1', { bank_account: '1' });

    expect(Object.keys(invoke.mock.calls[0][1].body.fields)).toEqual(['bank_account']);
  });

  it('throws on failure instead of reporting a save that never happened', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'write failed' } });

    await expect(saveEmployeePii('emp-1', { bank_account: '1' })).rejects.toThrow('write failed');
  });

  it('refuses to save without an employee id', async () => {
    await expect(saveEmployeePii('', { bank_account: '1' })).rejects.toThrow(/employee id/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not call the function when no encrypted field was supplied', async () => {
    expect(await saveEmployeePii('emp-1', { full_name: 'x' })).toEqual({ updated: [] });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('backfillEmployeePii', () => {
  it('propagates the report', async () => {
    invoke.mockResolvedValue(ok({ ok: true, scanned: 12, sealed: 9 }));

    expect(await backfillEmployeePii()).toMatchObject({ scanned: 12, sealed: 9 });
    expect(invoke).toHaveBeenCalledWith('employee-pii', { body: { action: 'backfill' } });
  });

  it('throws when the backfill reports an error', async () => {
    invoke.mockResolvedValue(ok({ error: 'Only a super admin can run the backfill.' }));

    await expect(backfillEmployeePii()).rejects.toThrow(/super admin/);
  });
});

describe('PII_FIELDS', () => {
  it('matches the columns the migration creates', () => {
    expect(PII_FIELDS).toEqual(['bank_account', 'nssf_number', 'next_of_kin_id']);
  });

  it('hands out a fresh blank record each time', () => {
    const a = emptyPii();
    a.bank_account = 'mutated';
    expect(emptyPii().bank_account).toBe('');
  });
});
