import { describe, it, expect } from 'vitest';
import {
  easterSunday,
  kenyaPublicHolidays,
  holidayName,
  isWeekend,
  isWorkingDay,
  nthWorkingDay,
  nthCalendarDay,
  dueDateFor,
  statutoryAmountsFor,
  statusFor,
  obligationApplies,
  buildStatutoryCalendar,
  calendarSummary,
  reminderDueToday,
  reminderHeadline,
  daysBetween,
  addDays,
  shiftPeriod,
  filingKey,
} from './statutoryCalendar';
import {
  findReturn,
  STATUTORY_RETURNS,
  RETURN_KEYS,
  resolveReturnVersion,
  periodLastDay,
  REMINDER_LEAD_DAYS,
  DUE_WORKING_DAY,
  DUE_CALENDAR_DAY,
  RETURN_FILED,
  RETURN_OVERDUE,
  RETURN_DUE_TODAY,
  RETURN_DUE_SOON,
  RETURN_UPCOMING,
  OVERDUE_CHASE_LIMIT_DAYS,
} from '../config/statutoryReturns';

// Dates below are worked from the calendar and the instruments, not captured
// from the code. A snapshot of a wrong deadline is still a penalty.

describe('easterSunday', () => {
  // Known Gregorian Easters — the algorithm is only worth having if it agrees
  // with the years anybody can check.
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
  ])('%i falls on %s', (year, iso) => {
    expect(easterSunday(year)).toBe(iso);
  });
});

describe('kenyaPublicHolidays', () => {
  const h2026 = kenyaPublicHolidays(2026);

  it('carries the fixed-date holidays', () => {
    expect(h2026.get('2026-01-01')).toBe("New Year's Day");
    expect(h2026.get('2026-05-01')).toBe('Labour Day');
    expect(h2026.get('2026-06-01')).toBe('Madaraka Day');
    expect(h2026.get('2026-12-12')).toBe('Jamhuri Day');
    expect(h2026.get('2026-12-26')).toBe('Boxing Day');
  });

  it('carries both October holidays — Utamaduni and Mashujaa', () => {
    expect(h2026.get('2026-10-10')).toBe('Utamaduni Day');
    expect(h2026.get('2026-10-20')).toBe('Mashujaa Day');
  });

  it('derives Good Friday and Easter Monday from Easter', () => {
    expect(h2026.get('2026-04-03')).toBe('Good Friday');
    expect(h2026.get('2026-04-06')).toBe('Easter Monday');
  });

  it('omits Eid, which is declared on sighting and cannot be computed', () => {
    // Documented in the module header: the omission makes a working-day count
    // EARLIER than statute, never later, so it cannot cause a late filing.
    const names = [...h2026.values()].join(' ').toLowerCase();
    expect(names).not.toContain('eid');
  });
});

describe('working days', () => {
  it('excludes weekends', () => {
    expect(isWeekend('2026-09-05')).toBe(true);  // Saturday
    expect(isWeekend('2026-09-06')).toBe(true);  // Sunday
    expect(isWeekend('2026-09-07')).toBe(false); // Monday
    expect(isWorkingDay('2026-09-05')).toBe(false);
  });

  it('excludes public holidays', () => {
    expect(holidayName('2026-05-01')).toBe('Labour Day');
    expect(isWorkingDay('2026-05-01')).toBe(false);
  });

  it('counts the Nth working day of a month', () => {
    // September 2026 starts on a Tuesday and carries no holiday: the 9th
    // working day is Friday the 11th.
    expect(nthWorkingDay('2026-09', 9)).toBe('2026-09-11');
    expect(nthWorkingDay('2026-09', 1)).toBe('2026-09-01');
  });

  it('steps over a holiday when counting', () => {
    // May 2026: the 1st is Labour Day, so the count starts on the 4th and the
    // 9th working day lands on the 14th rather than the 13th.
    expect(nthWorkingDay('2026-05', 9)).toBe('2026-05-14');
  });

  it('steps over Good Friday and Easter Monday', () => {
    // Without them April 2026's 9th working day would be the 13th.
    expect(nthWorkingDay('2026-04', 9)).toBe('2026-04-15');
  });

  it('always lands on a working day', () => {
    for (const period of ['2026-01', '2026-04', '2026-05', '2026-10', '2026-12', '2027-01']) {
      expect(isWorkingDay(nthWorkingDay(period, 9))).toBe(true);
    }
  });

  it('rejects nonsense rather than guessing', () => {
    expect(nthWorkingDay('not-a-month', 9)).toBeNull();
    expect(nthWorkingDay('2026-09', 0)).toBeNull();
  });
});

