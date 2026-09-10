/**
 * STATUTORY RETURN CALENDAR (pure functions)
 *
 * Turns the obligation schedule in src/config/statutoryReturns.js plus a
 * tenant's own payroll and VAT figures into a dated list: what is due, when,
 * for how much, and how late it already is.
 *
 * Nothing here touches the DOM, Supabase or React. The HR panel renders what
 * this returns, and supabase/functions/statutory-return-reminders mirrors the
 * same rules server-side, so the reminder in someone's inbox and the row on
 * their screen can never disagree about a deadline.
 *
 * ── DATES ARE UTC CALENDAR DATES, NOT INSTANTS ──────────────────────────────
 *
 * Every date in this module is a 'YYYY-MM-DD' string, and every Date built
 * from one uses Date.UTC. A deadline is a calendar day in Kenya, not a moment:
 * `new Date('2026-09-09')` parses as UTC midnight, so a browser in Nairobi
 * (UTC+3) reading .getDate() off it locally still gets the 9th, but one in
 * New York (UTC-5) gets the 8th — a whole day of "you have one more day than
 * you do". Local-time date construction is the single easiest way to make this
 * module lie, so it does not appear anywhere below.
 *
 * ── WHAT "WORKING DAY" MEANS HERE ───────────────────────────────────────────
 *
 * Saturday, Sunday and a Kenyan public holiday are not working days. The
 * holiday list below is the computable part: the fixed-date holidays in the
 * Public Holidays Act, plus Good Friday and Easter Monday, which are derived.
 *
 * Eid al-Fitr and Eid al-Adha are NOT in it, and cannot be: both are declared
 * on the sighting of the moon by the Chief Kadhi, days ahead at most, and a
 * table of predicted dates would be a guess wearing a fact's clothes. The
 * consequence is bounded and it runs the safe way: an uncounted holiday makes
 * the computed 9th working day EARLIER than the statutory one, so a levy
 * reminder near an Eid fires a day early rather than a day late. Early is a
 * nuisance; late is a 3% penalty.
 */

import {
  STATUTORY_RETURNS,
  DUE_WORKING_DAY,
  WHEN_PAYROLL,
  WHEN_VAT_ACTIVITY,
  RETURN_FILED,
  RETURN_OVERDUE,
  RETURN_DUE_TODAY,
  RETURN_DUE_SOON,
  RETURN_UPCOMING,
  RETURN_STATUS_ORDER,
  DUE_SOON_WITHIN_DAYS,
  CALENDAR_HORIZON_DAYS,
  OVERDUE_CHASE_LIMIT_DAYS,
  OVERDUE_REPEAT_DAYS,
  REMINDER_LEAD_DAYS,
  resolveReturnVersion,
  periodLastDay,
} from '../config/statutoryReturns';

// ─────────────────────────────────────────────────────────────────────────────
// DATE PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

/** A 'YYYY-MM-DD' string as a UTC Date, or null if it is not one. */
export const parseDate = (iso) => {
  if (iso instanceof Date) return Number.isNaN(iso.getTime()) ? null : iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** A Date (or date-ish value) as 'YYYY-MM-DD'. */
export const toIso = (d) => {
  const date = d instanceof Date ? d : parseDate(d);
  return date ? date.toISOString().slice(0, 10) : null;
};

/** Today as 'YYYY-MM-DD'. Resolved per call — a process can outlive a date. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export const daysBetween = (from, to) => {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
};

/** `iso` shifted by n days. */
export const addDays = (iso, n) => {
  const d = parseDate(iso);
  if (!d) return null;
  return toIso(new Date(d.getTime() + n * 86400000));
};

/** The 'YYYY-MM' period a date falls in. */
export const periodOf = (iso) => (toIso(iso) || '').slice(0, 7) || null;

/** The period n months before/after a 'YYYY-MM'. */
export const shiftPeriod = (period, months) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, 1));
  return d.toISOString().slice(0, 7);
};

