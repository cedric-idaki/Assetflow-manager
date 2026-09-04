/**
 * The statutory deadline schedule exists in two files and they must agree:
 *
 *   src/config/statutoryReturns.js        — what the calendar panel counts down
 *   + src/utils/statutoryCalendar.js        to, and what "mark as filed" closes
 *
 *   supabase/functions/_shared/statutory.ts — what the scheduler actually MAILS
 *
 * Two copies exist because an Edge Function runs in Deno and cannot import from
 * src/. Same split, same reason, as etimsCodes.js ↔ _shared/etims.ts.
 *
 * DRIFT HERE IS EXPENSIVE, and it is silent. If the server copy thought PAYE
 * were due on the 15th, the panel would count down to the 9th while the email
 * arrived six days after the 25% penalty had already attached — and nothing
 * would look broken to anyone until KRA wrote. If the two disagreed about the
 * housing levy's WORKING-day rule, one surface would be wrong every month of
 * the year.
 *
 * So this test walks both implementations over a run of real periods — ones
 * whose deadlines fall on a Sunday, on Mashujaa Day, and across Easter and
 * Labour Day, where the working-day count is hardest — and asserts they land on
 * the same date every time. Change one, change both.
 */

import { describe, it, expect } from 'vitest';

import {
  STATUTORY_RETURNS as JS_RETURNS,
  REMINDER_LEAD_DAYS as JS_LEADS,
  OVERDUE_REPEAT_DAYS as JS_REPEAT,
  OVERDUE_CHASE_LIMIT_DAYS as JS_LIMIT,
  DUE_CALENDAR_DAY as JS_CAL,
  DUE_WORKING_DAY as JS_WORK,
  WHEN_PAYROLL as JS_WHEN_PAYROLL,
  WHEN_VAT_ACTIVITY as JS_WHEN_VAT,
  findReturn as jsFind,
} from './statutoryReturns';
import {
  dueDateFor as jsDueDateFor,
  reminderDueToday as jsReminderDueToday,
  statutoryAmountsFor as jsAmounts,
  easterSunday as jsEaster,
  nthWorkingDay as jsNthWorkingDay,
  isWorkingDay as jsIsWorkingDay,
  obligationApplies as jsApplies,
  addDays,
} from '../utils/statutoryCalendar';

import {
  STATUTORY_RETURNS as TS_RETURNS,
  REMINDER_LEAD_DAYS as TS_LEADS,
  OVERDUE_REPEAT_DAYS as TS_REPEAT,
  OVERDUE_CHASE_LIMIT_DAYS as TS_LIMIT,
  DUE_CALENDAR_DAY as TS_CAL,
  DUE_WORKING_DAY as TS_WORK,
  WHEN_PAYROLL as TS_WHEN_PAYROLL,
  WHEN_VAT_ACTIVITY as TS_WHEN_VAT,
  findReturn as tsFind,
  dueDateFor as tsDueDateFor,
  reminderDueToday as tsReminderDueToday,
  amountsFromWorkload as tsAmounts,
  easterSunday as tsEaster,
  nthWorkingDay as tsNthWorkingDay,
  isWorkingDay as tsIsWorkingDay,
  obligationApplies as tsApplies,
} from '../../supabase/functions/_shared/statutory.ts';

// Deliberately awkward periods, not a tidy run of months:
//   2026-07 → due 9 Aug 2026, a SUNDAY
//   2026-09 → VAT due 20 Oct 2026, MASHUJAA DAY
//   2026-03 → levy counted through Easter (3 and 6 April 2026)
//   2026-04 → levy counted through Labour Day (1 May 2026)
//   2024-03 → the month the Affordable Housing Act came into force
//   2024-09 → the month before SHIF began, so the two must agree on
//             beforeHistory as well as on the date
const PERIODS = [
  '2024-03', '2024-09', '2024-12',
  '2025-01', '2025-02', '2025-12',
  '2026-01', '2026-03', '2026-04', '2026-05',
  '2026-06', '2026-07', '2026-08', '2026-09',
  '2026-10', '2026-11', '2026-12',
  '2027-01', '2027-03',
];

describe('the two schedules describe the same obligations', () => {
  it('same keys, in the same order', () => {
    expect(TS_RETURNS.map((r) => r.key)).toEqual(JS_RETURNS.map((r) => r.key));
  });

  it('same basis constants', () => {
    expect(TS_CAL).toBe(JS_CAL);
    expect(TS_WORK).toBe(JS_WORK);
    expect(TS_WHEN_PAYROLL).toBe(JS_WHEN_PAYROLL);
    expect(TS_WHEN_VAT).toBe(JS_WHEN_VAT);
  });

  it('same reminder cadence', () => {
    expect(TS_LEADS).toEqual(JS_LEADS);
    expect(TS_REPEAT).toBe(JS_REPEAT);
    expect(TS_LIMIT).toBe(JS_LIMIT);
  });

  it.each(JS_RETURNS.map((r) => r.key))('%s carries the same label, amount key and versions', (key) => {
    const js = jsFind(key);
    const ts = tsFind(key);
    expect(ts).toBeTruthy();
    expect(ts.label).toBe(js.label);
    expect(ts.authority).toBe(js.authority);
    expect(ts.portal).toBe(js.portal);
    expect(ts.appliesWhen).toBe(js.appliesWhen);
    // The amount key is the join between the schedule and the figures. A
    // mismatch here shows up as an email with no amount on it.
    expect(ts.amountKey).toBe(js.amountKey);
    expect(ts.amountLabel).toBe(js.amountLabel);
    expect(ts.versions.map((v) => [v.version, v.effectiveFrom, v.dueBasis, v.dueDay]))
      .toEqual(js.versions.map((v) => [v.version, v.effectiveFrom, v.dueBasis, v.dueDay]));
    // The instrument and the penalty are quoted verbatim in the email, so they
    // are part of the contract too.
    expect(ts.versions.map((v) => v.instrument)).toEqual(js.versions.map((v) => v.instrument));
    expect(ts.versions.map((v) => v.penalty)).toEqual(js.versions.map((v) => v.penalty));
  });
});

