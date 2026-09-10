/**
 * Reading a bank's CSV.
 *
 * THE FAILURE THIS FILE EXISTS TO CATCH is silent, not loud: a date read in the
 * wrong order. `new Date('03/04/2026')` is 4 March in a US locale and 3 April
 * in a Kenyan one, and neither throws — the payment simply reconciles into the
 * wrong month, and the only sign is a statement that will not balance.
 *
 * The second is a line the parser cannot read. Guessing at it is worse than
 * dropping it, because an invented date or amount matches the WRONG payment
 * and produces a reconciliation that looks finished.
 */

import { describe, it, expect } from 'vitest';
import { parseStatementCsv, parseStatementDate, parseStatementAmount } from './useBankReconciliation';

describe('parseStatementDate', () => {
  it('reads dd/mm/yyyy the way a Kenyan bank writes it', () => {
    // 3 April, not 4 March. This is the whole reason the function exists.
    expect(parseStatementDate('03/04/2026')).toBe('2026-04-03');
    expect(parseStatementDate('9/4/2026')).toBe('2026-04-09');
    expect(parseStatementDate('03-04-2026')).toBe('2026-04-03');
    expect(parseStatementDate('03.04.26')).toBe('2026-04-03');
  });

  it('still reads an ISO date', () => {
    expect(parseStatementDate('2026-04-03')).toBe('2026-04-03');
  });

  it('gives nothing back rather than a guess', () => {
    expect(parseStatementDate('')).toBeNull();
    expect(parseStatementDate('N/A')).toBeNull();
    expect(parseStatementDate(null)).toBeNull();
  });
});

describe('parseStatementAmount', () => {
  it('strips the formatting banks add', () => {
    expect(parseStatementAmount('1,234.50')).toBe(1234.5);
    expect(parseStatementAmount('KES 1,234.50')).toBe(1234.5);
    expect(parseStatementAmount(' 900 ')).toBe(900);
  });

  it('reads both ways of writing a negative', () => {
    expect(parseStatementAmount('(1,234.50)')).toBe(-1234.5);
    expect(parseStatementAmount('-1,234.50')).toBe(-1234.5);
  });

  it('treats zero and blank as no amount, because neither is a transaction', () => {
    expect(parseStatementAmount('0')).toBeNull();
    expect(parseStatementAmount('')).toBeNull();
    expect(parseStatementAmount('-')).toBeNull();
  });
});

describe('parseStatementCsv', () => {
  const csv = [
    'Transaction Date,Narrative,Reference,Credit,Debit,Balance',
    '03/04/2026,Payment from Nyeri Traders,FT26094XYZ,"48,000.00",,"1,048,000.00"',
    '04/04/2026,Bank charges,,,"350.00","1,047,650.00"',
    'not a date,Broken row,REF1,"100.00",,',
    '05/04/2026,No amount at all,REF2,,,',
  ].join('\n');

  it('maps a bank’s own column names onto the import shape', () => {
    const { rows } = parseStatementCsv(csv);
    expect(rows[0]).toMatchObject({
      txn_date: '2026-04-03',
      description: 'Payment from Nyeri Traders',
      bank_reference: 'FT26094XYZ',
      amount: 48000,
      direction: 'credit',
    });
  });

  it('reads a debit column as a negative, so direction is not guessed from the wording', () => {
    const { rows } = parseStatementCsv(csv);
    const charge = rows.find(r => r.description === 'Bank charges');
    expect(charge.amount).toBe(-350);
    expect(charge.direction).toBe('debit');
  });

  it('reports the lines it could not read instead of inventing values for them', () => {
    const { rows, skipped } = parseStatementCsv(csv);
    expect(rows).toHaveLength(2);
    expect(skipped).toHaveLength(2);
    expect(skipped.map(s => s.reason)).toEqual(
      expect.arrayContaining(['no readable date', 'no readable amount']),
    );
    // Line numbers count the header, so they match what the person sees in
    // their spreadsheet.
    expect(skipped[0].line).toBe(4);
  });

  it('keeps a comma inside a quoted field out of the column split', () => {
    const { rows } = parseStatementCsv([
      'Date,Description,Amount',
      '03/04/2026,"Nyeri Traders, Ltd","48,000.00"',
    ].join('\n'));
    expect(rows[0].description).toBe('Nyeri Traders, Ltd');
    expect(rows[0].amount).toBe(48000);
  });

  it('gives an empty result for a file with no rows rather than throwing', () => {
    expect(parseStatementCsv('').rows).toEqual([]);
    expect(parseStatementCsv('Date,Amount').rows).toEqual([]);
  });
});
