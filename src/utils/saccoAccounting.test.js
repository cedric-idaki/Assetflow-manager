/**
 * Tests for the SACCO/Chama accounting engine.
 *
 * The two that matter most are the specification's own integrity checks:
 *   §6  Assets = Liabilities + Equity, after every posting batch.
 *   §7  Net cash movement per the Cash Flow Statement reconciles to the actual
 *       movement in accounts 1010/1011/1020/1021.
 *
 * Both are asserted here against a hand-built ledger covering the full life of
 * a small SACCO period: share capital, savings, a disbursement, a repayment,
 * accruals, provisioning, depreciation and a dividend.
 */
import { describe, it, expect } from 'vitest';
import {
  indexTrialBalance, buildIncomeStatement, buildBalanceSheet, buildCashFlow,
  buildAppropriation, runProvisioning, computeDepreciation, classifyByDays,
  daysInArrears, outstandingPrincipal, buildMemberSubLedger,
  reconcileControlAccounts, loanableFundsCheck, buildMgrStatement, netSurplusOf,
} from './saccoAccounting';

// ── Helpers ─────────────────────────────────────────────────────────────────
const CLASS_OF = {
  1: 'asset', 2: 'liability', 3: 'equity', 4: 'income', 5: 'expense', 9: 'memo',
};
const NORMAL_OF = {
  asset: 'debit', liability: 'credit', equity: 'credit',
  income: 'credit', expense: 'debit', memo: 'debit',
};
// Contra accounts carry the opposite normal balance to their class.
const CONTRA = new Set(['1190', '1390']);

/**
 * Turns a list of [debitCode, creditCode, amount] postings into the shape
 * public.sacco_trial_balance() returns, so the builders are exercised through
 * exactly the same interface they see in production.
 */
const toTrialBalance = (postings) => {
  const acc = {};
  const touch = (code) => {
    if (!acc[code]) {
      const klass = CLASS_OF[code.charAt(0)];
      acc[code] = {
        account_code: code,
        account_name: `Account ${code}`,
        account_class: klass,
        normal_balance: CONTRA.has(code)
          ? (NORMAL_OF[klass] === 'debit' ? 'credit' : 'debit')
          : NORMAL_OF[klass],
        is_contra: CONTRA.has(code),
        segment: 'both',
        total_debit: 0,
        total_credit: 0,
      };
    }
    return acc[code];
  };

  postings.forEach(([dr, cr, amount]) => {
    touch(dr).total_debit  += amount;
    touch(cr).total_credit += amount;
  });

  return Object.values(acc).map((a) => ({
    ...a,
    balance: a.normal_balance === 'debit'
      ? a.total_debit - a.total_credit
      : a.total_credit - a.total_debit,
  }));
};

// Opening position carried into the period.
const OPENING = [
  ['1020', '3010', 500000],   // share capital already paid in, sitting at bank
  ['1020', '2010', 300000],   // member savings already held
  ['1100', '1020', 400000],   // loans already out
  ['1320', '1020',  96000],   // computers already owned
];

// Movements during the reporting period.
const PERIOD = [
  ['1020', '3010', 100000],   // new share capital  (financing in)
  ['1020', '2010', 250000],   // savings deposits   (operating in)
  ['2010', '1020',  40000],   // savings withdrawal (operating out)
  ['1100', '1020', 180000],   // loan disbursed     (operating out)
  ['1020', '1100',  60000],   // principal repaid   (operating in)
  ['1020', '4010',  25000],   // interest collected
  ['1020', '4020',   5000],   // processing fees
  ['1150', '4010',   8000],   // interest accrued, not yet collected
  ['5010', '2020',   4000],   // deposit interest accrued
  ['5300', '1190',  12000],   // provision raised   (non-cash)
  ['5400', '1390',   2000],   // depreciation       (non-cash)
  ['5200', '1020',  18000],   // rent paid
  ['5100', '1020',  30000],   // salaries paid
  ['1320', '1020',  50000],   // new computers      (investing out)
  ['3200', '2210',  15000],   // dividend declared
  ['2210', '1020',  15000],   // dividend paid      (financing out)
  ['1030', '1020', 100000],   // fixed deposit placed (investing out)
];

const openingTb = indexTrialBalance(toTrialBalance(OPENING));
const periodTb  = indexTrialBalance(toTrialBalance(PERIOD));
const closingTb = indexTrialBalance(toTrialBalance([...OPENING, ...PERIOD]));