// ─────────────────────────────────────────────────────────────────────────────
// KENYA PUBLIC HOLIDAYS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Easter Sunday for a Gregorian year, by the anonymous Gregorian algorithm
 * (Meeus/Jones/Butcher). Good Friday is two days before it, Easter Monday one
 * day after, and both are public holidays under the Public Holidays Act.
 */
export const easterSunday = (year) => {
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
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(new Date(Date.UTC(year, month - 1, day)));
};

/**
 * Fixed-date public holidays, as [month, day, name].
 *
 * Utamaduni Day (10 October) and Mashujaa Day (20 October) are both listed:
 * the Public Holidays (Amendment) Act 2023 renamed Huduma Day to Utamaduni Day
 * and kept it, so October carries two.
 */
const FIXED_HOLIDAYS = [
  [1, 1, "New Year's Day"],
  [5, 1, 'Labour Day'],
  [6, 1, 'Madaraka Day'],
  [10, 10, 'Utamaduni Day'],
  [10, 20, 'Mashujaa Day'],
  [12, 12, 'Jamhuri Day'],
  [12, 25, 'Christmas Day'],
  [12, 26, 'Boxing Day'],
];

/**
 * Kenyan public holidays in a year, as a Map of 'YYYY-MM-DD' → name.
 *
 * Does NOT include Eid al-Fitr or Eid al-Adha (see the module header), and
 * does not model the "falls on a Sunday, observed Monday" rule the Public
 * Holidays Act allows the Cabinet Secretary to declare: that declaration is
 * discretionary and per-occasion, so honouring it here would be inventing one.
 * Both omissions shift a working-day count EARLIER, never later.
 */
export const kenyaPublicHolidays = (year) => {
  const out = new Map();
  for (const [month, day, name] of FIXED_HOLIDAYS) {
    out.set(toIso(new Date(Date.UTC(year, month - 1, day))), name);
  }
  const easter = easterSunday(year);
  out.set(addDays(easter, -2), 'Good Friday');
  out.set(addDays(easter, 1), 'Easter Monday');
  return out;
};

/** Is this date a Kenyan public holiday? Returns the name, or null. */
export const holidayName = (iso) => {
  const d = parseDate(iso);
  if (!d) return null;
  return kenyaPublicHolidays(d.getUTCFullYear()).get(toIso(d)) || null;
};

/** Saturday or Sunday? */
export const isWeekend = (iso) => {
  const d = parseDate(iso);
  if (!d) return false;
  const day = d.getUTCDay();
  return day === 0 || day === 6;
};

/** A working day is a weekday that is not a public holiday. */
export const isWorkingDay = (iso) => !!parseDate(iso) && !isWeekend(iso) && !holidayName(iso);

/**
 * The Nth working day of a month, as 'YYYY-MM-DD'.
 *
 * A month has at least 19 working days, so N up to 19 always lands inside it.
 * Beyond that the walk is allowed to run into the next month rather than
 * clamping — a deadline that overflows its month is still a real date, and
 * silently pinning it to the 31st would be a fabricated one. No obligation on
 * the schedule counts past 9.
 */
export const nthWorkingDay = (period, n) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || '').trim());
  if (!m || !Number.isInteger(n) || n < 1) return null;

  let cursor = toIso(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
  let counted = 0;
  // 62 days is two full months — far past any deadline the schedule can state,
  // and a hard stop so a broken holiday table cannot spin forever.
  for (let i = 0; i < 62; i++) {
    if (isWorkingDay(cursor)) {
      counted += 1;
      if (counted === n) return cursor;
    }
    cursor = addDays(cursor, 1);
  }
  return null;
};

