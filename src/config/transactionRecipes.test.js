/**
 * WHY THIS IS THE TEST FOR "simplified entry posts the right thing".
 *
 * The simplified composer's whole promise is that the user never sees a debit
 * or a credit. That promise is only safe if the recipes are right, because the
 * user has lost the ability to notice that they are not: an accountant reading
 * a debit/credit grid can see a backwards entry, and the person this feature
 * is for cannot. A reversed recipe would post cleanly, balance, pass every
 * database constraint and quietly invert a figure on the income statement.
 *
 * So the recipes are checked here the way `saccoJournalTemplates.sync.test.js`
 * checks the SACCO seed: the direction of every line is asserted against what
 * the transaction actually means, every recipe is proved to balance, and the
 * data is proved internally consistent so a recipe cannot ask for an account
 * it never posts to, or post to one it never asked for.
 */

import { describe, it, expect } from 'vitest';
import {
  RECIPES, ROLES, AXES, GROUPS,
  accountLabel, candidatesForRole, suggestedAccountFor,
  splitAmount, buildRecipeEntry, rolesForRecipe, recipeByCode, describeEntry,
} from './transactionRecipes';

// A chart of accounts of the shape a real tenant builds by hand, deliberately
// including the traps: a receivable that is a current asset like cash is, a
// statutory payable that is a current liability like a supplier is, and VAT
// accounts on both sides.
const CHART = [
  { account_code: '1000', account_name: 'Cash at Bank',        account_type: 'current_asset',     category: 'Cash' },
  { account_code: '1001', account_name: 'M-Pesa Till',         account_type: 'current_asset',     category: 'Cash' },
  { account_code: '1002', account_name: 'Petty Cash',          account_type: 'current_asset',     category: 'Cash', is_active: false },
  { account_code: '1100', account_name: 'Trade Receivables',   account_type: 'current_asset',     category: 'Receivables' },
  { account_code: '1200', account_name: 'Inventory',           account_type: 'current_asset',     category: 'Inventory' },
  { account_code: '1300', account_name: 'Input VAT',           account_type: 'current_asset',     category: 'Other' },
  { account_code: '1500', account_name: 'Motor Vehicles',      account_type: 'non_current_asset', category: 'Fixed Assets' },
  { account_code: '1590', account_name: 'Accumulated Depreciation', account_type: 'non_current_asset', category: 'Depreciation' },
  { account_code: '2000', account_name: 'Trade Payables',      account_type: 'current_liability', category: 'Payables' },
  { account_code: '2050', account_name: 'PAYE Payable',        account_type: 'current_liability', category: 'Statutory' },
  { account_code: '2100', account_name: 'VAT Payable',         account_type: 'current_liability', category: 'Statutory' },
  { account_code: '2500', account_name: 'Bank Loan',           account_type: 'current_liability', category: 'Other' },
  { account_code: '3000', account_name: 'Owner Capital',       account_type: 'equity',            category: 'Capital' },
  { account_code: '3100', account_name: 'Owner Drawings',      account_type: 'equity',            category: 'Capital' },
  { account_code: '4000', account_name: 'Sales Revenue',       account_type: 'revenue',           category: 'Sales' },
  { account_code: '5000', account_name: 'Cost of Sales',       account_type: 'cost_of_sales',     category: 'COGS' },
  { account_code: '6000', account_name: 'Rent',                account_type: 'operating_expense', category: 'Overhead' },
  { account_code: '6900', account_name: 'Interest Expense',    account_type: 'operating_expense', category: 'Overhead' },
];

const byCode = (code) => CHART.find((a) => a.account_code === code);

/** Resolve every role a recipe needs to the chart's best candidate. */
const autoAccounts = (recipe, opts = {}) =>
  Object.fromEntries(
    rolesForRecipe(recipe, opts).map((role) => [role, candidatesForRole(role, CHART)[0]]),
  );

