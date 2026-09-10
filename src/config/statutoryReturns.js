/**
 * STATUTORY RETURN CALENDAR — what must be filed, to whom, and by when.
 *
 * WHY THIS FILE EXISTS
 *
 * The platform already computes every figure a Kenyan employer has to remit —
 * PAYE, NSSF, SHIF and the housing levy come out of src/utils/kenyaPayroll.js,
 * VAT comes out of src/utils/vatLedger.js — and then says nothing about WHEN
 * any of it is due. The only mention of a deadline anywhere in the codebase was
 * the string "By the 9th of next month" typed under a KPI card in the HR
 * payroll tab. A late return is a penalty and interest on top of the tax, so
 * the deadline is not decoration: it is the part of the obligation that costs
 * money when it is missed.
 *
 * The penalties are why this is worth building rather than leaving to a diary:
 *
 *   PAYE           25% of the tax due or KES 10,000, whichever is higher
 *                  (Tax Procedures Act 2015, s.83(1))
 *   VAT            5% of the tax due or KES 10,000, whichever is higher
 *                  (Tax Procedures Act 2015, s.83(2))
 *   late payment   5% of the unpaid tax, plus 1% interest per month
 *                  (Tax Procedures Act 2015, ss.83(3), 38)
 *   NSSF           5% of the unpaid contribution per month
 *                  (NSSF Act 2013, s.21)
 *
 * ── WHAT THIS FILE IS, EXACTLY ──────────────────────────────────────────────
 *
 * A schedule of obligations, versioned by the date the instrument came into
 * force, in the same shape and for the same reason as RATE_SCHEDULES in
 * src/utils/kenyaPayroll.js and TAX_REGIMES in src/config/taxRegulations.js.
 * Three tables, one rule: never inline a statutory value at a call site, and
 * always resolve it from the date of the thing being computed.
 *
 * Deadlines move. The Affordable Housing Levy's due date was rewritten between
 * the 2023 Finance Act version of the levy and the Affordable Housing Act 2024;
 * NHIF's 9th became SHIF's 9th under an entirely different Act. A period filed
 * under an old rule has to keep answering to the old rule, so a period's due
 * date resolves from the PERIOD, never from today.
 *
 * ── WHAT THIS FILE IS NOT ───────────────────────────────────────────────────
 *
 * It does not file anything. Nothing here talks to iTax, eSlip, the eCitizen
 * SHIF portal or the NSSF self-service portal, and a return marked filed in
 * this system is a note that a human filed it — not evidence that KRA received
 * it. Claiming otherwise would be the same defect the P10 export header warns
 * about in src/utils/payeReturns.js: a button that implies a return has been
 * filed when it has not is worse than no button.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 *
 * The obligations below are the ones this platform holds the figures for, so a
 * reminder can carry an amount rather than just a date. Obligations a business
 * has that this system knows nothing about — instalment tax, the annual return,
 * withholding tax on payments it never saw — are deliberately absent. A
 * reminder for a return whose amount we cannot state is a reminder that trains
 * people to ignore reminders.
 */

// ─────────────────────────────────────────────────────────────────────────────
// DUE-DATE BASES
//
// The two ways a Kenyan filing deadline is written. They are NOT
// interchangeable: nine calendar days after month end and nine WORKING days
// after month end differ by four days in a normal month and more across
// Easter, so treating one as the other is a fortnight of interest.
// ─────────────────────────────────────────────────────────────────────────────

/** The Nth calendar day of the month following the period. */
export const DUE_CALENDAR_DAY = 'calendar_day';
/** The Nth working day of the month following the period (weekends and public holidays excluded). */
export const DUE_WORKING_DAY = 'working_day';

// ─────────────────────────────────────────────────────────────────────────────
// WHO IS LIABLE
//
// Not every tenant owes every return. A company with no employees files no
// PAYE; one that is not VAT-registered files no VAT3. `appliesWhen` names the
// evidence this platform can actually check for, so an obligation is only
// raised against a tenant that has the data behind it.
// ─────────────────────────────────────────────────────────────────────────────

