/**
 * DOES A TRANSACTION RECORDED IN PLAIN ENGLISH REACH THE FINANCIAL STATEMENTS?
 *
 * The recipe tests prove the lines are right and the component tests prove the
 * screen hands those lines over. Neither follows them the rest of the way, and
 * the rest of the way is where a simplified composer can quietly fail: the
 * lines are paired into `journal_entries` rows, and every statement then has to
 * recognise the account each row names.
 *
 * That recognition is by ACCOUNT STRING, not by id, so this is the seam where a
 * transaction can post cleanly, balance perfectly, appear in the journal, and
 * still be missing from the income statement. Nothing in the UI would show it.
 *
 * So this runs the real chain end to end — recipe, `pairJournalLines`, then the
 * real trial balance, income statement, balance sheet and VAT return — and
 * asserts the money arrives.
 */

import { describe, it, expect } from 'vitest';

import { pairJournalLines } from '../../hooks/useFinanceHub';
import {
  recipeByCode, splitAmount, buildRecipeEntry, candidatesForRole, rolesForRecipe,
} from '../../config/transactionRecipes';
import {
  buildTrialBalance, buildIncomeStatement, buildBalanceSheet,
} from '../../utils/financialStatements';
import { computeVatReturn } from '../../utils/vatLedger';

const CHART = [
  { account_code: '1000', account_name: 'Cash at Bank',      account_type: 'current_asset',     category: 'Cash' },
  { account_code: '1100', account_name: 'Trade Receivables', account_type: 'current_asset',     category: 'Receivables' },
  { account_code: '1300', account_name: 'Input VAT',         account_type: 'current_asset',     category: 'Other' },
  { account_code: '2000', account_name: 'Trade Payables',    account_type: 'current_liability', category: 'Payables' },
  { account_code: '2100', account_name: 'VAT Payable',       account_type: 'current_liability', category: 'Statutory' },
  { account_code: '3000', account_name: 'Owner Capital',     account_type: 'equity',            category: 'Capital' },
  { account_code: '4000', account_name: 'Sales Revenue',     account_type: 'revenue',           category: 'Sales' },
  { account_code: '6000', account_name: 'Rent',              account_type: 'operating_expense', category: 'Overhead' },
];

const PERIOD = '2026-09';
const DATE = '2026-09-11';

/**
 * Everything `postJournalEntry` does to a set of lines, minus Supabase: pair
 * them off and stamp the row fields the statements read.
 */
const post = ({ recipeCode, amount, treatment = 'none', axisOption = null, interest = 0, pick = {} }) => {
  const recipe = recipeByCode(recipeCode);
  const amounts = splitAmount({ amount, treatment, rate: recipe.vat ? 16 : 0, interest });
  const opts = { axisOption, hasTax: amounts.tax > 0, hasInterest: amounts.interest > 0 };
  const accounts = Object.fromEntries(
    rolesForRecipe(recipe, opts).map((role) => {
      const list = candidatesForRole(role, CHART);
      return [role, list.find((a) => a.account_code === pick[role]) || list[0]];
    }),
  );
  const { lines } = buildRecipeEntry({ recipe, accounts, amounts, axisOption });

  return pairJournalLines(lines).map((p, i) => ({
    id: `${recipeCode}-${i}`,
    entry_no: `JE-${recipeCode}`,
    entry_date: DATE,
    description: recipe.ledger,
    status: 'posted',
    entry_type: recipe.entryType,
    ...p,
  }));
};

describe('pairing the lines the way postJournalEntry does', () => {
  it('turns a three-line VAT purchase into two balanced pairs', () => {
    const rows = post({ recipeCode: 'EXPENSE', amount: 11600, treatment: 'inclusive', axisOption: 'money' });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.debit_account, r.credit_account, r.amount])).toEqual([
      ['6000 — Rent',      '1000 — Cash at Bank', 10000],
      ['1300 — Input VAT', '1000 — Cash at Bank', 1600],
    ]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(11600);
  });

  it('leaves a simple two-line entry as a single pair', () => {
    const rows = post({ recipeCode: 'OWNER_IN', amount: 50000 });
    expect(rows).toEqual([expect.objectContaining({
      debit_account: '1000 — Cash at Bank',
      credit_account: '3000 — Owner Capital',
      amount: 50000,
    })]);
  });

  it('splits a loan repayment across principal and interest without losing a cent', () => {
    const CHART_LOAN = [
      ...CHART,
      { account_code: '2500', account_name: 'Bank Loan',        account_type: 'current_liability', category: 'Other' },
      { account_code: '6900', account_name: 'Interest Expense', account_type: 'operating_expense', category: 'Overhead' },
    ];
    const recipe = recipeByCode('LOAN_OUT');
    const amounts = splitAmount({ amount: 25000, interest: 4000 });
    const accounts = Object.fromEntries(
      rolesForRecipe(recipe, { hasInterest: true })
        .map((role) => [role, candidatesForRole(role, CHART_LOAN)[0]]),
    );
    const { lines } = buildRecipeEntry({ recipe, accounts, amounts });
    const pairs = pairJournalLines(lines);
    expect(pairs.reduce((s, p) => s + p.amount, 0)).toBe(25000);
  });
});