describe('trial balance', () => {
  it('nets debits against credits by the account normal balance', () => {
    // 1190 is a contra-asset: a credit balance reads as a positive provision.
    expect(closingTb['1190'].balance).toBe(12000);
    expect(closingTb['1390'].balance).toBe(2000);
    // Savings: 300k opening + 250k deposits − 40k withdrawals.
    expect(closingTb['2010'].balance).toBe(510000);
  });

  it('reports the surplus as income less expenses', () => {
    // Income 25k + 5k + 8k = 38k. Expenses 4k + 12k + 2k + 18k + 30k = 66k.
    expect(netSurplusOf(periodTb)).toBe(-28000);
  });
});

describe('income statement (§5)', () => {
  const is = buildIncomeStatement(periodTb);

  it('nets interest income against interest expense', () => {
    const nii = is.rows.find((r) => r.id === 'nii');
    expect(nii.value).toBe(33000 - 4000);   // 25k collected + 8k accrued − 4k deposit interest
  });

  it('carries every expense into the net surplus', () => {
    expect(is.netSurplus).toBe(netSurplusOf(periodTb));
  });

  it('presents deductions as negative amounts', () => {
    expect(is.rows.find((r) => r.id === 'staff').value).toBe(-30000);
    expect(is.rows.find((r) => r.id === 'provisions').value).toBe(-12000);
  });
});

describe('balance sheet (§6)', () => {
  const bs = buildBalanceSheet(closingTb);

  it('balances — Assets = Liabilities + Equity', () => {
    expect(bs.balances).toBe(true);
    expect(bs.difference).toBe(0);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
  });

  it('nets the loan loss provision off gross loans', () => {
    expect(bs.assets.find((r) => r.id === 'loans_gross').value).toBe(520000);
    expect(bs.assets.find((r) => r.id === 'provision').value).toBe(-12000);
    expect(bs.assets.find((r) => r.id === 'loans_net').value).toBe(508000);
  });

  it('nets accumulated depreciation off property and equipment', () => {
    expect(bs.assets.find((r) => r.id === 'ppe_net').value).toBe(146000 - 2000);
  });

  it('classifies member savings as a LIABILITY and share capital as EQUITY', () => {
    expect(bs.liabilities.find((r) => r.id === 'savings').value).toBe(510000);
    expect(bs.equity.find((r) => r.id === 'share_cap').value).toBe(600000);
  });

  it('carries the unappropriated surplus inside equity', () => {
    // 3200 was debited 15k for the dividend and never credited with the surplus,
    // so the undistributed line is what keeps the sheet balanced.
    expect(bs.equity.find((r) => r.id === 'retained').value).toBe(-15000);
    expect(bs.equity.find((r) => r.id === 'undistributed').value).toBe(bs.surplusToDate);
  });
});

describe('cash flow statement (§7)', () => {
  const netSurplus = buildIncomeStatement(periodTb).netSurplus;
  const cf = buildCashFlow(periodTb, openingTb, closingTb, netSurplus);

  it('reconciles to the actual movement in the cash and bank accounts', () => {
    expect(cf.reconciles).toBe(true);
    expect(cf.variance).toBe(0);
    expect(cf.netChange).toBe(cf.actualChange);
  });

  it('adds back the non-cash provision and depreciation charges', () => {
    expect(cf.operating.rows.find((r) => r.id === 'prov_back').value).toBe(12000);
    expect(cf.operating.rows.find((r) => r.id === 'depn_back').value).toBe(2000);
  });

  it('treats new lending as a use of cash and deposits as a source', () => {
    // Loans grew by 180k disbursed − 60k repaid = 120k.
    expect(cf.operating.rows.find((r) => r.id === 'd_loans').value).toBe(-120000);
    expect(cf.operating.rows.find((r) => r.id === 'd_savings').value).toBe(210000);
  });

  it('puts share capital and dividends paid in financing', () => {
    expect(cf.financing.rows.find((r) => r.id === 'd_share').value).toBe(100000);
    expect(cf.financing.rows.find((r) => r.id === 'div_paid').value).toBe(-15000);
  });

  it('puts equipment and fixed-deposit purchases in investing', () => {
    expect(cf.investing.total).toBe(-150000);
  });

  it('still reconciles when a loan is written off against the provision', () => {
    const withWriteOff = [...PERIOD, ['1190', '1100', 5000]];
    const p = indexTrialBalance(toTrialBalance(withWriteOff));
    const c = indexTrialBalance(toTrialBalance([...OPENING, ...withWriteOff]));
    const surplus = buildIncomeStatement(p).netSurplus;
    expect(buildCashFlow(p, openingTb, c, surplus).reconciles).toBe(true);
    expect(buildBalanceSheet(c).balances).toBe(true);
  });

  it('still reconciles when intangibles are amortised straight off the asset', () => {
    const withAmort = [...PERIOD, ['1400', '1020', 60000], ['5410', '1400', 5000]];
    const p = indexTrialBalance(toTrialBalance(withAmort));
    const c = indexTrialBalance(toTrialBalance([...OPENING, ...withAmort]));
    const surplus = buildIncomeStatement(p).netSurplus;
    expect(buildCashFlow(p, openingTb, c, surplus).reconciles).toBe(true);
    expect(buildBalanceSheet(c).balances).toBe(true);
  });
});

