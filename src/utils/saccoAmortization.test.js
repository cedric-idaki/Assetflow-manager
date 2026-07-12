/**
 * Amortization engine tests — assert each method reproduces the Chama Management
 * System BRS v3.0 §4 worked examples (KES 50,000 @ 12% p.a. over 6 months).
 * vitest runs with globals enabled (see vite.config.mjs), so describe/it/expect
 * are available without imports.
 */
import {
  reducingBalance,
  equalPrincipal,
  flatRate,
  interestOnly,
  balloon,
  generateSchedule,
} from './saccoAmortization';

const P = 50000;
const RATE = 12;      // % p.a.
const N = 6;          // months
const base = { principal: P, annualRate: RATE, termMonths: N };

const sumPrincipal = (schedule) => schedule.reduce((s, r) => s + r.principal, 0);
const lastRow = (schedule) => schedule[schedule.length - 1];

describe('reducingBalance (EMI)', () => {
  const { schedule, summary } = reducingBalance(base);

  it('has one row per month', () => {
    expect(schedule).toHaveLength(N);
  });

  it('EMI ≈ KES 8,627 (BRS §4.1)', () => {
    // Non-final payments equal the fixed EMI.
    expect(schedule[0].payment).toBeCloseTo(8627.4, 0);
  });

  it('first period interest is KES 500 on the full balance', () => {
    expect(schedule[0].interest).toBeCloseTo(500, 2);
  });

  it('fully amortizes to a zero closing balance', () => {
    expect(lastRow(schedule).closingBalance).toBe(0);
  });

  it('principal portions sum to the loan principal', () => {
    expect(sumPrincipal(schedule)).toBeCloseTo(P, 1);
    expect(summary.principal).toBe(P);
  });
});

describe('equalPrincipal', () => {
  const { schedule } = equalPrincipal(base);

  it('repays a constant KES 8,333.33 of principal (except final rounding)', () => {
    expect(schedule[0].principal).toBeCloseTo(8333.33, 1);
  });

  it('first total payment ≈ KES 8,833.33 (principal + KES 500 interest)', () => {
    expect(schedule[0].payment).toBeCloseTo(8833.33, 1);
  });

  it('payments decrease over time', () => {
    expect(schedule[0].payment).toBeGreaterThan(lastRow(schedule).payment);
  });

  it('closes at zero', () => {
    expect(lastRow(schedule).closingBalance).toBe(0);
    expect(sumPrincipal(schedule)).toBeCloseTo(P, 1);
  });
});

describe('flatRate', () => {
  const { schedule, summary } = flatRate(base);

  it('total interest is KES 3,000 (BRS §4.3)', () => {
    expect(summary.totalInterest).toBeCloseTo(3000, 1);
  });

  it('constant monthly payment ≈ KES 8,833.33', () => {
    expect(schedule[0].payment).toBeCloseTo(8833.33, 1);
    // interest portion is flat across periods
    expect(schedule[0].interest).toBeCloseTo(500, 2);
    expect(schedule[2].interest).toBeCloseTo(500, 2);
  });

  it('closes at zero', () => {
    expect(lastRow(schedule).closingBalance).toBe(0);
  });
});

describe('interestOnly', () => {
  const { schedule } = interestOnly(base);

  it('pays only KES 500 interest for the first five periods', () => {
    for (let i = 0; i < N - 1; i++) {
      expect(schedule[i].payment).toBeCloseTo(500, 2);
      expect(schedule[i].principal).toBe(0);
      expect(schedule[i].closingBalance).toBeCloseTo(P, 2);
    }
  });

  it('final payment is KES 50,500 (interest + full principal, BRS §4.4)', () => {
    const final = lastRow(schedule);
    expect(final.payment).toBeCloseTo(50500, 2);
    expect(final.principal).toBeCloseTo(P, 2);
    expect(final.closingBalance).toBe(0);
  });
});

describe('balloon', () => {
  const { schedule, summary } = balloon({ ...base, balloonAmount: 20000 });

  it('periodic payment is the closed-form value (~KES 5,377)', () => {
    // BRS §4.5 formula: P·emiFactor − B·(r/((1+r)^n − 1)) ≈ 5376.57.
    expect(summary.periodicPayment).toBeGreaterThan(5300);
    expect(summary.periodicPayment).toBeLessThan(5450);
  });

  it('non-final payments equal the periodic payment', () => {
    expect(schedule[0].payment).toBeCloseTo(summary.periodicPayment, 1);
  });

  it('final payment clears the balance (≈ periodic + balloon)', () => {
    const final = lastRow(schedule);
    expect(final.closingBalance).toBe(0);
    expect(final.payment).toBeGreaterThan(20000); // dominated by the balloon lump sum
  });

  it('principal portions sum to the loan principal', () => {
    expect(sumPrincipal(schedule)).toBeCloseTo(P, 1);
  });
});

describe('generateSchedule dispatcher', () => {
  it('routes to the correct method', () => {
    const emi = generateSchedule('reducing_balance', base);
    expect(emi.schedule[0].payment).toBeCloseTo(8627.4, 0);
  });

  it('falls back to reducing balance for an unknown method', () => {
    const fallback = generateSchedule('nonsense', base);
    expect(fallback.schedule).toHaveLength(N);
    expect(lastRow(fallback.schedule).closingBalance).toBe(0);
  });

  it('attaches monthly due dates when a start date is given', () => {
    const withDates = generateSchedule('reducing_balance', { ...base, startDate: '2026-01-15' });
    expect(withDates.schedule[0].dueDate).toBe('2026-02-15');
    expect(withDates.schedule[5].dueDate).toBe('2026-07-15');
  });

  it('handles an interest-free loan (r = 0) without dividing by zero', () => {
    const free = generateSchedule('reducing_balance', { principal: 12000, annualRate: 0, termMonths: 12 });
    expect(free.schedule[0].payment).toBeCloseTo(1000, 2);
    expect(free.summary.totalInterest).toBe(0);
    expect(lastRow(free.schedule).closingBalance).toBe(0);
  });
});