describe('the money arrives in the statements', () => {
  it('puts a VAT-inclusive expense into the income statement net of its VAT', () => {
    const journals = post({ recipeCode: 'EXPENSE', amount: 11600, treatment: 'inclusive', axisOption: 'money' });
    const pl = buildIncomeStatement({ journals, chartOfAccounts: CHART, period: PERIOD });
    expect(pl.expenses).toBe(10000);
  });

  it('puts a VAT-inclusive sale into revenue net of its VAT', () => {
    const journals = post({ recipeCode: 'SALE', amount: 11600, treatment: 'inclusive', axisOption: 'money' });
    const pl = buildIncomeStatement({ journals, chartOfAccounts: CHART, period: PERIOD });
    expect(pl.revenue).toBe(10000);
  });

  it('keeps the trial balance balanced across a whole day of transactions', () => {
    const journals = [
      ...post({ recipeCode: 'OWNER_IN', amount: 500000 }),
      ...post({ recipeCode: 'SALE',     amount: 11600, treatment: 'inclusive', axisOption: 'money' }),
      ...post({ recipeCode: 'SALE',     amount: 20000, axisOption: 'receivable' }),
      ...post({ recipeCode: 'EXPENSE',  amount: 11600, treatment: 'inclusive', axisOption: 'money' }),
      ...post({ recipeCode: 'EXPENSE',  amount: 5000,  axisOption: 'payable' }),
    ];
    const tb = buildTrialBalance({ journals, chartOfAccounts: CHART, period: PERIOD });
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.totalDebit).toBeGreaterThan(0);
  });

  it('balances the balance sheet after that same day', () => {
    const journals = [
      ...post({ recipeCode: 'OWNER_IN', amount: 500000 }),
      ...post({ recipeCode: 'SALE',     amount: 11600, treatment: 'inclusive', axisOption: 'money' }),
      ...post({ recipeCode: 'EXPENSE',  amount: 11600, treatment: 'inclusive', axisOption: 'money' }),
    ];
    const bs = buildBalanceSheet({ journals, chartOfAccounts: CHART, period: PERIOD });
    expect(bs.totalAssets).toBeCloseTo(bs.totalLiabilitiesAndEquity, 2);
  });

  it('reports the VAT charged and the VAT reclaimable on the return', () => {
    const journals = [
      ...post({ recipeCode: 'SALE',    amount: 11600, treatment: 'inclusive', axisOption: 'money' }),
      ...post({ recipeCode: 'EXPENSE', amount: 5800,  treatment: 'inclusive', axisOption: 'money' }),
    ];
    const vat = computeVatReturn({ journals, chartOfAccounts: CHART, period: PERIOD });
    expect(vat.outputVAT).toBe(1600);
    expect(vat.inputVAT).toBe(800);
    expect(vat.netVAT).toBe(800);
  });

  it('does not let capital introduced look like profit', () => {
    const journals = post({ recipeCode: 'OWNER_IN', amount: 500000 });
    const pl = buildIncomeStatement({ journals, chartOfAccounts: CHART, period: PERIOD });
    expect(pl.revenue).toBe(0);
    expect(pl.netProfit).toBe(0);
  });

  it('does not let a customer payment recognise the sale a second time', () => {
    const journals = [
      ...post({ recipeCode: 'SALE', amount: 20000, axisOption: 'receivable' }),
      ...post({ recipeCode: 'CUSTOMER_PAYMENT', amount: 20000 }),
    ];
    const pl = buildIncomeStatement({ journals, chartOfAccounts: CHART, period: PERIOD });
    expect(pl.revenue).toBe(20000);
  });

  it('names every account the statements recognise, with nothing unclassified', () => {
    // The failure this guards against is silent: an account string the
    // statements cannot place is dropped from every class total, so the
    // transaction posts, balances, shows in the journal, and is simply absent
    // from the income statement.
    const journals = [
      ...post({ recipeCode: 'OWNER_IN', amount: 500000 }),
      ...post({ recipeCode: 'SALE',     amount: 11600, treatment: 'inclusive', axisOption: 'money' }),
      ...post({ recipeCode: 'EXPENSE',  amount: 11600, treatment: 'inclusive', axisOption: 'money' }),
      ...post({ recipeCode: 'EXPENSE',  amount: 5000,  axisOption: 'payable' }),
    ];
    const tb = buildTrialBalance({ journals, chartOfAccounts: CHART, period: PERIOD });
    const unplaced = tb.rows.filter((r) => !r.cls);
    expect(unplaced.map((r) => r.name)).toEqual([]);
  });

  it('reads every posted account off the chart rather than guessing from its name', () => {
    const journals = post({ recipeCode: 'EXPENSE', amount: 11600, treatment: 'inclusive', axisOption: 'money' });
    const tb = buildTrialBalance({ journals, chartOfAccounts: CHART, period: PERIOD });
    const guessed = tb.rows.filter((r) => !r.charted);
    expect(guessed.map((r) => r.name)).toEqual([]);
  });
});
