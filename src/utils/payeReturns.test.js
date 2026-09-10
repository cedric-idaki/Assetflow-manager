import { describe, it, expect } from 'vitest';
import { buildP10Rows, p10Totals, p10Exceptions, P10_COLUMNS } from './payeReturns';
import { resolvePayrollRecord, computePayroll, payrollRecordFrom } from './kenyaPayroll';
import { toCSV } from './exportUtils';

const employeesById = {
  'e1': { id: 'e1', full_name: 'Grace Wanjiru', kra_pin: 'A001234567X', department: 'Finance' },
  'e2': { id: 'e2', full_name: 'Otieno Odhiambo', kra_pin: '', department: 'Sales' },
};

// A record as the current engine writes it.
const record = (over = {}) => ({
  employee_id: 'e1',
  pay_month: '2026-08',
  basic_salary: 85000,
  housing_allowance: 15000,
  transport_allowance: 10000,
  meal_allowance: 0, bonus: 0, gift: 0,
  loan_deduction: 0, advance_deduction: 0,
  ...payrollRecordFrom(computePayroll({
    payMonth: '2026-08', basic: 85000, housingAllowance: 15000, transportAllowance: 10000,
  })),
  ...over,
});

describe('resolvePayrollRecord', () => {
  it('prefers what was stored over anything recomputed', () => {
    // A row whose stored PAYE disagrees with today's engine — a rate change,
    // or a manual correction. The stored figure is what was paid and filed.
    const r = resolvePayrollRecord(record({ paye: 12345, net_salary: 77000 }));
    expect(r.paye).toBe(12345);
    expect(r.netPay).toBe(77000);
  });

  it('rebuilds a legacy row at its OWN month, never today', () => {
    // Pre-breakdown row: gross only, no taxable_pay, from a January 2025 run.
    const legacy = {
      employee_id: 'e1', pay_month: '2025-01',
      gross_salary: 100000, paye: 22383, nssf: 2160, shif: 2750, net_salary: 71207,
    };
    const r = resolvePayrollRecord(legacy);
    expect(r.rebuilt).toBe(true);
    // January 2025 NSSF ceiling was 2,160, not the 4,320 in force today. The
    // reconstruction has to use the older schedule.
    expect(r.nssf).toBe(2160);
    expect(r.taxablePay).toBeGreaterThan(0);
  });

  it('refuses to claim a statutory basis a legacy row never recorded', () => {
    const r = resolvePayrollRecord({ employee_id: 'e1', pay_month: '2025-01', gross_salary: 50000 });
    expect(r.rateLabel).toBeNull();
    expect(r.rateVersion).toBeNull();
  });

  it('marks a row written by the current engine as not rebuilt', () => {
    expect(resolvePayrollRecord(record()).rebuilt).toBe(false);
  });

  it('does not double count when a legacy row has no earnings components', () => {
    // gross_salary present, basic_salary absent — the old Finance Hub shape.
    const r = resolvePayrollRecord({ employee_id: 'e1', pay_month: '2026-08', gross_salary: 110000 });
    expect(r.grossCash).toBe(110000);
    expect(r.basic).toBe(110000);
    expect(r.housingAllowance).toBe(0);
  });
});

