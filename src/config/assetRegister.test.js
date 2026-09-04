import { describe, it, expect } from 'vitest';
import {
  ASSET_CATEGORIES, ASSET_STATUSES, TERMINAL_STATUSES,
  categoryMeta, statusMeta, isTerminalStatus, docTypeMeta,
  bookValue, reportedValue, ageInYears, depreciationProgress, isFullyDepreciated,
  valuationAge, expiringDocuments, validateAsset, buildAssetExport, ASSET_EXPORT_COLUMNS,
  valuationBasisLabel, valuationCoverage, revaluationStance,
  buildValuationExport, VALUATION_EXPORT_COLUMNS,
} from './assetRegister';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const DAY = 86400000;
const daysFromNow = (d) => new Date(NOW.getTime() + d * DAY).toISOString().slice(0, 10);

const asset = (o = {}) => ({
  id: 'a-1',
  asset_tag: 'FA-0001',
  asset_name: 'Toyota Hiace',
  category: 'motor_vehicles',
  status: 'in_use',
  acquisition_date: '2024-08-30',
  cost: 2000000,
  residual_value: 200000,
  accumulated_depreciation: 720000,
  useful_life_years: 5,
  method: 'straight_line',
  current_value: null,
  valuation_date: null,
  valuation_basis: null,
  ...o,
});

describe('vocabulary', () => {
  it('maps every category to a PPE account from the seeded chart', () => {
    const valid = ['1300', '1310', '1320', '1330', '1400'];
    ASSET_CATEGORIES.forEach((c) => expect(valid).toContain(c.gl));
  });

  it('falls back to "other" rather than throwing on an unknown category', () => {
    expect(categoryMeta('kryptonite').value).toBe('other');
    expect(categoryMeta(undefined).value).toBe('other');
  });

  it('falls back to "in use" on an unknown status', () => {
    expect(statusMeta('vaporised').value).toBe('in_use');
  });

  it('treats exactly the three parted-with states as terminal', () => {
    expect(TERMINAL_STATUSES.sort()).toEqual(['disposed', 'lost', 'written_off']);
    expect(isTerminalStatus('under_maintenance')).toBe(false);
    expect(isTerminalStatus('written_off')).toBe(true);
  });

  it('marks only the document kinds that can go stale as expiring', () => {
    expect(docTypeMeta('insurance').expires).toBe(true);
    expect(docTypeMeta('invoice').expires).toBe(false);
  });
});

describe('bookValue', () => {
  it('prefers the generated column the server sends', () => {
    expect(bookValue(asset({ book_value: 1234.5 }))).toBe(1234.5);
  });

  it('computes it for a row that has not been saved yet', () => {
    expect(bookValue(asset())).toBe(1280000);
  });

  it('treats missing depreciation as none, not as NaN', () => {
    expect(bookValue({ cost: 500 })).toBe(500);
  });
});

describe('reportedValue', () => {
  it('uses the recorded valuation when there is one, and says so', () => {
    expect(reportedValue(asset({ current_value: 1500000 })))
      .toEqual({ value: 1500000, basis: 'valuation' });
  });

  it('falls back to book value and says THAT, so the two never look alike', () => {
    expect(reportedValue(asset())).toEqual({ value: 1280000, basis: 'book' });
  });

  it('treats a zero valuation as a real valuation, not as absent', () => {
    // A written-down asset genuinely worth nothing must not silently report
    // its book value instead.
    expect(reportedValue(asset({ current_value: 0 })))
      .toEqual({ value: 0, basis: 'valuation' });
  });

  it('treats an empty string from a cleared input as absent', () => {
    expect(reportedValue(asset({ current_value: '' })).basis).toBe('book');
  });
});

