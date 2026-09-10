/**
 * Asset register vocabulary and the arithmetic that goes with it.
 *
 * A register only earns its keep if it can be aggregated — "what do we own,
 * by category" and "what is out of service" are the two questions it exists
 * to answer, and free text cannot answer either. So category and status are
 * CONTROLLED vocabularies, defined once here and enforced by CHECK constraints
 * in supabase/migrations/20260830200000_sacco_asset_register.sql. Adding a
 * value here means adding it there too.
 *
 * The GL mapping is the load-bearing part. This register is the same table the
 * depreciation job and the Balance Sheet's Property, Plant & Equipment line
 * read, so choosing a category is also choosing which asset account the
 * purchase posts to. Getting that mapping wrong does not produce a cosmetic
 * bug — it produces a Balance Sheet that puts a motor vehicle under furniture.
 * The codes come from the chart of accounts seeded by the accounting engine
 * (20260725120000).
 */

// ── What kind of thing is it ────────────────────────────────────────────────
// `gl` is the account the purchase is capitalised to. Two categories share
// 1310 because the standard SACCO chart has no separate account for them; the
// register still keeps them apart, which is the whole point of having a
// register rather than just a trial balance.
export const ASSET_CATEGORIES = [
  { value: 'land_buildings',      label: 'Land & Buildings',       icon: 'Building2',  gl: '1300', life: 40 },
  { value: 'motor_vehicles',      label: 'Motor Vehicles',         icon: 'Car',        gl: '1330', life: 5  },
  { value: 'computer_equipment',  label: 'Computers & IT',         icon: 'Laptop',     gl: '1320', life: 3  },
  { value: 'furniture_fittings',  label: 'Furniture & Fittings',   icon: 'Armchair',   gl: '1310', life: 8  },
  { value: 'office_equipment',    label: 'Office Equipment',       icon: 'Printer',    gl: '1310', life: 5  },
  { value: 'plant_machinery',     label: 'Plant & Machinery',      icon: 'Cog',        gl: '1310', life: 10 },
  { value: 'intangible_software', label: 'Software & Intangibles', icon: 'Code2',      gl: '1400', life: 4  },
  { value: 'other',               label: 'Other',                  icon: 'Package',    gl: '1310', life: 4  },
];

const CATEGORY_BY_VALUE = ASSET_CATEGORIES.reduce((acc, c) => { acc[c.value] = c; return acc; }, {});

export const categoryMeta = (value) => CATEGORY_BY_VALUE[value] || CATEGORY_BY_VALUE.other;
export const categoryLabel = (value) => categoryMeta(value).label;

// ── Where is it in its life ─────────────────────────────────────────────────
// `terminal` marks the states where the SACCO no longer holds the asset. The
// database derives is_disposed from exactly this set, and the depreciation job
// reads is_disposed — so a terminal status is what stops an asset that has
// been sold from going on being depreciated.
export const ASSET_STATUSES = [
  { value: 'in_use',            label: 'In use',            tone: 'success', icon: 'CheckCircle2', terminal: false },
  { value: 'in_storage',        label: 'In storage',        tone: 'muted',   icon: 'Archive',      terminal: false },
  { value: 'under_maintenance', label: 'Under maintenance', tone: 'warning', icon: 'Wrench',       terminal: false },
  { value: 'impaired',          label: 'Impaired',          tone: 'warning', icon: 'AlertTriangle', terminal: false },
  { value: 'disposed',          label: 'Disposed / sold',   tone: 'muted',   icon: 'PackageMinus', terminal: true  },
  { value: 'written_off',       label: 'Written off',       tone: 'danger',  icon: 'Trash2',       terminal: true  },
  { value: 'lost',              label: 'Lost / stolen',     tone: 'danger',  icon: 'HelpCircle',   terminal: true  },
];

const STATUS_BY_VALUE = ASSET_STATUSES.reduce((acc, s) => { acc[s.value] = s; return acc; }, {});

