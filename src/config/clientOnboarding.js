/**
 * INSTALLATION & ONBOARDING — the vocabulary.
 *
 * The platform charges every tenant a one-time "Installation & onboarding" fee
 * (line 5 of buildSystemInvoice in ./systemBilling.js). This file is what the
 * delivery of that fee is described with: the states an installation can be in,
 * the steps it is made of, and the small pieces of arithmetic that turn a row
 * into a sentence a person can act on.
 *
 * A CONTROLLED vocabulary, for the same reason ACQUISITION_CHANNELS is one: the
 * questions it exists to answer ("how many installations are overdue?", "how
 * long do we take?") are aggregations, and an aggregation over values that
 * disagree is a report that is quietly wrong rather than visibly broken. The
 * database enforces the same sets through client_onboardings_status_chk and
 * client_onboarding_steps_status_chk (20260901180000). Adding a value here
 * means adding it there too.
 *
 * ONBOARDING_STEPS mirrors public.client_onboarding_default_steps(). The KEYS
 * are the join between the two — the labels are copied onto each step row at
 * seed time on purpose, so renaming a step next year cannot rewrite what a
 * finished onboarding says was delivered last year. This list is therefore the
 * catalogue for NEW records and the grouping/iconography for old ones; a row
 * whose key is not here still renders, from its own stored label.
 */

// ── The state of one installation ──────────────────────────────────────────
/**
 * `open` is what separates work still owed from history. Every count that
 * matters — unassigned, overdue, due this week — is over the open states, and
 * client_onboarding_summary() applies the same rule server-side with
 * `status not in ('completed', 'cancelled')`.
 */
export const ONBOARDING_STATUSES = [
  {
    value: 'not_started',
    label: 'Not started',
    icon: 'Circle',
    tone: 'slate',
    open: true,
    hint: 'Paid for, nothing scheduled yet',
  },
  {
    value: 'scheduled',
    label: 'Scheduled',
    icon: 'CalendarClock',
    tone: 'blue',
    open: true,
    hint: 'Booked in with the client for a date',
  },
  {
    value: 'in_progress',
    label: 'In progress',
    icon: 'Wrench',
    tone: 'amber',
    open: true,
    hint: 'Installation and onboarding under way',
  },
  {
    value: 'on_hold',
    label: 'On hold',
    icon: 'PauseCircle',
    tone: 'orange',
    open: true,
    hint: 'Blocked — waiting on the client or on something else',
  },
  {
    value: 'completed',
    label: 'Completed',
    icon: 'CheckCircle2',
    tone: 'emerald',
    open: false,
    hint: 'Handed over and signed off',
  },
  {
    value: 'cancelled',
    label: 'Cancelled',
    icon: 'XCircle',
    tone: 'red',
    open: false,
    hint: 'Abandoned — the client left before installation',
  },
];

/** The set the database CHECK constraint accepts. Keep the two in step. */
export const ONBOARDING_STATUS_VALUES = ONBOARDING_STATUSES.map(s => s.value);

/** Statuses that still represent work the platform owes. */
export const OPEN_STATUSES = ONBOARDING_STATUSES.filter(s => s.open).map(s => s.value);

/**
 * Describe a status, including values this list has never heard of.
 *
 * Unknown values are titled and kept rather than dropped, the same way
 * channelMeta keeps them: a client that renders as nothing is a client nobody
 * installs.
 */
export const statusMeta = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) {
    return { value: 'not_started', label: 'Not started', icon: 'Circle', tone: 'slate', open: true, hint: null, known: false };
  }
  const hit = ONBOARDING_STATUSES.find(s => s.value === key);
  if (hit) return { ...hit, known: true };

  return {
    value: key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: 'HelpCircle',
    tone: 'slate',
    open: true,
    hint: null,
    known: false,
  };
};

export const isOpen = (record) => statusMeta(record?.status).open;

// ── The state of one step ──────────────────────────────────────────────────
/**
 * `settled` means "needs no more attention"; `counts` means "was work actually
 * performed". Only 'done' is both.
 *
 * 'skipped' is the case that makes the distinction necessary. A step that does
 * not apply to this client — no data to migrate, no M-Pesa till — must not hold
 * the progress bar below 100%, and must not be reported as delivered either.
 * client_onboarding_recount() drops it from both sides of the fraction for
 * exactly this reason.
 */
