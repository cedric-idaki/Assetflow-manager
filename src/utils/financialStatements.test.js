import { describe, it, expect } from 'vitest';
import {
  buildTrialBalance,
  buildIncomeStatement,
  buildBalanceSheet,
  buildCashFlow,
  resolveAccount,
  buildAccountIndex,
  accountBalances,
} from './financialStatements';

const coa = [
  { account_code: '1000', account_name: 'Cash at Bank',      account_type: 'current_asset' },
  { account_code: '1010', account_name: 'M-Pesa Float',      account_type: 'current_asset' },
  { account_code: '1200', account_name: 'Trade Receivables', account_type: 'current_asset' },
  { account_code: '1500', account_name: 'Motor Vehicles',    account_type: 'non_current_asset' },
  { account_code: '2000', account_name: 'Trade Payables',    account_type: 'current_liability' },
  { account_code: '2500', account_name: 'Bank Loan',         account_type: 'non_current_liability' },
  { account_code: '3000', account_name: 'Share Capital',     account_type: 'equity' },
  { account_code: '6000', account_name: 'Sales Revenue',     account_type: 'revenue' },
  { account_code: '7000', account_name: 'Cost of Sales',     account_type: 'cost_of_sales' },
  { account_code: '8000', account_name: 'Salaries',          account_type: 'operating_expense' },
];

const je = (date, dr, cr, amount, over = {}) => ({
  status: 'posted', entry_date: date, debit_account: dr, credit_account: cr, amount, ...over,
});

// July: the company is capitalised, buys a vehicle, makes a sale.
// August: another sale, a salary run, a loan drawdown, a receivable collected.
const ledger = [
  je('2026-07-01', 'Cash at Bank',      'Share Capital',     1000000),
  je('2026-07-05', 'Motor Vehicles',    'Cash at Bank',       600000),
  je('2026-07-20', 'Trade Receivables', 'Sales Revenue',      300000),
  je('2026-07-20', 'Cost of Sales',     'Trade Payables',     180000),

  je('2026-08-04', 'Cash at Bank',      'Sales Revenue',      500000),
  je('2026-08-04', 'Cost of Sales',     'Trade Payables',     300000),
  je('2026-08-12', 'Salaries',          'Cash at Bank',       120000),
  je('2026-08-18', 'Cash at Bank',      'Bank Loan',          400000),
  je('2026-08-25', 'Cash at Bank',      'Trade Receivables',  300000),

  je('2026-08-28', 'Cash at Bank',      'Sales Revenue',      999999, { status: 'draft' }),
];

const args = (period) => ({ journals: ledger, chartOfAccounts: coa, period });

describe('account classification', () => {
  it('takes the class from the chart, which the tenant set deliberately', () => {
    const index = buildAccountIndex(coa);
    expect(resolveAccount('Sales Revenue', index)).toMatchObject({ cls: 'revenue', charted: true });
    expect(resolveAccount('Motor Vehicles', index)).toMatchObject({ cls: 'asset', type: 'non_current_asset' });
  });

  it('falls back to the name only for accounts the chart does not carry', () => {
    const index = buildAccountIndex(coa);
    const inferred = resolveAccount('Office Rent Expense', index);
    expect(inferred).toMatchObject({ cls: 'expense', charted: false });
  });

  it('resolves the names that sit on both sides of the ledger', () => {
    const cls = (name) => resolveAccount(name, {})?.cls;
    // Each of these contains a word that would place it on the wrong side if
    // the rules were tested in a different order.
    expect(cls('Cost of Sales')).toBe('expense');      // not revenue, via "sales"
    expect(cls('Bank Loan')).toBe('liability');        // not asset, via "bank"
    expect(cls('Interest Expense')).toBe('expense');   // not revenue, via "interest"
    expect(cls('Rental Income')).toBe('revenue');      // not expense, via "rent"
    expect(cls('Interest Income')).toBe('revenue');
    expect(cls('Trade Payables')).toBe('liability');
  });

  it('does not treat a loan account as cash for the cash flow', () => {
    expect(resolveAccount('Bank Loan', {}).isCash).toBe(false);
    expect(resolveAccount('Cash at Bank', {}).isCash).toBe(true);
  });

  it('marks cash and cash equivalents', () => {
    const index = buildAccountIndex(coa);
    expect(index['Cash at Bank'].isCash).toBe(true);
    expect(index['M-Pesa Float'].isCash).toBe(true);
    expect(index['Trade Receivables'].isCash).toBe(false);
  });

  it('signs each balance in its own normal direction', () => {
    const index = buildAccountIndex(coa);
    const balances = accountBalances([
      je('2026-08-01', 'Cash at Bank', 'Sales Revenue', 1000),
    ], index);
    // The asset rose by 1,000 and the revenue rose by 1,000 — both positive,
    // despite sitting on opposite sides of the entry.
    expect(balances['Cash at Bank'].balance).toBe(1000);
    expect(balances['Sales Revenue'].balance).toBe(1000);
  });
});