describe('buildP10Rows', () => {
  const rows = buildP10Rows({ records: [record()], employeesById });
  const row = rows[0];

  it('emits every P10 column, in order', () => {
    expect(Object.keys(row)).toEqual(P10_COLUMNS);
  });

  it('carries the employee identity KRA files against', () => {
    expect(row['PIN of Employee']).toBe('A001234567X');
    expect(row['Name of Employee']).toBe('Grace Wanjiru');
    expect(row['Residential Status']).toBe('Resident');
  });

  it('reports the three pension legs, not just the winning one', () => {
    // The P10 asks for all three so the deduction can be checked.
    expect(row['Pension: Actual Contribution']).toBe(4320);
    expect(row['Pension: 30% of Cash Pay']).toBe(33000);
    expect(row['Pension: Permissible Limit']).toBe(30000);
    expect(row['Pension: Amount Deductible']).toBe(4320);
  });

  it('reconciles: gross less deductions is the taxable pay it reports', () => {
    const deductions = row['Pension: Amount Deductible']
      + row['Affordable Housing Levy']
      + row['Social Health Insurance Fund']
      + row['Owner Occupier Interest Deductible']
      + row['Post Retirement Medical Fund'];
    expect(row['Total Gross Pay'] - deductions).toBeCloseTo(row['Taxable Pay'], 2);
  });

  it('reconciles: tax less reliefs is the PAYE it reports', () => {
    const net = row['Tax Payable on Taxable Pay']
      - row['Monthly Personal Relief']
      - row['Amount of Insurance Relief'];
    expect(Math.round(net)).toBe(row['PAYE Tax']);
  });

  it('zeroes P10 columns this payroll has no input for', () => {
    expect(row['Leave Pay']).toBe(0);
    expect(row['Overtime Allowance']).toBe(0);
    expect(row['Directors Fee']).toBe(0);
    expect(row['Value of Car Benefit']).toBe(0);
  });

  it('folds meal, bonus and gift into Other Allowances', () => {
    const [r] = buildP10Rows({
      records: [record({ meal_allowance: 3000, bonus: 5000, gift: 1000 })],
      employeesById,
    });
    expect(r['Other Allowances']).toBe(9000);
  });

  it('stamps the rate basis, and says when a base was reconstructed', () => {
    expect(row.Basis).toBe('2025-02-01');
    const [legacy] = buildP10Rows({
      records: [{ employee_id: 'e1', pay_month: '2025-01', gross_salary: 100000, paye: 22383 }],
      employeesById,
    });
    expect(legacy.Basis).toContain('reconstructed');
  });
});

describe('p10Totals', () => {
  it('adds up what has to be remitted', () => {
    const rows = buildP10Rows({
      records: [record(), record({ employee_id: 'e2' })],
      employeesById,
    });
    const t = p10Totals(rows);
    expect(t.employees).toBe(2);
    expect(t.grossPay).toBe(220000);
    expect(t.paye).toBe(rows[0]['PAYE Tax'] + rows[1]['PAYE Tax']);
  });

  it('is zero-safe on an empty month', () => {
    expect(p10Totals([])).toMatchObject({ employees: 0, paye: 0, grossPay: 0 });
  });
});

describe('p10Exceptions', () => {
  it('names the employees whose missing PIN would fail the return', () => {
    const rows = buildP10Rows({
      records: [record(), record({ employee_id: 'e2' })],
      employeesById,
    });
    const { missingPin } = p10Exceptions(rows);
    expect(missingPin).toEqual(['Otieno Odhiambo']);
  });

  it('counts rows whose tax base was reconstructed', () => {
    const rows = buildP10Rows({
      records: [record(), { employee_id: 'e1', pay_month: '2025-01', gross_salary: 100000 }],
      employeesById,
    });
    expect(p10Exceptions(rows).reconstructed).toBe(1);
  });

  it('reports nothing to fix on a clean month', () => {
    const rows = buildP10Rows({ records: [record()], employeesById });
    expect(p10Exceptions(rows)).toEqual({ missingPin: [], reconstructed: 0 });
  });
});

describe('P10 as CSV', () => {
  it('serialises with the P10 header row, in order', () => {
    const rows = buildP10Rows({ records: [record()], employeesById });
    const csv = toCSV(rows, P10_COLUMNS);
    const [header] = csv.split('\r\n');
    expect(header).toBe(P10_COLUMNS.map(c => `"${c}"`).join(','));
  });

  it('survives an employee name containing a comma and a quote', () => {
    const rows = buildP10Rows({
      records: [record()],
      employeesById: { e1: { full_name: 'O\'Brien, "Jr" Kamau', kra_pin: 'A9X' } },
    });
    const csv = toCSV(rows, P10_COLUMNS);
    // Doubled internal quotes, whole field quoted — the row keeps its shape.
    expect(csv).toContain('"O\'Brien, ""Jr"" Kamau"');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