describe('depreciationProgress', () => {
  it('measures against the depreciable amount, not the full cost', () => {
    // 720,000 charged of (2,000,000 − 200,000) depreciable = 40%.
    expect(depreciationProgress(asset())).toBe(40);
  });

  it('reads zero for an asset the period-end job has never run over', () => {
    expect(depreciationProgress(asset({ accumulated_depreciation: 0 }))).toBe(0);
  });

  it('never exceeds 100 even if over-charged', () => {
    expect(depreciationProgress(asset({ accumulated_depreciation: 9999999 }))).toBe(100);
  });

  it('returns 0 rather than dividing by zero on a fully-residual asset', () => {
    expect(depreciationProgress(asset({ cost: 100, residual_value: 100 }))).toBe(0);
  });

  it('knows when an asset has reached its residual', () => {
    expect(isFullyDepreciated(asset())).toBe(false);
    expect(isFullyDepreciated(asset({ accumulated_depreciation: 1800000 }))).toBe(true);
  });
});

describe('valuationAge', () => {
  it('reports "none" when nothing has been recorded', () => {
    expect(valuationAge(asset(), NOW)).toBe('none');
  });

  it('reports "current" for a valuation inside the year', () => {
    expect(valuationAge(asset({ current_value: 1, valuation_date: daysFromNow(-30) }), NOW)).toBe('current');
  });

  it('reports "stale" past a year — a figure that old is history, not today', () => {
    expect(valuationAge(asset({ current_value: 1, valuation_date: daysFromNow(-400) }), NOW)).toBe('stale');
  });

  it('reports "stale" for a valuation with no date at all', () => {
    expect(valuationAge(asset({ current_value: 1 }), NOW)).toBe('stale');
  });
});

describe('ageInYears', () => {
  it('measures from acquisition', () => {
    expect(ageInYears(asset({ acquisition_date: '2024-08-30' }), NOW)).toBe(2);
  });

  it('returns null rather than NaN when the date is missing or unparseable', () => {
    expect(ageInYears(asset({ acquisition_date: null }), NOW)).toBeNull();
    expect(ageInYears(asset({ acquisition_date: 'soon' }), NOW)).toBeNull();
  });
});

describe('expiringDocuments', () => {
  const doc = (o) => ({ id: 'd', doc_type: 'insurance', expires_on: null, ...o });

  it('surfaces expired and soon-to-expire cover, soonest first', () => {
    const out = expiringDocuments([
      doc({ id: 'soon', expires_on: daysFromNow(10) }),
      doc({ id: 'gone', expires_on: daysFromNow(-5) }),
      doc({ id: 'later', expires_on: daysFromNow(200) }),
    ], NOW);
    expect(out.map((d) => d.id)).toEqual(['gone', 'soon']);
    expect(out[0].expired).toBe(true);
    expect(out[1].expired).toBe(false);
  });

  it('ignores an expiry date typed onto a kind that cannot expire', () => {
    // An expiry on a purchase invoice is a data-entry slip, and warning about
    // it would train people to ignore the warnings that matter.
    expect(expiringDocuments([doc({ doc_type: 'invoice', expires_on: daysFromNow(-1) })], NOW)).toEqual([]);
  });

  it('ignores documents with no expiry at all', () => {
    expect(expiringDocuments([doc({}), doc({})], NOW)).toEqual([]);
  });
});