/** Raised when the tenant ran payroll for the period. */
export const WHEN_PAYROLL = 'payroll';
/** Raised when the tenant posted VAT to the ledger for the period. */
export const WHEN_VAT_ACTIVITY = 'vat_activity';

// ─────────────────────────────────────────────────────────────────────────────
// THE SCHEDULE
//
// Ordered oldest → newest WITHIN each obligation. `effectiveFrom` is the date
// the instrument came into force, as 'YYYY-MM-DD'; a period resolves to the
// last version whose effectiveFrom is on or before the period's LAST DAY, the
// same rule resolveRateSchedule() applies to a pay month.
//
// Each version states:
//   dueBasis   DUE_CALENDAR_DAY | DUE_WORKING_DAY
//   dueDay     N, counted under that basis, in the month AFTER the period
//   instrument the authority for the deadline, quotable in a reminder
//   penalty    what late costs, in one line, for the same reason
// ─────────────────────────────────────────────────────────────────────────────

export const STATUTORY_RETURNS = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    key: 'paye',
    label: 'PAYE (P10)',
    authority: 'Kenya Revenue Authority',
    portal: 'iTax',
    cadence: 'monthly',
    appliesWhen: WHEN_PAYROLL,
    // Which figure on the return this platform can state. See
    // statutoryAmountsFor() in src/utils/statutoryCalendar.js.
    amountKey: 'paye',
    amountLabel: 'PAYE withheld',
    desc: 'Employee income tax deducted at source, declared on the P10 and paid by e-slip.',
    versions: [
      {
        version: '1974-01-01',
        effectiveFrom: '1974-01-01',
        dueBasis: DUE_CALENDAR_DAY,
        dueDay: 9,
        instrument: 'Income Tax (PAYE) Rules, r.6 (under Income Tax Act, Cap 470)',
        penalty: '25% of the tax due or KES 10,000, whichever is higher (Tax Procedures Act 2015, s.83(1)), plus 5% of the unpaid tax and 1% interest a month.',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    key: 'nssf',
    label: 'NSSF contributions',
    authority: 'National Social Security Fund',
    portal: 'NSSF self-service portal',
    cadence: 'monthly',
    appliesWhen: WHEN_PAYROLL,
    amountKey: 'nssfTotal',
    amountLabel: 'NSSF (employee + employer)',
    desc: 'Tier I and II pension contributions. The employer matches the employee deduction, so the payment is double what the payslips show.',
    versions: [
      {
        version: '2014-01-10',
        effectiveFrom: '2014-01-10',
        dueBasis: DUE_CALENDAR_DAY,
        dueDay: 9,
        instrument: 'National Social Security Fund Act, 2013, s.20(2)',
        penalty: 'A penalty of 5% of the unpaid contribution for each month it remains unpaid (NSSF Act 2013, s.21).',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    key: 'shif',
    label: 'SHIF contributions',
    authority: 'Social Health Authority',
    portal: 'SHA / eCitizen',
    cadence: 'monthly',
    appliesWhen: WHEN_PAYROLL,
    amountKey: 'shif',
    amountLabel: 'SHIF deducted',
    // The 2.75% deduction replaced the NHIF graduated table on 1 October 2024.
    // src/utils/kenyaPayroll.js does not model the NHIF era at all, so nothing
    // here reaches back past SHIF either.
    desc: '2.75% of gross pay, deducted from the employee and remitted to the Social Health Authority.',
    versions: [
      {
        version: '2024-10-01',
        effectiveFrom: '2024-10-01',
        dueBasis: DUE_CALENDAR_DAY,
        dueDay: 9,
        instrument: 'Social Health Insurance (General) Regulations, 2024, r.24',
        penalty: 'A penalty of 2% of the unpaid amount for every month it remains unpaid (Social Health Insurance Act 2023, s.47(3)).',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    key: 'housing_levy',
    label: 'Affordable Housing Levy',
    authority: 'Kenya Revenue Authority',
    portal: 'iTax',
    cadence: 'monthly',
    appliesWhen: WHEN_PAYROLL,
    amountKey: 'housingLevyTotal',
    amountLabel: 'Housing levy (employee + employer)',
    desc: '1.5% of gross pay from the employee, matched by the employer, collected by KRA on the Authority\'s behalf.',
    versions: [
      {
        // THE ONE OBLIGATION ON THIS LIST WITH A WORKING-DAY DEADLINE, and the
        // reason nthWorkingDay() exists at all. Reading "nine days" as calendar
        // days puts the deadline four days early in a normal month — harmless.
        // Reading the OTHERS as working days puts them four days late, which is
        // a penalty. The distinction is load-bearing in one direction.
        version: '2024-03-19',
        effectiveFrom: '2024-03-19',
        dueBasis: DUE_WORKING_DAY,
        dueDay: 9,
        instrument: 'Affordable Housing Act, 2024, s.4(3)',
        penalty: 'A penalty of 3% of the unpaid levy for every month it remains unpaid (Affordable Housing Act 2024, s.4(5)).',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    key: 'vat',
    label: 'VAT return (VAT3)',
    authority: 'Kenya Revenue Authority',
    portal: 'iTax',
    cadence: 'monthly',
    appliesWhen: WHEN_VAT_ACTIVITY,
    amountKey: 'vatPayable',
    amountLabel: 'Net VAT payable',
    // netVat can be negative — a credit carried forward, not a payment. The
    // return is still due; see amountNote below, which the UI prints instead of
    // a payment figure when the period is in credit.
    desc: 'Output VAT less input VAT for the month. A NIL return is still due if the business is registered.',
    versions: [
      {
        version: '2013-09-02',
        effectiveFrom: '2013-09-02',
        dueBasis: DUE_CALENDAR_DAY,
        dueDay: 20,
        instrument: 'Value Added Tax Act, 2013, s.44(1) and (2)',
        penalty: '5% of the tax due or KES 10,000, whichever is higher (Tax Procedures Act 2015, s.83(2)), plus 5% of the unpaid tax and 1% interest a month.',
      },
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  // NEXT OBLIGATION, OR NEXT VERSION OF ONE, GOES HERE.
  //
  // A deadline change is ONE new entry in that obligation's `versions`, with
  // `effectiveFrom` set to the date the amending instrument came into force.
  // Nothing else moves: the calendar, the reminder function and the panel all
  // resolve through resolveReturnVersion() below, and periods that closed
  // before the change keep answering to the rule that governed them.
  //
  // A NEW obligation needs, besides an entry here, a figure to put against it.
  // `amountKey` is looked up in the object statutoryAmountsFor() builds in
  // src/utils/statutoryCalendar.js — add it there in the same change, or the
  // obligation renders with a date and no amount.
  // ───────────────────────────────────────────────────────────────────────────
];

/** Every obligation key, in schedule order. */
export const RETURN_KEYS = STATUTORY_RETURNS.map((r) => r.key);

/** One obligation by key, or null. */
export const findReturn = (key) =>
  STATUTORY_RETURNS.find((r) => r.key === key) || null;

/**
 * The version of an obligation's deadline rule that governed a period.
 *
 * `period` is 'YYYY-MM'. Resolution is against the period's LAST DAY, so an
 * instrument that came into force mid-month governs that whole month's return
 * — the same rule resolveRateSchedule() applies to a pay month, and the same
 * one resolveTaxRegime() applies to a billing date.
 *
 * A period older than the obligation's history returns the earliest version
 * flagged `beforeHistory`, so a caller can distinguish "the 9th, and we can
 * cite the rule" from "the 9th, probably, but we are guessing".
 */
export const resolveReturnVersion = (obligation, period) => {
  const versions = obligation?.versions || [];
  if (!versions.length) return null;

  const lastDay = periodLastDay(period);
  if (!lastDay) return { ...versions[versions.length - 1], beforeHistory: false };

  const inForce = versions.filter((v) => v.effectiveFrom <= lastDay);
  if (!inForce.length) return { ...versions[0], beforeHistory: true };
  return { ...inForce[inForce.length - 1], beforeHistory: false };
};

/**
 * Last calendar day of a 'YYYY-MM' period, as 'YYYY-MM-DD'.
 *
 * Day 0 of the following month is the last day of this one, and UTC throughout
 * so a machine west of Greenwich does not resolve a period one day early.
 */
export const periodLastDay = (period) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

// ─────────────────────────────────────────────────────────────────────────────
// REMINDER LEAD TIMES
//
// When a reminder fires, counted in days before the due date. Chosen for what
// each one is FOR, not as a round number:
//
//   7  time to run payroll, fix a missing KRA PIN and pull the figures
//   3  time to fund the account the e-slip will be paid from
//   1  the last working evening before it is late
//   0  due today
//
// After the due date the return is chased once a day while it stays open —
// see OVERDUE_REPEAT_DAYS. A missed return does not stop being due.
// ─────────────────────────────────────────────────────────────────────────────
export const REMINDER_LEAD_DAYS = [7, 3, 1, 0];

/**
 * How often an overdue return is chased, in days, and for how long.
 *
 * Daily for a fortnight, then it stops. It stops because a return still open
 * after two weeks is not being missed for want of a reminder, and a mail that
 * arrives every morning forever is one the recipient filters — which would
 * cost them the NEXT period's reminder too.
 */
export const OVERDUE_REPEAT_DAYS = 1;
export const OVERDUE_CHASE_LIMIT_DAYS = 14;

/**
 * How far ahead the panel lists returns that are not yet due.
 *
 * A month's returns cannot be prepared before the month ends, so anything
 * beyond the next period's deadlines is noise on a screen.
 */
export const CALENDAR_HORIZON_DAYS = 45;

// ─────────────────────────────────────────────────────────────────────────────
// STATUS VOCABULARY
//
// One set of names, used by the calendar engine, the reminder function, the
// panel and the database CHECK constraint. Divergent vocabularies for the same
// state is the defect the CRM channel config was written to end.
// ─────────────────────────────────────────────────────────────────────────────
export const RETURN_FILED = 'filed';
export const RETURN_OVERDUE = 'overdue';
export const RETURN_DUE_TODAY = 'due_today';
export const RETURN_DUE_SOON = 'due_soon';
export const RETURN_UPCOMING = 'upcoming';

/** Severity order, worst first — the panel and the digest both sort on it. */
export const RETURN_STATUS_ORDER = [
  RETURN_OVERDUE,
  RETURN_DUE_TODAY,
  RETURN_DUE_SOON,
  RETURN_UPCOMING,
  RETURN_FILED,
];

/** What a status is called on screen, and how loudly. */
export const RETURN_STATUS_META = {
  [RETURN_OVERDUE]: { label: 'Overdue', tone: 'critical', icon: 'AlertOctagon' },
  [RETURN_DUE_TODAY]: { label: 'Due today', tone: 'critical', icon: 'AlertTriangle' },
  [RETURN_DUE_SOON]: { label: 'Due soon', tone: 'warning', icon: 'Clock' },
  [RETURN_UPCOMING]: { label: 'Upcoming', tone: 'info', icon: 'Calendar' },
  [RETURN_FILED]: { label: 'Filed', tone: 'ok', icon: 'CheckCircle' },
};

/**
 * The threshold between "due soon" and "upcoming", in days.
 *
 * Deliberately equal to the first reminder lead: the day the panel starts
 * shouting is the day the first email goes out, so the two surfaces never
 * disagree about whether something is urgent.
 */
export const DUE_SOON_WITHIN_DAYS = REMINDER_LEAD_DAYS[0];