describe('both implementations compute the same deadline', () => {
  for (const key of JS_RETURNS.map((r) => r.key)) {
    it.each(PERIODS)(`${key} for %s`, (period) => {
      const js = jsDueDateFor(jsFind(key), period);
      const ts = tsDueDateFor(tsFind(key), period);
      expect(ts.dueDate).toBe(js.dueDate);
      expect(ts.basis).toBe(js.basis);
      expect(ts.filingPeriod).toBe(js.filingPeriod);
      expect(ts.fallsOnNonWorkingDay).toBe(js.fallsOnNonWorkingDay);
      expect(ts.nonWorkingReason).toBe(js.nonWorkingReason);
      expect(ts.nextWorkingDay).toBe(js.nextWorkingDay);
      expect(ts.beforeHistory).toBe(js.beforeHistory);
    });
  }
});

describe('both implementations agree on the working-day calendar', () => {
  it.each([2024, 2025, 2026, 2027, 2028])('Easter %i', (year) => {
    expect(tsEaster(year)).toBe(jsEaster(year));
  });

  it.each(PERIODS)('the 9th working day of %s', (period) => {
    expect(tsNthWorkingDay(period, 9)).toBe(jsNthWorkingDay(period, 9));
  });

  it('agrees day by day across a full year, holidays included', () => {
    // The deadline tests above only probe two days a month. A holiday table
    // that diverged on, say, Boxing Day would slip through them and then move
    // a levy deadline the following year.
    let cursor = '2026-01-01';
    while (cursor <= '2026-12-31') {
      expect([cursor, tsIsWorkingDay(cursor)]).toEqual([cursor, jsIsWorkingDay(cursor)]);
      cursor = addDays(cursor, 1);
    }
  });
});

describe('both implementations fire reminders on the same days', () => {
  const dueDate = '2026-09-09';

  it('agrees on every day from a fortnight before to a fortnight after', () => {
    for (let offset = -14; offset <= 20; offset++) {
      const asOf = addDays(dueDate, offset);
      const js = jsReminderDueToday({ dueDate, filed: false }, asOf);
      const ts = tsReminderDueToday(dueDate, asOf);
      // Compared as a plain shape so "both null" and "both the same reminder"
      // are one assertion; the asOf is folded in so a failure names the day.
      expect([asOf, ts && ts.leadDays, ts && ts.overdue])
        .toEqual([asOf, js && js.leadDays, js && js.overdue]);
    }
  });
});

describe('both implementations apply the employer match identically', () => {
  it('doubles NSSF and the levy, and neither PAYE nor SHIF', () => {
    const row = { paye: 12500, nssf: 8640, shif: 4125, housing_levy: 2250 };
    const js = jsAmounts({
      payrollRecords: [
        { paye: 10000, nssf: 4320, shif: 2750, housing_levy: 1500 },
        { paye: 2500, nssf: 4320, shif: 1375, housing_levy: 750 },
      ],
    });
    const ts = tsAmounts(row);

    for (const key of ['paye', 'shif', 'nssfEmployee', 'nssfTotal', 'housingLevyEmployee', 'housingLevyTotal']) {
      expect([key, ts[key]]).toEqual([key, js[key]]);
    }
  });

  it('both report an unknown VAT position as null rather than zero', () => {
    expect(tsAmounts({}).vatPayable).toBeNull();
    expect(jsAmounts({}).vatPayable).toBeNull();
  });

  it('every obligation key resolves to a figure on both sides', () => {
    const ts = tsAmounts({ paye: 1, nssf: 1, shif: 1, housing_levy: 1 });
    const js = jsAmounts({ payrollRecords: [{ paye: 1, nssf: 1, shif: 1, housing_levy: 1 }] });
    for (const r of JS_RETURNS) {
      expect(Object.keys(ts)).toContain(r.amountKey);
      expect(Object.keys(js)).toContain(r.amountKey);
    }
  });
});

describe('both implementations raise the same obligations', () => {
  const cases = [
    { hasPayroll: true, hasVatActivity: false, vatRegistered: false },
    { hasPayroll: false, hasVatActivity: true, vatRegistered: false },
    { hasPayroll: false, hasVatActivity: false, vatRegistered: true },
    { hasPayroll: false, hasVatActivity: false, vatRegistered: false },
  ];

  it.each(cases)('%o', (evidence) => {
    for (const r of JS_RETURNS) {
      expect([r.key, tsApplies(tsFind(r.key), evidence)])
        .toEqual([r.key, jsApplies(jsFind(r.key), evidence)]);
    }
  });
});