const sideOf = (entry, code) => {
  const line = entry.lines.find((l) => l.account.startsWith(`${code} `));
  if (!line) return null;
  return line.debit > 0 ? { side: 'debit', amount: line.debit } : { side: 'credit', amount: line.credit };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('role resolution against a hand-built chart', () => {
  it('offers only real money accounts as the money account', () => {
    const names = candidatesForRole('money', CHART).map((a) => a.account_name);
    expect(names).toEqual(['Cash at Bank', 'M-Pesa Till']);
  });

  it('leaves deactivated accounts out', () => {
    expect(candidatesForRole('money', CHART).map((a) => a.account_code)).not.toContain('1002');
  });

  it('never offers a VAT account as an answer to a non-VAT question', () => {
    // VAT Payable is a current liability, exactly like a trade payable.
    expect(candidatesForRole('payable', CHART).map((a) => a.account_name)).toEqual(['Trade Payables']);
    // Input VAT is a current asset, exactly like cash.
    expect(candidatesForRole('money', CHART).map((a) => a.account_name)).not.toContain('Input VAT');
  });

  it('keeps statutory balances out of the supplier list', () => {
    expect(candidatesForRole('payable', CHART).map((a) => a.account_name)).not.toContain('PAYE Payable');
  });

  it('tells the two VAT accounts apart by role', () => {
    expect(candidatesForRole('vat_input',  CHART).map((a) => a.account_name)).toEqual(['Input VAT']);
    expect(candidatesForRole('vat_output', CHART).map((a) => a.account_name)).toEqual(['VAT Payable']);
  });

  it('does not offer accumulated depreciation as something you bought', () => {
    expect(candidatesForRole('fixed_asset', CHART).map((a) => a.account_name)).toEqual(['Motor Vehicles']);
  });

  it('accepts any account of the type for the open-ended roles', () => {
    // "What was it for?" is a real question with many right answers.
    expect(candidatesForRole('expense', CHART).map((a) => a.account_name).sort())
      .toEqual(['Cost of Sales', 'Interest Expense', 'Rent']);
  });

  it('returns nothing rather than a wrong answer when the chart has no such account', () => {
    const bare = [{ account_code: '4000', account_name: 'Sales Revenue', account_type: 'revenue', category: 'Sales' }];
    expect(candidatesForRole('money', bare)).toEqual([]);
  });
});

describe('suggesting an account the chart is missing', () => {
  it('proposes a free code inside the role band', () => {
    expect(suggestedAccountFor('money', CHART)).toMatchObject({
      account_code: '1003', account_type: 'current_asset', category: 'Cash',
    });
  });

  it('never proposes a code the tenant already uses', () => {
    // addAccountToCOA rejects duplicates, so a colliding suggestion would be a
    // button that cannot work.
    const taken = new Set(CHART.map((a) => a.account_code));
    for (const role of Object.keys(ROLES)) {
      const s = suggestedAccountFor(role, CHART);
      if (s) expect(taken.has(s.account_code)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('splitting the amount the user typed', () => {
  it('takes VAT out of a tax-inclusive total', () => {
    expect(splitAmount({ amount: 11600, treatment: 'inclusive', rate: 16 }))
      .toMatchObject({ net: 10000, tax: 1600, total: 11600 });
  });

  it('adds VAT on top of a tax-exclusive figure', () => {
    expect(splitAmount({ amount: 10000, treatment: 'exclusive', rate: 16 }))
      .toMatchObject({ net: 10000, tax: 1600, total: 11600 });
  });

  it('leaves the amount alone when there is no VAT', () => {
    expect(splitAmount({ amount: 10000, treatment: 'none', rate: 16 }))
      .toMatchObject({ net: 10000, tax: 0, total: 10000 });
  });

  it('keeps net and tax summing back to the figure typed, at every rounding', () => {
    // An inclusive split that grossed up instead would leave entries a cent
    // out, and a cent out is an entry that will not post at all.
    for (let amount = 1; amount <= 2000; amount += 1) {
      const s = splitAmount({ amount: amount + 0.37, treatment: 'inclusive', rate: 16 });
      expect(s.net + s.tax).toBeCloseTo(s.total, 10);
      expect(s.total).toBe(Math.round((amount + 0.37) * 100) / 100);
    }
  });

  it('splits a loan repayment into principal and interest', () => {
    expect(splitAmount({ amount: 25000, interest: 4000 }))
      .toMatchObject({ total: 25000, interest: 4000, principal: 21000 });
  });

  it('will not let interest exceed the payment', () => {
    expect(splitAmount({ amount: 5000, interest: 9000 }))
      .toMatchObject({ interest: 5000, principal: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('every recipe is internally consistent', () => {
  it('has a unique code, a known group and a known icon slot', () => {
    const codes = RECIPES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of RECIPES) {
      expect(GROUPS.map((g) => g.key)).toContain(r.group);
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.blurb.length).toBeGreaterThan(0);
      expect(r.icon.length).toBeGreaterThan(0);
    }
  });

  it('carries a ledger description that reads in the third person', () => {
    // The card names are first person because that is how the user thinks
    // ("I paid a running cost"). The ledger is read later by someone else, so
    // the description that gets stored must not be.
    for (const r of RECIPES) {
      expect(r.ledger, r.code).toBeTruthy();
      expect(r.ledger, r.code).not.toMatch(/^I\b/);
    }
  });

  it('names only roles that exist', () => {
    for (const r of RECIPES) {
      for (const line of r.lines) {
        if (line.role === '@axis') { expect(AXES[r.axis]).toBeTruthy(); continue; }
        expect(ROLES[line.role], `${r.code} -> ${line.role}`).toBeTruthy();
      }
      for (const pick of r.picks) expect(ROLES[pick], `${r.code} pick ${pick}`).toBeTruthy();
    }
  });

  it('asks for exactly the accounts it posts to', () => {
    // A pick with no line would make the user answer a question that changes
    // nothing; a line with no pick would post to an account never chosen.
    for (const r of RECIPES) {
      const axisRoles = AXES[r.axis]?.options.map((o) => o.role) || [];
      const posted = new Set(
        r.lines.map((l) => l.role).filter((role) => role !== '@axis'),
      );
      for (const pick of r.picks) expect([...posted], `${r.code}`).toContain(pick);
      for (const role of posted) {
        // VAT and interest accounts are resolved automatically once the user
        // says there is VAT or interest, so they are deliberately not picks.
        const automatic = ['vat_input', 'vat_output', 'interest_expense'];
        if (automatic.includes(role)) continue;
        expect([...r.picks, ...axisRoles], `${r.code} posts to ${role}`).toContain(role);
      }
    }
  });

  it('only declares VAT on recipes that carry a VAT line', () => {
    for (const r of RECIPES) {
      const vatLines = r.lines.filter((l) => l.role === 'vat_input' || l.role === 'vat_output');
      if (r.vat) {
        expect(vatLines.map((l) => l.role), r.code).toEqual([`vat_${r.vat}`]);
        expect(vatLines[0].whenTax, r.code).toBe(true);
      } else {
        expect(vatLines, r.code).toEqual([]);
      }
    }
  });

  it('balances for every recipe, every axis option and every VAT treatment', () => {
    for (const recipe of RECIPES) {
      const axisKeys = AXES[recipe.axis]?.options.map((o) => o.key) || [null];
      for (const axisOption of axisKeys) {
        for (const treatment of ['inclusive', 'exclusive', 'none']) {
          const amounts = splitAmount({
            amount: 11600, treatment, rate: recipe.vat ? 16 : 0, interest: recipe.interest ? 1600 : 0,
          });
          const opts = { axisOption, hasTax: amounts.tax > 0, hasInterest: amounts.interest > 0 };
          const entry = buildRecipeEntry({
            recipe, accounts: autoAccounts(recipe, opts), amounts, axisOption,
          });
          expect(entry.totalDr, `${recipe.code}/${axisOption}/${treatment}`).toBe(entry.totalCr);
          expect(entry.totalDr).toBeGreaterThan(0);
        }
      }
    }
  });

  it('gives every posted line a plain-English sentence', () => {
    for (const recipe of RECIPES) {
      const amounts = splitAmount({ amount: 11600, treatment: 'inclusive', rate: recipe.vat ? 16 : 0, interest: recipe.interest ? 1600 : 0 });
      const opts = { hasTax: amounts.tax > 0, hasInterest: amounts.interest > 0 };
      const entry = buildRecipeEntry({ recipe, accounts: autoAccounts(recipe, opts), amounts });
      const sentences = describeEntry({ lines: entry.lines });
      expect(sentences).toHaveLength(entry.lines.length);
      // The fallback phrasing means a role was added without a sentence for it.
      for (const s of sentences) expect(s, recipe.code).not.toMatch(/^\d[\d,.]* to /);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DIRECTION. The point of the whole feature is that these are right, and there
// is nothing downstream that can catch them being wrong.
// ─────────────────────────────────────────────────────────────────────────────
describe('the direction of each entry', () => {
  const build = (code, { amount = 11600, treatment = 'none', axisOption = null, interest = 0, accounts } = {}) => {
    const recipe = recipeByCode(code);
    const amounts = splitAmount({ amount, treatment, rate: recipe.vat ? 16 : 0, interest });
    const opts = { axisOption, hasTax: amounts.tax > 0, hasInterest: amounts.interest > 0 };
    return buildRecipeEntry({
      recipe,
      accounts: accounts || autoAccounts(recipe, opts),
      amounts,
      axisOption,
    });
  };

  it('a cash sale brings money in and records income', () => {
    const e = build('SALE', { amount: 11600, treatment: 'inclusive', axisOption: 'money' });
    expect(sideOf(e, '1000')).toEqual({ side: 'debit',  amount: 11600 }); // Cash at Bank up
    expect(sideOf(e, '4000')).toEqual({ side: 'credit', amount: 10000 }); // Sales, net of VAT
    expect(sideOf(e, '2100')).toEqual({ side: 'credit', amount: 1600 });  // VAT owed to KRA
  });

  it('a credit sale records what the customer owes instead of cash', () => {
    const e = build('SALE', { amount: 10000, axisOption: 'receivable' });
    expect(sideOf(e, '1100')).toEqual({ side: 'debit',  amount: 10000 });
    expect(sideOf(e, '1000')).toBeNull();
  });

  it('a customer payment clears the debt without recording the sale twice', () => {
    const e = build('CUSTOMER_PAYMENT', { amount: 10000 });
    expect(sideOf(e, '1000')).toEqual({ side: 'debit',  amount: 10000 });
    expect(sideOf(e, '1100')).toEqual({ side: 'credit', amount: 10000 });
    expect(sideOf(e, '4000')).toBeNull(); // income is NOT recognised again
  });

  it('an expense paid in cash is a cost and takes money out', () => {
    const e = build('EXPENSE', {
      amount: 11600, treatment: 'inclusive', axisOption: 'money',
      accounts: { expense: byCode('6000'), vat_input: byCode('1300'), money: byCode('1000') },
    });
    expect(sideOf(e, '6000')).toEqual({ side: 'debit',  amount: 10000 }); // Rent, net
    expect(sideOf(e, '1300')).toEqual({ side: 'debit',  amount: 1600 });  // reclaimable VAT
    expect(sideOf(e, '1000')).toEqual({ side: 'credit', amount: 11600 }); // full amount leaves
  });

  it('an unpaid bill is a cost now and a debt, with no money moving', () => {
    const e = build('EXPENSE', {
      amount: 10000, axisOption: 'payable',
      accounts: { expense: byCode('6000'), payable: byCode('2000') },
    });
    expect(sideOf(e, '6000')).toEqual({ side: 'debit',  amount: 10000 });
    expect(sideOf(e, '2000')).toEqual({ side: 'credit', amount: 10000 });
    expect(sideOf(e, '1000')).toBeNull();
  });

  it('paying a supplier reduces the debt and is not a second cost', () => {
    const e = build('SUPPLIER_PAYMENT', { amount: 10000 });
    expect(sideOf(e, '2000')).toEqual({ side: 'debit',  amount: 10000 });
    expect(sideOf(e, '1000')).toEqual({ side: 'credit', amount: 10000 });
    expect(sideOf(e, '6000')).toBeNull();
  });

  it('stock bought is an asset, not a cost', () => {
    const e = build('STOCK', { amount: 11600, treatment: 'inclusive', axisOption: 'money' });
    expect(sideOf(e, '1200')).toEqual({ side: 'debit', amount: 10000 });
    expect(sideOf(e, '5000')).toBeNull(); // cost of sales is recognised on SALE, not here
  });

  it('equipment bought is capitalised, not expensed', () => {
    const e = build('ASSET', { amount: 11600, treatment: 'inclusive', axisOption: 'money' });
    expect(sideOf(e, '1500')).toEqual({ side: 'debit', amount: 10000 });
  });

  it("owner money in raises the owner's stake, not income", () => {
    const e = build('OWNER_IN', { amount: 50000 });
    expect(sideOf(e, '1000')).toEqual({ side: 'debit',  amount: 50000 });
    expect(sideOf(e, '3000')).toEqual({ side: 'credit', amount: 50000 });
    expect(sideOf(e, '4000')).toBeNull();
  });

  it('owner money out is drawings, not an expense', () => {
    const e = build('OWNER_OUT', { amount: 20000 });
    expect(sideOf(e, '3100')).toEqual({ side: 'debit',  amount: 20000 });
    expect(sideOf(e, '1000')).toEqual({ side: 'credit', amount: 20000 });
  });

  it('a loan received is a debt, not income', () => {
    const e = build('LOAN_IN', { amount: 500000 });
    expect(sideOf(e, '1000')).toEqual({ side: 'debit',  amount: 500000 });
    expect(sideOf(e, '2500')).toEqual({ side: 'credit', amount: 500000 });
    expect(sideOf(e, '4000')).toBeNull();
  });

  it('a loan repayment costs only the interest', () => {
    const e = build('LOAN_OUT', { amount: 25000, interest: 4000 });
    expect(sideOf(e, '2500')).toEqual({ side: 'debit',  amount: 21000 }); // debt down
    expect(sideOf(e, '6900')).toEqual({ side: 'debit',  amount: 4000 });  // the only cost
    expect(sideOf(e, '1000')).toEqual({ side: 'credit', amount: 25000 });
  });

  it('a repayment with no interest touches no expense account', () => {
    const e = build('LOAN_OUT', { amount: 25000, interest: 0 });
    expect(sideOf(e, '2500')).toEqual({ side: 'debit', amount: 25000 });
    expect(sideOf(e, '6900')).toBeNull();
  });

  it('a transfer moves money without earning or spending anything', () => {
    const e = build('TRANSFER', {
      amount: 30000,
      accounts: { money: byCode('1000'), money_to: byCode('1001') },
    });
    expect(sideOf(e, '1001')).toEqual({ side: 'debit',  amount: 30000 });
    expect(sideOf(e, '1000')).toEqual({ side: 'credit', amount: 30000 });
    expect(e.lines).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('what the entry refuses to do', () => {
  it('will not post without an amount', () => {
    expect(() => buildRecipeEntry({
      recipe: recipeByCode('OWNER_IN'),
      accounts: { money: byCode('1000'), equity: byCode('3000') },
      amounts: splitAmount({ amount: 0 }),
    })).toThrow(/amount greater than zero/i);
  });

  it('will not post with a role left unanswered', () => {
    expect(() => buildRecipeEntry({
      recipe: recipeByCode('OWNER_IN'),
      accounts: { money: byCode('1000') },
      amounts: splitAmount({ amount: 1000 }),
    })).toThrow(/Choose an account/i);
  });

  it('writes accounts in the same form as the manual composer', () => {
    // The trial balance groups by this exact string. Two spellings of one
    // account would appear as two accounts, each holding half the balance.
    expect(accountLabel(byCode('1000'))).toBe('1000 — Cash at Bank');
    const e = buildRecipeEntry({
      recipe: recipeByCode('OWNER_IN'),
      accounts: { money: byCode('1000'), equity: byCode('3000') },
      amounts: splitAmount({ amount: 1000 }),
    });
    expect(e.lines.map((l) => l.account)).toEqual(['1000 — Cash at Bank', '3000 — Owner Capital']);
  });
});
