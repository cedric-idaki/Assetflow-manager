import { describe, it, expect } from 'vitest';
import {
  normalisePayrollTotals, payrollTotalsArgs, statutoryRemittance, sumPayrollRecords,
} from './payrollTotals';

const rec = (over = {}) => ({
  employee_id: 'e1', pay_month: '2026-09',
  basic_salary: 50000, housing_allowance: 5000, transport_allowance: 3000,
  meal_allowance: 0, bonus: 1000, gift: 0,
  gross_salary: 59000, taxable_pay: 52000, paye: 9000, nssf: 3540, shif: 1622.5,
  housing_levy: 885, loan_deduction: 2000, advance_deduction: 500, net_salary: 41452.5,
  ...over,
});

describe('sumPayrollRecords', () => {
  it('adds every money column and counts people, payslips and months separately', () => {
    const t = sumPayrollRecords([
      rec(),
      rec({ pay_month: '2026-08' }),                       // same person, another month
      rec({ employee_id: 'e2', gross_salary: '41000' }),   // numeric as a string
    ]);
    expect(t.records).toBe(3);
    expect(t.employees).toBe(2);   // not 3: one person paid twice is one employee
    expect(t.months).toBe(2);
    expect(t.gross).toBe(59000 + 59000 + 41000);
    expect(t.paye).toBe(27000);
    expect(t.nssf).toBe(3540 * 3);
    expect(t.shif).toBeCloseTo(1622.5 * 3);
    expect(t.allowances).toBe(8000 * 3);
    expect(t.additions).toBe(1000 * 3);
    expect(t.other_deductions).toBe(2500 * 3);
  });

  it('treats a legacy row with no housing levy as nothing, not NaN', () => {
    const t = sumPayrollRecords([rec({ housing_levy: null }), rec({ housing_levy: undefined })]);
    expect(t.housing_levy).toBe(0);
    expect(Number.isNaN(t.gross)).toBe(false);
  });

  it('is all zeros for no records', () => {
    const t = sumPayrollRecords([]);
    expect(t.records).toBe(0);
    expect(t.employees).toBe(0);
    expect(t.gross).toBe(0);
  });
});

describe('normalisePayrollTotals', () => {
  it('turns PostgREST numeric strings into numbers, so totals add rather than concatenate', () => {
    const t = normalisePayrollTotals({ records: 3, employees: 2, gross: '1000.50', paye: '200', nssf: null });
    expect(t.gross).toBe(1000.5);
    expect(t.paye + t.gross).toBe(1200.5);
    expect(t.nssf).toBe(0);
    expect(t.shif).toBe(0); // absent field
  });

  it('passes a missing row through as null so the page falls back', () => {
    expect(normalisePayrollTotals(undefined)).toBeNull();
  });
});

describe('statutoryRemittance', () => {
  it('doubles NSSF and the housing levy for the employer match; SHIF is withheld only', () => {
    expect(statutoryRemittance({ nssf: 100, shif: 50, housing_levy: 30 })).toBe(200 + 50 + 60);
  });
});

describe('payrollTotalsArgs', () => {
  it("maps 'all' and blanks to null, and keeps real filters", () => {
    expect(payrollTotalsArgs({
      adminId: 'a1', isSuper: false, month: '', from: '2026-07', to: '',
      status: 'all', department: 'Finance', role: 'all', search: '',
    })).toEqual({
      p_admin_id: 'a1', p_month: null, p_from: '2026-07', p_to: null,
      p_status: null, p_department: 'Finance', p_role: null, p_search: null,
    });
  });

  it('does not narrow a super admin to one tenant, matching the list query', () => {
    expect(payrollTotalsArgs({ adminId: 'a1', isSuper: true }).p_admin_id).toBeNull();
  });

  it('passes the search text exactly as the list filters on it', () => {
    expect(payrollTotalsArgs({ adminId: 'a1', search: 'Grace ' }).p_search).toBe('Grace ');
  });
});