describe('nthCalendarDay', () => {
  it('is the plain day of the month', () => {
    expect(nthCalendarDay('2026-09', 9)).toBe('2026-09-09');
    expect(nthCalendarDay('2026-09', 20)).toBe('2026-09-20');
  });

  it('clamps to the length of a short month', () => {
    expect(nthCalendarDay('2026-02', 31)).toBe('2026-02-28');
  });
});

describe('dueDateFor', () => {
  it('puts PAYE on the 9th of the month after the pay month', () => {
    const due = dueDateFor(findReturn('paye'), '2026-08');
    expect(due.dueDate).toBe('2026-09-09');
    expect(due.filingPeriod).toBe('2026-09');
    expect(due.basis).toBe(DUE_CALENDAR_DAY);
    expect(due.instrument).toMatch(/PAYE/);
  });

  it('puts VAT on the 20th', () => {
    expect(dueDateFor(findReturn('vat'), '2026-08').dueDate).toBe('2026-09-20');
  });

  it('counts the housing levy in WORKING days, not calendar days', () => {
    // The one obligation on the schedule with a working-day deadline. Reading
    // it as the 9th of September would put it two days early — harmless — but
    // the reverse error on the others is a penalty, so the distinction is
    // asserted in both directions here.
    const ahl = dueDateFor(findReturn('housing_levy'), '2026-08');
    expect(ahl.basis).toBe(DUE_WORKING_DAY);
    expect(ahl.dueDate).toBe('2026-09-11');
    expect(dueDateFor(findReturn('paye'), '2026-08').dueDate).toBe('2026-09-09');
  });

  it('reports a deadline that lands on a weekend without moving it', () => {
    // July 2026 PAYE is due 9 August 2026, a Sunday. KRA practice accepts the
    // next working day; practice is not the statute, so the date stands and
    // the fact is surfaced instead.
    const due = dueDateFor(findReturn('paye'), '2026-07');
    expect(due.dueDate).toBe('2026-08-09');
    expect(due.fallsOnNonWorkingDay).toBe(true);
    expect(due.nonWorkingReason).toBe('weekend');
    expect(due.nextWorkingDay).toBe('2026-08-10');
  });

  it('names a holiday when the deadline lands on one', () => {
    // November 2026 VAT is due 20 December 2026, a Sunday; and December 2025
    // PAYE would be due 9 January. Pick the case that is a named holiday:
    // September 2026 VAT is due 20 October 2026 — Mashujaa Day.
    const due = dueDateFor(findReturn('vat'), '2026-09');
    expect(due.dueDate).toBe('2026-10-20');
    expect(due.fallsOnNonWorkingDay).toBe(true);
    expect(due.nonWorkingReason).toBe('Mashujaa Day');
    expect(due.nextWorkingDay).toBe('2026-10-21');
  });

  it('leaves a working-day deadline unflagged, since it cannot land badly', () => {
    const ahl = dueDateFor(findReturn('housing_levy'), '2026-07');
    expect(ahl.fallsOnNonWorkingDay).toBe(false);
    expect(ahl.nextWorkingDay).toBe(ahl.dueDate);
  });

  it('carries the instrument and the penalty, so a reminder can cite them', () => {
    const due = dueDateFor(findReturn('housing_levy'), '2026-08');
    expect(due.instrument).toContain('Affordable Housing Act, 2024');
    expect(due.penalty).toMatch(/3%/);
  });

  it('refuses a period it cannot parse', () => {
    expect(dueDateFor(findReturn('paye'), 'August')).toBeNull();
    expect(dueDateFor(null, '2026-08')).toBeNull();
  });
});

