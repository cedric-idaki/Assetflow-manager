/**
 * SACCO LOAN AMORTIZATION ENGINE
 *
 * Pure, dependency-free implementations of the five amortization methods defined
 * in the Chama Management System BRS v3.0 §4. Each builder returns a normalized
 * schedule so the Loans tab can render it and the dashboard can persist rows to
 * public.sacco_loan_schedule.
 *
 * Conventions:
 *   principal    – initial loan amount P (KES)
 *   annualRate   – nominal annual interest rate as a percentage (e.g. 12 = 12% p.a.)
 *   termMonths   – number of monthly instalments n
 *   balloonAmount– lump sum due at the end (balloon method only)
 *
 * Monthly rate r = annualRate / 100 / 12.
 *
 * Every method reconciles the final period so the closing balance is exactly 0
 * and the principal portions sum to P (rounding is absorbed in the last row).
 *
 * Row shape (camelCase; the dashboard maps these to sacco_loan_schedule columns):
 *   { periodNo, openingBalance, interest, principal, payment, closingBalance }
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Monthly rate from an annual percentage. */
const monthlyRate = (annualRate) => (Number(annualRate) || 0) / 100 / 12;

/**
 * Standard EMI factor: r(1+r)^n / ((1+r)^n − 1).
 * Falls back to 1/n when r = 0 (interest-free loan → equal instalments).
 */
const emiFactor = (r, n) => {
  if (r === 0) return 1 / n;
  const p = Math.pow(1 + r, n);
  return (r * p) / (p - 1);
};

const summarize = (schedule, principal) => {
  const totalInterest = round2(schedule.reduce((s, row) => s + row.interest, 0));
  const totalPaid = round2(schedule.reduce((s, row) => s + row.payment, 0));
  return {
    principal: round2(principal),
    totalInterest,
    totalPaid,
    periods: schedule.length,
  };
};

// ── Method 1: Reducing Balance (EMI / Equal Instalment) ─────────────────────
export const reducingBalance = ({ principal, annualRate, termMonths }) => {
  const P = Number(principal) || 0;
  const n = parseInt(termMonths, 10) || 0;
  const r = monthlyRate(annualRate);
  const schedule = [];
  if (P <= 0 || n <= 0) return { schedule, summary: summarize(schedule, P) };

  const emi = P * emiFactor(r, n);
  let balance = P;
  for (let t = 1; t <= n; t++) {
    const interest = balance * r;
    // Final period clears whatever remains so rounding never leaves a residue.
    const principalPortion = t === n ? balance : emi - interest;
    const payment = principalPortion + interest;
    const closing = t === n ? 0 : balance - principalPortion;
    schedule.push({
      periodNo: t,
      openingBalance: round2(balance),
      interest: round2(interest),
      principal: round2(principalPortion),
      payment: round2(payment),
      closingBalance: round2(closing),
    });
    balance = closing;
  }
  return { schedule, summary: summarize(schedule, P) };
};

// ── Method 2: Equal Principal ───────────────────────────────────────────────
export const equalPrincipal = ({ principal, annualRate, termMonths }) => {
  const P = Number(principal) || 0;
  const n = parseInt(termMonths, 10) || 0;
  const r = monthlyRate(annualRate);
  const schedule = [];
  if (P <= 0 || n <= 0) return { schedule, summary: summarize(schedule, P) };

  const principalPayment = P / n;
  let balance = P;
  for (let t = 1; t <= n; t++) {
    const interest = balance * r;
    const principalPortion = t === n ? balance : principalPayment;
    const payment = principalPortion + interest;
    const closing = t === n ? 0 : balance - principalPortion;
    schedule.push({
      periodNo: t,
      openingBalance: round2(balance),
      interest: round2(interest),
      principal: round2(principalPortion),
      payment: round2(payment),
      closingBalance: round2(closing),
    });
    balance = closing;
  }
  return { schedule, summary: summarize(schedule, P) };
};

// ── Method 3: Flat Rate ─────────────────────────────────────────────────────
// Interest charged once on the full original principal, split equally.
export const flatRate = ({ principal, annualRate, termMonths }) => {
  const P = Number(principal) || 0;
  const n = parseInt(termMonths, 10) || 0;
  const rateFraction = (Number(annualRate) || 0) / 100;
  const schedule = [];
  if (P <= 0 || n <= 0) return { schedule, summary: summarize(schedule, P) };

  const totalInterest = P * rateFraction * (n / 12);
  const interestPart = totalInterest / n;
  const principalPart = P / n;
  let balance = P;
  for (let t = 1; t <= n; t++) {
    const principalPortion = t === n ? balance : principalPart;
    const payment = principalPortion + interestPart;
    const closing = t === n ? 0 : balance - principalPortion;
    schedule.push({
      periodNo: t,
      openingBalance: round2(balance),
      interest: round2(interestPart),
      principal: round2(principalPortion),
      payment: round2(payment),
      closingBalance: round2(closing),
    });
    balance = closing;
  }
  return { schedule, summary: summarize(schedule, P) };
};