describe('appropriation waterfall (§2.4)', () => {
  const rules = [
    { id: 'a', sort_order: 1, rule_type: 'statutory_reserve', name: 'Statutory Reserve', percent: 20, target_account: '3100', is_mandatory: true },
    { id: 'b', sort_order: 2, rule_type: 'education',   name: 'Education Fund',   percent: 5,  target_account: '3300' },
    { id: 'c', sort_order: 3, rule_type: 'development', name: 'Development Fund', percent: 5,  target_account: '3310' },
    { id: 'd', sort_order: 4, rule_type: 'dividend',    name: 'Dividend',         percent: 10, target_account: '2210' },
  ];

  it('takes the statutory reserve first and leaves the remainder distributable', () => {
    const a = buildAppropriation(1000000, rules);
    expect(a.lines[0].name).toBe('Statutory Reserve');
    expect(a.lines[0].amount).toBe(200000);
    expect(a.totalAppropriated).toBe(400000);
    expect(a.availableForDistribution).toBe(600000);
  });

  it('never appropriates more than the surplus', () => {
    const greedy = rules.map((r) => ({ ...r, percent: 40 }));
    const a = buildAppropriation(100000, greedy);
    expect(a.totalAppropriated).toBeLessThanOrEqual(100000);
    expect(a.availableForDistribution).toBe(0);
  });

  it('appropriates nothing out of a deficit', () => {
    const a = buildAppropriation(-50000, rules);
    expect(a.totalAppropriated).toBe(0);
    expect(a.availableForDistribution).toBe(-50000);
  });

  it('honours the configured order and skips inactive rules', () => {
    const a = buildAppropriation(100000, [
      ...rules.slice(0, 1),
      { ...rules[1], is_active: false },
    ]);
    expect(a.lines).toHaveLength(1);
    expect(a.totalAppropriated).toBe(20000);
  });
});

