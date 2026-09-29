/**
 * Consultancy pricing — the vocabulary and arithmetic of the Services tab.
 *
 * A consultancy sells one service several ways at once, so a service carries a
 * PRICE LIST (consultancy_cost_structures), and a client mapped to it carries
 * the TERMS that client agreed (consultancy_engagements). Both tables hold the
 * same ten term columns; which of them mean anything depends on the model.
 *
 * ── KEEP IN SYNC ─────────────────────────────────────────────────────────────
 * supabase/migrations/20260925160000_consultancy_services.sql enforces all of
 * this: the model, billing-period and status lists are CHECK constraints
 * there, each model's `fields` is what consultancy_terms_normalise() keeps, and
 * validateTerms() below is consultancy_terms_problem(), message for message.
 * consultancyPricing.sync.test.js reads the SQL and fails when they drift.
 * The database is the enforcement; this copy exists so the form can say what
 * is wrong before the round trip, in the words the server would use.
 */

// ── How a service is priced ─────────────────────────────────────────────────
// `fields` are the terms the model uses, in the order the form asks for them.
// kind: money (KES) | hours | percent | period | text.
export const PRICING_MODELS = [
  {
    value: 'unit', label: 'Unit cost', icon: 'Package',
    hint: 'A price for each unit delivered — a report, a session, a filing.',
    fields: [
      { key: 'amount',     label: 'Price per unit', kind: 'money', required: true },
      { key: 'unit_label', label: 'Unit',           kind: 'text',  placeholder: 'e.g. report, session, page' },
    ],
  },
  {
    value: 'hourly', label: 'Per-hour cost', icon: 'Clock',
    hint: 'Charged for every hour worked.',
    fields: [
      { key: 'amount', label: 'Rate per hour', kind: 'money', required: true },
    ],
  },
  {
    value: 'consultant_fee', label: 'Consultant fee (flat)', icon: 'UserCheck',
    hint: 'One flat fee for the consultant, whatever the hours.',
    fields: [
      { key: 'amount', label: 'Flat fee', kind: 'money', required: true },
    ],
  },
  {
    value: 'hourly_package', label: 'Hourly billing package', icon: 'Timer',
    hint: 'A block of hours sold for one price — the retainer-style offer.',
    fields: [
      { key: 'amount',         label: 'Package price',           kind: 'money',  required: true },
      { key: 'included_hours', label: 'Hours included',          kind: 'hours',  required: true },
      { key: 'billing_period', label: 'Billed',                  kind: 'period', required: true },
      { key: 'overage_rate',   label: 'Extra hours, per hour',   kind: 'money' },
    ],
  },
  {
    value: 'retainer', label: 'Retainer', icon: 'CalendarClock',
    hint: 'A fixed fee every period for ongoing access to the firm.',
    fields: [
      { key: 'amount',         label: 'Retainer fee',            kind: 'money',  required: true },
      { key: 'billing_period', label: 'Billed',                  kind: 'period', required: true, recurringOnly: true },
      { key: 'included_hours', label: 'Hours covered',           kind: 'hours' },
      { key: 'overage_rate',   label: 'Extra hours, per hour',   kind: 'money' },
    ],
  },
  {
    value: 'fixed_fee', label: 'Project / fixed fee', icon: 'Briefcase',
    hint: 'One price for a defined piece of work.',
    fields: [
      { key: 'amount',      label: 'Project fee',   kind: 'money',   required: true },
      { key: 'deposit_pct', label: 'Deposit',       kind: 'percent' },
    ],
  },
  {
    value: 'success_fee', label: 'Success / performance fee', icon: 'Trophy',
    hint: 'Paid when the work succeeds — a share of the result, a fixed bonus, or both.',
    fields: [
      { key: 'success_pct',   label: 'Success fee',         kind: 'percent' },
      { key: 'success_basis', label: 'Percentage of',       kind: 'text', placeholder: 'e.g. funds raised, tax recovered' },
      { key: 'amount',        label: 'Fixed success bonus', kind: 'money' },
      { key: 'minimum_fee',   label: 'Minimum fee',         kind: 'money' },
      { key: 'fee_cap',       label: 'Fee cap',             kind: 'money' },
    ],
  },
];

const MODEL_BY_VALUE = PRICING_MODELS.reduce((acc, m) => { acc[m.value] = m; return acc; }, {});

export const pricingModelMeta = (value) => MODEL_BY_VALUE[value] || null;
export const pricingModelLabel = (value) => MODEL_BY_VALUE[value]?.label || 'Unpriced';

// ── How often recurring terms are billed ────────────────────────────────────
export const BILLING_PERIODS = [
  { value: 'one_off',   label: 'One-off',   per: null },
  { value: 'weekly',    label: 'Weekly',    per: 'week' },
  { value: 'monthly',   label: 'Monthly',   per: 'month' },
  { value: 'quarterly', label: 'Quarterly', per: 'quarter' },
  { value: 'annually',  label: 'Annually',  per: 'year' },
];

