/**
 * FINANCIAL STATEMENTS FROM THE LEDGER (pure functions)
 *
 * FLOW vs POSITION — the distinction the period selector turns on
 *
 * The Statements tab has always had a month picker that changed nothing: every
 * figure summed the entire ledger and merely printed the chosen month as a
 * heading. Fixing that is not one filter, because the four statements do not
 * mean the same thing by "a period":
 *
 *   P&L, Cash Flow      FLOW      what happened DURING the month.
 *                                 Entries inside the month only.
 *
 *   Balance Sheet,      POSITION  where things STAND at month end.
 *   Trial Balance                 Every entry from inception up to that date.
 *
 * Filtering a balance sheet to one month's entries would be as wrong as leaving
 * a P&L unfiltered — it would report a company that came into existence on the
 * 1st. Both are handled explicitly below, and the wrong one is never reachable.
 *
 * WHY THIS ALSO HAD TO REPLACE THE FIGURES
 *
 * The balance sheet was ratios of ratios: total assets were
 * `netCash + revenue * 0.3`, and each line was then a fraction of THAT —
 * receivables `revenue * 0.35`, inventory `assets * 0.15`, share capital
 * `equity * 0.6`. There is no such thing as `revenue * 0.3` "as at August
 * 2026", so the period selector could not be honoured without deriving the
 * statement from real balances. Same for the cash flow, where operating cash
 * was `netProfit + COGS * 0.05`.
 *
 * Everything here is now the ledger, summed by account class:
 *
 *   assets & expenses     debit-normal   balance = debits - credits
 *   liabilities, equity,  credit-normal  balance = credits - debits
 *   revenue
 *
 * Nothing touches the DOM, Supabase or React.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/** chart_of_accounts.account_type -> the class that decides its normal balance. */
const TYPE_CLASS = {
  current_asset:         'asset',
  non_current_asset:     'asset',
  current_liability:     'liability',
  non_current_liability: 'liability',
  equity:                'equity',
  revenue:               'revenue',
  cost_of_sales:         'expense',
  operating_expense:     'expense',
};

const DEBIT_NORMAL = new Set(['asset', 'expense']);

/**
 * Name patterns, used ONLY for accounts a journal names that the chart does not
 * carry. The chart is always preferred — a tenant who has set an account's type
 * has told us the answer, and guessing over that would override them.
 */
/**
 * ORDER IS THE WHOLE DESIGN HERE. Several of these words appear in accounts on
 * both sides of the ledger, so the more specific marker has to be tested first:
 *
 *   "Cost of Sales"   contains "sales"  -> must not read as revenue
 *   "Bank Loan"       contains "bank"   -> must not read as a cash asset
 *   "Interest Expense" contains "interest" -> must not read as revenue
 *   "Rental Income"   contains "rent"   -> must not read as an expense
 *
 * Each rule below is placed to beat the ones that would get it wrong, and each
 * of those four is covered by a test.
 */
const NAME_CLASS = [
  // Cost of sales first: it carries "sales" but is an expense.
  [/\b(cost\s+of|cogs)\b/i,                                              'expense'],
  // Explicit expense markers, before revenue so "Interest Expense" lands here.
  // "rent" is deliberately absent — it cannot be told from "Rental Income".
  [/\bexpenses?\b|\b(salar|wage|payroll|depreciat|amorti|utilit)\w*/i,   'expense'],
  // Liability markers before the asset ones, so "Bank Loan" is not read as cash.
  [/\b(payable|creditor|accrual|accrued|loan|borrowing|liabilit)\w*/i,   'liability'],
  [/\b(cash|bank|m-?pesa|petty\s*cash|till)\b/i,                         'asset'],
  [/\b(receivable|debtor|inventory|stock|prepaid|equipment|vehicle)\b/i, 'asset'],
  [/\b(capital|retained\s*earnings|reserves|equity)\b/i,                 'equity'],
  [/\b(revenue|income|sales|turnover|commission|interest|penalt)\w*/i,   'revenue'],
  // Anything still calling itself a cost is one.
  [/\bcosts?\b/i,                                                        'expense'],
];

/** Cash and cash equivalents — the accounts the cash flow statement tracks. */
const CASH_NAME = /\b(cash|bank|m-?pesa|petty\s*cash|till)\b/i;

/**
 * Index the chart by account name, so a journal line can be classified in O(1).
 * Accounts the chart does not carry fall back to the name patterns, and are
 * reported so the UI can say which figures rest on a guess.
 */
export const buildAccountIndex = (chartOfAccounts = []) => {
  const index = {};
  for (const a of chartOfAccounts) {
    if (!a?.account_name) continue;
    const cls = TYPE_CLASS[a.account_type];
    if (cls) {
      index[a.account_name] = {
        cls,
        code: a.account_code || '—',
        type: a.account_type,
        isCash: cls === 'asset' && CASH_NAME.test(a.account_name),
        charted: true,
      };
    }
  }
  return index;
};

const classifyByName = (name) => {
  for (const [pattern, cls] of NAME_CLASS) {
    if (pattern.test(name)) return cls;
  }
  return null;
};

