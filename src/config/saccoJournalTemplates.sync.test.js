/**
 * Every journal template must post to accounts that exist, on the right sides.
 *
 * WHY THIS IS THE TEST FOR "journal entries post correctly".
 *
 * The posting engine itself is sound — sacco_journal_lines is constrained to
 * balance, and financialStatements.test.js proves the statements read the
 * ledger correctly. What neither covers is the DATA the engine is driven by:
 * `sacco_journal_templates`, seeded in 20260725120000, maps each business event
 * to a debit account and a credit account.
 *
 * A typo in one of those codes does not fail loudly. The entry posts, it
 * balances, and it lands in an account that does not exist in the chart — so
 * the money leaves one statement line and never arrives at another. The
 * Trial Balance still balances. You find it at year end, if at all.
 *
 * So this reads the seeded chart of accounts and the seeded templates out of
 * the migration and checks them against each other. It is the same treatment
 * finhubPipeline and approvalEnqueue get: the SQL owns the truth, and the test
 * makes drift from it fail.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { classForCode } from './saccoAccountingConfig';

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260725120000_sacco_accounting_engine.sql',
);
const sql = readFileSync(MIGRATION, 'utf8');

/**
 * The seeded chart of accounts.
 * Rows look like: ('1010','Cash in Hand – BOSA','asset','debit','bosa',false,'…')
 */
const accounts = (() => {
  const map = new Map();
  for (const m of sql.matchAll(
    /\('(\d{4})','((?:[^']|'')*)','(asset|liability|equity|income|expense|memo)','(debit|credit)'/g,
  )) {
    map.set(m[1], { code: m[1], name: m[2].replace(/''/g, "'"), klass: m[3], normal: m[4] });
  }
  return map;
})();

/**
 * The seeded templates.
 * ('CODE','Name','category','<debit>','<credit>','side',ARRAY[…],'trigger',bool,bool,n)
 */
const templates = (() => {
  const out = [];
  for (const m of sql.matchAll(
    /\('([A-Z_]+)','((?:[^']|'')*)','(member|loan|period_end|equity|chama|ops)','(\d{4})','(\d{4})'\s*,\s*(NULL|'(?:debit|credit)')\s*,\s*(ARRAY\[[^\]]*\]|'\{\}')\s*,\s*'((?:[^']|'')*)'/g,
  )) {
    const options = [...m[7].matchAll(/'(\d{4})'/g)].map(o => o[1]);
    out.push({
      code: m[1],
      name: m[2].replace(/''/g, "'"),
      category: m[3],
      debit: m[4],
      credit: m[5],
      variableSide: m[6] === 'NULL' ? null : m[6].replace(/'/g, ''),
      options,
      // The seed's own declared trigger. Far better than inferring direction
      // from the English name: "member share purchase" is money in and "fixed
      // asset purchase" is money out, and the word is identical.
      trigger: m[8].replace(/''/g, "'"),
    });
  }
  return out;
})();

describe('sacco journal templates', () => {
  it('reads the chart of accounts and the templates out of the migration', () => {
    expect(accounts.size).toBeGreaterThan(30);
    expect(templates.length).toBeGreaterThan(20);
  });

  it('every debit account exists in the chart', () => {
    const missing = templates
      .filter(t => !accounts.has(t.debit))
      .map(t => `${t.code} debits ${t.debit}`);
    // A template naming an account the chart does not have posts money into a
    // line no statement reads. It balances, so nothing complains.
    expect(missing).toEqual([]);
  });

  it('every credit account exists in the chart', () => {
    const missing = templates
      .filter(t => !accounts.has(t.credit))
      .map(t => `${t.code} credits ${t.credit}`);
    expect(missing).toEqual([]);
  });

  it('every selectable option exists in the chart', () => {
    const missing = [];
    templates.forEach((t) => {
      t.options.forEach((code) => {
        if (!accounts.has(code)) missing.push(`${t.code} offers ${code}`);
      });
    });
    // These are the codes a teller picks between at posting time — an invalid
    // one is a posting that fails in front of a member, or worse, succeeds.
    expect(missing).toEqual([]);
  });

  it('never debits and credits the same account', () => {
    const noop = templates.filter(t => t.debit === t.credit).map(t => t.code);
    // Such an entry balances perfectly and moves nothing. It is always a typo.
    expect(noop).toEqual([]);
  });

  it('offers options only on the side it says is variable', () => {
    const wrong = templates
      .filter(t => t.options.length > 0 && !t.variableSide)
      .map(t => t.code);
    expect(wrong).toEqual([]);
  });

  it('includes the variable side’s own account among its options', () => {
    const wrong = [];
    templates.forEach((t) => {
      if (!t.variableSide || t.options.length === 0) return;
      const fixed = t.variableSide === 'debit' ? t.debit : t.credit;
      if (!t.options.includes(fixed)) {
        wrong.push(`${t.code}: default ${fixed} is not among ${t.options.join('/')}`);
      }
    });
    // The default has to be selectable, or the template posts to an account
    // the operator was never offered and cannot reproduce.
    expect(wrong).toEqual([]);
  });

  it('classifies every account code the same way the frontend does', () => {
    // classForCode drives which statement a figure lands on. If it disagrees
    // with the seeded class, the Balance Sheet and the ledger tell different
    // stories about the same account.
    const disagree = [];
    accounts.forEach((a) => {
      const frontend = classForCode(a.code);
      if (frontend !== a.klass) {
        disagree.push(`${a.code} — chart says ${a.klass}, classForCode says ${frontend}`);
      }
    });
    expect(disagree).toEqual([]);
  });

  it('debits cash on every entry the seed calls a Receipt', () => {
    // Direction is the whole meaning of an entry: a receipt that CREDITS cash
    // is money leaving the till, recorded as money arriving.
    //
    // The classifier is the template's own `trigger_hint`, not its name. An
    // earlier version of this test guessed from the wording and flagged
    // FIXED_ASSET_PURCHASE — which correctly credits cash, because the society
    // is the one spending. "Purchase" points both ways; 'Receipt' does not.
    const CASH = new Set(['1010', '1011', '1020', '1021']);
    const wrong = templates
      .filter(t => t.trigger === 'Receipt')
      .filter(t => !CASH.has(t.debit))
      .map(t => `${t.code} is a Receipt but debits ${t.debit}, not cash`);
    expect(wrong).toEqual([]);
  });

  it('credits cash on every entry the seed calls a Payment', () => {
    const CASH = new Set(['1010', '1011', '1020', '1021']);
    const wrong = templates
      .filter(t => t.trigger === 'Payment')
      .filter(t => !CASH.has(t.credit))
      .map(t => `${t.code} is a Payment but credits ${t.credit}, not cash`);
    expect(wrong).toEqual([]);
  });
});