export const STEP_STATUSES = [
  { value: 'pending',     label: 'Pending',     icon: 'Circle',       tone: 'slate',   settled: false, counts: false },
  { value: 'in_progress', label: 'In progress', icon: 'Loader',       tone: 'amber',   settled: false, counts: false },
  { value: 'done',        label: 'Done',        icon: 'CheckCircle2', tone: 'emerald', settled: true,  counts: true  },
  { value: 'skipped',     label: 'Not needed',  icon: 'MinusCircle',  tone: 'slate',   settled: true,  counts: false },
  { value: 'blocked',     label: 'Blocked',     icon: 'AlertCircle',  tone: 'red',     settled: false, counts: false },
];

export const STEP_STATUS_VALUES = STEP_STATUSES.map(s => s.value);

export const stepStatusMeta = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  const hit = STEP_STATUSES.find(s => s.value === key);
  if (hit) return { ...hit, known: true };

  return {
    value: key || 'pending',
    label: key ? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Pending',
    icon: 'HelpCircle',
    tone: 'slate',
    settled: false,
    counts: false,
    known: false,
  };
};

// ── The shape of the job ───────────────────────────────────────────────────
/** Four phases, in the order they happen. `phase` on a step row points here. */
export const ONBOARDING_PHASES = [
  { value: 'prepare', label: 'Preparation', icon: 'ClipboardList', hint: 'Before anyone touches the system' },
  { value: 'install', label: 'Installation', icon: 'Wrench',        hint: 'Standing the client’s portal up' },
  { value: 'enable',  label: 'Enablement',   icon: 'GraduationCap', hint: 'Getting their people using it' },
  { value: 'close',   label: 'Handover',     icon: 'PackageCheck',  hint: 'Signing the work off' },
];

export const phaseMeta = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  const hit = ONBOARDING_PHASES.find(p => p.value === key);
  if (hit) return { ...hit, known: true };
  return { value: key || 'other', label: 'Other', icon: 'ListChecks', hint: null, known: false };
};

/**
 * The shipped checklist. MIRRORS public.client_onboarding_default_steps().
 *
 * 'installation' is the step the invoice line is named after. It is deliberately
 * one of eleven: a client who has had a box switched on but no data, no training
 * and no handover has not been onboarded, and a record that could only say
 * "installed / not installed" would let that pass for finished.
 */
export const ONBOARDING_STEPS = [
  { key: 'kickoff_call',   label: 'Kickoff call with the client',              phase: 'prepare', icon: 'PhoneCall' },
  { key: 'requirements',   label: 'Requirements and opening data collected',   phase: 'prepare', icon: 'ClipboardList' },
  { key: 'account_setup',  label: 'Portal account and modules configured',     phase: 'install', icon: 'Settings' },
  { key: 'branding',       label: 'Company branding and documents uploaded',   phase: 'install', icon: 'Palette' },
  { key: 'data_migration', label: 'Opening balances and records imported',     phase: 'install', icon: 'Database' },
  { key: 'payment_channel',label: 'Payment channel (M-Pesa) configured',       phase: 'install', icon: 'Smartphone' },
  { key: 'installation',   label: 'System installed and verified on site',     phase: 'install', icon: 'Wrench' },
  { key: 'user_accounts',  label: 'Staff user accounts created',               phase: 'enable',  icon: 'Users' },
  { key: 'training',       label: 'Staff training delivered',                  phase: 'enable',  icon: 'GraduationCap' },
  { key: 'acceptance',     label: 'Client acceptance walkthrough signed off',  phase: 'close',   icon: 'ClipboardCheck' },
  { key: 'handover',       label: 'Handover pack and support contacts issued', phase: 'close',   icon: 'PackageCheck' },
];

export const ONBOARDING_STEP_KEYS = ONBOARDING_STEPS.map(s => s.key);

/**
 * Describe a step key. A bespoke step added for one client has no entry here;
 * it gets the generic icon and keeps its own stored label.
 */
