/**
 * KENYA STATUTORY PAYROLL ENGINE (pure functions)
 *
 * The single source of truth for PAYE and the statutory deductions that feed
 * it. Both payroll surfaces — HR "Run Payroll" and the Finance Hub payroll tab
 * / PAYE calculator — compute through this module, so the payslip, the
 * payroll_records row and the calculator can never disagree about what an
 * employee is owed.
 *
 * ORDER OF OPERATIONS (KRA P10 / iTax):
 *
 *   1. Gross pay              cash pay + taxable non-cash benefits
 *   2. less allowable         NSSF, SHIF, Affordable Housing Levy, pension,
 *      deductions             mortgage interest, post-retirement medical fund
 *                             ----------------------------------------------
 *                             = TAXABLE PAY
 *   3. apply PAYE bands       -> gross tax
 *   4. less reliefs           personal relief + insurance relief
 *                             ----------------------------------------------
 *                             = PAYE PAYABLE (floored at zero)
 *
 * Step 2 is the step hand-rolled payroll usually skips. Since the Tax Laws
 * (Amendment) Act 2024 (in force 27 December 2024) SHIF, the housing levy and
 * NSSF are DEDUCTIBLE in arriving at taxable pay — they are no longer 15%
 * reliefs applied against the tax. Banding gross pay directly overstates PAYE
 * for every employee on the roster.
 *
 * RATES ARE VERSIONED BY EFFECTIVE DATE, never inlined at the call site.
 * Re-running an old month has to reproduce the numbers that were lawful in
 * that month, so every calculation resolves its schedule from the pay month
 * rather than from today. Adding a schedule is the only edit a rate change
 * needs, and `rate_version` is stored on each payroll record so a figure can
 * always be traced back to the table that produced it.
 *
 * Nothing here touches the DOM, Supabase or React — plain data in, plain data
 * out, so the numbers are testable in isolation.
 */