describe('resolveReturnVersion', () => {
  it('resolves on the period\'s last day, so a mid-month instrument governs it', () => {
    // The Affordable Housing Act came into force on 19 March 2024. March 2024
    // must therefore resolve to it, not fall before the history.
    const v = resolveReturnVersion(findReturn('housing_levy'), '2024-03');
    expect(v.version).toBe('2024-03-19');
    expect(v.beforeHistory).toBe(false);
  });

  it('flags a period older than the obligation instead of inventing a rule', () => {
    const v = resolveReturnVersion(findReturn('shif'), '2024-01');
    expect(v.beforeHistory).toBe(true);
  });

  it('every obligation carries at least one version and a due day', () => {
    for (const r of STATUTORY_RETURNS) {
      expect(r.versions.length).toBeGreaterThan(0);
      for (const v of r.versions) {
        expect([DUE_CALENDAR_DAY, DUE_WORKING_DAY]).toContain(v.dueBasis);
        expect(v.dueDay).toBeGreaterThan(0);
        expect(v.instrument).toBeTruthy();
        expect(v.penalty).toBeTruthy();
      }
    }
  });

  it('every obligation names an amount the calendar can actually produce', () => {
    // A schedule entry whose amountKey is absent from statutoryAmountsFor()
    // renders a date with no figure. The two files must move together.
    const amounts = statutoryAmountsFor({
      payrollRecords: [{ paye: 1, nssf: 1, shif: 1, housing_levy: 1 }],
      vat: { outputVAT: 1, inputVAT: 0, netVAT: 1 },
    });
    for (const r of STATUTORY_RETURNS) {
      expect(Object.keys(amounts)).toContain(r.amountKey);
    }
  });
});

describe('statutoryAmountsFor', () => {
  const records = [
    { paye: 10000, nssf: 4320, shif: 2750, housing_levy: 1500 },
    { paye: 2500, nssf: 4320, shif: 1375, housing_levy: 750 },
  ];

  it('doubles NSSF and the housing levy for the employer match', () => {
    const a = statutoryAmountsFor({ payrollRecords: records });
    expect(a.nssfEmployee).toBe(8640);
    expect(a.nssfTotal).toBe(17280);
    expect(a.housingLevyEmployee).toBe(2250);
    expect(a.housingLevyTotal).toBe(4500);
  });

  it('does NOT double SHIF or PAYE — neither has an employer half', () => {
    const a = statutoryAmountsFor({ payrollRecords: records });
    expect(a.shif).toBe(4125);
    expect(a.paye).toBe(12500);
  });

  it('reports unknown VAT as null, not as a confident zero', () => {
    const a = statutoryAmountsFor({ payrollRecords: records });
    expect(a.vatPayable).toBeNull();
    expect(a.vatOutput).toBeNull();
  });

  it('carries a VAT credit through as a negative, not clamped to zero', () => {
    // A month in credit still has a return to file; the figure is a carry
    // forward, not a payment.
    const a = statutoryAmountsFor({ vat: { outputVAT: 1000, inputVAT: 2500, netVAT: -1500 } });
    expect(a.vatPayable).toBe(-1500);
  });

  it('handles an empty month without throwing', () => {
    const a = statutoryAmountsFor({});
    expect(a.paye).toBe(0);
    expect(a.employees).toBe(0);
  });
});

describe('statusFor', () => {
  const dueDate = '2026-09-09';

  it('is overdue the day after the deadline', () => {
    expect(statusFor({ dueDate, asOf: '2026-09-10' })).toBe(RETURN_OVERDUE);
  });

  it('is due today on the deadline itself', () => {
    expect(statusFor({ dueDate, asOf: '2026-09-09' })).toBe(RETURN_DUE_TODAY);
  });

  it('is due soon inside the first reminder lead', () => {
    expect(statusFor({ dueDate, asOf: '2026-09-02' })).toBe(RETURN_DUE_SOON);
    expect(statusFor({ dueDate, asOf: '2026-09-08' })).toBe(RETURN_DUE_SOON);
  });

  it('is upcoming beyond it', () => {
    expect(statusFor({ dueDate, asOf: '2026-09-01' })).toBe(RETURN_UPCOMING);
  });

  it('filed beats overdue, however long ago the deadline was', () => {
    expect(statusFor({ dueDate, filed: true, asOf: '2027-01-01' })).toBe(RETURN_FILED);
  });
});

describe('obligationApplies', () => {
  it('raises payroll returns only when payroll ran', () => {
    const paye = findReturn('paye');
    expect(obligationApplies(paye, { hasPayroll: true })).toBe(true);
    expect(obligationApplies(paye, { hasPayroll: false })).toBe(false);
  });

  it('stays quiet about VAT unless the tenant posted VAT or says it is registered', () => {
    const vat = findReturn('vat');
    expect(obligationApplies(vat, {})).toBe(false);
    expect(obligationApplies(vat, { hasVatActivity: true })).toBe(true);
    // A registered business owes a NIL return in a month it sold nothing.
    expect(obligationApplies(vat, { vatRegistered: true })).toBe(true);
  });
});

