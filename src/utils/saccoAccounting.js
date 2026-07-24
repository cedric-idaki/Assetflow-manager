/**
 * SACCO / CHAMA ACCOUNTING ENGINE (pure functions)
 *
 * Report generation and the period-end batch calculators from the
 * "SACCO / Chama Financial Accounting System" specification:
 *
 *   §10.3  Trial Balance is the single source of truth; the Income Statement,
 *          Balance Sheet and Cash Flow Statement are all derived from it via
 *          the ReportDefinition mappings in src/config/saccoAccountingConfig.js.
 *   §7     The Cash Flow Statement is DERIVED, never entered — and it is
 *          reconciled back to the actual movement in 1010/1011/1020/1021.
 *   §2.5   Loan aging → classification → provisioning.
 *   §2.4   The surplus appropriation waterfall.
 *   §9.4   The merry-go-round Statement of Contributions and Payouts.
 *
 * Nothing here touches the DOM, Supabase or React — every function takes plain
 * data and returns plain data, so the numbers are testable in isolation.
 *
 * SACCO/CHAMA ONLY.
 */

import {
  INCOME_STATEMENT_DEF,
  BALANCE_SHEET_DEF,
  CASH_FLOW_DEF,
  CASH_ACCOUNTS,
} from '../config/saccoAccountingConfig';

export const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

const num = (n) => Number(n) || 0;

/**
 * Index a `sacco_trial_balance()` result set by account code.
 * Each row already carries `balance` signed by the account's normal balance,
 * so a contra-asset like 1190 reads as a positive provision.
 */
export const indexTrialBalance = (rows = []) => {
  const map = {};
  rows.forEach((r) => {
    map[r.account_code] = {
      code:    r.account_code,
      name:    r.account_name,
      klass:   r.account_class,
      normal:  r.normal_balance,
      contra:  r.is_contra,
      segment: r.segment,
      debit:   num(r.total_debit),
      credit:  num(r.total_credit),
      balance: num(r.balance),
    };
  });
  return map;
};

/** Signed balance for a set of codes. */
export const sumBalances = (tbMap, codes = []) =>
  round2(codes.reduce((s, c) => s + num(tbMap[c]?.balance), 0));

/** Total debits booked to a set of codes (used for actual cash-out lines). */
export const sumDebits = (tbMap, codes = []) =>
  round2(codes.reduce((s, c) => s + num(tbMap[c]?.debit), 0));

/** Class totals — used for the Assets = Liabilities + Equity integrity check. */
export const classTotal = (tbMap, klass) =>
  round2(Object.values(tbMap).filter((a) => a.klass === klass)
    .reduce((s, a) => s + a.balance, 0));

/**
 * Surplus recognised to date (or for the period, depending on which trial
 * balance is passed): income less expenses. This is what keeps
 * Assets = Liabilities + Equity true while income/expense accounts stay open.
 */
export const netSurplusOf = (tbMap) =>
  round2(classTotal(tbMap, 'income') - classTotal(tbMap, 'expense'));

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC REPORT BUILDER
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Resolve a ReportDefinition section against a trial balance.
 * Returns [{ id, label, value, kind, emphasis, strong, codes }] plus a lookup.
 */
const buildSection = (def, tbMap, opts = {}) => {
  const values = {};
  const rows = [];

  def.forEach((line) => {
    let value = 0;

    if (line.kind === 'subtotal') {
      value = round2((line.of || []).reduce((s, id) => s + num(values[id]), 0));
    } else if (line.kind === 'surplus_to_date') {
      value = opts.surplusToDate ?? netSurplusOf(tbMap);
    } else {
      value = round2(sumBalances(tbMap, line.codes) * (line.sign ?? 1));
    }

    values[line.id] = value;

    if (line.hideIfZero && value === 0) return;
    rows.push({
      id: line.id,
      label: line.label,
      value,
      kind: line.kind || 'line',
      codes: line.codes || [],
      emphasis: !!line.emphasis,
      strong: !!line.strong,
    });
  });

  return { rows, values };
};