/** The Nth calendar day of a month, clamped to the month's length. */
export const nthCalendarDay = (period, n) => {
  const last = periodLastDay(period);
  if (!last || !Number.isInteger(n) || n < 1) return null;
  const lastDay = Number(last.slice(8, 10));
  const day = Math.min(n, lastDay);
  return `${period}-${String(day).padStart(2, '0')}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// DUE DATES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When a period's return for one obligation is due.
 *
 * Every obligation on the schedule is filed in the month AFTER the period it
 * covers, so the deadline is computed in `shiftPeriod(period, 1)`.
 *
 * ── WHY A WEEKEND DEADLINE IS NOT MOVED ─────────────────────────────────────
 *
 * When a calendar-day deadline lands on a Saturday, KRA's published practice
 * is to accept the return on the next working day. Practice is not the statute,
 * it is not uniform across KRA, NSSF and the SHA, and it has no instrument this
 * file could cite. Moving the date on the strength of it would mean this system
 * telling someone they have until Monday on the authority of a convention —
 * and being wrong about that costs them 25% of the tax.
 *
 * So the statutory date stands as the deadline, and `fallsOnNonWorkingDay`
 * carries the fact to the surface with `nextWorkingDay` beside it. The panel
 * says what the rule is and what the practice is, and lets a human decide. The
 * error runs the safe way: at worst someone files on Friday when Monday would
 * also have been accepted.
 *
 * @returns {{dueDate, statutoryDate, basis, dueDay, filingPeriod, fallsOnNonWorkingDay, nonWorkingReason, nextWorkingDay, instrument, penalty, beforeHistory}|null}
 */
export const dueDateFor = (obligation, period) => {
  if (!obligation || !periodLastDay(period)) return null;
  const version = resolveReturnVersion(obligation, period);
  if (!version) return null;

  const filingPeriod = shiftPeriod(period, 1);
  const statutoryDate =
    version.dueBasis === DUE_WORKING_DAY
      ? nthWorkingDay(filingPeriod, version.dueDay)
      : nthCalendarDay(filingPeriod, version.dueDay);
  if (!statutoryDate) return null;

  // A working-day deadline lands on a working day by construction; only a
  // calendar-day one can fall on a weekend or holiday.
  const holiday = holidayName(statutoryDate);
  const weekend = isWeekend(statutoryDate);
  let nextWorking = statutoryDate;
  while (!isWorkingDay(nextWorking)) nextWorking = addDays(nextWorking, 1);

  return {
    dueDate: statutoryDate,
    statutoryDate,
    basis: version.dueBasis,
    dueDay: version.dueDay,
    filingPeriod,
    fallsOnNonWorkingDay: weekend || !!holiday,
    nonWorkingReason: holiday || (weekend ? 'weekend' : null),
    nextWorkingDay: nextWorking,
    instrument: version.instrument,
    penalty: version.penalty,
    beforeHistory: !!version.beforeHistory,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// AMOUNTS
// ─────────────────────────────────────────────────────────────────────────────

const money = (n) => Math.round(((parseFloat(n) || 0) + Number.EPSILON) * 100) / 100;
const sum = (rows, pick) => money(rows.reduce((s, r) => s + (parseFloat(pick(r)) || 0), 0));

/**
 * The figures behind one period's returns, keyed by `amountKey` on the
 * schedule.
 *
 * NSSF and the housing levy are doubled because the employer matches them: the
 * payslip shows the employee's half, and the payment that leaves the bank is
 * both halves. Remitting what the payslips add up to is a 50% shortfall, and
 * it is the mistake this figure exists to prevent — the same reasoning behind
 * the "Statutory Remittance" KPI in the HR payroll tab.
 *
 * SHIF and PAYE are NOT doubled. There is no employer SHIF contribution, and
 * PAYE is the employee's own tax withheld on their behalf.
 *
 * @param {object} opts
 * @param {Array}  opts.payrollRecords  rows for the period only
 * @param {object} [opts.vat]           a computeVatReturn() result for the period
 *                                      — src/utils/vatLedger.js, whose keys
 *                                      (outputVAT / inputVAT / netVAT) are used
 *                                      verbatim so its output passes straight in
 */
export const statutoryAmountsFor = ({ payrollRecords = [], vat = null } = {}) => {
  const nssf = sum(payrollRecords, (p) => p.nssf);
  const ahl = sum(payrollRecords, (p) => p.housing_levy);
  const netVat = vat ? money(vat.netVAT) : null;

  return {
    paye: sum(payrollRecords, (p) => p.paye),
    shif: sum(payrollRecords, (p) => p.shif),
    // Employee halves, kept alongside the doubled totals so a panel can show
    // the working rather than a number nobody can tie to a payslip.
    nssfEmployee: nssf,
    nssfTotal: money(nssf * 2),
    housingLevyEmployee: ahl,
    housingLevyTotal: money(ahl * 2),
    // Null, not zero, when the ledger has nothing to say. Zero is a claim that
    // no VAT is payable; null is the truth, which is that we do not know.
    vatPayable: netVat,
    vatOutput: vat ? money(vat.outputVAT) : null,
    vatInput: vat ? money(vat.inputVAT) : null,
    employees: payrollRecords.length,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a return stands on a given day.
 *
 * `filed` beats everything: a return marked filed is not overdue, however long
 * ago the deadline was.
 */
export const statusFor = ({ dueDate, filed = false, asOf = todayIso() }) => {
  if (filed) return RETURN_FILED;
  const days = daysBetween(asOf, dueDate);
  if (days === null) return RETURN_UPCOMING;
  if (days < 0) return RETURN_OVERDUE;
  if (days === 0) return RETURN_DUE_TODAY;
  if (days <= DUE_SOON_WITHIN_DAYS) return RETURN_DUE_SOON;
  return RETURN_UPCOMING;
};

// ─────────────────────────────────────────────────────────────────────────────
// THE CALENDAR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Does a tenant owe this obligation for this period?
 *
 * An obligation is raised only on evidence the platform actually holds. A
 * business with no payroll for the month files no PAYE; one that has posted no
 * VAT files no VAT3 through this panel.
 *
 * NOT a legal test of registration. A VAT-registered business owes a NIL
 * return in a month it sold nothing, and this platform cannot tell that
 * business apart from one that is not registered at all — so it stays quiet
 * rather than nagging every tenant about a return most of them do not file.
 * `vatRegistered` overrides that once a tenant says so.
 */
export const obligationApplies = (obligation, { hasPayroll, hasVatActivity, vatRegistered }) => {
  if (obligation.appliesWhen === WHEN_PAYROLL) return !!hasPayroll;
  if (obligation.appliesWhen === WHEN_VAT_ACTIVITY) return !!vatRegistered || !!hasVatActivity;
  return true;
};

/** A stable key for one return: obligation + the period it covers. */
export const filingKey = (returnKey, period) => `${returnKey}:${period}`;

/**
 * The tenant's statutory calendar: one entry per (obligation, period) that is
 * currently worth showing.
 *
 * Which periods? Every period with data, plus the current one, filtered to
 * those whose deadline is either still ahead (within the horizon) or behind
 * but unfiled. A return filed six months ago is history, not a calendar entry,
 * so it drops out — `includeFiled` brings it back for a "what did we file"
 * view.
 *
 * @param {object}   opts
 * @param {string[]} opts.periods            'YYYY-MM' periods the tenant has data for
 * @param {Function} opts.amountsFor         (period) => the statutoryAmountsFor result
 * @param {Function} opts.evidenceFor        (period) => { hasPayroll, hasVatActivity }
 * @param {object}   [opts.filings]          { 'key:period': filingRow }
 * @param {boolean}  [opts.vatRegistered]    tenant has declared itself VAT-registered
 * @param {string}   [opts.asOf]             defaults to today
 * @param {boolean}  [opts.includeFiled]     keep filed entries in the list
 */
export const buildStatutoryCalendar = ({
  periods = [],
  amountsFor = () => ({}),
  evidenceFor = () => ({}),
  filings = {},
  vatRegistered = false,
  asOf = todayIso(),
  includeFiled = false,
  obligations = STATUTORY_RETURNS,
} = {}) => {
  const seen = new Set();
  const entries = [];

  for (const period of periods) {
    if (!periodLastDay(period) || seen.has(period)) continue;
    seen.add(period);

    const evidence = evidenceFor(period) || {};
    const amounts = amountsFor(period) || {};

    for (const obligation of obligations) {
      if (!obligationApplies(obligation, { ...evidence, vatRegistered })) continue;

      const due = dueDateFor(obligation, period);
      if (!due) continue;

      const filing = filings[filingKey(obligation.key, period)] || null;
      const filed = !!filing?.filed_at;
      const status = statusFor({ dueDate: due.dueDate, filed, asOf });
      const daysRemaining = daysBetween(asOf, due.dueDate);

      // A period whose deadline is still far off is not yet actionable, and a
      // filed one that is already behind us is history.
      if (status === RETURN_UPCOMING && daysRemaining > CALENDAR_HORIZON_DAYS) continue;
      if (filed && !includeFiled) continue;

      const amount = obligation.amountKey in amounts ? amounts[obligation.amountKey] : null;

      entries.push({
        key: filingKey(obligation.key, period),
        returnKey: obligation.key,
        label: obligation.label,
        authority: obligation.authority,
        portal: obligation.portal,
        desc: obligation.desc,
        period,
        ...due,
        status,
        filed,
        filing,
        daysRemaining,
        daysOverdue: daysRemaining !== null && daysRemaining < 0 ? -daysRemaining : 0,
        amount,
        amountLabel: obligation.amountLabel,
        amounts,
      });
    }
  }

  return sortCalendar(entries);
};

/**
 * Worst first, then soonest, then by the order the schedule lists obligations
 * in — so two returns due the same day always appear in the same order rather
 * than in whatever order the periods happened to arrive.
 */
export const sortCalendar = (entries = []) => {
  const scheduleOrder = new Map(STATUTORY_RETURNS.map((r, i) => [r.key, i]));
  return [...entries].sort((a, b) => {
    const sa = RETURN_STATUS_ORDER.indexOf(a.status);
    const sb = RETURN_STATUS_ORDER.indexOf(b.status);
    if (sa !== sb) return sa - sb;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return (scheduleOrder.get(a.returnKey) ?? 99) - (scheduleOrder.get(b.returnKey) ?? 99);
  });
};

/** Headline counts for a calendar, for a badge or a digest subject line. */
export const calendarSummary = (entries = []) => {
  const count = (s) => entries.filter((e) => e.status === s).length;
  const overdue = count(RETURN_OVERDUE);
  const dueToday = count(RETURN_DUE_TODAY);
  const dueSoon = count(RETURN_DUE_SOON);
  return {
    overdue,
    dueToday,
    dueSoon,
    upcoming: count(RETURN_UPCOMING),
    filed: count(RETURN_FILED),
    // What a bell badge shows: things that need doing now, not the whole list.
    actionable: overdue + dueToday + dueSoon,
    total: entries.length,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// REMINDER SCHEDULING
//
// Shared with supabase/functions/statutory-return-reminders so that "is a
// reminder due today?" is answered by ONE rule. A second copy of this in the
// function would drift, and the drift would show up as either a silent missed
// deadline or a duplicate mail every morning.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Should a reminder fire for this entry today, and which one?
 *
 * Before the deadline: on each lead day in REMINDER_LEAD_DAYS, exactly.
 * After it: every OVERDUE_REPEAT_DAYS days until OVERDUE_CHASE_LIMIT_DAYS, then
 * silence — see the reasoning on those constants.
 *
 * Returns the reminder's identity (`leadDays`, negative when overdue) so the
 * caller can record that this specific reminder was sent and never send it
 * twice. Null means nothing is due today.
 */
export const reminderDueToday = (entry, asOf = todayIso()) => {
  if (!entry || entry.filed) return null;
  const days = daysBetween(asOf, entry.dueDate);
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

/**
 * How a reminder describes itself, in one line.
 *
 * Used for the email subject, the SMS body and the in-app bell, so all three
 * say the same thing about the same deadline.
 */
export const reminderHeadline = (entry) => {
  if (!entry) return '';
  const { label, period, daysOverdue, daysRemaining } = entry;
  if (daysRemaining !== null && daysRemaining < 0) {
    return `${label} for ${period} is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`;
  }
  if (daysRemaining === 0) return `${label} for ${period} is due today`;
  return `${label} for ${period} is due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
};

// Re-exported so callers need only one import to work with a calendar entry.
export { RETURN_FILED, RETURN_OVERDUE, RETURN_DUE_TODAY, RETURN_DUE_SOON, RETURN_UPCOMING };