describe('buildStatutoryCalendar', () => {
  const payroll = [{ paye: 10000, nssf: 4320, shif: 2750, housing_levy: 1500 }];
  const base = {
    periods: ['2026-08'],
    amountsFor: () => statutoryAmountsFor({ payrollRecords: payroll }),
    evidenceFor: () => ({ hasPayroll: true }),
    asOf: '2026-09-08',
  };

  it('raises one entry per payroll obligation, and no VAT entry', () => {
    const cal = buildStatutoryCalendar(base);
    expect(cal.map((e) => e.returnKey).sort()).toEqual(['housing_levy', 'nssf', 'paye', 'shif']);
  });

  it('puts the amount and the deadline on each entry', () => {
    const paye = buildStatutoryCalendar(base).find((e) => e.returnKey === 'paye');
    expect(paye.amount).toBe(10000);
    expect(paye.dueDate).toBe('2026-09-09');
    expect(paye.daysRemaining).toBe(1);
    expect(paye.status).toBe(RETURN_DUE_SOON);
  });

  it('sorts worst first, then soonest', () => {
    const cal = buildStatutoryCalendar({
      ...base,
      periods: ['2026-07', '2026-08'],
      asOf: '2026-09-08',
    });
    // July's returns were due 9 August and are overdue; August's are not yet.
    expect(cal[0].status).toBe(RETURN_OVERDUE);
    expect(cal[0].period).toBe('2026-07');
    const statuses = cal.map((e) => e.status);
    expect(statuses.indexOf(RETURN_OVERDUE)).toBeLessThan(statuses.lastIndexOf(RETURN_DUE_SOON));
  });

  it('counts how overdue a return is', () => {
    const cal = buildStatutoryCalendar({ ...base, periods: ['2026-07'], asOf: '2026-09-08' });
    const paye = cal.find((e) => e.returnKey === 'paye');
    expect(paye.daysOverdue).toBe(30); // due 2026-08-09
    expect(paye.daysRemaining).toBe(-30);
  });

  it('drops a filed return from the working list, and keeps it on request', () => {
    const filings = { [filingKey('paye', '2026-08')]: { filed_at: '2026-09-05T10:00:00Z' } };
    expect(buildStatutoryCalendar({ ...base, filings }).map((e) => e.returnKey)).not.toContain('paye');

    const withFiled = buildStatutoryCalendar({ ...base, filings, includeFiled: true });
    const paye = withFiled.find((e) => e.returnKey === 'paye');
    expect(paye.status).toBe(RETURN_FILED);
    // Filed entries sort last, behind everything still outstanding.
    expect(withFiled[withFiled.length - 1].status).toBe(RETURN_FILED);
  });

  it('hides deadlines too far out to act on', () => {
    // Standing in June, August's returns are months away and not yet
    // preparable — the month has not even happened.
    const cal = buildStatutoryCalendar({ ...base, asOf: '2026-06-01' });
    expect(cal).toHaveLength(0);
  });

  it('ignores a period it cannot parse instead of throwing', () => {
    expect(buildStatutoryCalendar({ ...base, periods: ['whenever'] })).toEqual([]);
  });

  it('does not raise the same period twice', () => {
    const cal = buildStatutoryCalendar({ ...base, periods: ['2026-08', '2026-08'] });
    expect(cal).toHaveLength(4);
  });
});

describe('calendarSummary', () => {
  it('counts what needs doing now, separately from the whole list', () => {
    const cal = buildStatutoryCalendar({
      periods: ['2026-07', '2026-08'],
      amountsFor: () => statutoryAmountsFor({ payrollRecords: [{ paye: 1 }] }),
      evidenceFor: () => ({ hasPayroll: true }),
      asOf: '2026-09-09',
    });
    const s = calendarSummary(cal);
    expect(s.overdue).toBe(4);  // July's four, all past their August deadlines
    // PAYE, NSSF and SHIF share the 9th; the housing levy's working-day count
    // puts it on the 11th, so it is due soon rather than due today.
    expect(s.dueToday).toBe(3);
    expect(s.dueSoon).toBe(1);
    expect(s.actionable).toBe(s.overdue + s.dueToday + s.dueSoon);
    expect(s.total).toBe(cal.length);
  });

  it('three of the four payroll returns fall on the same day', () => {
    // Worth asserting on its own: a single missed 9th is three late returns
    // and three separate penalties, which is why one reminder covers them all.
    const cal = buildStatutoryCalendar({
      periods: ['2026-08'],
      amountsFor: () => statutoryAmountsFor({ payrollRecords: [{ paye: 1 }] }),
      evidenceFor: () => ({ hasPayroll: true }),
      asOf: '2026-09-09',
    });
    const onTheNinth = cal.filter((e) => e.dueDate === '2026-09-09').map((e) => e.returnKey);
    expect(onTheNinth.sort()).toEqual(['nssf', 'paye', 'shif']);
  });
});