// ─────────────────────────────────────────────────────────────────────────────
// §5 INCOME STATEMENT
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param periodTb  trial balance for the reporting period
 * @param priorTb   optional trial balance for the comparative period
 */
export const buildIncomeStatement = (periodTb, priorTb = null) => {
  const cur = buildSection(INCOME_STATEMENT_DEF, periodTb);
  const prior = priorTb ? buildSection(INCOME_STATEMENT_DEF, priorTb) : null;

  const rows = cur.rows.map((r) => ({
    ...r,
    prior: prior ? (prior.values[r.id] ?? 0) : null,
  }));

  return {
    rows,
    netSurplus: cur.values.net_surplus ?? 0,
    totalIncome: cur.values.total_income ?? 0,
    netInterestIncome: cur.values.nii ?? 0,
    priorNetSurplus: prior ? (prior.values.net_surplus ?? 0) : null,
  };
};

/**
 * §5 tail — the appropriation block that turns Net Surplus into
 * "Surplus Available for Distribution". Driven by sacco_appropriation_rules,
 * never by a hard-coded percentage (§2.4).
 */
export const buildAppropriation = (netSurplus, rules = []) => {
  const base = round2(netSurplus);
  const active = [...rules]
    .filter((r) => r.is_active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  let remaining = base;
  const lines = active.map((r) => {
    const pct = num(r.percent);
    // Each rule takes its percentage of the ORIGINAL surplus (the standard
    // co-operative reading of "20% of net surplus"), capped at what is left.
    const raw = round2(base * pct / 100);
    const amount = base >= 0 ? Math.min(raw, Math.max(remaining, 0)) : 0;
    remaining = round2(remaining - amount);
    return {
      id: r.id,
      ruleType: r.rule_type,
      name: r.name,
      percent: pct,
      targetAccount: r.target_account,
      isMandatory: !!r.is_mandatory,
      amount: round2(amount),
    };
  });

  return {
    netSurplus: base,
    lines,
    totalAppropriated: round2(lines.reduce((s, l) => s + l.amount, 0)),
    availableForDistribution: round2(remaining),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// §6 BALANCE SHEET
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param asAtTb  CUMULATIVE trial balance as at the reporting date
 *                (sacco_trial_balance(NULL, asAtDate)).
 */
export const buildBalanceSheet = (asAtTb) => {
  const surplusToDate = netSurplusOf(asAtTb);

  const assets      = buildSection(BALANCE_SHEET_DEF.assets, asAtTb);
  const liabilities = buildSection(BALANCE_SHEET_DEF.liabilities, asAtTb);
  const equity      = buildSection(BALANCE_SHEET_DEF.equity, asAtTb, { surplusToDate });

  const totalAssets      = assets.values.total_assets ?? 0;
  const totalLiabilities = liabilities.values.total_liab ?? 0;
  const totalEquity      = equity.values.total_equity ?? 0;
  const difference       = round2(totalAssets - totalLiabilities - totalEquity);

  return {
    assets: assets.rows,
    liabilities: liabilities.rows,
    equity: equity.rows,
    totalAssets,
    totalLiabilities,
    totalEquity,
    surplusToDate,
    // §6 "this equality is the core system integrity check"
    balances: Math.abs(difference) < 0.01,
    difference,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// §7 CASH FLOW STATEMENT (indirect method) — derived, never entered
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param periodTb   movements during the period  (from, to)
 * @param openingTb  cumulative balances as at the day before the period start
 * @param closingTb  cumulative balances as at the period end
 * @param netSurplus net surplus for the period (from the Income Statement)
 */
export const buildCashFlow = (periodTb, openingTb, closingTb, netSurplus) => {
  const delta = (codes) => round2(sumBalances(closingTb, codes) - sumBalances(openingTb, codes));

  const resolve = (line) => {
    switch (line.source) {
      case 'surplus':  return round2(netSurplus);
      case 'charge':   return round2(sumBalances(periodTb, line.codes));
      case 'cash_out': return round2(-sumDebits(periodTb, line.codes));
      case 'delta_gross':
        return round2((delta(line.codes) + sumBalances(periodTb, line.chargeCodes)) * (line.flow ?? 1));
      case 'delta':
      default:         return round2(delta(line.codes) * (line.flow ?? 1));
    }
  };

  const section = (lines) => {
    const rows = lines.map((l) => ({ id: l.id, label: l.label, value: resolve(l) }));
    return { rows, total: round2(rows.reduce((s, r) => s + r.value, 0)) };
  };

  const operating = section(CASH_FLOW_DEF.operating);
  const investing = section(CASH_FLOW_DEF.investing);
  const financing = section(CASH_FLOW_DEF.financing);

  const netChange   = round2(operating.total + investing.total + financing.total);
  const openingCash = sumBalances(openingTb, CASH_ACCOUNTS);
  const closingCash = sumBalances(closingTb, CASH_ACCOUNTS);
  const actualChange = round2(closingCash - openingCash);
  const variance     = round2(netChange - actualChange);

  return {
    operating, investing, financing,
    netChange, openingCash, closingCash, actualChange,
    // §7 "This reconciliation is the second system integrity check"
    reconciles: Math.abs(variance) < 0.01,
    variance,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// §2.5 LOAN AGING, CLASSIFICATION AND PROVISIONING
// ─────────────────────────────────────────────────────────────────────────────
const DAY_MS = 86400000;

/**
 * Days in arrears for a loan = age of its oldest unpaid, past-due instalment.
 */
export const daysInArrears = (scheduleRows = [], asOf = new Date()) => {
  const due = scheduleRows
    .filter((r) => !r.paid && r.due_date && new Date(r.due_date) < asOf)
    .map((r) => new Date(r.due_date).getTime());
  if (due.length === 0) return 0;
  return Math.max(0, Math.floor((asOf.getTime() - Math.min(...due)) / DAY_MS));
};

/** Outstanding principal = the closing balance of the last paid row, or the full principal. */
export const outstandingPrincipal = (loan, scheduleRows = []) => {
  const rows = [...scheduleRows].sort((a, b) => (a.period_no || 0) - (b.period_no || 0));
  const unpaid = rows.filter((r) => !r.paid);
  if (rows.length === 0) return round2(loan.principal);
  if (unpaid.length === 0) return 0;
  return round2(num(unpaid[0].opening_balance));
};

export const classifyByDays = (days, policy = []) => {
  const sorted = [...policy].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const hit = sorted.find((p) =>
    days >= num(p.min_days) && (p.max_days == null || days <= num(p.max_days)));
  return hit || sorted[sorted.length - 1] || null;
};

/**
 * Runs the aging + provisioning calculation across the loan book.
 * Returns the per-loan rows plus the total provision the balance sheet should
 * carry, so the batch job can post only the MOVEMENT against 1190/5300.
 */
export const runProvisioning = ({ loans = [], schedules = [], policy = [], asOf = new Date() }) => {
  const byLoan = {};
  schedules.forEach((s) => {
    (byLoan[s.loan_id] = byLoan[s.loan_id] || []).push(s);
  });

  const rows = loans
    .filter((l) => ['active', 'disbursed', 'defaulted'].includes(l.status))
    .map((loan) => {
      const rowsFor = byLoan[loan.id] || [];
      const outstanding = outstandingPrincipal(loan, rowsFor);
      const days = daysInArrears(rowsFor, asOf);
      const band = classifyByDays(days, policy);
      const pct = num(band?.provision_pct);
      return {
        loanId: loan.id,
        memberId: loan.member_id,
        memberName: loan.member?.full_name || '—',
        outstanding,
        daysInArrears: days,
        classification: band?.classification || 'performing',
        provisionPct: pct,
        provisionAmount: round2(outstanding * pct / 100),
      };
    });

  const requiredProvision = round2(rows.reduce((s, r) => s + r.provisionAmount, 0));
  const grossPortfolio    = round2(rows.reduce((s, r) => s + r.outstanding, 0));
  const atRisk = round2(rows
    .filter((r) => r.classification !== 'performing')
    .reduce((s, r) => s + r.outstanding, 0));

  return {
    rows,
    requiredProvision,
    grossPortfolio,
    portfolioAtRisk: atRisk,
    parRatio: grossPortfolio > 0 ? round2(atRisk / grossPortfolio * 100) : 0,
    byClass: rows.reduce((m, r) => {
      const b = (m[r.classification] = m[r.classification] || { count: 0, outstanding: 0, provision: 0 });
      b.count += 1;
      b.outstanding = round2(b.outstanding + r.outstanding);
      b.provision   = round2(b.provision + r.provisionAmount);
      return m;
    }, {}),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// §4 PERIOD-END ACCRUALS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Interest accrual on performing loans for a period: the interest column of
 * every schedule row falling inside the period that has not been collected yet.
 * Dr 1150 Interest Receivable / Cr 4010–4012 Interest Income.
 */
export const computeLoanInterestAccrual = ({ loans = [], schedules = [], periodStart, periodEnd }) => {
  const start = new Date(periodStart);
  const end   = new Date(periodEnd);
  const activeIds = new Set(loans.filter((l) => ['active', 'disbursed'].includes(l.status)).map((l) => l.id));

  const rows = schedules
    .filter((s) => activeIds.has(s.loan_id) && !s.paid && s.due_date)
    .filter((s) => {
      const d = new Date(s.due_date);
      return d >= start && d <= end;
    })
    .map((s) => ({ loanId: s.loan_id, periodNo: s.period_no, dueDate: s.due_date, interest: round2(s.interest) }))
    .filter((r) => r.interest > 0);

  return { rows, total: round2(rows.reduce((s, r) => s + r.interest, 0)) };
};

/**
 * Interest accrual on member deposits for a period.
 * Dr 5010 Interest Expense / Cr 2020 Interest Payable.
 * Simple pro-rata on the closing deposit liability at the society's declared
 * deposit rate — the by-law parameter, not a hard-coded number.
 */
export const computeDepositInterestAccrual = ({ depositBalance, annualRatePct, months = 1 }) =>
  round2(num(depositBalance) * num(annualRatePct) / 100 * (months / 12));

/**
 * Depreciation / amortisation for one period across the fixed asset register.
 * Straight line: (cost − residual) / life / 12 per month.
 * Reducing balance: net book value × (1/life) / 12 per month.
 * Never depreciates an asset below its residual value.
 */
export const computeDepreciation = ({ assets = [], months = 1, asOf = new Date() }) => {
  const rows = assets
    .filter((a) => !a.is_disposed && num(a.cost) > 0 && num(a.useful_life_years) > 0)
    .filter((a) => !a.acquisition_date || new Date(a.acquisition_date) <= asOf)
    .map((a) => {
      const cost     = num(a.cost);
      const residual = num(a.residual_value);
      const accum    = num(a.accumulated_depreciation);
      const life     = num(a.useful_life_years);
      const nbv      = round2(cost - accum);

      const charge = a.method === 'reducing'
        ? round2(nbv / life * (months / 12))
        : round2((cost - residual) / life * (months / 12));

      const depreciable = round2(Math.max(nbv - residual, 0));
      const applied = round2(Math.min(charge, depreciable));

      return {
        assetId: a.id,
        assetName: a.asset_name,
        glCode: a.gl_code,
        isIntangible: String(a.gl_code) === '1400',
        cost, accumulated: accum, nbv,
        charge: applied,
      };
    })
    .filter((r) => r.charge > 0);

  return {
    rows,
    depreciation: round2(rows.filter((r) => !r.isIntangible).reduce((s, r) => s + r.charge, 0)),
    amortisation: round2(rows.filter((r) =>  r.isIntangible).reduce((s, r) => s + r.charge, 0)),
    total: round2(rows.reduce((s, r) => s + r.charge, 0)),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// §8 MEMBER SUB-LEDGER — three parallel balances per member
// ─────────────────────────────────────────────────────────────────────────────
/**
 * "One member ID must link to all three roles": owner (shares, equity),
 * depositor (savings, a liability) and borrower (loans, an asset). Each column
 * rolls up separately to its own GL control account.
 */
export const buildMemberSubLedger = ({ members = [], contributions = [], shares = [], loans = [], schedules = [] }) => {
  const byLoan = {};
  schedules.forEach((s) => { (byLoan[s.loan_id] = byLoan[s.loan_id] || []).push(s); });

  const savingsBy = {};
  contributions.filter((c) => c.status === 'paid').forEach((c) => {
    savingsBy[c.member_id] = round2(num(savingsBy[c.member_id]) + num(c.amount));
  });

  const sharesBy = {};
  shares.forEach((s) => {
    const v = (parseInt(s.shares_held, 10) || 0) * num(s.par_value);
    sharesBy[s.member_id] = round2(num(sharesBy[s.member_id]) + v);
    });

  const loansBy = {};
  loans.filter((l) => ['active', 'disbursed', 'defaulted'].includes(l.status)).forEach((l) => {
    loansBy[l.member_id] = round2(num(loansBy[l.member_id]) + outstandingPrincipal(l, byLoan[l.id] || []));
  });

  const rows = members.map((m) => {
    const shareCapital = num(sharesBy[m.id]);
    const savings      = num(savingsBy[m.id]);
    const loanBalance  = num(loansBy[m.id]);
    return {
      memberId: m.id,
      memberNo: m.member_no,
      name: m.full_name,
      status: m.status,
      shareCapital,     // → GL 3010 (EQUITY)
      savings,          // → GL 2010 (LIABILITY)
      loanBalance,      // → GL 1100 (ASSET)
      netPosition: round2(shareCapital + savings - loanBalance),
    };
  });

  return {
    rows,
    totals: {
      shareCapital: round2(rows.reduce((s, r) => s + r.shareCapital, 0)),
      savings:      round2(rows.reduce((s, r) => s + r.savings, 0)),
      loanBalance:  round2(rows.reduce((s, r) => s + r.loanBalance, 0)),
    },
  };
};

/**
 * Reconciles each member sub-ledger column against its GL control account
 * (§8 "must each roll up separately into the GL control accounts").
 */
export const reconcileControlAccounts = (subLedgerTotals, tbMap) => {
  const check = (label, subledger, codes) => {
    const gl = sumBalances(tbMap, codes);
    const diff = round2(subledger - gl);
    return { label, codes, subledger: round2(subledger), gl, difference: diff, ok: Math.abs(diff) < 0.01 };
  };
  return [
    check('Share Capital',      subLedgerTotals.shareCapital, ['3010', '3020']),
    check('Member Savings',     subLedgerTotals.savings,      ['2010', '2011', '2012', '2013']),
    check('Loans to Members',   subLedgerTotals.loanBalance,  ['1100', '1101', '1102', '1103']),
  ];
};

// ─────────────────────────────────────────────────────────────────────────────
// §9.2 BOSA loanable-funds ceiling
// ─────────────────────────────────────────────────────────────────────────────
export const loanableFundsCheck = ({ shareCapital, savings, loansOut, multiple }) => {
  const base    = round2(num(shareCapital) + num(savings));
  const ceiling = round2(base * num(multiple));
  return {
    base, ceiling,
    loansOut: round2(loansOut),
    headroom: round2(ceiling - num(loansOut)),
    utilisation: ceiling > 0 ? round2(num(loansOut) / ceiling * 100) : 0,
    breached: num(loansOut) > ceiling,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// §9.4 STATEMENT OF CONTRIBUTIONS AND PAYOUTS (merry-go-round)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Columns = members, rows = cycles. Each cell shows what a member contributed
 * in that cycle; the beneficiary column shows what they received when it was
 * their turn. Every cycle carries its own contributions-vs-payout reconciliation.
 */
export const buildMgrStatement = ({ cycles = [], mgrContributions = [], members = [] }) => {
  const byCycle = {};
  mgrContributions.forEach((c) => { (byCycle[c.cycle_id] = byCycle[c.cycle_id] || []).push(c); });

  const memberList = members
    .filter((m) => m.status === 'active')
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));

  const rows = [...cycles]
    .sort((a, b) => (a.cycle_no || 0) - (b.cycle_no || 0))
    .map((cy) => {
      const contribs = byCycle[cy.id] || [];
      const cells = {};
      contribs.forEach((c) => {
        cells[c.member_id] = { amount: num(c.amount), paid: !!c.paid, paidDate: c.paid_date };
      });
      const collected = round2(contribs.filter((c) => c.paid).reduce((s, c) => s + num(c.amount), 0));
      const expected  = round2(memberList.length * num(cy.contribution_per_member));
      const payout    = num(cy.payout_amount);
      return {
        cycleId: cy.id,
        cycleNo: cy.cycle_no,
        label: cy.label || `Cycle ${cy.cycle_no}`,
        date: cy.cycle_date,
        status: cy.status,
        beneficiaryId: cy.beneficiary_member_id,
        beneficiaryName: members.find((m) => m.id === cy.beneficiary_member_id)?.full_name || '—',
        contributionPerMember: num(cy.contribution_per_member),
        cells,
        expected,
        collected,
        outstanding: round2(expected - collected),
        payout,
        // §9.4 "a running reconciliation that total contributions collected in a
        // cycle equal the payout made that cycle"
        reconciles: Math.abs(round2(collected - payout)) < 0.01,
        variance: round2(collected - payout),
      };
    });

  const perMember = memberList.map((m) => {
    const contributed = round2(rows.reduce((s, r) => s + (r.cells[m.id]?.paid ? r.cells[m.id].amount : 0), 0));
    const received    = round2(rows.filter((r) => r.beneficiaryId === m.id && r.status === 'paid')
      .reduce((s, r) => s + r.payout, 0));
    return { memberId: m.id, name: m.full_name, memberNo: m.member_no, contributed, received, net: round2(received - contributed) };
  });

  return {
    members: memberList,
    rows,
    perMember,
    totalContributed: round2(perMember.reduce((s, p) => s + p.contributed, 0)),
    totalPaidOut:     round2(perMember.reduce((s, p) => s + p.received, 0)),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// §9.5 WELFARE FUND POSITION
// ─────────────────────────────────────────────────────────────────────────────
export const buildWelfarePosition = ({ claims = [], tbMap = {} }) => {
  const sum = (pred) => round2(claims.filter(pred).reduce((s, c) => s + num(c.amount_approved), 0));
  const fundBalance = sumBalances(tbMap, ['2310', '3320']);
  const approvedUnpaid = sum((c) => c.status === 'approved');
  return {
    fundBalance,
    pending:   round2(claims.filter((c) => c.status === 'pending').reduce((s, c) => s + num(c.amount_requested), 0)),
    approvedUnpaid,
    paid:      round2(claims.filter((c) => c.status === 'paid').reduce((s, c) => s + num(c.amount_paid), 0)),
    available: round2(fundBalance - approvedUnpaid),
    counts: {
      pending:  claims.filter((c) => c.status === 'pending').length,
      approved: claims.filter((c) => c.status === 'approved').length,
      paid:     claims.filter((c) => c.status === 'paid').length,
      rejected: claims.filter((c) => c.status === 'rejected').length,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers shared by the finance tabs
// ─────────────────────────────────────────────────────────────────────────────
export const fmtMoney = (n, currency = 'KES') => {
  const v = num(n);
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${currency} ${s})` : `${currency} ${s}`;
};

export const fmtPlain = (n) => {
  const v = num(n);
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

/** First and last day of the month containing `d`, as YYYY-MM-DD. */
export const monthBounds = (d = new Date()) => {
  const dt = new Date(d);
  const start = new Date(dt.getFullYear(), dt.getMonth(), 1);
  const end   = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { start: iso(start), end: iso(end) };
};

export const dayBefore = (isoDate) => {
  const d = new Date(isoDate);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
