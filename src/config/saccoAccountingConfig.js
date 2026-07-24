/**
 * SACCO / CHAMA ACCOUNTING — STATIC CONFIGURATION
 *
 * Mirrors the "SACCO / Chama Financial Accounting System" specification:
 *   §3   account classes and code ranges
 *   §5   Income Statement line structure
 *   §6   Balance Sheet line structure
 *   §7   Cash Flow Statement (indirect method)
 *   §9   the Society-Type configuration matrix
 *
 * Report layouts live here as DATA (the spec's "ReportDefinition" entity, §10.1)
 * so a line can be re-mapped to different COA codes without touching the
 * rendering code. The engine in src/utils/saccoAccounting.js consumes these.
 *
 * SACCO/CHAMA ONLY — the company Finance Hub has its own, unrelated COA.
 */

// ── §3.1 Account classes ────────────────────────────────────────────────────
export const ACCOUNT_CLASSES = [
  { id: 'asset',     label: 'Assets',      range: '1000–1999', normal: 'debit',  statement: 'Balance Sheet' },
  { id: 'liability', label: 'Liabilities', range: '2000–2999', normal: 'credit', statement: 'Balance Sheet' },
  { id: 'equity',    label: 'Equity',      range: '3000–3999', normal: 'credit', statement: 'Balance Sheet' },
  { id: 'income',    label: 'Income',      range: '4000–4999', normal: 'credit', statement: 'Income Statement' },
  { id: 'expense',   label: 'Expenses',    range: '5000–5999', normal: 'debit',  statement: 'Income Statement' },
  { id: 'memo',      label: 'Off-balance-sheet / Memo', range: '9000–9999', normal: 'debit', statement: 'Notes / Memo' },
];

export const CLASS_LABEL = ACCOUNT_CLASSES.reduce((m, c) => { m[c.id] = c.label; return m; }, {});

/** First digit of a 4-digit code → account class. */
export const classForCode = (code) => ({
  1: 'asset', 2: 'liability', 3: 'equity', 4: 'income', 5: 'expense', 9: 'memo',
}[String(code || '').charAt(0)] || null);

export const SEGMENTS = [
  { id: 'both',  label: 'Both' },
  { id: 'bosa',  label: 'BOSA' },
  { id: 'fosa',  label: 'FOSA' },
  { id: 'chama', label: 'Chama' },
];

// Accounts treated as cash for the Cash Flow reconciliation (§7).
export const CASH_ACCOUNTS = ['1010', '1011', '1020', '1021'];