export const statusMeta = (value) => STATUS_BY_VALUE[value] || STATUS_BY_VALUE.in_use;
export const statusLabel = (value) => statusMeta(value).label;
export const isTerminalStatus = (value) => !!STATUS_BY_VALUE[value]?.terminal;

/** Statuses that mean the SACCO has parted with the asset. */
export const TERMINAL_STATUSES = ASSET_STATUSES.filter((s) => s.terminal).map((s) => s.value);

// ── Supporting documents ────────────────────────────────────────────────────
// `expires` marks the kinds that go stale. Insurance that lapsed in March and a
// valuation from 2019 are both worth flagging; a purchase invoice never is.
export const ASSET_DOC_TYPES = [
  { value: 'invoice',          label: 'Purchase invoice',  icon: 'Receipt',      expires: false },
  { value: 'receipt',          label: 'Payment receipt',   icon: 'ReceiptText',  expires: false },
  { value: 'title_deed',       label: 'Title deed',        icon: 'ScrollText',   expires: false },
  { value: 'logbook',          label: 'Logbook',           icon: 'BookMarked',   expires: false },
  { value: 'warranty',         label: 'Warranty',          icon: 'ShieldCheck',  expires: true  },
  { value: 'valuation_report', label: 'Valuation report',  icon: 'LineChart',    expires: true  },
  { value: 'insurance',        label: 'Insurance cover',   icon: 'Umbrella',     expires: true  },
  { value: 'photo',            label: 'Photograph',        icon: 'Image',        expires: false },
  { value: 'disposal_note',    label: 'Disposal note',     icon: 'FileMinus',    expires: false },
  { value: 'other',            label: 'Other document',    icon: 'FileText',     expires: false },
];

const DOC_TYPE_BY_VALUE = ASSET_DOC_TYPES.reduce((acc, d) => { acc[d.value] = d; return acc; }, {});

export const docTypeMeta = (value) => DOC_TYPE_BY_VALUE[value] || DOC_TYPE_BY_VALUE.other;
export const docTypeLabel = (value) => docTypeMeta(value).label;

/** How a recorded valuation was arrived at. Free text would not aggregate. */
export const VALUATION_BASES = [
  { value: 'market',       label: 'Market / open market value' },
  { value: 'professional', label: 'Professional valuer' },
  { value: 'insurance',    label: 'Insurance replacement value' },
  { value: 'internal',     label: 'Internal estimate' },
];

const BASIS_BY_VALUE = VALUATION_BASES.reduce((acc, b) => { acc[b.value] = b; return acc; }, {});

/**
 * A recorded valuation with no basis is an internal estimate — that is what
 * the form defaults to, and what sacco_asset_valuation_totals() folds a blank
 * into. Saying "unknown" here instead would make the report's basis breakdown
 * disagree with the server's.
 */
export const valuationBasisLabel = (value) =>
  (BASIS_BY_VALUE[value] || BASIS_BY_VALUE.internal).label;

export const DEPRECIATION_METHODS = [
  { value: 'straight_line', label: 'Straight line' },
  { value: 'reducing',      label: 'Reducing balance' },
];

/** A document within this many days of expiry is worth surfacing. */
export const DOC_EXPIRY_WARNING_DAYS = 60;

/** A valuation older than this no longer describes what the asset is worth. */
export const VALUATION_STALE_DAYS = 365;

// ── Arithmetic ──────────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

/**
 * Book value: cost less accumulated depreciation.
 *
 * The database computes this as a GENERATED column, so a row read from the
 * server already carries it. This recomputes it for the rows that have not
 * been saved yet — a form being filled in — and as the fallback for a row
 * fetched before the migration landed.
 */
export const bookValue = (asset) =>
  asset?.book_value != null
    ? round2(asset.book_value)
    : round2(num(asset?.cost) - num(asset?.accumulated_depreciation));

/**
 * What the register says an asset is worth TODAY.
 *
 * Two numbers can answer that and they mean different things, so this returns
 * which one it used rather than quietly picking. A screen that prints a
 * valuation and a screen that prints book value must not look identical — the
 * first is somebody's opinion, the second is what the ledger will defend.
 */
