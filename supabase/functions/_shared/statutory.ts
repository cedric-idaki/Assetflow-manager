/**
 * STATUTORY RETURN DEADLINES — server-side mirror.
 *
 * WHY THERE ARE TWO COPIES
 *
 * The browser copy (src/config/statutoryReturns.js + src/utils/statutoryCalendar.js)
 * renders the calendar panel. This copy decides what the scheduler actually
 * MAILS, and an Edge Function cannot import from src/ — different runtime,
 * different bundle. The same split, for the same reason, as
 * src/config/etimsCodes.js ↔ _shared/etims.ts and
 * src/config/taxRegulations.js ↔ _shared/plans.ts.
 *
 * DRIFT BETWEEN THEM IS NOT COSMETIC. If this file thinks PAYE is due on the
 * 15th, the panel shows a countdown to the 9th and the reminder arrives six
 * days after the penalty has already attached. If the two disagree about the
 * housing levy's working-day rule, one surface is wrong every single month.
 *
 * src/config/statutoryReturns.sync.test.js asserts they agree — on every
 * deadline, for every obligation, across a run of periods that includes
 * weekends, Easter and a Labour Day. Change one, change both.
 *
 * Everything below is UTC calendar-date arithmetic. See the header of
 * src/utils/statutoryCalendar.js for why local-time Date construction is
 * banned here: a deadline is a day in Kenya, not an instant.
 */

export const DUE_CALENDAR_DAY = "calendar_day";
export const DUE_WORKING_DAY = "working_day";

export const WHEN_PAYROLL = "payroll";
export const WHEN_VAT_ACTIVITY = "vat_activity";

export type ReturnVersion = {
  version: string;
  effectiveFrom: string;
  dueBasis: string;
  dueDay: number;
  instrument: string;
  penalty: string;
};

export type StatutoryReturn = {
  key: string;
  label: string;
  authority: string;
  portal: string;
  cadence: string;
  appliesWhen: string;
  amountKey: string;
  amountLabel: string;
  versions: ReturnVersion[];
};

/** Mirrors STATUTORY_RETURNS in src/config/statutoryReturns.js. */
export const STATUTORY_RETURNS: StatutoryReturn[] = [
  {
    key: "paye",
    label: "PAYE (P10)",
    authority: "Kenya Revenue Authority",
    portal: "iTax",
    cadence: "monthly",
    appliesWhen: WHEN_PAYROLL,
    amountKey: "paye",
    amountLabel: "PAYE withheld",
    versions: [
      {
        version: "1974-01-01",
        effectiveFrom: "1974-01-01",
        dueBasis: DUE_CALENDAR_DAY,
        dueDay: 9,
        instrument: "Income Tax (PAYE) Rules, r.6 (under Income Tax Act, Cap 470)",
        penalty:
          "25% of the tax due or KES 10,000, whichever is higher (Tax Procedures Act 2015, s.83(1)), plus 5% of the unpaid tax and 1% interest a month.",
      },
    ],
  },
  {
    key: "nssf",
    label: "NSSF contributions",
    authority: "National Social Security Fund",
    portal: "NSSF self-service portal",
    cadence: "monthly",
    appliesWhen: WHEN_PAYROLL,
    amountKey: "nssfTotal",
    amountLabel: "NSSF (employee + employer)",
    versions: [
      {
        version: "2014-01-10",
        effectiveFrom: "2014-01-10",
        dueBasis: DUE_CALENDAR_DAY,
        dueDay: 9,
        instrument: "National Social Security Fund Act, 2013, s.20(2)",
        penalty:
          "A penalty of 5% of the unpaid contribution for each month it remains unpaid (NSSF Act 2013, s.21).",
      },
    ],
  },
  {
    key: "shif",
    label: "SHIF contributions",
    authority: "Social Health Authority",
    portal: "SHA / eCitizen",
    cadence: "monthly",
    appliesWhen: WHEN_PAYROLL,
    amountKey: "shif",
    amountLabel: "SHIF deducted",
    versions: [
      {
        version: "2024-10-01",
        effectiveFrom: "2024-10-01",
        dueBasis: DUE_CALENDAR_DAY,
        dueDay: 9,
        instrument: "Social Health Insurance (General) Regulations, 2024, r.24",
        penalty:
          "A penalty of 2% of the unpaid amount for every month it remains unpaid (Social Health Insurance Act 2023, s.47(3)).",
      },
    ],
  },
  {
    key: "housing_levy",
    label: "Affordable Housing Levy",
    authority: "Kenya Revenue Authority",
    portal: "iTax",
    cadence: "monthly",
    appliesWhen: WHEN_PAYROLL,
    amountKey: "housingLevyTotal",
    amountLabel: "Housing levy (employee + employer)",
    versions: [
      {
        version: "2024-03-19",
        effectiveFrom: "2024-03-19",
        dueBasis: DUE_WORKING_DAY,
        dueDay: 9,
        instrument: "Affordable Housing Act, 2024, s.4(3)",
        penalty:
          "A penalty of 3% of the unpaid levy for every month it remains unpaid (Affordable Housing Act 2024, s.4(5)).",
      },
    ],
  },
  {
    key: "vat",
    label: "VAT return (VAT3)",
    authority: "Kenya Revenue Authority",
    portal: "iTax",
    cadence: "monthly",
    appliesWhen: WHEN_VAT_ACTIVITY,
    amountKey: "vatPayable",
    amountLabel: "Net VAT payable",
    versions: [
      {
        version: "2013-09-02",
        effectiveFrom: "2013-09-02",
        dueBasis: DUE_CALENDAR_DAY,
        dueDay: 20,
        instrument: "Value Added Tax Act, 2013, s.44(1) and (2)",
        penalty:
          "5% of the tax due or KES 10,000, whichever is higher (Tax Procedures Act 2015, s.83(2)), plus 5% of the unpaid tax and 1% interest a month.",
      },
    ],
  },
];

