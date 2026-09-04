import { describe, it, expect } from 'vitest';
import {
  computePayroll,
  resolveRateSchedule,
  applyPayeBands,
  calcNssf,
  calcShif,
  payrollInputForEmployee,
  payrollRecordFrom,
  RATE_SCHEDULES,
} from './kenyaPayroll';

// Every expectation below is worked by hand from the statutory instruments, not
// captured from the code — a snapshot of a wrong engine is still wrong.
const AUG_2026 = '2026-08';

describe('resolveRateSchedule', () => {
  it('uses the rates in force during the pay month, not today', () => {
    // January 2025 sits after the Tax Laws (Amendment) Act but before the NSSF
    // Year 3 limits, so it still bands on the 7,000 / 36,000 ceiling.
    expect(resolveRateSchedule('2025-01').version).toBe('2024-12-27');
    expect(resolveRateSchedule('2025-02').version).toBe('2025-02-01');
    expect(resolveRateSchedule('2026-08').version).toBe('2025-02-01');
  });

  it('resolves on the last day of the month, so a mid-month change governs it', () => {
    // The Act came into force on 27 December 2024 — the 1st would resolve the
    // month to the wrong schedule.
    expect(resolveRateSchedule('2024-12').version).toBe('2024-12-27');
  });

  it('flags a month older than the modelled history instead of guessing', () => {
    expect(resolveRateSchedule('2023-06').beforeHistory).toBe(true);
  });

  it('falls back to the newest schedule when no month is given', () => {
    const newest = RATE_SCHEDULES[RATE_SCHEDULES.length - 1].version;
    expect(resolveRateSchedule(undefined).version).toBe(newest);
    expect(resolveRateSchedule('not-a-month').version).toBe(newest);
  });
});

describe('applyPayeBands', () => {
  const bands = RATE_SCHEDULES[RATE_SCHEDULES.length - 1].payeBands;

  it('charges each band only on the slice that falls inside it', () => {
    // 50,000 taxable: 24,000 @10% + 8,333 @25% + 17,667 @30%
    const { tax, breakdown } = applyPayeBands(50000, bands);
    expect(tax).toBe(2400 + 2083.25 + 5300.1);
    expect(breakdown).toHaveLength(3);
    expect(breakdown[2]).toMatchObject({ rate: 0.3, amount: 17667 });
  });

  it('reaches the 35% band only above 800,000', () => {
    expect(applyPayeBands(800000, bands).breakdown.some(b => b.rate === 0.35)).toBe(false);
    expect(applyPayeBands(800001, bands).breakdown.some(b => b.rate === 0.35)).toBe(true);
  });

  it('charges nothing on zero or negative taxable pay', () => {
    expect(applyPayeBands(0, bands).tax).toBe(0);
    expect(applyPayeBands(-5000, bands).tax).toBe(0);
  });
});

describe('calcNssf', () => {
  const yr3 = { rate: 0.06, lowerLimit: 8000, upperLimit: 72000 };

  it('caps the employee contribution at the upper earnings limit', () => {
    // Tier I 6% of 8,000 = 480; Tier II 6% of (72,000 - 8,000) = 3,840.
    expect(calcNssf(100000, yr3)).toEqual({ tierI: 480, tierII: 3840, total: 4320 });
    expect(calcNssf(5000000, yr3).total).toBe(4320);
  });

  it('is a flat 6% for anyone earning between the two limits', () => {
    expect(calcNssf(50000, yr3).total).toBe(3000);
  });

  it('charges Tier I only below the lower limit', () => {
    expect(calcNssf(5000, yr3)).toEqual({ tierI: 300, tierII: 0, total: 300 });
  });
});

describe('calcShif', () => {
  const shif = { rate: 0.0275, min: 300 };

  it('applies the 300 floor to low earners', () => {
    expect(calcShif(5000, shif)).toBe(300);   // 137.50 would be below the floor
    expect(calcShif(100000, shif)).toBe(2750);
  });

  it('charges nothing on no pay — the floor is a minimum, not a charge', () => {
    expect(calcShif(0, shif)).toBe(0);
  });

  it('has no ceiling', () => {
    expect(calcShif(1000000, shif)).toBe(27500);
  });
});

