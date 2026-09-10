/**
 * KRA PAYE RETURN (P10) EXPORT
 *
 * Turns a month of payroll_records into rows shaped like the P10 employee
 * details schedule, in the order and vocabulary KRA uses.
 *
 * WHAT THIS IS, EXACTLY
 *
 * A CSV of the figures a P10 needs, under P10 column names. It is NOT a
 * validated iTax upload file: the real return is a macro-enabled Excel
 * workbook whose sheet layout and validation KRA controls and revises, and
 * producing a byte-exact one from here would be a claim this codebase cannot
 * keep. What this gives an accountant is every figure already computed and in
 * the right order, to map or paste into the current template — instead of
 * re-deriving taxable pay by hand for each employee.
 *
 * The UI says the same thing. A button that implies a return has been filed
 * when it has not is worse than no button.
 *
 * COLUMNS WE DO NOT COLLECT
 *
 * Leave pay, overtime, directors fees, lump sums and car benefits are real P10
 * columns that this payroll has no inputs for. They are emitted as 0 rather
 * than omitted: the column order is the useful part, and a missing column is
 * harder to spot than a zero one.
 */

import { resolvePayrollRecord } from './kenyaPayroll';

/** P10 employee-details columns, in order. */
export const P10_COLUMNS = [
  'PIN of Employee',
  'Name of Employee',
  'Residential Status',
  'Type of Employee',
  'Basic Salary',
  'Housing Allowance',
  'Transport Allowance',
  'Leave Pay',
  'Overtime Allowance',
  'Directors Fee',
  'Lump Sum Payment',
  'Other Allowances',
  'Total Cash Pay',
  'Value of Car Benefit',
  'Other Non-Cash Benefits',
  'Total Non-Cash Pay',
  'Total Gross Pay',
  'Pension: Actual Contribution',
  'Pension: 30% of Cash Pay',
  'Pension: Permissible Limit',
  'Pension: Amount Deductible',
  'Owner Occupier Interest Deductible',
  'Post Retirement Medical Fund',
  'Affordable Housing Levy',
  'Social Health Insurance Fund',
  'Taxable Pay',
  'Tax Payable on Taxable Pay',
  'Monthly Personal Relief',
  'Amount of Insurance Relief',
  'PAYE Tax',
  'Basis',
];

const money = (n) => Math.round(((parseFloat(n) || 0) + Number.EPSILON) * 100) / 100;

/**
 * One P10 row per payroll record.
 *
 * `employeesById` supplies the KRA PIN and name, which live on the employee
 * record rather than the payroll row. An employee with no PIN on file is left
 * blank and reported by `p10Exceptions` — the return cannot be filed without
 * it, and silently emitting an empty cell hides that until KRA rejects it.
 */
export const buildP10Rows = ({ records = [], employeesById = {} }) =>
  records.map((record) => {
    const employee = employeesById[record.employee_id] || {};
    const r = resolvePayrollRecord(record);

    return {
      'PIN of Employee': employee.kra_pin || '',
      'Name of Employee': employee.full_name || '',
      // This payroll has no non-resident or secondary-employment handling, so
      // these are the only values it can honestly assert.
      'Residential Status': 'Resident',
      'Type of Employee': 'Primary Employee',

      'Basic Salary': money(r.basic),
      'Housing Allowance': money(r.housingAllowance),
      'Transport Allowance': money(r.transportAllowance),
      'Leave Pay': 0,
      'Overtime Allowance': 0,
      'Directors Fee': 0,
      'Lump Sum Payment': 0,
      // Meal, bonus and gift have no column of their own on the P10.
      'Other Allowances': money(r.mealAllowance + r.bonus + r.gift + r.otherAllowances),
      'Total Cash Pay': money(r.grossCash),

      'Value of Car Benefit': 0,
      'Other Non-Cash Benefits': money(r.nonCashBenefits),
      'Total Non-Cash Pay': money(r.taxableNonCash),
      'Total Gross Pay': money(r.grossPay),

      'Pension: Actual Contribution': money(r.pensionActual),
      'Pension: 30% of Cash Pay': money(r.pensionRateLimit),
      'Pension: Permissible Limit': money(r.pensionCap),
      'Pension: Amount Deductible': money(r.pensionDeduction),
      'Owner Occupier Interest Deductible': money(r.mortgageDeduction),
      'Post Retirement Medical Fund': money(r.medicalFundDeduction),
      'Affordable Housing Levy': money(r.housingLevy),
      'Social Health Insurance Fund': money(r.shif),

      'Taxable Pay': money(r.taxablePay),
      'Tax Payable on Taxable Pay': money(r.grossTax),
      'Monthly Personal Relief': money(r.personalRelief),
      'Amount of Insurance Relief': money(r.insuranceRelief),
      'PAYE Tax': money(r.paye),

      // Which rate table produced the row, so a query months later can be
      // answered without guessing. Rows whose tax base had to be reconstructed
      // say so rather than passing themselves off as recorded figures.
      'Basis': r.rebuilt ? `${r.rateVersion || 'unknown'} (reconstructed)` : (r.rateVersion || ''),
    };
  });

/** Column totals, for the return's summary and a quick eyeball against the bank. */
export const p10Totals = (rows = []) => {
  const sum = (col) => money(rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0));
  return {
    employees: rows.length,
    grossPay: sum('Total Gross Pay'),
    taxablePay: sum('Taxable Pay'),
    paye: sum('PAYE Tax'),
    shif: sum('Social Health Insurance Fund'),
    housingLevy: sum('Affordable Housing Levy'),
    personalRelief: sum('Monthly Personal Relief'),
  };
};

/**
 * Rows that would be rejected or questioned, found before the file is handed
 * over rather than after.
 */
export const p10Exceptions = (rows = []) => {
  const missingPin = rows.filter(r => !r['PIN of Employee']).map(r => r['Name of Employee'] || 'Unnamed employee');
  const reconstructed = rows.filter(r => String(r.Basis).includes('reconstructed')).length;
  return { missingPin, reconstructed };
};
