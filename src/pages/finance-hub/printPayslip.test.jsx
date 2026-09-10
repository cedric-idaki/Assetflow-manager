import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn(), getUser: vi.fn() }, rpc: vi.fn() },
  getCurrentUser: vi.fn(),
  invokeSupabaseFunction: vi.fn(),
}));

const { printPayslip } = await import('./index');
const { computePayroll } = await import('../../utils/kenyaPayroll');

// printPayslip writes into a window it opens; capture what it wrote.
const render = (data, month = '2026-08') => {
  let written = '';
  const w = {
    document: { write: (s) => { written += s; }, close: () => {} },
    focus: () => {},
    print: () => {},
  };
  vi.spyOn(window, 'open').mockReturnValue(w);
  printPayslip({
    company: { company_name: 'Ararat Ltd', kra_pin: 'P051234567X' },
    employee: { id: 'emp-1', full_name: 'Grace Wanjiru', department: 'Finance' },
    month,
    data,
  });
  return written;
};

// Strip tags so an assertion on a figure is not defeated by the markup around it.
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('printPayslip', () => {
  const result = computePayroll({
    payMonth: '2026-08',
    basic: 85000, housingAllowance: 15000, transportAllowance: 10000,
  });

  it('prints every statutory deduction, the housing levy included', () => {
    const out = text(render(result));
    expect(out).toContain('NSSF (Tier I &amp; II)');
    expect(out).toContain('SHIF (2.75%)');
    // The levy was displayed on the employee form and never appeared on a
    // payslip with a real figure behind it.
    expect(out).toContain('Affordable Housing Levy (1.5%)');
    expect(out).toContain('PAYE (Income Tax)');
    expect(out).toContain(`KES ${(1650).toLocaleString('en-KE')}`);   // 1.5% of 110,000
  });

  it('shows the working PAYE was arrived at, not just the tax', () => {
    const out = text(render(result));
    expect(out).toContain('How PAYE Was Calculated');
    expect(out).toContain('Taxable pay');
    expect(out).toContain('Less allowable deductions');
    expect(out).toContain('Less personal relief');
    // The band split an employee would need to check the figure themselves.
    expect(out).toContain('10% on');
    expect(out).toContain('25% on');
    expect(out).toContain('30% on');
  });

  it('names the statutory basis the figures were priced under', () => {
    expect(text(render(result))).toContain('NSSF Act 2013');
  });

  it('says the basis is unrecorded rather than borrowing the current one', () => {
    // A legacy row whose rate schedule was never stored.
    const out = text(render({ ...result, rateLabel: null }));
    expect(out).toContain('Statutory basis not recorded');
    expect(out).not.toContain('NSSF Act 2013');
  });

  it('omits allowance lines that carry nothing', () => {
    const basicOnly = computePayroll({ payMonth: '2026-08', basic: 50000 });
    const out = text(render(basicOnly));
    expect(out).toContain('Basic Salary');
    expect(out).not.toContain('Housing Allowance');
    expect(out).not.toContain('Bonus');
  });

  it('prints the deductions an employee actually asked about', () => {
    const withExtras = computePayroll({
      payMonth: '2026-08', basic: 100000, pension: 5000, loanDeduction: 7500,
    });
    const out = text(render(withExtras));
    expect(out).toContain('Other Deductions');
    expect(out).toContain('Pension Contribution');
    expect(out).toContain('Loan Repayment');
    expect(out).not.toContain('Salary Advance');   // nothing withheld under it
  });

  it('foots — the printed net equals gross less the printed total', () => {
    const out = text(render(result));
    const money = (n) => `KES ${Math.round(n).toLocaleString('en-KE')}`;
    expect(out).toContain(money(result.grossCash));
    expect(out).toContain(money(result.totalDeductions));
    expect(out).toContain(money(result.netPay));
    expect(result.grossCash - result.totalDeductions).toBeCloseTo(result.netPay, 2);
  });

  it('escapes employee-supplied text rather than letting it through as markup', () => {
    let written = '';
    const w = { document: { write: (s) => { written += s; }, close: () => {} }, focus: () => {}, print: () => {} };
    vi.spyOn(window, 'open').mockReturnValue(w);
    printPayslip({
      company: { company_name: '<script>alert(1)</script>' },
      employee: { id: 'e', full_name: 'Grace <img src=x onerror=alert(1)>' },
      month: '2026-08',
      data: result,
    });
    expect(written).not.toContain('<script>');
    expect(written).not.toContain('<img src=x');
  });
});