describe('loan aging and provisioning (§2.5)', () => {
  const policy = [
    { classification: 'performing',  min_days: 0,   max_days: 30,   provision_pct: 1,   sort_order: 1 },
    { classification: 'watch',       min_days: 31,  max_days: 180,  provision_pct: 5,   sort_order: 2 },
    { classification: 'substandard', min_days: 181, max_days: 360,  provision_pct: 25,  sort_order: 3 },
    { classification: 'doubtful',    min_days: 361, max_days: 540,  provision_pct: 50,  sort_order: 4 },
    { classification: 'loss',        min_days: 541, max_days: null, provision_pct: 100, sort_order: 5 },
  ];

  it('maps a day count to its band, including the open-ended loss bucket', () => {
    expect(classifyByDays(0, policy).classification).toBe('performing');
    expect(classifyByDays(45, policy).classification).toBe('watch');
    expect(classifyByDays(200, policy).classification).toBe('substandard');
    expect(classifyByDays(5000, policy).classification).toBe('loss');
  });

  it('ages from the OLDEST unpaid past-due instalment', () => {
    const asOf = new Date('2026-07-25');
    const rows = [
      { period_no: 1, due_date: '2026-05-25', paid: true },
      { period_no: 2, due_date: '2026-06-25', paid: false },
      { period_no: 3, due_date: '2026-07-25', paid: false },
    ];
    expect(daysInArrears(rows, asOf)).toBe(30);
  });

  it('reads outstanding principal off the first unpaid schedule row', () => {
    const loan = { principal: 100000 };
    const rows = [
      { period_no: 1, opening_balance: 100000, paid: true },
      { period_no: 2, opening_balance: 70000,  paid: false },
      { period_no: 3, opening_balance: 35000,  paid: false },
    ];
    expect(outstandingPrincipal(loan, rows)).toBe(70000);
  });

  it('reports nothing outstanding once every instalment is paid', () => {
    expect(outstandingPrincipal({ principal: 100000 }, [
      { period_no: 1, opening_balance: 100000, paid: true },
      { period_no: 2, opening_balance: 50000,  paid: true },
    ])).toBe(0);
  });

  it('provisions the whole book and reports portfolio at risk', () => {
    const asOf = new Date('2026-07-25');
    const loans = [
      { id: 'L1', member_id: 'M1', status: 'active', principal: 100000 },
      { id: 'L2', member_id: 'M2', status: 'active', principal: 100000 },
    ];
    const schedules = [
      { loan_id: 'L1', period_no: 1, opening_balance: 100000, due_date: '2026-08-25', paid: false },
      { loan_id: 'L2', period_no: 1, opening_balance: 80000,  due_date: '2025-12-25', paid: false },
    ];
    const r = runProvisioning({ loans, schedules, policy, asOf });

    expect(r.grossPortfolio).toBe(180000);
    // L1 is not yet due → performing at 1%. L2 is ~212 days late → substandard at 25%.
    expect(r.requiredProvision).toBe(1000 + 20000);
    expect(r.portfolioAtRisk).toBe(80000);
    expect(r.parRatio).toBe(44.44);
  });

  it('ignores loans that are not on the book', () => {
    const r = runProvisioning({
      loans: [{ id: 'L1', member_id: 'M1', status: 'pending', principal: 100000 }],
      schedules: [], policy, asOf: new Date(),
    });
    expect(r.rows).toHaveLength(0);
  });
});

describe('depreciation', () => {
  it('charges straight line pro rata and separates intangible amortisation', () => {
    const r = computeDepreciation({
      assets: [
        { id: 'A', asset_name: 'Computers', gl_code: '1320', cost: 120000, residual_value: 0, useful_life_years: 4, method: 'straight_line', accumulated_depreciation: 0, acquisition_date: '2026-01-01' },
        { id: 'B', asset_name: 'Core system', gl_code: '1400', cost: 240000, residual_value: 0, useful_life_years: 5, method: 'straight_line', accumulated_depreciation: 0, acquisition_date: '2026-01-01' },
      ],
      months: 1, asOf: new Date('2026-07-31'),
    });
    expect(r.depreciation).toBe(2500);   // 120000 / 4 / 12
    expect(r.amortisation).toBe(4000);   // 240000 / 5 / 12
    expect(r.total).toBe(6500);
  });

  it('never depreciates below the residual value', () => {
    const r = computeDepreciation({
      assets: [{
        id: 'A', asset_name: 'Van', gl_code: '1330', cost: 100000, residual_value: 20000,
        useful_life_years: 1, method: 'straight_line', accumulated_depreciation: 79000,
        acquisition_date: '2025-01-01',
      }],
      months: 1, asOf: new Date('2026-07-31'),
    });
    expect(r.total).toBe(1000);          // only 1000 of depreciable amount left
  });

  it('skips disposed assets', () => {
    const r = computeDepreciation({
      assets: [{ id: 'A', asset_name: 'Old desk', gl_code: '1310', cost: 50000, useful_life_years: 5, is_disposed: true, accumulated_depreciation: 0 }],
      months: 1,
    });
    expect(r.total).toBe(0);
  });
});