export const reportedValue = (asset) => {
  if (asset?.current_value != null && asset.current_value !== '') {
    return { value: round2(asset.current_value), basis: 'valuation' };
  }
  return { value: bookValue(asset), basis: 'book' };
};

/** Whole years between acquisition and `asOf`, to one decimal. */
export const ageInYears = (asset, asOf = new Date()) => {
  if (!asset?.acquisition_date) return null;
  const from = new Date(asset.acquisition_date);
  if (Number.isNaN(from.getTime())) return null;
  const years = (asOf.getTime() - from.getTime()) / (365.25 * 24 * 3600 * 1000);
  return years < 0 ? 0 : Math.round(years * 10) / 10;
};

/**
 * How much of the asset's life the ledger has already charged, 0–100.
 *
 * Deliberately measured against depreciation charged rather than against time
 * elapsed: an asset bought four years ago that nobody ever ran the period-end
 * job for is 0% depreciated, and the register should say so rather than
 * implying the books are up to date.
 */
export const depreciationProgress = (asset) => {
  const depreciable = num(asset?.cost) - num(asset?.residual_value);
  if (depreciable <= 0) return 0;
  const pct = (num(asset?.accumulated_depreciation) / depreciable) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
};

/** True once accumulated depreciation has taken the asset down to residual. */
export const isFullyDepreciated = (asset) =>
  num(asset?.cost) > 0 && bookValue(asset) <= num(asset?.residual_value) + 0.005;

/**
 * Is the recorded valuation still worth believing?
 *
 * `none` — nothing recorded, so the register reports book value.
 * `stale` — recorded, but older than a year.
 * `current` — recorded within the year.
 */
export const valuationAge = (asset, asOf = new Date()) => {
  if (asset?.current_value == null || asset.current_value === '') return 'none';
  if (!asset?.valuation_date) return 'stale';
  const on = new Date(asset.valuation_date);
  if (Number.isNaN(on.getTime())) return 'stale';
  const days = (asOf.getTime() - on.getTime()) / 86400000;
  return days > VALUATION_STALE_DAYS ? 'stale' : 'current';
};

/**
 * Documents that have expired or are about to.
 *
 * Only the kinds that CAN expire are considered — an expiry date typed onto a
 * purchase invoice is a data-entry slip, not a compliance event.
 */
export const expiringDocuments = (docs = [], asOf = new Date()) =>
  (docs || [])
    .filter((d) => d?.expires_on && docTypeMeta(d.doc_type).expires)
    .map((d) => {
      const on = new Date(d.expires_on);
      const days = Math.floor((on.getTime() - asOf.getTime()) / 86400000);
      return { ...d, daysToExpiry: days, expired: days < 0 };
    })
    .filter((d) => Number.isFinite(d.daysToExpiry) && d.daysToExpiry <= DOC_EXPIRY_WARNING_DAYS)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry);

/**
 * What is wrong with this form, as { field: message }.
 *
 * Returned rather than thrown, and keyed by field, so the form can mark the
 * offending inputs instead of showing one toast that says "invalid" and leaves
 * the operator hunting.
 */