export const stepMeta = (key) => {
  const k = String(key ?? '').trim().toLowerCase();
  const hit = ONBOARDING_STEPS.find(s => s.key === k);
  if (hit) return { ...hit, known: true };
  return { key: k, label: null, phase: 'other', icon: 'ListChecks', known: false };
};

/** Icon for a step row, preferring the catalogue and falling back to its phase. */
export const stepIcon = (step) => {
  const meta = stepMeta(step?.step_key);
  if (meta.known) return meta.icon;
  return phaseMeta(step?.phase).icon;
};

/** Group step rows into the four phases, in catalogue order. */
export const groupStepsByPhase = (steps = []) => {
  const ordered = [...(steps || [])].sort(
    (a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0),
  );
  return ONBOARDING_PHASES
    .map(p => ({ ...p, steps: ordered.filter(s => phaseMeta(s?.phase).value === p.value) }))
    .concat([{ ...phaseMeta(null), steps: ordered.filter(s => !ONBOARDING_PHASES.some(p => p.value === s?.phase)) }])
    .filter(g => g.steps.length > 0);
};

// ── Arithmetic ─────────────────────────────────────────────────────────────
const MS_PER_DAY = 86400000;

/**
 * A date-only value, so "today" comparisons are not thrown by a timestamp.
 *
 * The two kinds of value that reach this screen are handled differently on
 * purpose:
 *
 *   'YYYY-MM-DD'  — a Postgres `date` (scheduled_date, installation_date,
 *                   due_date). A calendar day with no timezone in it. Feeding
 *                   it to new Date() reads it as UTC midnight, which in any
 *                   zone behind UTC is the PREVIOUS day — an installation
 *                   booked for the 2nd exporting as the 1st. Parsed by parts.
 *   a timestamp   — a `timestamptz` (completed_at, assigned_at). Reduced to
 *                   the calendar day the reader is looking at it on.
 *
 * Both come back as local midnight, so subtracting two of them is whole days.
 */