const PERIOD_BY_VALUE = BILLING_PERIODS.reduce((acc, p) => { acc[p.value] = p; return acc; }, {});

// ── Where a client's engagement stands ──────────────────────────────────────
// `current` marks the states that still describe a working relationship: they
// are what "clients mapped" counts. Completed and cancelled stay on record.
export const ENGAGEMENT_STATUSES = [
  { value: 'proposed',  label: 'Proposed',  current: true,  cls: 'text-sky-700 bg-sky-100' },
  { value: 'active',    label: 'Active',    current: true,  cls: 'text-emerald-700 bg-emerald-100' },
  { value: 'on_hold',   label: 'On hold',   current: true,  cls: 'text-amber-700 bg-amber-100' },
  { value: 'completed', label: 'Completed', current: false, cls: 'text-gray-600 bg-gray-100' },
  { value: 'cancelled', label: 'Cancelled', current: false, cls: 'text-red-700 bg-red-100' },
];

const STATUS_BY_VALUE = ENGAGEMENT_STATUSES.reduce((acc, s) => { acc[s.value] = s; return acc; }, {});

export const engagementStatusMeta = (value) => STATUS_BY_VALUE[value] || STATUS_BY_VALUE.active;
export const isCurrentEngagement = (status) => !!STATUS_BY_VALUE[status]?.current;

// ── The terms ───────────────────────────────────────────────────────────────
export const TERM_FIELDS = [
  'amount', 'unit_label', 'included_hours', 'overage_rate', 'billing_period',
  'success_pct', 'success_basis', 'minimum_fee', 'fee_cap', 'deposit_pct',
];

const NUMERIC_TERMS = new Set([
  'amount', 'included_hours', 'overage_rate', 'success_pct', 'minimum_fee', 'fee_cap', 'deposit_pct',
]);

/** Which models use each term — the columns the database keeps for them. */
export const TERM_FIELD_MODELS = TERM_FIELDS.reduce((acc, key) => {
  acc[key] = PRICING_MODELS.filter(m => m.fields.some(f => f.key === key)).map(m => m.value);
  return acc;
}, {});

export const modelUses = (model, key) => (TERM_FIELD_MODELS[key] || []).includes(model);

/** '' from an untouched input means "not given" — never zero. */
const toNumber = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Shape a form (or a row) into terms the database will accept as they are.
 * Terms the model does not use come back null, exactly as the database would
 * clear them, so a model switched mid-form cannot carry stale values across.
 */
export const buildTerms = (form = {}) => {
  const model = MODEL_BY_VALUE[form.pricing_model] ? form.pricing_model : null;
  const terms = { pricing_model: model };
  TERM_FIELDS.forEach((key) => {
    if (!model || !modelUses(model, key)) {
      terms[key] = null;
    } else if (NUMERIC_TERMS.has(key)) {
      terms[key] = toNumber(form[key]);
    } else {
      terms[key] = String(form[key] ?? '').trim() || null;
    }
  });
  return terms;
};

const AMOUNT_MISSING = {
  unit:           'Enter the price per unit.',
  hourly:         'Enter the rate per hour.',
  consultant_fee: 'Enter the consultant fee.',
  hourly_package: 'Enter the package price.',
  retainer:       'Enter the retainer fee.',
  fixed_fee:      'Enter the project fee.',
};

/**
 * NULL when the terms are sound, otherwise the sentence to show. Takes BUILT
 * terms (see buildTerms). Mirrors public.consultancy_terms_problem().
 */
export const validateTerms = (t = {}) => {
  const model = t.pricing_model;
  if (!MODEL_BY_VALUE[model]) return 'Choose how this option is priced.';

  if ([t.amount, t.overage_rate, t.minimum_fee, t.fee_cap].some(v => v != null && v < 0)) {
    return 'Amounts cannot be negative.';
  }

  if (AMOUNT_MISSING[model] && !((t.amount ?? 0) > 0)) return AMOUNT_MISSING[model];

  if (model === 'hourly_package') {
    if (!((t.included_hours ?? 0) > 0)) return 'Enter how many hours the package includes.';
    if (!t.billing_period) return 'Choose how often the package is billed.';
  }

  if (model === 'retainer') {
    if (!t.billing_period || t.billing_period === 'one_off') {
      return 'A retainer recurs — choose weekly, monthly, quarterly or annually.';
    }
    if (t.included_hours != null && t.included_hours <= 0) {
      return 'Hours covered by the retainer must be more than zero.';
    }
  }

  if (model === 'fixed_fee' && t.deposit_pct != null && (t.deposit_pct <= 0 || t.deposit_pct > 100)) {
    return 'A deposit must be more than 0 and at most 100 percent.';
  }

  if (model === 'success_fee') {
    if (t.success_pct != null && (t.success_pct <= 0 || t.success_pct > 100)) {
      return 'A success percentage must be more than 0 and at most 100.';
    }
    if (t.success_pct == null && !((t.amount ?? 0) > 0)) {
      return 'Enter a success percentage, a fixed success bonus, or both.';
    }
    if (t.minimum_fee != null && t.fee_cap != null && t.fee_cap < t.minimum_fee) {
      return 'The fee cap cannot be lower than the minimum fee.';
    }
  }

  return null;
};