export const validateAsset = (form = {}) => {
  const errors = {};

  if (!String(form.asset_name || '').trim()) errors.asset_name = 'Give the asset a name.';
  if (!form.category) errors.category = 'Choose a category.';
  if (!form.acquisition_date) {
    errors.acquisition_date = 'When was it acquired?';
  } else {
    const on = new Date(form.acquisition_date);
    if (Number.isNaN(on.getTime())) errors.acquisition_date = 'That is not a date.';
    // An acquisition dated in the future would post the purchase into a period
    // that has not happened, and the depreciation job skips it silently.
    else if (on.getTime() > Date.now() + 86400000) errors.acquisition_date = 'Acquisition cannot be in the future.';
  }

  const cost = Number(form.cost);
  if (form.cost === '' || form.cost == null || !Number.isFinite(cost)) errors.cost = 'Enter the purchase value.';
  else if (cost < 0) errors.cost = 'Purchase value cannot be negative.';

  if (form.residual_value !== '' && form.residual_value != null) {
    const residual = Number(form.residual_value);
    if (!Number.isFinite(residual) || residual < 0) errors.residual_value = 'Residual value cannot be negative.';
    else if (Number.isFinite(cost) && residual > cost) errors.residual_value = 'Residual cannot exceed the purchase value.';
  }

  if (form.current_value !== '' && form.current_value != null) {
    const current = Number(form.current_value);
    if (!Number.isFinite(current) || current < 0) errors.current_value = 'Current value cannot be negative.';
    // A valuation with no date is a number nobody can date-check later.
    else if (!form.valuation_date) errors.valuation_date = 'Say when it was valued.';
  }

  const life = Number(form.useful_life_years);
  if (form.useful_life_years !== '' && form.useful_life_years != null) {
    if (!Number.isFinite(life) || life <= 0) errors.useful_life_years = 'Useful life must be more than zero.';
  }

  if (isTerminalStatus(form.status) && !String(form.disposal_reason || '').trim()) {
    errors.disposal_reason = 'Say what happened to it.';
  }

  return errors;
};

/**
 * Column order for the CSV export. Passed to downloadCSV explicitly so the
 * order is fixed by this list rather than by whichever row happened to be
 * first — see toCSV in utils/exportUtils.
 */
export const ASSET_EXPORT_COLUMNS = [
  'Tag', 'Asset', 'Category', 'Description', 'Status', 'Location',
  'Acquired', 'Purchase value', 'Accumulated depreciation', 'Book value',
  'Current value', 'Value basis', 'Valued on', 'Serial number',
  'Supplier', 'GL account', 'Useful life (yrs)', 'Method',
];

/**
 * The register as rows for downloadCSV.
 *
 * Raw numbers, not display strings, in the money columns — a treasurer opening
 * this in a spreadsheet needs to sum the cost column, and "KES 1,200,000" does
 * not sum. `Value basis` is carried beside `Current value` for the same reason
 * the UI carries it: a recorded valuation and a book value are different
 * claims, and a column of numbers that mixes the two silently is worse than no
 * column at all.
 */
export const buildAssetExport = (assets = []) => (assets || []).map((a) => {
  const reported = reportedValue(a);
  return {
    'Tag':                       a.asset_tag || '',
    'Asset':                     a.asset_name || '',
    'Category':                  categoryLabel(a.category),
    'Description':               a.description || '',
    'Status':                    statusLabel(a.status),
    'Location':                  a.location || '',
    'Acquired':                  a.acquisition_date || '',
    'Purchase value':            round2(a.cost),
    'Accumulated depreciation':  round2(a.accumulated_depreciation),
    'Book value':                bookValue(a),
    'Current value':             reported.value,
    'Value basis':               reported.basis === 'valuation'
                                   ? (a.valuation_basis || 'recorded valuation')
                                   : 'book value',
    'Valued on':                 a.valuation_date || '',
    'Serial number':             a.serial_number || '',
    'Supplier':                  a.supplier || '',
    'GL account':                a.gl_code || '',
    'Useful life (yrs)':         a.useful_life_years ?? '',
    'Method':                    a.method || '',
  };
});

// ── Valuation ───────────────────────────────────────────────────────────────
// The register reports what an asset is worth as coalesce(current_value,
// book_value) — see reportedValue above. That single number is the right thing
// to show on a row and the wrong thing to hand a board without saying what is
// underneath it, so everything below exists to keep the two apart: how much of
// the book has actually been valued, and how much of the headline is book value
// wearing a valuation's clothes.
//
// The figures come from public.sacco_asset_valuation_totals() and
// public.sacco_asset_valuation_by_category(); nothing here re-derives them from
// a list of assets, because any list the browser holds is a page.

/** Zero-safe percentage, to one decimal. */
const share = (part, whole) => (num(whole) > 0 ? Math.round((num(part) / num(whole)) * 1000) / 10 : 0);

