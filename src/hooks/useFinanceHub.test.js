import { describe, it, expect, vi } from 'vitest';

// buildSalePlan is pure, but the module it lives in boots the Supabase client.
vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn(), getUser: vi.fn() } },
}));

const { buildSalePlan } = await import('./useFinanceHub');
const { monthlyInstallmentFor, buildInstallmentSchedule } = await import('./usePOS');

// A 24-month plan: 1.2M asset, 200k deposit, 1M financed at 12% p.a.
const sale = (overrides = {}) => ({
  id: 'sale-1',
  invoice_number: 'INV-2026-000123',
  pricing_model: 'installment',
  selling_price: 1200000,
  deposit_amount: 200000,
  finance_balance: 1000000,
  interest_rate: 12,
  tenure_months: 24,
  payment_start_date: '2026-09-01',
  ...overrides,
});

describe('monthlyInstallmentFor', () => {
  it('matches the installment the POS schedule is built from', () => {
    const built = buildInstallmentSchedule({
      sellingPrice: 1200000,
      deposit: 200000,
      annualInterestRate: 12,
      tenureMonths: 24,
      startDate: '2026-09-01',
    });
    const direct = monthlyInstallmentFor({
      financed: 1000000,
      annualInterestRate: 12,
      tenureMonths: 24,
    });
    expect(Math.round(direct * 100) / 100).toBe(built.summary.monthlyInstallment);
  });

  it('divides evenly when the plan carries no interest', () => {
    expect(monthlyInstallmentFor({ financed: 120000, annualInterestRate: 0, tenureMonths: 12 })).toBe(10000);
  });

  it('returns zero rather than Infinity when there is no tenure', () => {
    expect(monthlyInstallmentFor({ financed: 120000, annualInterestRate: 12, tenureMonths: 0 })).toBe(0);
  });
});

describe('buildSalePlan', () => {
  it('takes the monthly figure from the schedule the client is billed against', () => {
    // The schedule row wins even where it disagrees with the formula — that row
    // is what collections raises against the client.
    const plan = buildSalePlan(sale(), { installment_amount: 47073.47, due_date: '2026-09-15' });
    expect(plan.monthly_installment).toBe(47073.47);
    expect(plan.start_date).toBe('2026-09-15');
  });

  it('falls back to the amortisation formula when no schedule row exists', () => {
    const plan = buildSalePlan(sale(), null);
    const expected = Math.round(
      monthlyInstallmentFor({ financed: 1000000, annualInterestRate: 12, tenureMonths: 24 }) * 100
    ) / 100;
    expect(plan.monthly_installment).toBe(expected);
    expect(plan.start_date).toBe('2026-09-01');
  });

  it('dates the final installment one tenure after the first, not one past it', () => {
    // 24 monthly payments starting Sep 2026 end Aug 2028 — not Sep 2028.
    const plan = buildSalePlan(sale(), null);
    expect(plan.final_due_date).toBe('2028-08-01');
  });

  it('reports the tenure and the total the client pays across the plan', () => {
    const plan = buildSalePlan(sale(), { installment_amount: 47000, due_date: '2026-09-01' });
    expect(plan.tenure_months).toBe(24);
    expect(plan.plan_total).toBe(200000 + 47000 * 24);
    expect(plan.deposit).toBe(200000);
    expect(plan.financed).toBe(1000000);
  });

  it('has no plan for a cash sale or a sale with no tenure', () => {
    expect(buildSalePlan(sale({ pricing_model: 'cash' }))).toBeNull();
    expect(buildSalePlan(sale({ tenure_months: 0 }))).toBeNull();
    expect(buildSalePlan(null)).toBeNull();
  });

  it('leaves the dates empty rather than inventing them when the plan has no start', () => {
    const plan = buildSalePlan(sale({ payment_start_date: null }), null);
    expect(plan.start_date).toBeNull();
    expect(plan.final_due_date).toBeNull();
    expect(plan.tenure_months).toBe(24);
  });
});