describe('member sub-ledger (§8)', () => {
  const members = [
    { id: 'M1', full_name: 'Asha', member_no: '001', status: 'active' },
    { id: 'M2', full_name: 'Baraka', member_no: '002', status: 'active' },
  ];
  const contributions = [
    { member_id: 'M1', amount: 30000, status: 'paid' },
    { member_id: 'M1', amount: 10000, status: 'pending' },
    { member_id: 'M2', amount: 20000, status: 'paid' },
  ];
  const shares = [
    { member_id: 'M1', shares_held: 100, par_value: 100 },
    { member_id: 'M2', shares_held: 50,  par_value: 100 },
  ];
  const loans = [{ id: 'L1', member_id: 'M1', status: 'active', principal: 50000 }];
  const schedules = [{ loan_id: 'L1', period_no: 1, opening_balance: 40000, paid: false }];

  const sub = buildMemberSubLedger({ members, contributions, shares, loans, schedules });

  it('carries three parallel balances per member and excludes unpaid contributions', () => {
    const asha = sub.rows.find((r) => r.memberId === 'M1');
    expect(asha.shareCapital).toBe(10000);
    expect(asha.savings).toBe(30000);      // the pending 10000 is not yet savings
    expect(asha.loanBalance).toBe(40000);
    expect(asha.netPosition).toBe(0);
  });

  it('reconciles each column against its own GL control account', () => {
    const tb = indexTrialBalance(toTrialBalance([
      ['1020', '3010', 15000],   // share capital control
      ['1020', '2010', 50000],   // savings control
      ['1100', '1020', 40000],   // loans control
    ]));
    const checks = reconcileControlAccounts(sub.totals, tb);
    expect(checks.find((c) => c.label === 'Share Capital').ok).toBe(true);
    expect(checks.find((c) => c.label === 'Member Savings').ok).toBe(true);
    expect(checks.find((c) => c.label === 'Loans to Members').ok).toBe(true);
  });

  it('flags a control account that has drifted from the sub-ledger', () => {
    const tb = indexTrialBalance(toTrialBalance([['1020', '2010', 999]]));
    const savings = reconcileControlAccounts(sub.totals, tb).find((c) => c.label === 'Member Savings');
    expect(savings.ok).toBe(false);
    expect(savings.difference).toBe(50000 - 999);
  });
});

describe('loanable funds ceiling (§9.2)', () => {
  it('caps lending at a multiple of members own shares and savings', () => {
    const r = loanableFundsCheck({ shareCapital: 100000, savings: 300000, loansOut: 900000, multiple: 3 });
    expect(r.ceiling).toBe(1200000);
    expect(r.headroom).toBe(300000);
    expect(r.breached).toBe(false);
  });

  it('flags a breach', () => {
    const r = loanableFundsCheck({ shareCapital: 100000, savings: 100000, loansOut: 900000, multiple: 3 });
    expect(r.breached).toBe(true);
  });
});

describe('merry-go-round statement (§9.4)', () => {
  const members = [
    { id: 'M1', full_name: 'Asha',   member_no: '001', status: 'active' },
    { id: 'M2', full_name: 'Baraka', member_no: '002', status: 'active' },
    { id: 'M3', full_name: 'Chege',  member_no: '003', status: 'active' },
  ];
  const cycles = [
    { id: 'C1', cycle_no: 1, cycle_date: '2026-05-01', contribution_per_member: 1000, beneficiary_member_id: 'M1', payout_amount: 3000, status: 'paid' },
    { id: 'C2', cycle_no: 2, cycle_date: '2026-06-01', contribution_per_member: 1000, beneficiary_member_id: 'M2', payout_amount: 2000, status: 'paid' },
  ];
  const mgrContributions = [
    { cycle_id: 'C1', member_id: 'M1', amount: 1000, paid: true },
    { cycle_id: 'C1', member_id: 'M2', amount: 1000, paid: true },
    { cycle_id: 'C1', member_id: 'M3', amount: 1000, paid: true },
    { cycle_id: 'C2', member_id: 'M1', amount: 1000, paid: true },
    { cycle_id: 'C2', member_id: 'M2', amount: 1000, paid: true },
    { cycle_id: 'C2', member_id: 'M3', amount: 1000, paid: false },
  ];

  const st = buildMgrStatement({ cycles, mgrContributions, members });

  it('reconciles a cycle where collections equal the payout', () => {
    const c1 = st.rows.find((r) => r.cycleNo === 1);
    expect(c1.collected).toBe(3000);
    expect(c1.reconciles).toBe(true);
  });

  it('flags a cycle where a member has not paid in but the payout still went out', () => {
    const c2 = st.rows.find((r) => r.cycleNo === 2);
    expect(c2.collected).toBe(2000);
    expect(c2.outstanding).toBe(1000);
    expect(c2.reconciles).toBe(true);      // 2000 collected, 2000 paid out
  });

  it('tracks each member position across cycles', () => {
    const chege = st.perMember.find((p) => p.memberId === 'M3');
    expect(chege.contributed).toBe(1000);  // only cycle 1
    expect(chege.received).toBe(0);
    expect(chege.net).toBe(-1000);
    expect(st.totalContributed).toBe(5000);
    expect(st.totalPaidOut).toBe(5000);
  });
});