const asDay = (value) => {
  if (!value) return null;

  if (typeof value === 'string') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (parts) {
      const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * A date as YYYY-MM-DD, which is what a spreadsheet can sort.
 *
 * Built from the local parts rather than toISOString(): the value is already a
 * local midnight, and re-encoding that as UTC would shift it back over the
 * boundary asDay() just corrected for.
 */
const isoDay = (value) => {
  const d = asDay(value);
  return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : '';
};

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export const daysBetween = (from, to) => {
  const a = asDay(from);
  const b = asDay(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
};

/**
 * Progress as a percentage.
 *
 * Prefers the counters the database maintains (steps_done / steps_total, kept
 * by client_onboarding_recount) and falls back to counting the step rows in
 * hand. A record with no steps is 0%, never 100%: an empty checklist is an
 * onboarding nobody has started, not one with nothing left to do.
 */
export const progressOf = (record, steps = null) => {
  if (Array.isArray(steps) && steps.length) {
    const applicable = steps.filter(s => stepStatusMeta(s?.status).value !== 'skipped');
    if (!applicable.length) return 0;
    const done = applicable.filter(s => stepStatusMeta(s?.status).counts).length;
    return Math.round((done / applicable.length) * 100);
  }
  const total = Number(record?.steps_total) || 0;
  if (total <= 0) return 0;
  const done = Number(record?.steps_done) || 0;
  return Math.round((done / total) * 100);
};

/** Booked for a day that has passed, and still not finished. */
export const isOverdue = (record, today = new Date()) => {
  if (!record || !isOpen(record)) return false;
  const days = daysBetween(today, record.scheduled_date);
  return days !== null && days < 0;
};

/**
 * One sentence about where this installation stands against its date.
 *
 * The board leans on this rather than printing a raw date because a date on its
 * own does not say whether anyone should be worried about it. Returns a tone the
 * UI colours by, so the reading and the colour cannot disagree.
 */
export const scheduleStance = (record, today = new Date()) => {
  if (!record) return { tone: 'slate', label: '—', urgent: false };

  const status = statusMeta(record.status);
  if (!status.open) {
    const when = record.installation_date || record.completed_at;
    return {
      tone: status.value === 'completed' ? 'emerald' : 'slate',
      label: status.value === 'completed'
        ? (when ? `Installed ${formatDay(when)}` : 'Completed')
        : 'Cancelled',
      urgent: false,
    };
  }

  if (!record.scheduled_date) {
    return { tone: 'slate', label: 'No date set', urgent: false };
  }

  const days = daysBetween(today, record.scheduled_date);
  if (days === null) return { tone: 'slate', label: 'No date set', urgent: false };
  if (days < 0) {
    const late = Math.abs(days);
    return { tone: 'red', label: `Overdue by ${late} day${late === 1 ? '' : 's'}`, urgent: true };
  }
  if (days === 0) return { tone: 'amber', label: 'Due today', urgent: true };
  if (days === 1) return { tone: 'amber', label: 'Due tomorrow', urgent: true };
  if (days <= 7) return { tone: 'blue', label: `Due in ${days} days`, urgent: false };
  return { tone: 'slate', label: `Booked ${formatDay(record.scheduled_date)}`, urgent: false };
};

/** Short, unambiguous, and the same everywhere this screen prints a date. */
export const formatDay = (value) => {
  const d = asDay(value);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * What this record most needs next, as a single line for the list.
 *
 * Ordered by what actually blocks delivery: nobody assigned beats no date,
 * which beats a slipped date, which beats the ordinary case.
 */
export const nextActionFor = (record, today = new Date()) => {
  if (!record) return null;
  if (!isOpen(record)) return null;
  if (!record.assigned_to) return 'Assign someone';
  if (!record.scheduled_date) return 'Book a date';
  if (isOverdue(record, today)) return 'Rebook or complete';
  if (record.status === 'on_hold') return record.on_hold_reason || 'On hold';
  return null;
};

// ── Export ─────────────────────────────────────────────────────────────────
/** Column order for the board's CSV. */
export const ONBOARDING_EXPORT_COLUMNS = [
  'Client', 'Type', 'Email', 'Phone', 'Account active', 'Registered',
  'Status', 'Responsible', 'Assigned on', 'Scheduled', 'Installed',
  'Completed', 'Signed off by', 'Steps done', 'Steps total', 'Progress (%)',
  'On hold reason', 'Notes',
];

/**
 * The board as rows for downloadCSV / exportCSV.
 *
 * Dates as ISO day strings and progress as a bare number, for the same reason
 * buildAssetExport writes raw money: a spreadsheet sorts "2026-09-01" and sums
 * "45"; it does nothing useful with "01 Sep 2026" or "45%".
 */
export const buildOnboardingExport = (rows = []) => (rows || []).map((r) => ({
  'Client':          r.client_name || '',
  'Type':            r.entity_type === 'sacco' ? 'Sacco' : 'Company',
  'Email':           r.contact_email || '',
  'Phone':           r.contact_phone || '',
  'Account active':  r.account_active ? 'Yes' : 'No',
  'Registered':      isoDay(r.registered_at),
  'Status':          statusMeta(r.status).label,
  'Responsible':     r.assigned_to_name || '',
  'Assigned on':     isoDay(r.assigned_at),
  'Scheduled':       isoDay(r.scheduled_date),
  'Installed':       isoDay(r.installation_date),
  'Completed':       isoDay(r.completed_at),
  'Signed off by':   r.completed_by_name || '',
  'Steps done':      Number(r.steps_done) || 0,
  'Steps total':     Number(r.steps_total) || 0,
  'Progress (%)':    progressOf(r),
  'On hold reason':  r.on_hold_reason || '',
  'Notes':           (r.notes || '').replace(/\s+/g, ' ').trim(),
}));

export default {
  ONBOARDING_STATUSES, ONBOARDING_STATUS_VALUES, OPEN_STATUSES, statusMeta, isOpen,
  STEP_STATUSES, STEP_STATUS_VALUES, stepStatusMeta,
  ONBOARDING_PHASES, phaseMeta,
  ONBOARDING_STEPS, ONBOARDING_STEP_KEYS, stepMeta, stepIcon, groupStepsByPhase,
  daysBetween, progressOf, isOverdue, scheduleStance, formatDay, nextActionFor,
  ONBOARDING_EXPORT_COLUMNS, buildOnboardingExport,
};
