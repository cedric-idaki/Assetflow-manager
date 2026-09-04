import { describe, it, expect } from 'vitest';
import { buildCalendarFrom } from './useStatutoryCalendar';
import { filingKey } from '../utils/statutoryCalendar';
import { RETURN_OVERDUE, RETURN_FILED } from '../config/statutoryReturns';

// One month of payroll, as statutory_payroll_periods() returns it: ALREADY
// summed in Postgres, one row per month. Two hundred employees produce exactly
// this shape, which is the point — nothing downstream reduces over a record
// list that a query limit could have truncated.
const period = (o = {}) => ({
  period: '2026-08',
  employees: 214,
  gross: 9_600_000,
  paye: 1_842_000,
  nssf: 924_480,
  shif: 264_000,
  housing_levy: 144_000,
  ...o,
});

const ON_THE_8TH = '2026-09-08';   // August's returns are a day away
const AFTER_THE_9TH = '2026-09-20'; // and eleven days past it

describe('buildCalendarFrom', () => {
  it('reads the month\'s figures off the aggregate row', () => {
    const { calendar } = buildCalendarFrom({ periods: [period()], asOf: ON_THE_8TH });
    const by = Object.fromEntries(calendar.map((e) => [e.returnKey, e]));

    expect(by.paye.amount).toBe(1_842_000);
    expect(by.shif.amount).toBe(264_000);
  });

  it('adds the employer match to NSSF and the levy, and to nothing else', () => {
    // This is the figure that actually leaves the bank. Remitting the employee
    // half is a 50% shortfall on two of the four payroll returns.
    const { calendar } = buildCalendarFrom({ periods: [period()], asOf: ON_THE_8TH });
    const by = Object.fromEntries(calendar.map((e) => [e.returnKey, e]));

    expect(by.nssf.amount).toBe(924_480 * 2);
    expect(by.housing_levy.amount).toBe(144_000 * 2);
    expect(by.paye.amount).toBe(1_842_000);
    expect(by.shif.amount).toBe(264_000);
  });

  it('reports employee counts from the aggregate, not from an array length', () => {
    const { employeesIn } = buildCalendarFrom({ periods: [period()], asOf: ON_THE_8TH });
    expect(employeesIn('2026-08')).toBe(214);
    expect(employeesIn('2026-01')).toBe(0);
  });

  it('raises the four payroll returns and no VAT return', () => {
    const { calendar } = buildCalendarFrom({ periods: [period()], asOf: ON_THE_8TH });
    expect(calendar.map((e) => e.returnKey).sort())
      .toEqual(['housing_levy', 'nssf', 'paye', 'shif']);
  });

  it('raises a VAT return once a VAT position is supplied', () => {
    const { calendar } = buildCalendarFrom({
      periods: [period()],
      vatByPeriod: { '2026-08': { outputVAT: 400_000, inputVAT: 150_000, netVAT: 250_000 } },
      asOf: ON_THE_8TH,
    });
    const vat = calendar.find((e) => e.returnKey === 'vat');
    expect(vat.amount).toBe(250_000);
    expect(vat.dueDate).toBe('2026-09-20');
  });

  it('raises VAT with NO amount when the tenant is registered but the ledger is silent', () => {
    // A registered business owes a NIL return in a month it sold nothing. The
    // deadline is real; the figure is genuinely unknown here, and null is what
    // the panel renders as a dash. A zero would read as "nothing to pay".
    const { calendar } = buildCalendarFrom({
      periods: [period()],
      settings: { vat_registered: true },
      asOf: ON_THE_8TH,
    });
    const vat = calendar.find((e) => e.returnKey === 'vat');
    expect(vat).toBeTruthy();
    expect(vat.amount).toBeNull();
  });

  it('puts overdue returns first', () => {
    const { calendar } = buildCalendarFrom({ periods: [period()], asOf: AFTER_THE_9TH });
    expect(calendar[0].status).toBe(RETURN_OVERDUE);
    expect(calendar[0].daysOverdue).toBeGreaterThan(0);
  });

  it('drops a return once it is marked filed, and keeps it in the history', () => {
    const filings = {
      [filingKey('paye', '2026-08')]: { filed_at: '2026-09-08T09:00:00Z', reference: 'KRA123' },
    };
    const { calendar, history } = buildCalendarFrom({
      periods: [period()], filings, asOf: ON_THE_8TH,
    });

    expect(calendar.map((e) => e.returnKey)).not.toContain('paye');
    const filed = history.find((e) => e.returnKey === 'paye');
    expect(filed.status).toBe(RETURN_FILED);
    expect(filed.filing.reference).toBe('KRA123');
  });

  it('counts what needs action, and reports nothing when there is no data at all', () => {
    const busy = buildCalendarFrom({ periods: [period()], asOf: AFTER_THE_9TH });
    expect(busy.summary.actionable).toBe(4);

    // No payroll and no VAT: an empty summary, not a summary built from the
    // current month that happens to contain zero entries.
    const idle = buildCalendarFrom({ periods: [], asOf: ON_THE_8TH });
    expect(idle.summary.total).toBe(0);
    expect(idle.summary.actionable).toBe(0);
    expect(idle.calendar).toEqual([]);
  });

  it('survives a month whose aggregate row is missing columns', () => {
    // A tenant whose payroll predates the statutory-breakdown migration has no
    // housing_levy stored. The return still has a deadline; its amount is zero
    // because nothing was withheld, which is the truthful reading of the data.
    const { calendar } = buildCalendarFrom({
      periods: [{ period: '2026-08', employees: 3, paye: 1000 }],
      asOf: ON_THE_8TH,
    });
    const ahl = calendar.find((e) => e.returnKey === 'housing_levy');
    expect(ahl.amount).toBe(0);
    expect(ahl.dueDate).toBe('2026-09-11');
  });
});
