/**
 * The receipt screens are a CLIENT of migration 20260925163000. This test reads
 * the SQL and fails when the two drift.
 *
 *   argument names  PostgREST matches RPC arguments BY NAME. A renamed
 *                   parameter is not an error anywhere — the argument is
 *                   dropped and the function runs with its default, which for
 *                   p_reference means an M-Pesa payment refused for having no
 *                   code the cashier did type.
 *
 *   methods         the method picker, the reference rule and the CHECK
 *                   constraint have to agree, or the screen offers a method the
 *                   database refuses, or waves through a missing reference the
 *                   database then rejects after the round trip.
 *
 *   loan reference  the screen quotes a loan as LN-XXXXXXXX and so does the
 *                   receipt the RPC writes; if one changes the cashier and the
 *                   paper name the same loan differently.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { RECEIPT_METHODS, loanRef } from '../utils/saccoReceipts';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260925163000_sacco_payment_receipts.sql'), 'utf8',
);
const service = readFileSync(resolve(process.cwd(), 'src/services/saccoReceiptService.js'), 'utf8');

/** The p_ parameter names a `create or replace function` declares, in order. */
const paramsOf = (fnName) => {
  const block = new RegExp(
    `create or replace function public\\.${fnName}\\s*\\(([\\s\\S]*?)\\)\\s*returns`, 'i',
  ).exec(sql);
  return block ? (block[1].match(/\bp_[a-z_]+/g) || []) : null;
};

describe('saccoReceiptService mirrors migration 20260925163000', () => {
  it('calls only functions the migration defines, with arguments they declare', () => {
    const calls = [...service.matchAll(/supabase\.rpc\(\s*'([a-z_]+)',\s*\{([^{}]*)\}\s*\)/g)];
    expect(calls.map((c) => c[1]).sort()).toEqual([
      'sacco_receipt_loan_repayment',
      'sacco_receipt_pending_share_purchases',
      'sacco_receipt_share_purchase',
      'sacco_receipt_summary',
    ]);

    calls.forEach(([, fnName, body]) => {
      const declared = paramsOf(fnName);
      expect(declared, `public.${fnName} is not declared`).not.toBeNull();
      const passed = [...body.matchAll(/(p_[a-z_]+)\s*:/g)].map((m) => m[1]);
      expect(passed.sort(), `arguments passed to ${fnName}`).toEqual([...declared].sort());
    });
  });

  it('grants every RPC the service calls to signed-in users, and no internal helper', () => {
    ['sacco_receipt_loan_repayment', 'sacco_receipt_share_purchase',
      'sacco_receipt_pending_share_purchases', 'sacco_receipt_summary'].forEach((fn) => {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated`, 'i'));
    });
    ['sacco_receipt_next_no', 'sacco_receipt_payment_terms', 'sacco_receipt_purchase_is_payable'].forEach((fn) => {
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${fn}\\(`, 'i'));
    });
  });

  it('offers exactly the payment methods the CHECK constraint allows', () => {
    const check = /sacco_receipts_method_chk\s+check \(payment_method in \(([^)]*)\)\)/i.exec(sql);
    expect(check).not.toBeNull();
    const allowed = check[1].match(/'([a-z]+)'/g).map((s) => s.replace(/'/g, ''));
    expect(RECEIPT_METHODS.map((m) => m.value).sort()).toEqual(allowed.sort());
  });

  it('demands a reference for the same methods the RPC does', () => {
    const rule = /if reference is null and method in \(([^)]*)\)/i.exec(sql);
    expect(rule).not.toBeNull();
    const needs = rule[1].match(/'([a-z]+)'/g).map((s) => s.replace(/'/g, ''));
    expect(RECEIPT_METHODS.filter((m) => m.required).map((m) => m.value).sort()).toEqual(needs.sort());
  });

  it('quotes a loan the way the receipt does', () => {
    expect(sql).toContain("'LN-' || upper(left(l.id::text, 8))");
    expect(loanRef('abcdef12-3456-7890-abcd-ef1234567890')).toBe('LN-ABCDEF12');
  });

  it('leaves the receipt tables with no write path from the browser', () => {
    expect(sql).toMatch(/revoke all on table public\.sacco_receipts, public\.sacco_receipt_lines, public\.sacco_receipt_counters\s+from anon, authenticated/i);
    expect(sql).toMatch(/grant select on table public\.sacco_receipts, public\.sacco_receipt_lines to authenticated/i);
    expect(sql).not.toMatch(/for (insert|update|delete|all) to authenticated/i);
  });
});