describe('computePayroll — statutory order of operations', () => {
  it('taxes pay AFTER the allowable deductions, not gross', () => {
    const r = computePayroll({ payMonth: AUG_2026, basic: 100000 });

    expect(r.nssf).toBe(4320);
    expect(r.shif).toBe(2750);
    expect(r.housingLevy).toBe(1500);
    expect(r.allowableDeductions).toBe(8570);
    expect(r.taxablePay).toBe(91430);

    // 24,000 @10% + 8,333 @25% + 59,097 @30% = 22,212.35, less 2,400 relief.
    expect(r.grossTax).toBe(22212.35);
    expect(r.personalRelief).toBe(2400);
    expect(r.paye).toBe(19812);

    expect(r.totalDeductions).toBe(28382);
    expect(r.netPay).toBe(71618);
  });

  it('leaves the low-paid untaxed once personal relief is applied', () => {
    const r = computePayroll({ payMonth: AUG_2026, basic: 24000 });
    // Banded tax of 2,154 is wiped out by the 2,400 relief.
    expect(r.grossTax).toBe(2154);
    expect(r.paye).toBe(0);
    expect(r.netPay).toBe(21540);
  });

  it('never returns negative PAYE when relief exceeds the tax', () => {
    expect(computePayroll({ payMonth: AUG_2026, basic: 15000 }).paye).toBe(0);
  });

  it('bands a high earner across all five rates', () => {
    const r = computePayroll({ payMonth: AUG_2026, basic: 1000000 });
    expect(r.taxablePay).toBe(953180);   // 1,000,000 - 4,320 - 27,500 - 15,000
    expect(r.paye).toBe(293496);
    expect(r.payeBands).toHaveLength(5);
  });

  it('sums allowances into gross before anything is charged on it', () => {
    const r = computePayroll({
      payMonth: AUG_2026,
      basic: 60000, housingAllowance: 20000, transportAllowance: 10000,
      mealAllowance: 5000, bonus: 5000,
    });
    expect(r.grossCash).toBe(100000);
    // Identical to the 100,000 basic-only case above.
    expect(r.paye).toBe(19812);
  });
});

describe('computePayroll — reliefs and capped deductions', () => {
  it('gives insurance relief at 15% of premiums, capped at 5,000', () => {
    const some = computePayroll({ payMonth: AUG_2026, basic: 100000, insurancePremiums: 10000 });
    expect(some.insuranceRelief).toBe(1500);
    expect(some.paye).toBe(19812 - 1500);

    const lots = computePayroll({ payMonth: AUG_2026, basic: 100000, insurancePremiums: 200000 });
    expect(lots.insuranceRelief).toBe(5000);   // not 30,000
  });

  it('caps NSSF and pension together at 30,000 of deductible contributions', () => {
    const r = computePayroll({ payMonth: AUG_2026, basic: 300000, pension: 40000 });
    expect(r.pensionDeduction).toBe(30000);    // 4,320 NSSF + 40,000 would be 44,320
  });

  it('limits the pension deduction to 30% of pay for a low earner', () => {
    // 20,000 gross, 8,000 contributed. The cash cap (30,000) does not bite and
    // the actual contribution is 8,000 — but only 30% of 20,000 is deductible.
    const r = computePayroll({ payMonth: AUG_2026, basic: 20000, pension: 8000 });
    expect(r.pensionActual).toBe(9200);        // 1,200 NSSF + 8,000
    expect(r.pensionRateLimit).toBe(6000);     // 30% of 20,000
    expect(r.pensionCap).toBe(30000);
    expect(r.pensionDeduction).toBe(6000);     // the lowest of the three
  });

  it('takes the actual contribution when it is the lowest leg', () => {
    const r = computePayroll({ payMonth: AUG_2026, basic: 100000, pension: 2000 });
    expect(r.pensionDeduction).toBe(r.pensionActual);   // 4,320 + 2,000
    expect(r.pensionDeduction).toBe(6320);
  });

  it('caps mortgage interest at 30,000 and the medical fund at 15,000', () => {
    const r = computePayroll({
      payMonth: AUG_2026, basic: 300000,
      mortgageInterest: 50000, postRetirementMedical: 25000,
    });
    expect(r.mortgageDeduction).toBe(30000);
    expect(r.medicalFundDeduction).toBe(15000);
  });

  it('exempts the first 150,000 for a disability certificate holder', () => {
    const r = computePayroll({ payMonth: AUG_2026, basic: 200000, hasDisabilityExemption: true });
    const without = computePayroll({ payMonth: AUG_2026, basic: 200000 });
    expect(r.taxablePay).toBe(without.taxablePay - 150000);
    expect(r.paye).toBeLessThan(without.paye);
  });
});

describe('computePayroll — cash vs non-cash', () => {
  it('taxes non-cash benefits above the exemption without paying them out', () => {
    const plain = computePayroll({ payMonth: AUG_2026, basic: 100000 });
    const withCar = computePayroll({ payMonth: AUG_2026, basic: 100000, nonCashBenefits: 20000 });

    expect(withCar.taxableNonCash).toBe(15000);          // 20,000 less the 5,000 exemption
    expect(withCar.taxablePay).toBe(plain.taxablePay + 15000);
    expect(withCar.paye).toBeGreaterThan(plain.paye);

    // Taxed, but the employee is not handed the 20,000 — gross cash is untouched
    // and net pay falls by exactly the extra tax.
    expect(withCar.grossCash).toBe(100000);
    expect(withCar.netPay).toBe(plain.netPay - (withCar.paye - plain.paye));
  });

  it('ignores a benefit that sits under the exemption', () => {
    const r = computePayroll({ payMonth: AUG_2026, basic: 100000, nonCashBenefits: 4000 });
    expect(r.taxableNonCash).toBe(0);
    expect(r.paye).toBe(19812);
  });

  it('lowers tax on mortgage interest without withholding it from pay', () => {
    const plain = computePayroll({ payMonth: AUG_2026, basic: 200000 });
    const withLoan = computePayroll({ payMonth: AUG_2026, basic: 200000, mortgageInterest: 30000 });

    expect(withLoan.taxablePay).toBe(plain.taxablePay - 30000);
    // The lender is paid by the employee, so net pay RISES by the tax saved.
    expect(withLoan.netPay).toBe(plain.netPay + (plain.paye - withLoan.paye));
  });
});