describe('income statement — a FLOW, confined to the month', () => {
  it('reports only what happened in the period', () => {
    const jul = buildIncomeStatement(args('2026-07'));
    const aug = buildIncomeStatement(args('2026-08'));

    expect(jul.revenue).toBe(300000);
    expect(jul.cogs).toBe(180000);
    expect(jul.netProfit).toBe(120000);

    expect(aug.revenue).toBe(500000);
    expect(aug.cogs).toBe(300000);
    expect(aug.opex).toBe(120000);          // salaries
    expect(aug.netProfit).toBe(80000);
  });

  it('changes when the period changes — the whole point of the selector', () => {
    expect(buildIncomeStatement(args('2026-07')).revenue)
      .not.toBe(buildIncomeStatement(args('2026-08')).revenue);
  });

  it('reports nothing for a month with no trading', () => {
    const empty = buildIncomeStatement(args('2026-06'));
    expect(empty).toMatchObject({ revenue: 0, expenses: 0, netProfit: 0, grossMargin: 0 });
  });

  it('separates cost of sales from operating expenses', () => {
    const aug = buildIncomeStatement(args('2026-08'));
    expect(aug.grossProfit).toBe(200000);   // 500,000 - 300,000
    expect(aug.netProfit).toBe(80000);      // less 120,000 salaries
  });

  it('excludes unposted drafts', () => {
    expect(buildIncomeStatement(args('2026-08')).revenue).toBe(500000);
  });

  it('sums the whole ledger when no period is given', () => {
    expect(buildIncomeStatement({ journals: ledger, chartOfAccounts: coa }).revenue).toBe(800000);
  });
});

describe('balance sheet — a POSITION, cumulative to the month end', () => {
  it('carries everything from inception, not just the month', () => {
    const aug = buildBalanceSheet(args('2026-08'));
    // Cash: +1,000,000 -600,000 +500,000 -120,000 +400,000 +300,000
    const cash = aug.assetAccounts.find(a => a.name === 'Cash at Bank');
    expect(cash.balance).toBe(1480000);
    // The July vehicle is still on the sheet in August.
    expect(aug.assetAccounts.find(a => a.name === 'Motor Vehicles').balance).toBe(600000);
  });

  it('moves as the period moves', () => {
    expect(buildBalanceSheet(args('2026-07')).totalAssets)
      .not.toBe(buildBalanceSheet(args('2026-08')).totalAssets);
  });

  it('July: assets equal liabilities plus equity', () => {
    const jul = buildBalanceSheet(args('2026-07'));
    // Assets 1,000,000 - 600,000 cash + 600,000 vehicle + 300,000 receivable
    expect(jul.totalAssets).toBe(1300000);
    expect(jul.totalLiabilities).toBe(180000);       // trade payables
    expect(jul.contributedEquity).toBe(1000000);
    expect(jul.retainedEarnings).toBe(120000);       // July profit
    expect(jul.totalEquity).toBe(1120000);
    expect(jul.difference).toBe(0);
    expect(jul.balanced).toBe(true);
  });

  it('August: still balances once the month is added', () => {
    const aug = buildBalanceSheet(args('2026-08'));
    expect(aug.totalAssets).toBe(2080000);           // 1,480,000 cash + 600,000 vehicle
    expect(aug.totalLiabilities).toBe(880000);       // 480,000 payables + 400,000 loan
    expect(aug.retainedEarnings).toBe(200000);       // 120,000 + 80,000, cumulative
    expect(aug.totalLiabilitiesAndEquity).toBe(aug.totalAssets);
    expect(aug.balanced).toBe(true);
  });

  it('closes profit into equity — without it nothing balances', () => {
    const aug = buildBalanceSheet(args('2026-08'));
    const jul = buildIncomeStatement(args('2026-07'));
    const augPl = buildIncomeStatement(args('2026-08'));
    expect(aug.retainedEarnings).toBe(jul.netProfit + augPl.netProfit);
  });

  it('reports a real difference rather than always claiming to balance', () => {
    // An account with no type and a name that matches nothing cannot be placed,
    // so the sheet genuinely does not balance and has to say so.
    const withOrphan = [...ledger, je('2026-08-30', 'Zzz Unknown Thing', 'Cash at Bank', 50000)];
    const bs = buildBalanceSheet({ journals: withOrphan, chartOfAccounts: coa, period: '2026-08' });
    expect(bs.balanced).toBe(false);
    expect(bs.difference).not.toBe(0);
    expect(bs.unclassified.map(a => a.name)).toContain('Zzz Unknown Thing');
  });
});