// ── §9 Society-type configuration matrix ────────────────────────────────────
export const SOCIETY_TYPES = [
  {
    id: 'sacco_dt',
    label: 'Deposit-Taking SACCO (SASRA-licensed)',
    short: 'SACCO · Deposit-taking',
    blurb: 'Full chart of accounts, BOSA and FOSA active, full provisioning engine, statutory reserve enforced, SASRA prudential returns.',
    modules: {
      share_capital_enabled: true, loan_book_enabled: true, fosa_enabled: true,
      provisioning_enabled: true, statutory_reserve_enabled: true, dividends_enabled: true,
      sasra_returns_enabled: true, welfare_fund_enabled: false, mgr_enabled: false,
    },
    statements: ['income', 'balance', 'cashflow'],
    memberBase: 'Hundreds–thousands of members',
  },
  {
    id: 'sacco_bosa',
    label: 'BOSA-only SACCO (non-deposit-taking)',
    short: 'SACCO · BOSA only',
    blurb: 'Same core engine with the FOSA range (1011, 1103, 2012) switched off. Loans are funded from members’ own shares and savings, so a loanable-funds ceiling applies.',
    modules: {
      share_capital_enabled: true, loan_book_enabled: true, fosa_enabled: false,
      provisioning_enabled: true, statutory_reserve_enabled: true, dividends_enabled: true,
      sasra_returns_enabled: false, welfare_fund_enabled: false, mgr_enabled: false,
    },
    statements: ['income', 'balance', 'cashflow'],
    memberBase: 'Tens–hundreds of members',
  },
  {
    id: 'chama_investment',
    label: 'Table-Banking / Investment Chama',
    short: 'Chama · Table-banking',
    blurb: 'Lightweight version: one pooled contribution account, a simple member loan ledger, basic aging, no statutory reserve unless the constitution sets one.',
    modules: {
      share_capital_enabled: true, loan_book_enabled: true, fosa_enabled: false,
      provisioning_enabled: true, statutory_reserve_enabled: false, dividends_enabled: true,
      sasra_returns_enabled: false, welfare_fund_enabled: false, mgr_enabled: false,
    },
    statements: ['income', 'balance', 'cashflow'],
    memberBase: '5–30 members',
  },
  {
    id: 'chama_mgr',
    label: 'Merry-go-round Chama',
    short: 'Chama · Merry-go-round',
    blurb: 'No loan book and no Income Statement in the SACCO sense. The core report is a Statement of Contributions and Payouts, reconciled per cycle.',
    modules: {
      share_capital_enabled: false, loan_book_enabled: false, fosa_enabled: false,
      provisioning_enabled: false, statutory_reserve_enabled: false, dividends_enabled: false,
      sasra_returns_enabled: false, welfare_fund_enabled: false, mgr_enabled: true,
    },
    statements: ['contributions'],
    memberBase: '5–30 members',
  },
  {
    id: 'chama_welfare',
    label: 'Welfare Chama',
    short: 'Chama · Welfare',
    blurb: 'Contribution ledger plus a Claims Register posting against the Welfare Fund liability rather than through a P&L expense line.',
    modules: {
      share_capital_enabled: false, loan_book_enabled: false, fosa_enabled: false,
      provisioning_enabled: false, statutory_reserve_enabled: false, dividends_enabled: false,
      sasra_returns_enabled: false, welfare_fund_enabled: true, mgr_enabled: false,
    },
    statements: ['income', 'balance', 'contributions'],
    memberBase: '5–30 members',
  },
];

export const societyType = (id) => SOCIETY_TYPES.find((s) => s.id === id) || SOCIETY_TYPES[1];

/** §9 comparison matrix, rendered as-is on the Setup tab. */
export const SOCIETY_MATRIX = [
  { module: 'Share Capital ledger',            sacco_dt: 'Required', sacco_bosa: 'Required', chama_investment: 'Optional (pooled contributions)', chama_mgr: 'Not used', chama_welfare: 'Not used' },
  { module: 'Savings / deposit products',      sacco_dt: 'Multiple (regular, fixed, junior, FOSA)', sacco_bosa: 'Regular + fixed only', chama_investment: 'Single pooled contribution account', chama_mgr: 'Single contribution account', chama_welfare: 'Single contribution account' },
  { module: 'FOSA (current a/c, cheques, ATM)',sacco_dt: 'Yes, if licensed', sacco_bosa: 'No', chama_investment: 'No', chama_mgr: 'No', chama_welfare: 'No' },
  { module: 'Loan book & provisioning',        sacco_dt: 'Full, multi-product, regulatory', sacco_bosa: 'Full, simplified provisioning', chama_investment: 'Simple flat-rate, basic aging', chama_mgr: 'None', chama_welfare: 'None' },
  { module: 'Statutory reserve appropriation', sacco_dt: 'Mandatory, regulator %', sacco_bosa: 'Mandatory, by-law %', chama_investment: 'Optional, by constitution', chama_mgr: 'Not applicable', chama_welfare: 'Not applicable' },
  { module: 'Dividends & interest on deposits',sacco_dt: 'Both, AGM-approved', sacco_bosa: 'Both, AGM-approved', chama_investment: 'Often a single profit share', chama_mgr: 'Not applicable', chama_welfare: 'Not applicable' },
  { module: 'SASRA regulatory returns',        sacco_dt: 'Required', sacco_bosa: 'Not applicable', chama_investment: 'Not applicable', chama_mgr: 'Not applicable', chama_welfare: 'Not applicable' },
  { module: 'Core statements produced',        sacco_dt: 'Full P&L, B/S, Cash Flow', sacco_bosa: 'Full P&L, B/S, Cash Flow', chama_investment: 'Simplified P&L, B/S, Cash Flow', chama_mgr: 'Statement of Contributions & Payouts', chama_welfare: 'Contributions + Claims Register' },
  { module: 'Typical user base',               sacco_dt: 'Hundreds–thousands', sacco_bosa: 'Tens–hundreds', chama_investment: '5–30 members', chama_mgr: '5–30 members', chama_welfare: '5–30 members' },
];