export const REMINDER_LEAD_DAYS = [7, 3, 1, 0];
export const OVERDUE_REPEAT_DAYS = 1;
export const OVERDUE_CHASE_LIMIT_DAYS = 14;

// ─── Date primitives (UTC only) ───────────────────────────────────────────────

export const parseDate = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
};

export const toIso = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (iso: string, n: number): string | null => {
  const d = parseDate(iso);
  return d ? toIso(new Date(d.getTime() + n * 86400000)) : null;
};

export const daysBetween = (from: string, to: string): number | null => {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
};

export const periodLastDay = (period: string): string | null => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return toIso(new Date(Date.UTC(Number(m[1]), month, 0)));
};

export const shiftPeriod = (period: string, months: number): string | null => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || "").trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, 1))
    .toISOString()
    .slice(0, 7);
};

// ─── Kenya public holidays ────────────────────────────────────────────────────
// Fixed dates plus Easter. Eid is omitted because it is declared on sighting;
// see src/utils/statutoryCalendar.js for why that omission is safe.

export const easterSunday = (year: number): string => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(new Date(Date.UTC(year, month - 1, day)));
};

const FIXED_HOLIDAYS: [number, number, string][] = [
  [1, 1, "New Year's Day"],
  [5, 1, "Labour Day"],
  [6, 1, "Madaraka Day"],
  [10, 10, "Utamaduni Day"],
  [10, 20, "Mashujaa Day"],
  [12, 12, "Jamhuri Day"],
  [12, 25, "Christmas Day"],
  [12, 26, "Boxing Day"],
];

export const kenyaPublicHolidays = (year: number): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [month, day, name] of FIXED_HOLIDAYS) {
    out.set(toIso(new Date(Date.UTC(year, month - 1, day))), name);
  }
  const easter = easterSunday(year);
  out.set(addDays(easter, -2)!, "Good Friday");
  out.set(addDays(easter, 1)!, "Easter Monday");
  return out;
};

export const holidayName = (iso: string): string | null => {
  const d = parseDate(iso);
  if (!d) return null;
  return kenyaPublicHolidays(d.getUTCFullYear()).get(toIso(d)) || null;
};

export const isWeekend = (iso: string): boolean => {
  const d = parseDate(iso);
  if (!d) return false;
  const day = d.getUTCDay();
  return day === 0 || day === 6;
};

export const isWorkingDay = (iso: string): boolean =>
  !!parseDate(iso) && !isWeekend(iso) && !holidayName(iso);

export const nthWorkingDay = (period: string, n: number): string | null => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || "").trim());
  if (!m || !Number.isInteger(n) || n < 1) return null;

  let cursor = toIso(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
  let counted = 0;
  for (let i = 0; i < 62; i++) {
    if (isWorkingDay(cursor)) {
      counted += 1;
      if (counted === n) return cursor;
    }
    cursor = addDays(cursor, 1)!;
  }
  return null;
};

export const nthCalendarDay = (period: string, n: number): string | null => {
  const last = periodLastDay(period);
  if (!last || !Number.isInteger(n) || n < 1) return null;
  const day = Math.min(n, Number(last.slice(8, 10)));
  return `${period}-${String(day).padStart(2, "0")}`;
};

// ─── Deadlines ────────────────────────────────────────────────────────────────

export const findReturn = (key: string): StatutoryReturn | null =>
  STATUTORY_RETURNS.find((r) => r.key === key) || null;

export const resolveReturnVersion = (
  obligation: StatutoryReturn | null,
  period: string,
): (ReturnVersion & { beforeHistory: boolean }) | null => {
  const versions = obligation?.versions || [];
  if (!versions.length) return null;

  const lastDay = periodLastDay(period);
  if (!lastDay) return { ...versions[versions.length - 1], beforeHistory: false };

  const inForce = versions.filter((v) => v.effectiveFrom <= lastDay);
  if (!inForce.length) return { ...versions[0], beforeHistory: true };
  return { ...inForce[inForce.length - 1], beforeHistory: false };
};