// ─────────────────────────────────────────────────────────────────────────────
// MONEY
//
// Contributions are held to the cent and PAYE is rounded to the shilling (KRA
// files whole shillings). Net pay is then derived from the ALREADY-ROUNDED
// components rather than from the raw floats — otherwise a payslip's own
// deduction lines do not sum to the total printed beneath them.
// ─────────────────────────────────────────────────────────────────────────────
export const round2 = (n) => Math.round(((parseFloat(n) || 0) + Number.EPSILON) * 100) / 100;
const shillings = (n) => Math.round((parseFloat(n) || 0) + Number.EPSILON);
const num = (n) => {
  const v = parseFloat(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// STATUTORY RATE SCHEDULES
//
// Ordered oldest → newest. `effectiveFrom` is the date the instrument came
// into force. The history deliberately starts at the Tax Laws (Amendment) Act
// 2024: that is the first regime under which the whole present-day shape of
// the calculation holds (statutory contributions deductible, SHIF in place of
// the NHIF graduated table). Pay months before it resolve to the earliest
// schedule and are flagged `beforeHistory` — this engine does not reconstruct
// the NHIF era.
// ─────────────────────────────────────────────────────────────────────────────

// Finance Act 2023, in force 1 July 2023. Monthly band WIDTHS, not ceilings:
// 24,000 -> 32,333 -> 500,000 -> 800,000 -> above.
const PAYE_BANDS_2023 = [
  { width: 24000,    rate: 0.10 },
  { width: 8333,     rate: 0.25 },
  { width: 467667,   rate: 0.30 },
  { width: 300000,   rate: 0.325 },
  { width: Infinity, rate: 0.35 },
];

export const RATE_SCHEDULES = [
  {
    version: '2024-12-27',
    label: 'Tax Laws (Amendment) Act 2024',
    effectiveFrom: '2024-12-27',
    payeBands: PAYE_BANDS_2023,
    personalRelief: 2400,
    // 15% of premiums paid, capped at 5,000/month (Income Tax Act s.31).
    insuranceRelief: { rate: 0.15, cap: 5000 },
    // NSSF Act 2013 Third Schedule, Year 2 (Feb 2024 - Jan 2025).
    nssf: { rate: 0.06, lowerLimit: 7000, upperLimit: 36000 },
    // Social Health Insurance Act 2023 — 2.75% of gross, floor 300, no cap.
    shif: { rate: 0.0275, min: 300 },
    // Affordable Housing Act 2024 — 1.5% of gross monthly pay, employer matches.
    housingLevy: { rate: 0.015 },
    // Ceilings on what may be deducted before banding (monthly).
    deductionCaps: {
      pension: 30000,          // NSSF + occupational pension, combined
      // The deductible pension contribution is the LOWEST of the actual
      // contribution, this share of pensionable pay, and the cap above.
      pensionRateOfPay: 0.30,
      mortgageInterest: 30000,
      postRetirementMedical: 15000,
    },
    // Non-cash benefits are tax free up to this much per month (60,000/year).
    nonCashBenefitExemption: 5000,
    // Holders of a KRA disability exemption certificate: first 150,000/month.
    disabilityExemption: 150000,
  },
  {
    version: '2025-02-01',
    label: 'NSSF Act 2013 — Year 3 limits',
    effectiveFrom: '2025-02-01',
    payeBands: PAYE_BANDS_2023,
    personalRelief: 2400,
    insuranceRelief: { rate: 0.15, cap: 5000 },
    // Year 3 raised the lower limit to 8,000 and the upper limit to 72,000, so
    // the employee ceiling moves from 2,160 to 480 + 3,840 = 4,320 a month.
    nssf: { rate: 0.06, lowerLimit: 8000, upperLimit: 72000 },
    shif: { rate: 0.0275, min: 300 },
    housingLevy: { rate: 0.015 },
    deductionCaps: {
      pension: 30000,
      pensionRateOfPay: 0.30,
      mortgageInterest: 30000,
      postRetirementMedical: 15000,
    },
    nonCashBenefitExemption: 5000,
    disabilityExemption: 150000,
  },
  // ───────────────────────────────────────────────────────────────────────────
  // NEXT SCHEDULE GOES HERE.
  //
  // The NSSF Act Third Schedule leaves the Year 4 (from February 2026) upper
  // earnings limit to be set against national average earnings and gazetted,
  // rather than fixing it in the Act the way Years 1-3 are fixed. Until that
  // gazette notice is read off and entered here, February 2026 onwards keeps
  // computing on the Year 3 limits above — which is the last figure this
  // codebase can stand behind, not a claim that the limits did not move.
  // Copy the block above, set `version` / `effectiveFrom` / `nssf`, done.
  // ───────────────────────────────────────────────────────────────────────────
];

/** Last calendar day of a 'YYYY-MM' pay month, as 'YYYY-MM-DD'. */
const lastDayOfPayMonth = (payMonth) => {
  const m = String(payMonth || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split('-').map(Number);
  if (mo < 1 || mo > 12) return null;
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

/**
 * The rate schedule in force for a pay month.
 *
 * Resolved against the LAST day of the period: PAYE falls due on the pay date,
 * which lands at or after month end, so a rate that came in mid-month governs
 * that month of payroll. A missing or unparseable month falls back to the
 * newest schedule — that is the "run payroll today" case.
 */
export const resolveRateSchedule = (payMonth) => {
  const asOf = lastDayOfPayMonth(payMonth);
  if (!asOf) return { ...RATE_SCHEDULES[RATE_SCHEDULES.length - 1], beforeHistory: false };

  const inForce = RATE_SCHEDULES.filter(s => s.effectiveFrom <= asOf);
  if (inForce.length === 0) return { ...RATE_SCHEDULES[0], beforeHistory: true };
  return { ...inForce[inForce.length - 1], beforeHistory: false };
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PAYE charged on taxable pay, before reliefs, with the per-band working kept
 * so a payslip or an audit can show where each shilling of tax came from.
 */
export const applyPayeBands = (taxablePay, bands) => {
  let remaining = Math.max(0, num(taxablePay));
  let floor = 0;
  let tax = 0;
  const breakdown = [];

  for (const band of bands) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, band.width);
    const bandTax = amount * band.rate;
    breakdown.push({
      from: round2(floor),
      to: Number.isFinite(band.width) ? round2(floor + band.width) : null,
      rate: band.rate,
      amount: round2(amount),
      tax: round2(bandTax),
    });
    tax += bandTax;
    remaining -= amount;
    floor += band.width;
  }

  return { tax: round2(tax), breakdown };
};

/**
 * NSSF is two tiers on pensionable pay: 6% of everything up to the lower
 * earnings limit, then 6% of the slice between the lower and upper limits.
 * Pay above the upper limit attracts nothing.
 */
export const calcNssf = (pensionablePay, { rate, lowerLimit, upperLimit }) => {
  const pay = num(pensionablePay);
  const tierI  = Math.min(pay, lowerLimit) * rate;
  const tierII = Math.max(0, Math.min(pay, upperLimit) - lowerLimit) * rate;
  return { tierI: round2(tierI), tierII: round2(tierII), total: round2(tierI + tierII) };
};

/**
 * SHIF: a flat percentage of gross with a floor and no ceiling.
 *
 * The floor is a minimum on a contribution, not a charge in its own right —
 * an employee with no pay in the month contributes nothing. Applying it to
 * zero gross would hand them a negative payslip.
 */
export const calcShif = (grossPay, { rate, min }) => {
  const pay = num(grossPay);
  return pay <= 0 ? 0 : round2(Math.max(pay * rate, min));
};

/** Affordable Housing Levy: a flat percentage of gross, uncapped. */
export const calcHousingLevy = (grossPay, { rate }) => round2(num(grossPay) * rate);

// ─────────────────────────────────────────────────────────────────────────────
// THE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute one employee's pay for one month.
 *
 * Every input is optional and defaults to zero, so the common case — a basic
 * salary and nothing else — is `computePayroll({ payMonth, basic })`.
 *
 * A note on where two of the inputs land, because both are easy to misread:
 *
 *   - `nonCashBenefits` is taxed but not paid, so it raises taxable pay and
 *     never touches net pay.
 *   - `mortgageInterest` is paid to a lender, not withheld by the employer, so
 *     it lowers taxable pay and never touches net pay either.
 *
 * Everything else that reduces tax is also withheld, and so does both.
 */
export const computePayroll = ({
  payMonth,
  // Cash earnings
  basic = 0,
  housingAllowance = 0,
  transportAllowance = 0,
  mealAllowance = 0,
  bonus = 0,
  gift = 0,
  otherAllowances = 0,
  // Taxed but not paid in cash
  nonCashBenefits = 0,
  // Allowable deductions the employee funds
  pension = 0,
  mortgageInterest = 0,
  postRetirementMedical = 0,
  // Relief inputs
  insurancePremiums = 0,
  // Non-statutory withholdings
  loanDeduction = 0,
  advanceDeduction = 0,
  otherDeductions = 0,
  // Exemptions
  hasDisabilityExemption = false,
  exemptFromNssf = false,
  exemptFromShif = false,
  exemptFromHousingLevy = false,
} = {}) => {
  const rates = resolveRateSchedule(payMonth);

  // ── 1. Gross pay ──────────────────────────────────────────────────────────
  const cashEarnings = {
    basic: round2(basic),
    housingAllowance: round2(housingAllowance),
    transportAllowance: round2(transportAllowance),
    mealAllowance: round2(mealAllowance),
    bonus: round2(bonus),
    gift: round2(gift),
    otherAllowances: round2(otherAllowances),
  };
  const grossCash = round2(Object.values(cashEarnings).reduce((s, v) => s + v, 0));

  const taxableNonCash = round2(
    Math.max(0, num(nonCashBenefits) - rates.nonCashBenefitExemption),
  );
  const grossPay = round2(grossCash + taxableNonCash);

  // ── 2. Statutory contributions ────────────────────────────────────────────
  // All three are charged on cash gross — a non-cash benefit is not salary the
  // employer can withhold a contribution out of.
  const nssf = exemptFromNssf
    ? { tierI: 0, tierII: 0, total: 0 }
    : calcNssf(grossCash, rates.nssf);
  const shif = exemptFromShif ? 0 : calcShif(grossCash, rates.shif);
  const housingLevy = exemptFromHousingLevy ? 0 : calcHousingLevy(grossCash, rates.housingLevy);

  // ── 3. Allowable deductions -> taxable pay ────────────────────────────────
  // NSSF and any occupational pension are one deductible pot, and what may be
  // taken is the LOWEST of three tests: what was actually contributed, 30% of
  // pensionable pay, and the monthly cap. The 30% leg only ever bites on a low
  // earner making a large contribution — which is exactly the case a two-leg
  // test would silently over-deduct for. The P10 asks for all three.
  const pensionActual = round2(nssf.total + num(pension));
  const pensionRateLimit = round2(grossCash * rates.deductionCaps.pensionRateOfPay);
  const pensionCap = rates.deductionCaps.pension;
  const pensionDeduction = round2(Math.min(pensionActual, pensionRateLimit, pensionCap));
  const mortgageDeduction = round2(
    Math.min(num(mortgageInterest), rates.deductionCaps.mortgageInterest),
  );
  const medicalFundDeduction = round2(
    Math.min(num(postRetirementMedical), rates.deductionCaps.postRetirementMedical),
  );
  const disabilityRelief = hasDisabilityExemption ? rates.disabilityExemption : 0;

  const allowableDeductions = round2(
    pensionDeduction + shif + housingLevy + mortgageDeduction + medicalFundDeduction,
  );
  const taxablePay = round2(
    Math.max(0, grossPay - allowableDeductions - disabilityRelief),
  );

  // ── 4. Bands, then reliefs ────────────────────────────────────────────────
  const { tax: grossTax, breakdown: payeBands } = applyPayeBands(taxablePay, rates.payeBands);

  const personalRelief = taxablePay > 0 ? rates.personalRelief : 0;
  const insuranceRelief = round2(
    Math.min(num(insurancePremiums) * rates.insuranceRelief.rate, rates.insuranceRelief.cap),
  );
  const totalRelief = round2(personalRelief + insuranceRelief);
  const paye = shillings(Math.max(0, grossTax - totalRelief));

  // ── 5. Net pay ────────────────────────────────────────────────────────────
  // Built from the rounded components, so the payslip lines add up to the
  // total printed beneath them. Mortgage interest is absent by design: the
  // employer never withholds it.
  const statutoryDeductions = round2(paye + nssf.total + shif + housingLevy);
  const voluntaryDeductions = round2(
    num(pension) + num(postRetirementMedical) +
    num(loanDeduction) + num(advanceDeduction) + num(otherDeductions),
  );
  const totalDeductions = round2(statutoryDeductions + voluntaryDeductions);
  const netPay = round2(grossCash - totalDeductions);

  return {
    rateVersion: rates.version,
    rateLabel: rates.label,
    beforeHistory: rates.beforeHistory,

    // Earnings
    ...cashEarnings,
    nonCashBenefits: round2(nonCashBenefits),
    taxableNonCash,
    grossCash,
    grossPay,

    // Statutory contributions
    nssf: nssf.total,
    nssfTierI: nssf.tierI,
    nssfTierII: nssf.tierII,
    shif,
    housingLevy,

    // Tax working. The three pension legs are kept separately because the P10
    // return asks for each of them, not only the figure that won.
    pensionDeduction,
    pensionActual,
    pensionRateLimit,
    pensionCap,
    mortgageDeduction,
    medicalFundDeduction,
    disabilityRelief,
    allowableDeductions,
    taxablePay,
    grossTax,
    payeBands,
    personalRelief,
    insuranceRelief,
    totalRelief,
    paye,

    // Non-statutory withholdings
    pension: round2(pension),
    postRetirementMedical: round2(postRetirementMedical),
    loanDeduction: round2(loanDeduction),
    advanceDeduction: round2(advanceDeduction),
    otherDeductions: round2(otherDeductions),

    // Totals
    statutoryDeductions,
    voluntaryDeductions,
    totalDeductions,
    netPay,

    // The employer side, for the statutory return and the expense posting.
    employerNssf: nssf.total,
    employerHousingLevy: housingLevy,
  };
};

/**
 * Map an employees row plus this month's one-off extras onto engine input.
 * Keeps the column-name -> input-name translation in one place so HR and the
 * Finance Hub cannot drift apart on which column feeds which figure.
 */
export const payrollInputForEmployee = (employee = {}, extras = {}, payMonth) => ({
  payMonth,
  basic: employee.basic_salary,
  housingAllowance: employee.housing_allowance,
  transportAllowance: employee.transport_allowance,
  pension: employee.pension_contribution,
  mortgageInterest: employee.mortgage_interest,
  postRetirementMedical: employee.post_retirement_medical,
  insurancePremiums: employee.insurance_premiums,
  hasDisabilityExemption: !!employee.has_disability_exemption,
  mealAllowance: extras.meal,
  bonus: extras.bonus,
  gift: extras.gift,
  nonCashBenefits: extras.nonCash,
  loanDeduction: extras.loan,
  advanceDeduction: extras.advance,
});

/**
 * A stored payroll_records row, resolved back into a full engine result.
 *
 * Two rules, and the order matters:
 *
 *   1. Anything the row actually stored WINS. That is what was paid and filed;
 *      recomputing over it would quietly rewrite history.
 *   2. The working a row never stored — the band split, and taxable pay on rows
 *      written before the breakdown columns existed — is rebuilt at the rates
 *      of the row's OWN pay month, never today's.
 *
 * `rebuilt` on the result flags a row whose tax base had to be reconstructed,
 * so a payslip or a return can say so instead of implying it was recorded.
 */
export const resolvePayrollRecord = (record = {}) => {
  const stored = (v, fallback) => (v == null || v === '' ? fallback : parseFloat(v));
  // Rows written by the old Finance Hub path stored a gross with no components.
  // Treating that gross as basic keeps earnings from being double counted.
  const hasComponents = record.basic_salary != null;

  const result = computePayroll({
    payMonth:           record.pay_month,
    basic:              hasComponents ? record.basic_salary : record.gross_salary,
    housingAllowance:   hasComponents ? record.housing_allowance   : 0,
    transportAllowance: hasComponents ? record.transport_allowance : 0,
    mealAllowance:      hasComponents ? record.meal_allowance      : 0,
    bonus:              hasComponents ? record.bonus : 0,
    gift:               hasComponents ? record.gift  : 0,
    nonCashBenefits:    record.non_cash_benefits,
    pension:            record.pension_contribution,
    loanDeduction:      record.loan_deduction,
    advanceDeduction:   record.advance_deduction,
  });

  return {
    ...result,
    grossCash:       stored(record.gross_salary,     result.grossCash),
    taxablePay:      stored(record.taxable_pay,      result.taxablePay),
    paye:            stored(record.paye,             result.paye),
    nssf:            stored(record.nssf,             result.nssf),
    shif:            stored(record.shif,             result.shif),
    housingLevy:     stored(record.housing_levy,     result.housingLevy),
    personalRelief:  stored(record.personal_relief,  result.personalRelief),
    insuranceRelief: stored(record.insurance_relief, result.insuranceRelief),
    totalDeductions: stored(record.total_deductions, result.totalDeductions),
    netPay:          stored(record.net_salary,       result.netPay),
    // A row with no rate_version was priced by the old engine on a basis
    // nobody recorded. Borrowing the current label would be a claim we cannot
    // support, so it is dropped and consumers say "not recorded".
    rateLabel:       record.rate_version ? result.rateLabel : null,
    rateVersion:     record.rate_version ?? null,
    rebuilt:         record.taxable_pay == null,
  };
};

/** Engine result -> payroll_records columns. */
export const payrollRecordFrom = (result) => ({
  gross_salary: result.grossCash,
  taxable_pay: result.taxablePay,
  paye: result.paye,
  nssf: result.nssf,
  shif: result.shif,
  housing_levy: result.housingLevy,
  personal_relief: result.personalRelief,
  insurance_relief: result.insuranceRelief,
  pension_contribution: result.pension,
  non_cash_benefits: result.nonCashBenefits,
  total_deductions: result.totalDeductions,
  net_salary: result.netPay,
  rate_version: result.rateVersion,
});