/** The terms of a price option, ready to copy onto a client's engagement. */
export const termsOf = (row = {}) => buildTerms(row);

/** True when two sets of terms would bill differently. */
export const termsDiffer = (a, b) => {
  const x = buildTerms(a || {});
  const y = buildTerms(b || {});
  if (x.pricing_model !== y.pricing_model) return true;
  return TERM_FIELDS.some((key) => {
    if (NUMERIC_TERMS.has(key)) {
      return x[key] == null || y[key] == null ? x[key] !== y[key] : Number(x[key]) !== Number(y[key]);
    }
    return (x[key] || null) !== (y[key] || null);
  });
};

/**
 * An empty form for a model. Recurring models start monthly, which is how
 * almost every retainer is sold; everything else starts blank.
 */
export const blankTermsForm = (model = '') => {
  const form = { pricing_model: model };
  TERM_FIELDS.forEach((key) => { form[key] = ''; });
  if (modelUses(model, 'billing_period')) form.billing_period = 'monthly';
  return form;
};

/** Terms from the database, as strings the inputs can hold. */
export const termsToForm = (row = {}) => {
  const form = blankTermsForm(row.pricing_model || '');
  TERM_FIELDS.forEach((key) => {
    if (row[key] !== null && row[key] !== undefined) form[key] = String(row[key]);
  });
  return form;
};

// ── Saying it in words ──────────────────────────────────────────────────────
export const formatMoney = (n, currency = 'KES') =>
  `${currency} ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

const formatPct = (n) => `${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 3 })}%`;
const formatHours = (n) => `${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })} ${Number(n) === 1 ? 'hour' : 'hours'}`;
const perPeriod = (period) => (PERIOD_BY_VALUE[period]?.per ? ` per ${PERIOD_BY_VALUE[period].per}` : '');

const overageLine = (t) => {
  if (t.overage_rate == null) return null;
  return t.overage_rate === 0
    ? 'Extra hours not charged'
    : `Extra hours ${formatMoney(t.overage_rate)} per hour`;
};

/**
 * One headline and the supporting lines, e.g.
 *   { headline: 'KES 45,000 for 10 hours per month',
 *     details: ['≈ KES 4,500 per hour', 'Extra hours KES 5,000 per hour'] }
 * Accepts a form or a row; incomplete terms describe what is there.
 */
export const describeTerms = (input = {}) => {
  const t = buildTerms(input);
  const details = [];
  let headline;

  switch (t.pricing_model) {
    case 'unit':
      headline = `${formatMoney(t.amount)} per ${t.unit_label || 'unit'}`;
      break;
    case 'hourly':
      headline = `${formatMoney(t.amount)} per hour`;
      break;
    case 'consultant_fee':
      headline = `${formatMoney(t.amount)} flat fee`;
      break;
    case 'hourly_package':
      headline = `${formatMoney(t.amount)} for ${formatHours(t.included_hours || 0)}${perPeriod(t.billing_period)}`;
      if (t.amount > 0 && t.included_hours > 0) {
        details.push(`≈ ${formatMoney(Math.round(t.amount / t.included_hours))} per hour`);
      }
      details.push(overageLine(t));
      break;
    case 'retainer':
      headline = `${formatMoney(t.amount)}${perPeriod(t.billing_period)}`;
      if (t.included_hours > 0) details.push(`Covers ${formatHours(t.included_hours)}${perPeriod(t.billing_period)}`);
      details.push(overageLine(t));
      break;
    case 'fixed_fee':
      headline = `${formatMoney(t.amount)} project fee`;
      if (t.deposit_pct > 0) {
        details.push(`Deposit ${formatPct(t.deposit_pct)} (${formatMoney(Math.round((t.amount || 0) * t.deposit_pct) / 100)})`);
      }
      break;
    case 'success_fee': {
      const share = t.success_pct > 0 ? `${formatPct(t.success_pct)} of ${t.success_basis || 'the result'}` : null;
      const bonus = t.amount > 0 ? formatMoney(t.amount) : null;
      if (share && bonus) headline = `${share} + ${bonus} bonus`;
      else if (share) headline = share;
      else if (bonus) headline = `${bonus} on success`;
      else headline = 'Success fee';
      if (t.minimum_fee != null) details.push(`Minimum ${formatMoney(t.minimum_fee)}`);
      if (t.fee_cap != null) details.push(`Capped at ${formatMoney(t.fee_cap)}`);
      break;
    }
    default:
      headline = 'No price set';
  }

  return { headline, details: details.filter(Boolean) };
};