describe('cash flow — a FLOW, reconciling to the balance sheet', () => {
  it('opens at last month\'s closing cash', () => {
    const jul = buildCashFlow(args('2026-07'));
    const aug = buildCashFlow(args('2026-08'));
    expect(jul.openingCash).toBe(0);
    expect(jul.closingCash).toBe(400000);            // 1,000,000 in, 600,000 out
    expect(aug.openingCash).toBe(jul.closingCash);
  });

  it('closes on the cash the balance sheet reports', () => {
    const aug = buildCashFlow(args('2026-08'));
    const bs  = buildBalanceSheet(args('2026-08'));
    const sheetCash = bs.assetAccounts
      .filter(a => a.isCash)
      .reduce((s, a) => s + a.balance, 0);
    expect(aug.closingCash).toBe(sheetCash);
  });

  it('classifies movements by what the cash moved against', () => {
    const jul = buildCashFlow(args('2026-07'));
    expect(jul.financing).toBe(1000000);             // share capital
    expect(jul.investing).toBe(-600000);             // vehicle purchase
    expect(jul.operating).toBe(0);                   // July's sale was on credit

    const aug = buildCashFlow(args('2026-08'));
    expect(aug.financing).toBe(400000);              // loan drawdown
    expect(aug.operating).toBe(680000);              // 500,000 sale - 120,000 salaries + 300,000 collected
    expect(aug.investing).toBe(0);
  });

  it('ignores a transfer between two cash accounts', () => {
    // Moving money bank -> M-Pesa changes no total, so it is not a cash flow.
    const withTransfer = [...ledger, je('2026-08-27', 'M-Pesa Float', 'Cash at Bank', 50000)];
    const aug = buildCashFlow({ journals: withTransfer, chartOfAccounts: coa, period: '2026-08' });
    expect(aug.netChange).toBe(buildCashFlow(args('2026-08')).netChange);
  });

  it('nets to the change in cash over the month', () => {
    const aug = buildCashFlow(args('2026-08'));
    expect(aug.netChange).toBe(1080000);             // 1,480,000 - 400,000
    expect(aug.closingCash - aug.openingCash).toBe(aug.netChange);
  });

  it('names the accounts it treated as cash', () => {
    expect(buildCashFlow(args('2026-08')).cashAccountNames).toEqual(['Cash at Bank', 'M-Pesa Float']);
  });

  it('reports gross movement each way, not just the net', () => {
    const aug = buildCashFlow(args('2026-08'));
    // In: 500,000 sale + 400,000 loan + 300,000 collected. Out: 120,000 salaries.
    expect(aug.inflows).toBe(1200000);
    expect(aug.outflows).toBe(120000);
    expect(aug.inflows - aug.outflows).toBe(aug.netChange);
  });

  it('does not let a busy month look quiet because it nets out', () => {
    // 400,000 in and 400,000 out nets to zero, but nothing about that month
    // was quiet — the gross figures are what say so.
    const churn = [
      je('2026-09-02', 'Cash at Bank', 'Sales Revenue', 400000),
      je('2026-09-20', 'Salaries',     'Cash at Bank',  400000),
    ];
    const sep = buildCashFlow({ journals: churn, chartOfAccounts: coa, period: '2026-09' });
    expect(sep.netChange).toBe(0);
    expect(sep.inflows).toBe(400000);
    expect(sep.outflows).toBe(400000);
  });
});

describe('trial balance — position, as at the month end', () => {
  it('balances in every period', () => {
    for (const period of ['2026-07', '2026-08', null]) {
      const tb = buildTrialBalance({ journals: ledger, chartOfAccounts: coa, period });
      expect(tb.totalDebit).toBe(tb.totalCredit);
    }
  });

  it('grows as periods are added, rather than resetting', () => {
    const jul = buildTrialBalance(args('2026-07'));
    const aug = buildTrialBalance(args('2026-08'));
    expect(aug.totalDebit).toBeGreaterThan(jul.totalDebit);
  });

  it('leaves out accounts nothing was ever posted to', () => {
    const tb = buildTrialBalance(args('2026-07'));
    expect(tb.rows.map(r => r.name)).not.toContain('Bank Loan');   // first used in August
  });

  it('is empty, not broken, before any trading', () => {
    const tb = buildTrialBalance(args('2026-06'));
    expect(tb.rows).toEqual([]);
    expect(tb.totalDebit).toBe(0);
  });
});

describe('safety', () => {
  it('survives being called with nothing', () => {
    expect(() => buildIncomeStatement()).not.toThrow();
    expect(() => buildBalanceSheet()).not.toThrow();
    expect(() => buildCashFlow()).not.toThrow();
    expect(() => buildTrialBalance()).not.toThrow();
  });

  it('works with no chart of accounts at all, on name patterns alone', () => {
    const pl = buildIncomeStatement({ journals: ledger, chartOfAccounts: [], period: '2026-08' });
    expect(pl.revenue).toBe(500000);
  });
});