describe('reminderDueToday', () => {
  const entry = { dueDate: '2026-09-09', filed: false };

  it('fires on each lead day and no other day before the deadline', () => {
    for (const lead of REMINDER_LEAD_DAYS) {
      const asOf = addDays('2026-09-09', -lead);
      expect(reminderDueToday(entry, asOf)).toMatchObject({ leadDays: lead, overdue: false });
    }
    // 5 days out is not a lead day.
    expect(reminderDueToday(entry, '2026-09-04')).toBeNull();
  });

  it('chases daily once overdue', () => {
    expect(reminderDueToday(entry, '2026-09-10')).toMatchObject({ overdue: true, daysOverdue: 1 });
    expect(reminderDueToday(entry, '2026-09-15')).toMatchObject({ overdue: true, daysOverdue: 6 });
  });

  it('stops chasing after the limit, rather than mailing forever', () => {
    const lastChase = addDays('2026-09-09', OVERDUE_CHASE_LIMIT_DAYS);
    expect(reminderDueToday(entry, lastChase)).not.toBeNull();
    expect(reminderDueToday(entry, addDays(lastChase, 1))).toBeNull();
  });

  it('never fires for a filed return', () => {
    expect(reminderDueToday({ ...entry, filed: true }, '2026-09-09')).toBeNull();
  });

  it('gives each reminder a distinct identity, so it can be deduped', () => {
    const seven = reminderDueToday(entry, '2026-09-02');
    const three = reminderDueToday(entry, '2026-09-06');
    expect(seven.leadDays).not.toBe(three.leadDays);
  });
});

describe('reminderHeadline', () => {
  it('says the same thing the panel does', () => {
    expect(reminderHeadline({ label: 'PAYE (P10)', period: '2026-08', daysRemaining: 7, daysOverdue: 0 }))
      .toBe('PAYE (P10) for 2026-08 is due in 7 days');
    expect(reminderHeadline({ label: 'PAYE (P10)', period: '2026-08', daysRemaining: 1, daysOverdue: 0 }))
      .toBe('PAYE (P10) for 2026-08 is due in 1 day');
    expect(reminderHeadline({ label: 'PAYE (P10)', period: '2026-08', daysRemaining: 0, daysOverdue: 0 }))
      .toBe('PAYE (P10) for 2026-08 is due today');
    expect(reminderHeadline({ label: 'PAYE (P10)', period: '2026-08', daysRemaining: -3, daysOverdue: 3 }))
      .toBe('PAYE (P10) for 2026-08 is 3 days overdue');
  });
});

describe('date primitives', () => {
  it('measures whole days in UTC, so a timezone cannot buy an extra one', () => {
    expect(daysBetween('2026-09-01', '2026-09-09')).toBe(8);
    expect(daysBetween('2026-09-10', '2026-09-09')).toBe(-1);
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    expect(periodLastDay('2028-02')).toBe('2028-02-29'); // leap year
  });

  it('returns null for input it cannot read', () => {
    expect(daysBetween('nope', '2026-09-09')).toBeNull();
    expect(addDays('nope', 1)).toBeNull();
    expect(shiftPeriod('nope', 1)).toBeNull();
  });
});

describe('the schedule itself', () => {
  it('has unique keys', () => {
    expect(new Set(RETURN_KEYS).size).toBe(RETURN_KEYS.length);
  });

  it('lists versions oldest first, so resolution can take the last match', () => {
    for (const r of STATUTORY_RETURNS) {
      const dates = r.versions.map((v) => v.effectiveFrom);
      expect(dates).toEqual([...dates].sort());
    }
  });
});