describe('validateAsset', () => {
  const good = {
    asset_name: 'Server', category: 'computer_equipment',
    acquisition_date: '2026-01-15', cost: '250000',
    residual_value: '', current_value: '', useful_life_years: '', status: 'in_use',
  };

  it('passes a complete form', () => {
    expect(validateAsset(good)).toEqual({});
  });

  it('demands the four fields a register cannot do without', () => {
    const e = validateAsset({});
    expect(Object.keys(e).sort()).toEqual(['acquisition_date', 'asset_name', 'category', 'cost']);
  });

  it('rejects a future acquisition — it would post into a period that has not happened', () => {
    expect(validateAsset({ ...good, acquisition_date: daysFromNow(30) }).acquisition_date).toBeTruthy();
  });

  it('accepts a zero-cost asset, which is a donation, not an error', () => {
    expect(validateAsset({ ...good, cost: '0' }).cost).toBeUndefined();
  });

  it('rejects a negative purchase value', () => {
    expect(validateAsset({ ...good, cost: '-5' }).cost).toBeTruthy();
  });

  it('rejects a residual above cost — it would make depreciation negative', () => {
    expect(validateAsset({ ...good, residual_value: '300000' }).residual_value).toBeTruthy();
  });

  it('makes a valuation carry its date, so it can be date-checked later', () => {
    expect(validateAsset({ ...good, current_value: '180000' }).valuation_date).toBeTruthy();
    expect(validateAsset({ ...good, current_value: '180000', valuation_date: '2026-06-01' })).toEqual({});
  });

  it('demands a reason before an asset leaves the register', () => {
    expect(validateAsset({ ...good, status: 'written_off' }).disposal_reason).toBeTruthy();
    expect(validateAsset({ ...good, status: 'written_off', disposal_reason: 'Beyond repair' })).toEqual({});
  });

  it('does not demand a reason for a non-terminal status', () => {
    expect(validateAsset({ ...good, status: 'under_maintenance' })).toEqual({});
  });

  it('rejects a zero or negative useful life', () => {
    expect(validateAsset({ ...good, useful_life_years: '0' }).useful_life_years).toBeTruthy();
  });
});

describe('buildAssetExport', () => {
  it('exports raw numbers so a spreadsheet can sum them', () => {
    const [row] = buildAssetExport([asset()]);
    expect(row['Purchase value']).toBe(2000000);
    expect(row['Book value']).toBe(1280000);
    expect(typeof row['Current value']).toBe('number');
  });

  it('says which of the two values it exported', () => {
    expect(buildAssetExport([asset()])[0]['Value basis']).toBe('book value');
    expect(buildAssetExport([asset({ current_value: 1, valuation_basis: 'market' })])[0]['Value basis']).toBe('market');
  });

  it('emits every declared column, so the CSV header order is honoured', () => {
    const [row] = buildAssetExport([asset()]);
    expect(Object.keys(row).sort()).toEqual([...ASSET_EXPORT_COLUMNS].sort());
  });

  it('renders labels, not raw enum values', () => {
    const [row] = buildAssetExport([asset()]);
    expect(row.Category).toBe('Motor Vehicles');
    expect(row.Status).toBe('In use');
  });

  it('survives an empty register', () => {
    expect(buildAssetExport([])).toEqual([]);
    expect(buildAssetExport()).toEqual([]);
  });
});

describe('status list', () => {
  it('gives every status a tone the UI can render', () => {
    ASSET_STATUSES.forEach((s) => {
      expect(['success', 'warning', 'danger', 'muted']).toContain(s.tone);
    });
  });
});

// ── Valuation ───────────────────────────────────────────────────────────────
// These figures come from public.sacco_asset_valuation_totals() and
// public.sacco_asset_valuation_by_category(); the helpers below only interpret
// them. What is being held to account here is the interpretation — a book that
// has barely been valued must never present itself as one that has.

const totals = (o = {}) => ({
  heldAssets: 400,
  valuedAssets: 4,
  unvaluedAssets: 396,
  staleValuations: 0,
  totalCost: 88000000,
  totalDepreciation: 31000000,
  totalBookValue: 57000000,
  totalCurrentValue: 63500000,
  valuedCurrentValue: 54000000,
  valuedBookValue: 47500000,
  unvaluedBookValue: 9500000,
  revaluationDelta: 6500000,
  byBasis: {},
  lastValuedOn: '2026-06-01',
  ...o,
});

describe('valuationBasisLabel', () => {
  it('names each basis the register offers', () => {
    expect(valuationBasisLabel('professional')).toBe('Professional valuer');
    expect(valuationBasisLabel('market')).toBe('Market / open market value');
  });

  it('reads a blank basis as an internal estimate, matching the server', () => {
    // sacco_asset_valuation_totals() folds a null basis into 'internal'. Calling
    // it "unknown" here would make the report's basis breakdown disagree with
    // the totals it sits underneath.
    expect(valuationBasisLabel(null)).toBe('Internal estimate');
    expect(valuationBasisLabel('nonsense')).toBe('Internal estimate');
  });
});