// ── §8 How this differs from a generic commercial accounting system ─────────
export const DIFFERENCES = [
  { aspect: 'Owner contributions', normal: 'All booked to Equity (capital account)', sacco: 'Split: Share Capital → Equity; Savings/Deposits → Liability, even though contributed by the same members' },
  { aspect: 'Customer vs owner', normal: 'Customers and owners are different entities', sacco: 'A member is simultaneously owner (shares), depositor (savings, a liability) and borrower (loans, an asset) — one member ID links all three' },
  { aspect: 'Revenue driver', normal: 'Sales of goods/services to external customers', sacco: 'Interest income earned FROM the same members who are also owners; needs a member-level sub-ledger' },
  { aspect: 'Profit terminology', normal: 'Net Profit, freely distributable at will', sacco: 'Net Surplus, subject to a mandatory statutory reserve waterfall before any distribution is permitted' },
  { aspect: 'Core ledger unit', normal: 'GL + AR/AP per customer/supplier', sacco: 'GL + a member sub-ledger carrying THREE parallel balances per member, each rolling up to its own control account' },
  { aspect: 'Interest handling', normal: 'Rare and simple', sacco: 'Central: accrues on declining loan balances AND on deposit balances, both automatically, both reconciled to control accounts' },
  { aspect: 'Provisioning', normal: 'Optional bad-debt allowance, often manual', sacco: 'Mandatory, formula-driven classification and provisioning, recalculated every period end' },
  { aspect: 'Regulatory reporting', normal: 'Tax filings only', sacco: 'SASRA prudential returns, co-operative annual returns, AGM financial statements' },
  { aspect: 'Dividend mechanics', normal: 'Discretionary board decision', sacco: 'Dividend AND interest-on-deposits are two rule-bound computations on different bases (shares held vs average savings), both needing AGM approval' },
  { aspect: 'Multi-fund structure', normal: 'Single equity pool', sacco: 'Ring-fenced funds (education, development, welfare) that must not be commingled in reporting even when cash sits in one bank account' },
  { aspect: 'Member exit', normal: 'No equivalent', sacco: 'Share capital refund, savings withdrawal and loan offset handled as one linked workflow' },
];