describe('computePayroll — net pay integrity', () => {
  const cases = [0, 5000, 23999, 24000, 32333, 57333, 100000, 500001, 1000000];

  it.each(cases)('deduction lines add up to the total at gross %i', (basic) => {
    const r = computePayroll({ payMonth: AUG_2026, basic });
    const lines = r.paye + r.nssf + r.shif + r.housingLevy;
    expect(r.statutoryDeductions).toBeCloseTo(lines, 2);
    expect(r.netPay).toBeCloseTo(r.grossCash - r.totalDeductions, 2);
  });

  it('withholds loans and advances after tax, not before it', () => {
    const plain = computePayroll({ payMonth: AUG_2026, basic: 100000 });
    const owing = computePayroll({
      payMonth: AUG_2026, basic: 100000, loanDeduction: 5000, advanceDeduction: 2000,
    });
    expect(owing.paye).toBe(plain.paye);              // a loan is not tax deductible
    expect(owing.netPay).toBe(plain.netPay - 7000);
  });

  it('produces a clean zero for an employee with no pay set', () => {
    const r = computePayroll({ payMonth: AUG_2026 });
    expect(r.grossCash).toBe(0);
    expect(r.paye).toBe(0);
    expect(r.personalRelief).toBe(0);   // no relief to claim against no pay
    expect(r.netPay).toBe(0);
  });

  it('treats blank strings and nulls from form inputs as zero', () => {
    const r = computePayroll({
      payMonth: AUG_2026, basic: '100000', housingAllowance: '', bonus: null, gift: undefined,
    });
    expect(r.grossCash).toBe(100000);
    expect(r.paye).toBe(19812);
  });
});

// The reason this module exists. HR "Run Payroll" and the Finance Hub payroll
// tab both write to payroll_records, and each used to carry its own copy of the
// tax rules — one with pre-2023 bands and no personal relief, the other banding
// gross pay. The same employee could be paid two different amounts depending on
// which screen the run was started from.
describe('one engine for both payroll surfaces', () => {
  const employee = {
    id: 'emp-1',
    basic_salary: 85000,
    housing_allowance: 15000,
    transport_allowance: 10000,
    pension_contribution: 5000,
    insurance_premiums: 8000,
  };

  it('gives HR and the Finance Hub the same figures for the same employee', () => {
    // HR maps the employee row through the shared mapper.
    const hr = computePayroll(payrollInputForEmployee(employee, {}, AUG_2026));
    // The Finance Hub form defaults each field off the same record.
    const financeHub = computePayroll({
      ...payrollInputForEmployee(employee, {}, AUG_2026),
      basic: employee.basic_salary,
      housingAllowance: employee.housing_allowance,
      transportAllowance: employee.transport_allowance,
    });
    expect(financeHub).toEqual(hr);
  });

  it('writes a record whose stored figures reconcile to each other', () => {
    const result = computePayroll(payrollInputForEmployee(employee, { loan: 4000 }, AUG_2026));
    const row = payrollRecordFrom(result);

    expect(row.gross_salary).toBe(110000);
    expect(row.net_salary).toBeCloseTo(row.gross_salary - row.total_deductions, 2);
    // Taxable pay is stored, so the PAYE on this row can be re-derived later.
    expect(row.taxable_pay).toBeLessThan(row.gross_salary);
    expect(row.rate_version).toBe('2025-02-01');
  });

  it('records the housing levy that payroll previously computed and dropped', () => {
    const row = payrollRecordFrom(computePayroll(payrollInputForEmployee(employee, {}, AUG_2026)));
    expect(row.housing_levy).toBe(1650);   // 1.5% of 110,000
    expect(row.total_deductions).toBeGreaterThan(row.paye + row.nssf + row.shif);
  });
});

describe('computePayroll — rate versioning', () => {
  it('applies the older NSSF ceiling to a January 2025 payroll', () => {
    const jan = computePayroll({ payMonth: '2025-01', basic: 100000 });
    const aug = computePayroll({ payMonth: AUG_2026, basic: 100000 });

    // Year 2 ceiling: 6% of 7,000 + 6% of 29,000 = 2,160.
    expect(jan.nssf).toBe(2160);
    expect(aug.nssf).toBe(4320);
    // Less deductible contribution means more taxable pay, so more PAYE.
    expect(jan.paye).toBeGreaterThan(aug.paye);
  });

  it('stamps the schedule that produced the figures', () => {
    expect(computePayroll({ payMonth: '2025-01', basic: 50000 }).rateVersion).toBe('2024-12-27');
    expect(computePayroll({ payMonth: AUG_2026, basic: 50000 }).rateVersion).toBe('2025-02-01');
  });
});