describe('valuationCoverage', () => {
  it('separates the share of ASSETS valued from the share of MONEY valued', () => {
    // The gap between these two numbers is the whole point: 1% of the assets
    // carry 85% of the value. Reporting either alone misleads.
    const c = valuationCoverage(totals());
    expect(c.assets).toBe(1);
    expect(c.value).toBe(85);
  });

  it('reports zero rather than NaN on an empty register', () => {
    expect(valuationCoverage({})).toEqual({ assets: 0, value: 0 });
    expect(valuationCoverage(totals({ heldAssets: 0, totalCurrentValue: 0 })))
      .toEqual({ assets: 0, value: 0 });
  });
});

describe('revaluationStance', () => {
  it('calls a gap above book value a surplus and one below it a deficit', () => {
    expect(revaluationStance(totals())).toMatchObject({ delta: 6500000, tone: 'success' });
    expect(revaluationStance(totals({ revaluationDelta: -250000 })))
      .toMatchObject({ delta: -250000, tone: 'warning' });
  });

  it('says nothing at all when no asset has been valued', () => {
    // Not "KES 0" — that reads as "we valued everything and it came to exactly
    // book value", which is the opposite of the truth.
    expect(revaluationStance(totals({ valuedAssets: 0, revaluationDelta: 0 }))).toBeNull();
  });

  it('treats a sub-cent gap as agreement rather than a movement', () => {
    expect(revaluationStance(totals({ revaluationDelta: 0.004 })))
      .toMatchObject({ delta: 0, tone: 'muted' });
  });
});

describe('buildValuationExport', () => {
  const rows = [
    { category: 'land_buildings', assetCount: 2, valuedCount: 2, staleCount: 1,
      totalCost: 60000000, totalDepreciation: 12000000, totalBookValue: 48000000,
      totalCurrentValue: 54000000, valuedCurrentValue: 54000000, valuedBookValue: 48000000,
      revaluationDelta: 6000000 },
    { category: 'motor_vehicles', assetCount: 9, valuedCount: 0, staleCount: 0,
      totalCost: 28000000, totalDepreciation: 19000000, totalBookValue: 9000000,
      totalCurrentValue: 9000000, valuedCurrentValue: 0, valuedBookValue: 0,
      revaluationDelta: 0 },
  ];

  it('emits every declared column, so the CSV header order is honoured', () => {
    const [row] = buildValuationExport(rows, totals());
    expect(Object.keys(row).sort()).toEqual([...VALUATION_EXPORT_COLUMNS].sort());
  });

  it('writes raw numbers, not display strings, in the money columns', () => {
    const [row] = buildValuationExport(rows, totals());
    expect(row['At cost']).toBe(60000000);
    expect(row['Net book value']).toBe(48000000);
  });

  it('renders category labels, not raw enum values', () => {
    expect(buildValuationExport(rows, totals())[0].Category).toBe('Land & Buildings');
  });

  it('takes the total row from the server aggregate, not from the rows above it', () => {
    // Deliberately inconsistent input: the rows add to 88,000,000 at cost while
    // the whole-book total says 90,000,000. The exported total must be the
    // server's — the browser only ever holds what it was sent.
    const out = buildValuationExport(rows, totals({ totalCost: 90000000 }));
    const total = out[out.length - 1];
    expect(total.Category).toBe('TOTAL');
    expect(total['At cost']).toBe(90000000);
    expect(total['Assets']).toBe(400);
  });

  it('omits the total row when there are no whole-book figures to trust', () => {
    const out = buildValuationExport(rows);
    expect(out).toHaveLength(2);
    expect(out.some((r) => r.Category === 'TOTAL')).toBe(false);
  });

  it('survives an empty register', () => {
    expect(buildValuationExport([], null)).toEqual([]);
    expect(buildValuationExport()).toEqual([]);
  });
});