/**
 * How much of the valuation is real.
 *
 * `assets` — the share of held assets carrying a recorded valuation.
 * `value`  — the share of the reported total that rests on one.
 *
 * The two differ, and the difference is the point: a SACCO that has valued its
 * one office block and none of its ninety chairs has valued 1% of its assets
 * and 85% of its money. Reporting only the first understates the coverage;
 * reporting only the second hides that almost nothing was looked at.
 */
export const valuationCoverage = (totals = {}) => ({
  assets: share(totals.valuedAssets, totals.heldAssets),
  value:  share(totals.valuedCurrentValue, totals.totalCurrentValue),
});

/**
 * Is the revaluation gap a surplus, a deficit, or nothing worth a word?
 *
 * Returns null when no asset carries a valuation — there is no gap to report,
 * and rendering "KES 0" would read as "we valued everything and it came to
 * exactly book value", which is the opposite of the truth.
 */
export const revaluationStance = (totals = {}) => {
  if (!Number(totals.valuedAssets)) return null;
  const delta = round2(totals.revaluationDelta);
  if (Math.abs(delta) < 0.01) return { delta: 0, tone: 'muted', label: 'In line with book value' };
  return delta > 0
    ? { delta, tone: 'success', label: 'Revaluation surplus' }
    : { delta, tone: 'warning', label: 'Revaluation deficit' };
};

/** Column order for the valuation report's CSV. See ASSET_EXPORT_COLUMNS. */
export const VALUATION_EXPORT_COLUMNS = [
  'Category', 'Assets', 'At cost', 'Accumulated depreciation', 'Net book value',
  'Current value', 'Share of value (%)', 'Valued assets', 'Value of valued assets',
  'Book value of valued assets', 'Revaluation surplus/(deficit)', 'Stale valuations',
];

/**
 * The by-category valuation as rows for downloadCSV.
 *
 * Raw numbers in the money columns for the same reason as buildAssetExport: a
 * treasurer opening this in a spreadsheet needs to sum and cross-foot it, and
 * "KES 1,200,000" does neither.
 *
 * A TOTAL ROW IS APPENDED, and it comes from `totals` — the server's whole-book
 * aggregate — rather than from adding the rows above it. They should agree; if
 * they ever do not, the total that is right is the one Postgres computed over
 * every asset, not the one the browser computed over what it was sent.
 */
export const buildValuationExport = (rows = [], totals = null) => {
  const out = (rows || []).map((r) => ({
    'Category':                     categoryLabel(r.category),
    'Assets':                       Number(r.assetCount) || 0,
    'At cost':                      round2(r.totalCost),
    'Accumulated depreciation':     round2(r.totalDepreciation),
    'Net book value':               round2(r.totalBookValue),
    'Current value':                round2(r.totalCurrentValue),
    'Share of value (%)':           share(r.totalCurrentValue, totals?.totalCurrentValue),
    'Valued assets':                Number(r.valuedCount) || 0,
    'Value of valued assets':       round2(r.valuedCurrentValue),
    'Book value of valued assets':  round2(r.valuedBookValue),
    'Revaluation surplus/(deficit)': round2(r.revaluationDelta),
    'Stale valuations':             Number(r.staleCount) || 0,
  }));

  if (totals) {
    out.push({
      'Category':                     'TOTAL',
      'Assets':                       Number(totals.heldAssets) || 0,
      'At cost':                      round2(totals.totalCost),
      'Accumulated depreciation':     round2(totals.totalDepreciation),
      'Net book value':               round2(totals.totalBookValue),
      'Current value':                round2(totals.totalCurrentValue),
      'Share of value (%)':           100,
      'Valued assets':                Number(totals.valuedAssets) || 0,
      'Value of valued assets':       round2(totals.valuedCurrentValue),
      'Book value of valued assets':  round2(totals.valuedBookValue),
      'Revaluation surplus/(deficit)': round2(totals.revaluationDelta),
      'Stale valuations':             Number(totals.staleValuations) || 0,
    });
  }

  return out;
};