/** Resolve one account name to its class, chart first, name patterns second. */
export const resolveAccount = (name, index = {}) => {
  if (!name) return null;
  if (index[name]) return index[name];
  const cls = classifyByName(name);
  if (!cls) return null;
  return {
    cls,
    code: '—',
    type: `${cls} (inferred)`,
    isCash: cls === 'asset' && CASH_NAME.test(name),
    charted: false,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD
// ─────────────────────────────────────────────────────────────────────────────

const monthOf = (j) => String(j?.entry_date || '').slice(0, 7);

/** Entries inside the month — for the flow statements. */
const duringPeriod = (period) => (j) => !period || monthOf(j) === period;

/** Everything up to and including the month — for the position statements. */
const upToPeriod = (period) => (j) => !period || monthOf(j) <= period;

const postedOnly = (journals) => (journals || []).filter(j => j?.status === 'posted');
const amountOf = (j) => parseFloat(j?.amount || 0) || 0;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT BALANCES — what every statement below is built from
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Debit and credit totals per account over whichever entries are passed in.
 * `balance` is signed in the account's own normal direction, so a positive
 * figure always means "more of what this account is for".
 */
export const accountBalances = (journals, index) => {
  const accounts = {};

  const touch = (name) => {
    if (!accounts[name]) {
      const meta = resolveAccount(name, index) || { cls: null, code: '—', type: '?', isCash: false, charted: false };
      accounts[name] = { name, ...meta, debit: 0, credit: 0 };
    }
    return accounts[name];
  };

  for (const j of journals) {
    const amount = amountOf(j);
    if (!amount) continue;
    if (j.debit_account)  touch(j.debit_account).debit  += amount;
    if (j.credit_account) touch(j.credit_account).credit += amount;
  }

  for (const a of Object.values(accounts)) {
    a.debit = round2(a.debit);
    a.credit = round2(a.credit);
    a.balance = round2(DEBIT_NORMAL.has(a.cls) ? a.debit - a.credit : a.credit - a.debit);
  }

  return accounts;
};

const sumClass = (accounts, cls) =>
  round2(Object.values(accounts).filter(a => a.cls === cls).reduce((s, a) => s + a.balance, 0));

const sumType = (accounts, type) =>
  round2(Object.values(accounts).filter(a => a.type === type).reduce((s, a) => s + a.balance, 0));

// ─────────────────────────────────────────────────────────────────────────────
// TRIAL BALANCE — position, as at period end
// ─────────────────────────────────────────────────────────────────────────────

export const buildTrialBalance = ({ journals = [], chartOfAccounts = [], period = null } = {}) => {
  const index = buildAccountIndex(chartOfAccounts);
  const entries = postedOnly(journals).filter(upToPeriod(period));
  const accounts = accountBalances(entries, index);

  // Accounts in the chart that have never been posted to still belong on a
  // trial balance, at nil — their absence reads as "we don't have that account".
  for (const [name, meta] of Object.entries(index)) {
    if (!accounts[name]) accounts[name] = { name, ...meta, debit: 0, credit: 0, balance: 0 };
  }

  const rows = Object.values(accounts)
    .filter(a => a.debit > 0 || a.credit > 0)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));

  return {
    period,
    rows,
    totalDebit:  round2(rows.reduce((s, a) => s + a.debit,  0)),
    totalCredit: round2(rows.reduce((s, a) => s + a.credit, 0)),
    entryCount: entries.length,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// INCOME STATEMENT — flow, during the period
// ─────────────────────────────────────────────────────────────────────────────

export const buildIncomeStatement = ({ journals = [], chartOfAccounts = [], period = null } = {}) => {
  const index = buildAccountIndex(chartOfAccounts);
  const entries = postedOnly(journals).filter(duringPeriod(period));
  const accounts = accountBalances(entries, index);

  const revenue = sumClass(accounts, 'revenue');
  const cogs    = sumType(accounts, 'cost_of_sales');
  const expenses = sumClass(accounts, 'expense');
  const opex    = round2(expenses - cogs);

  const grossProfit = round2(revenue - cogs);
  const netProfit   = round2(revenue - expenses);

  const named = (pattern) => round2(
    Object.values(accounts)
      .filter(a => pattern.test(a.name))
      .reduce((s, a) => s + a.balance, 0),
  );

  return {
    period,
    revenue,
    cogs,
    opex,
    expenses,
    grossProfit,
    netProfit,
    grossMargin: revenue > 0 ? round2((grossProfit / revenue) * 100) : 0,
    netMargin:   revenue > 0 ? round2((netProfit / revenue) * 100) : 0,
    // Lines the P&L breaks out by name rather than by type, because the chart
    // has no type that distinguishes them.
    interestIncome: named(/interest/i),
    penaltyIncome:  named(/penalt/i),
    salaries:       named(/salar|wage|payroll/i),
    revenueAccounts: Object.values(accounts).filter(a => a.cls === 'revenue' && a.balance !== 0),
    expenseAccounts: Object.values(accounts).filter(a => a.cls === 'expense' && a.balance !== 0),
    entryCount: entries.length,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE SHEET — position, as at period end
// ─────────────────────────────────────────────────────────────────────────────

export const buildBalanceSheet = ({ journals = [], chartOfAccounts = [], period = null } = {}) => {
  const index = buildAccountIndex(chartOfAccounts);
  const entries = postedOnly(journals).filter(upToPeriod(period));
  const accounts = accountBalances(entries, index);

  const totalAssets      = sumClass(accounts, 'asset');
  const totalLiabilities = sumClass(accounts, 'liability');
  const contributedEquity = sumClass(accounts, 'equity');

  // Revenue and expense accounts close into equity. Cumulative profit since
  // inception IS retained earnings — without it the sheet cannot balance, which
  // is precisely why the old ratio-built version had to hardcode its own
  // "balanced" badge.
  const retainedEarnings = round2(sumClass(accounts, 'revenue') - sumClass(accounts, 'expense'));
  const totalEquity = round2(contributedEquity + retainedEarnings);

  const difference = round2(totalAssets - (totalLiabilities + totalEquity));

  const byClass = (cls) => Object.values(accounts).filter(a => a.cls === cls && a.balance !== 0);

  return {
    period,
    currentAssets:    round2(sumType(accounts, 'current_asset')),
    nonCurrentAssets: round2(sumType(accounts, 'non_current_asset')),
    totalAssets,
    currentLiabilities:    round2(sumType(accounts, 'current_liability')),
    nonCurrentLiabilities: round2(sumType(accounts, 'non_current_liability')),
    totalLiabilities,
    contributedEquity,
    retainedEarnings,
    totalEquity,
    totalLiabilitiesAndEquity: round2(totalLiabilities + totalEquity),
    // A real check with a real answer. Double entry guarantees it nets to zero
    // whenever every account is classified; a non-zero difference means some
    // account has no type, and that is worth saying out loud.
    difference,
    balanced: Math.abs(difference) < 1,
    assetAccounts:     byClass('asset'),
    liabilityAccounts: byClass('liability'),
    equityAccounts:    byClass('equity'),
    unclassified: Object.values(accounts).filter(a => !a.cls && (a.debit > 0 || a.credit > 0)),
    entryCount: entries.length,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// CASH FLOW — flow, during the period, direct method
// ─────────────────────────────────────────────────────────────────────────────

/** Which activity a cash movement belongs to, judged by what it moved against. */
const activityOf = (contraClass, contraType) => {
  if (contraClass === 'revenue' || contraClass === 'expense') return 'operating';
  if (contraType === 'non_current_asset') return 'investing';
  if (contraClass === 'equity' || contraType === 'non_current_liability') return 'financing';
  // Receivables, payables, VAT, payroll liabilities: working capital.
  return 'operating';
};

export const buildCashFlow = ({ journals = [], chartOfAccounts = [], period = null } = {}) => {
  const index = buildAccountIndex(chartOfAccounts);
  const posted = postedOnly(journals);

  const isCash = (name) => !!resolveAccount(name, index)?.isCash;

  // Opening cash is the cumulative cash balance BEFORE the period opens, so the
  // statement reconciles to the balance sheet instead of being an invented
  // fraction of it.
  const priorEntries = period ? posted.filter(j => monthOf(j) < period) : [];
  const priorCash = accountBalances(priorEntries, index);
  const openingCash = round2(
    Object.values(priorCash).filter(a => a.isCash).reduce((s, a) => s + a.balance, 0),
  );

  const entries = posted.filter(duringPeriod(period));
  const activities = { operating: 0, investing: 0, financing: 0 };
  const movements = [];

  for (const j of entries) {
    const amount = amountOf(j);
    if (!amount) continue;

    const debitIsCash  = isCash(j.debit_account);
    const creditIsCash = isCash(j.credit_account);
    // Cash moved between two cash accounts (bank to petty cash) is not a cash
    // flow at all — the total is unchanged. Counting it inflates both sides.
    if (debitIsCash === creditIsCash) continue;

    const contraName = debitIsCash ? j.credit_account : j.debit_account;
    const contra = resolveAccount(contraName, index);
    const activity = activityOf(contra?.cls, contra?.type);
    const signed = debitIsCash ? amount : -amount;

    activities[activity] = round2(activities[activity] + signed);
    movements.push({ ...j, activity, signed, contraName });
  }

  const netChange = round2(activities.operating + activities.investing + activities.financing);

  // Gross movement in each direction. A month can net to nearly nothing while
  // moving a great deal of money both ways, and the netted figure hides that.
  const inflows  = round2(movements.filter(m => m.signed > 0).reduce((s, m) => s + m.signed, 0));
  const outflows = round2(movements.filter(m => m.signed < 0).reduce((s, m) => s - m.signed, 0));

  return {
    period,
    openingCash,
    operating: activities.operating,
    investing: activities.investing,
    financing: activities.financing,
    inflows,
    outflows,
    netChange,
    closingCash: round2(openingCash + netChange),
    movements,
    // Which accounts were treated as cash. The set is name-matched, so naming
    // it lets a user spot an account that should have been in it (or should not).
    cashAccountNames: Object.entries(index).filter(([, a]) => a.isCash).map(([name]) => name),
    entryCount: movements.length,
  };
};