export type DueInfo = {
  dueDate: string;
  statutoryDate: string;
  basis: string;
  dueDay: number;
  filingPeriod: string;
  fallsOnNonWorkingDay: boolean;
  nonWorkingReason: string | null;
  nextWorkingDay: string;
  instrument: string;
  penalty: string;
  beforeHistory: boolean;
};

/**
 * When a period's return is due. A deadline that lands on a weekend or holiday
 * is REPORTED, never moved — see the long note on dueDateFor() in
 * src/utils/statutoryCalendar.js.
 */
export const dueDateFor = (
  obligation: StatutoryReturn | null,
  period: string,
): DueInfo | null => {
  if (!obligation || !periodLastDay(period)) return null;
  const version = resolveReturnVersion(obligation, period);
  if (!version) return null;

  const filingPeriod = shiftPeriod(period, 1)!;
  const statutoryDate =
    version.dueBasis === DUE_WORKING_DAY
      ? nthWorkingDay(filingPeriod, version.dueDay)
      : nthCalendarDay(filingPeriod, version.dueDay);
  if (!statutoryDate) return null;

  const holiday = holidayName(statutoryDate);
  const weekend = isWeekend(statutoryDate);
  let nextWorking = statutoryDate;
  while (!isWorkingDay(nextWorking)) nextWorking = addDays(nextWorking, 1)!;

  return {
    dueDate: statutoryDate,
    statutoryDate,
    basis: version.dueBasis,
    dueDay: version.dueDay,
    filingPeriod,
    fallsOnNonWorkingDay: weekend || !!holiday,
    nonWorkingReason: holiday || (weekend ? "weekend" : null),
    nextWorkingDay: nextWorking,
    instrument: version.instrument,
    penalty: version.penalty,
    beforeHistory: !!version.beforeHistory,
  };
};

/**
 * Is a reminder due today, and which one? Mirrors reminderDueToday() in
 * src/utils/statutoryCalendar.js — `leadDays` is the reminder's identity and
 * goes into statutory_reminder_logs.lead_days, where the unique index turns it
 * into the send-once guarantee.
 */
export const reminderDueToday = (
  dueDate: string,
  asOf: string,
): { leadDays: number; overdue: boolean; daysOverdue: number } | null => {
  const days = daysBetween(asOf, dueDate);
  if (days === null) return null;

  if (days >= 0) {
    return REMINDER_LEAD_DAYS.includes(days)
      ? { leadDays: days, overdue: false, daysOverdue: 0 }
      : null;
  }

  const overdueBy = -days;
  if (overdueBy > OVERDUE_CHASE_LIMIT_DAYS) return null;
  if (overdueBy % OVERDUE_REPEAT_DAYS !== 0) return null;
  return { leadDays: days, overdue: true, daysOverdue: overdueBy };
};

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The figures behind one period's returns, keyed by `amountKey`.
 *
 * NSSF and the housing levy are DOUBLED for the employer match; SHIF and PAYE
 * are not. Mirrors statutoryAmountsFor() in src/utils/statutoryCalendar.js —
 * the doubling rule lives in exactly one place per runtime, so it cannot be
 * applied twice on one surface and forgotten on the other.
 *
 * vatPayable is null: statutory_reminder_workload() reports only WHETHER a VAT
 * return is owed, not its amount, because classifying a tenant's chart of
 * accounts into input and output VAT is done by classifyVatAccount() in
 * src/utils/vatLedger.js and reimplementing that in SQL would be a third copy
 * of a subtle rule. The email prints "check the portal" rather than a zero.
 */
export const amountsFromWorkload = (row: {
  paye?: number | string;
  nssf?: number | string;
  shif?: number | string;
  housing_levy?: number | string;
}): Record<string, number | null> => {
  const nssf = money(Number(row.nssf) || 0);
  const ahl = money(Number(row.housing_levy) || 0);
  return {
    paye: money(Number(row.paye) || 0),
    shif: money(Number(row.shif) || 0),
    nssfEmployee: nssf,
    nssfTotal: money(nssf * 2),
    housingLevyEmployee: ahl,
    housingLevyTotal: money(ahl * 2),
    vatPayable: null,
  };
};

export const obligationApplies = (
  obligation: StatutoryReturn,
  ev: { hasPayroll?: boolean; hasVatActivity?: boolean; vatRegistered?: boolean },
): boolean => {
  if (obligation.appliesWhen === WHEN_PAYROLL) return !!ev.hasPayroll;
  if (obligation.appliesWhen === WHEN_VAT_ACTIVITY)
    return !!ev.vatRegistered || !!ev.hasVatActivity;
  return true;
};