// ─────────────────────────────────────────────────────────────────────────────
// §5 INCOME STATEMENT DEFINITION
// kind: 'line' (sum of codes) | 'subtotal' (sum of earlier line ids) | 'spacer'
// sign: +1 adds, -1 subtracts (presented as "Less: …")
// ─────────────────────────────────────────────────────────────────────────────
export const INCOME_STATEMENT_DEF = [
  { id: 'int_income',   label: 'Interest Income on Loans',                       kind: 'line', codes: ['4010', '4011', '4012'], sign: 1 },
  { id: 'int_expense',  label: 'Less: Interest Expense on Deposits & Borrowings', kind: 'line', codes: ['5010', '5011'], sign: -1 },
  { id: 'nii',          label: 'Net Interest Income',                            kind: 'subtotal', of: ['int_income', 'int_expense'], emphasis: true },
  { id: 'fee_income',   label: 'Add: Fee & Commission Income',                   kind: 'line', codes: ['4020', '4040', '4050'], sign: 1 },
  { id: 'inv_income',   label: 'Add: Investment Income',                         kind: 'line', codes: ['4100', '4110'], sign: 1 },
  { id: 'other_income', label: 'Add: Other Operating Income',                    kind: 'line', codes: ['4030', '4200', '4210', '4300'], sign: 1 },
  { id: 'total_income', label: 'Total Operating Income',                         kind: 'subtotal', of: ['nii', 'fee_income', 'inv_income', 'other_income'], emphasis: true },
  { id: 'provisions',   label: 'Less: Provision for Loan Losses (net charge)',   kind: 'line', codes: ['5300'], sign: -1 },
  { id: 'staff',        label: 'Less: Staff Costs',                              kind: 'line', codes: ['5100', '5110', '5120'], sign: -1 },
  { id: 'admin',        label: 'Less: Administrative & General Expenses',        kind: 'line', codes: ['5200', '5210', '5220', '5230', '5240', '5250', '5260', '5500'], sign: -1 },
  { id: 'depn',         label: 'Less: Depreciation & Amortisation',              kind: 'line', codes: ['5400', '5410'], sign: -1 },
  { id: 'badbedt',      label: 'Less: Bad Debts Written Off',                    kind: 'line', codes: ['5310'], sign: -1 },
  { id: 'welfare_paid', label: 'Less: Welfare Claims Paid',                      kind: 'line', codes: ['5600'], sign: -1, hideIfZero: true },
  { id: 'net_surplus',  label: 'Net Surplus for the Year (before appropriation)', kind: 'subtotal', of: ['total_income', 'provisions', 'staff', 'admin', 'depn', 'badbedt', 'welfare_paid'], emphasis: true, strong: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// §6 BALANCE SHEET DEFINITION
// ─────────────────────────────────────────────────────────────────────────────
export const BALANCE_SHEET_DEF = {
  assets: [
    { id: 'cash',        label: 'Cash and Bank Balances',                      kind: 'line', codes: CASH_ACCOUNTS, sign: 1 },
    { id: 'sti',         label: 'Short-Term Investments / Fixed Deposits Held', kind: 'line', codes: ['1030'], sign: 1 },
    { id: 'loans_gross', label: 'Loans to Members (gross)',                     kind: 'line', codes: ['1100', '1101', '1102', '1103'], sign: 1 },
    { id: 'provision',   label: 'Less: Provision for Loan Losses',              kind: 'line', codes: ['1190'], sign: -1 },
    { id: 'loans_net',   label: 'Loans to Members (net)',                       kind: 'subtotal', of: ['loans_gross', 'provision'], emphasis: true },
    { id: 'int_recv',    label: 'Interest Receivable',                          kind: 'line', codes: ['1150'], sign: 1 },
    { id: 'other_recv',  label: 'Other Receivables & Prepayments',              kind: 'line', codes: ['1200', '1201', '1210'], sign: 1 },
    { id: 'ppe_cost',    label: 'Property, Plant & Equipment (at cost)',        kind: 'line', codes: ['1300', '1310', '1320', '1330'], sign: 1 },
    { id: 'acc_depn',    label: 'Less: Accumulated Depreciation',               kind: 'line', codes: ['1390'], sign: -1 },
    { id: 'ppe_net',     label: 'Property, Plant & Equipment (net)',            kind: 'subtotal', of: ['ppe_cost', 'acc_depn'], emphasis: true },
    { id: 'intangible',  label: 'Intangible Assets (net)',                      kind: 'line', codes: ['1400'], sign: 1 },
    { id: 'total_assets',label: 'TOTAL ASSETS',                                 kind: 'subtotal', of: ['cash', 'sti', 'loans_net', 'int_recv', 'other_recv', 'ppe_net', 'intangible'], emphasis: true, strong: true },
  ],
  liabilities: [
    { id: 'savings',     label: 'Member Savings & Deposits',                    kind: 'line', codes: ['2010', '2011', '2012', '2013'], sign: 1 },
    { id: 'int_pay',     label: 'Interest Payable on Deposits',                 kind: 'line', codes: ['2020'], sign: 1 },
    { id: 'borrowings',  label: 'Borrowings (external)',                        kind: 'line', codes: ['2100', '2110'], sign: 1 },
    { id: 'statutory',   label: 'Statutory Deductions Payable',                 kind: 'line', codes: ['2200'], sign: 1 },
    { id: 'div_pay',     label: 'Dividends & Interest on Deposits Payable',     kind: 'line', codes: ['2210', '2211'], sign: 1 },
    { id: 'creditors',   label: 'Trade & Sundry Creditors',                     kind: 'line', codes: ['2300'], sign: 1 },
    { id: 'chama_pay',   label: 'Welfare Fund / Contribution Payables',         kind: 'line', codes: ['2310', '2320'], sign: 1 },
    { id: 'total_liab',  label: 'TOTAL LIABILITIES',                            kind: 'subtotal', of: ['savings', 'int_pay', 'borrowings', 'statutory', 'div_pay', 'creditors', 'chama_pay'], emphasis: true, strong: true },
  ],
  equity: [
    { id: 'share_cap',   label: "Members' Share Capital",                       kind: 'line', codes: ['3010', '3020'], sign: 1 },
    { id: 'stat_res',    label: 'Statutory Reserve Fund',                       kind: 'line', codes: ['3100'], sign: 1 },
    { id: 'retained',    label: 'Retained Surplus / Accumulated Fund',          kind: 'line', codes: ['3200'], sign: 1 },
    { id: 'other_res',   label: 'Education, Development & Welfare Reserves',    kind: 'line', codes: ['3300', '3310', '3320', '3330'], sign: 1 },
    { id: 'reval',       label: 'Revaluation Reserve',                          kind: 'line', codes: ['3400'], sign: 1 },
    // Income and expense accounts are never closed out to 3200 by a posting —
    // the undistributed surplus to date is what makes Assets = Liabilities +
    // Equity hold at any date, so it is presented as its own equity line.
    { id: 'undistributed', label: 'Add: Surplus Not Yet Appropriated',          kind: 'surplus_to_date' },
    { id: 'total_equity',label: 'TOTAL EQUITY',                                 kind: 'subtotal', of: ['share_cap', 'stat_res', 'retained', 'other_res', 'reval', 'undistributed'], emphasis: true, strong: true },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// §7 CASH FLOW STATEMENT (indirect method)
//
// source: 'surplus'  → net surplus for the period, from the Income Statement
//         'delta'    → period-on-period movement in the listed balance codes
//         'charge'   → a P&L charge for the period (used where the credit side
//                      goes straight to the asset, e.g. amortisation → 1400)
//         'delta_gross' → movement in an asset that is already net of a P&L
//                      charge; the charge in `chargeCodes` is added back so the
//                      line shows the GROSS cash spent, not the netted movement
//         'cash_out' → actual cash paid out of a payable, i.e. debits booked to
//                      that account during the period
// flow:   how a movement maps to cash. An increase in an asset consumes cash
//         (-1); an increase in a liability/equity/contra-asset provides or
//         restores cash (+1).
//
// The non-cash add-backs are taken from the BALANCE-SHEET contra movement
// (Δ1190, Δ1390) rather than the raw P&L charge. The two are identical in a
// clean period, but only the contra movement keeps the statement reconciling
// when a loan is written off or an asset disposed — and §7 makes that
// reconciliation an automated integrity check.
// ─────────────────────────────────────────────────────────────────────────────
export const CASH_FLOW_DEF = {
  operating: [
    { id: 'surplus',    label: 'Net Surplus for the Year (before appropriation)', source: 'surplus' },
    { id: 'depn_back',  label: 'Add back: Depreciation (non-cash)',               source: 'delta',  codes: ['1390'], flow: 1 },
    { id: 'amort_back', label: 'Add back: Amortisation of Intangibles (non-cash)',source: 'charge', codes: ['5410'] },
    { id: 'prov_back',  label: 'Add back: Provision for Loan Losses (net charge)',source: 'delta',  codes: ['1190'], flow: 1 },
    { id: 'd_loans',    label: '(Increase)/Decrease in Loans to Members',         source: 'delta', codes: ['1100', '1101', '1102', '1103'], flow: -1 },
    { id: 'd_int_recv', label: '(Increase)/Decrease in Interest Receivable',      source: 'delta', codes: ['1150'], flow: -1 },
    { id: 'd_other_recv', label: '(Increase)/Decrease in Other Receivables',      source: 'delta', codes: ['1200', '1201', '1210'], flow: -1 },
    { id: 'd_savings',  label: 'Increase/(Decrease) in Member Savings & Deposits',source: 'delta', codes: ['2010', '2011', '2012', '2013'], flow: 1 },
    { id: 'd_int_pay',  label: 'Increase/(Decrease) in Interest Payable',         source: 'delta', codes: ['2020'], flow: 1 },
    { id: 'd_other_pay',label: 'Increase/(Decrease) in Other Payables',           source: 'delta', codes: ['2200', '2300', '2310', '2320'], flow: 1 },
  ],
  investing: [
    { id: 'd_ppe',      label: 'Purchase of Property, Plant & Equipment',         source: 'delta', codes: ['1300', '1310', '1320', '1330'], flow: -1 },
    { id: 'd_sti',      label: 'Purchase/(Maturity) of Fixed Deposits & Investments', source: 'delta', codes: ['1030'], flow: -1 },
    // 1400 is carried net (amortisation is credited straight to it, there is no
    // accumulated-amortisation contra in the spec's chart), so the period's
    // 5410 charge is added back to show the gross cash actually spent.
    { id: 'd_intang',   label: 'Purchase of Intangible Assets',                   source: 'delta_gross', codes: ['1400'], chargeCodes: ['5410'], flow: -1 },
  ],
  financing: [
    { id: 'd_share',    label: 'Share Capital Received/(Refunded on exit)',       source: 'delta', codes: ['3010', '3020'], flow: 1 },
    { id: 'd_borrow',   label: 'External Borrowings Drawn/(Repaid)',              source: 'delta', codes: ['2100', '2110'], flow: 1 },
    { id: 'div_paid',   label: 'Dividends Paid',                                  source: 'cash_out', codes: ['2210'] },
    { id: 'iod_paid',   label: 'Interest on Deposits Paid',                       source: 'cash_out', codes: ['2211'] },
  ],
};

// ── §10.4 Period-end close checklist ────────────────────────────────────────
export const CLOSE_CHECKLIST = [
  { id: 'accrual',     label: 'Run interest accrual batch (loans and deposits)', job: 'accrual' },
  { id: 'provision',   label: 'Run loan aging & provisioning batch',             job: 'provisioning' },
  { id: 'depreciation',label: 'Run depreciation / amortisation batch',           job: 'depreciation' },
  { id: 'reconcile',   label: 'Reconcile bank and mobile-money control accounts', job: null },
  { id: 'trial',       label: 'Generate trial balance and review for out-of-balance or suspense items', job: null },
  { id: 'lock',        label: 'Lock the period (no further postings without a reversing entry)', job: 'lock' },
  { id: 'statements',  label: 'Generate P&L, Balance Sheet and Cash Flow Statement', job: null },
  { id: 'appropriate', label: 'Year-end only: run the appropriation engine (statutory reserve → other reserves → dividends → IOD)', job: 'appropriation' },
];

export const APPROPRIATION_LABELS = {
  statutory_reserve: 'Statutory Reserve Fund',
  education: 'Education Fund',
  development: 'Development Fund',
  welfare: 'Welfare / Benevolent Reserve',
  honoraria: 'Honoraria / AGM Reserve',
  dividend: 'Dividend on Share Capital',
  iod: 'Interest on Member Deposits',
};

export const CLASSIFICATION_TONES = {
  performing:  'bg-emerald-100 text-emerald-700',
  watch:       'bg-sky-100 text-sky-700',
  substandard: 'bg-amber-100 text-amber-700',
  doubtful:    'bg-orange-100 text-orange-700',
  loss:        'bg-red-100 text-red-700',
};