// ── Method 4: Interest Only ─────────────────────────────────────────────────
// Interest each period; full principal repaid as a lump sum at the end.
export const interestOnly = ({ principal, annualRate, termMonths }) => {
  const P = Number(principal) || 0;
  const n = parseInt(termMonths, 10) || 0;
  const r = monthlyRate(annualRate);
  const schedule = [];
  if (P <= 0 || n <= 0) return { schedule, summary: summarize(schedule, P) };

  const interest = P * r;
  for (let t = 1; t <= n; t++) {
    const isFinal = t === n;
    const principalPortion = isFinal ? P : 0;
    const payment = interest + principalPortion;
    schedule.push({
      periodNo: t,
      openingBalance: round2(P),
      interest: round2(interest),
      principal: round2(principalPortion),
      payment: round2(payment),
      closingBalance: isFinal ? 0 : round2(P),
    });
  }
  return { schedule, summary: summarize(schedule, P) };
};

// ── Method 5: Balloon Payment ───────────────────────────────────────────────
// Reduced periodic payments amortize the balance down toward the balloon; the
// final period clears the whole remaining balance (≈ periodic + balloon), so it
// reconciles to 0. NOTE: the BRS §4.5 worked table is illustrative/approximate;
// this uses the closed-form periodic payment from the same section's formula.
export const balloon = ({ principal, annualRate, termMonths, balloonAmount }) => {
  const P = Number(principal) || 0;
  const n = parseInt(termMonths, 10) || 0;
  const r = monthlyRate(annualRate);
  const B = Math.min(Number(balloonAmount) || 0, P);
  const schedule = [];
  if (P <= 0 || n <= 0) return { schedule, summary: summarize(schedule, P) };

  // periodic = P·emiFactor − B·(r / ((1+r)^n − 1)); with r=0 it degrades to (P−B)/n.
  let periodic;
  if (r === 0) {
    periodic = (P - B) / n;
  } else {
    const pow = Math.pow(1 + r, n);
    periodic = P * emiFactor(r, n) - B * (r / (pow - 1));
  }

  let balance = P;
  for (let t = 1; t <= n; t++) {
    const interest = balance * r;
    // Final period repays the entire remaining balance (the balloon) in full.
    const principalPortion = t === n ? balance : periodic - interest;
    const payment = principalPortion + interest;
    const closing = t === n ? 0 : balance - principalPortion;
    schedule.push({
      periodNo: t,
      openingBalance: round2(balance),
      interest: round2(interest),
      principal: round2(principalPortion),
      payment: round2(payment),
      closingBalance: round2(closing),
    });
    balance = closing;
  }
  return { schedule, summary: { ...summarize(schedule, P), periodicPayment: round2(periodic), balloonAmount: round2(B) } };
};

// ── Dispatcher ──────────────────────────────────────────────────────────────
export const AMORTIZATION_METHODS = [
  { id: 'reducing_balance', label: 'Reducing Balance (EMI)' },
  { id: 'equal_principal',  label: 'Equal Principal' },
  { id: 'flat_rate',        label: 'Flat Rate' },
  { id: 'interest_only',    label: 'Interest Only' },
  { id: 'balloon',          label: 'Balloon Payment' },
];

const BUILDERS = {
  reducing_balance: reducingBalance,
  equal_principal: equalPrincipal,
  flat_rate: flatRate,
  interest_only: interestOnly,
  balloon,
};

/**
 * Generate an amortization schedule for any supported method.
 * @param {string} method one of AMORTIZATION_METHODS ids
 * @param {object} params { principal, annualRate, termMonths, balloonAmount?, startDate? }
 * @returns {{ schedule, summary }} — schedule rows optionally carry dueDate when startDate is given
 */
export const generateSchedule = (method, params = {}) => {
  const builder = BUILDERS[method] || reducingBalance;
  const result = builder(params);

  // Attach monthly due dates when a start date is provided (BRS AM1.2).
  if (params.startDate) {
    const start = new Date(params.startDate);
    result.schedule = result.schedule.map((row) => {
      const due = new Date(start);
      due.setMonth(due.getMonth() + row.periodNo);
      return { ...row, dueDate: due.toISOString().slice(0, 10) };
    });
  }
  return result;
};
