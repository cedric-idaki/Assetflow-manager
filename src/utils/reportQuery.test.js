import { describe, it, expect } from 'vitest';
import {
  resolvePeriod, periodOps, filterOps, buildSelect,
  validateDefinition, buildQueryPlan, applyOps,
  shapeRows, formatCell, cellLabel, applyAggregate, groupKeyOf,
  buildReport, toExportRows, describeFilter, describeDefinition,
} from './reportQuery';
import { sourceByKey, fieldByKey } from '../config/reportSchema';

const payments = sourceByKey('payments');
const payroll  = sourceByKey('payroll_records');
const leads    = sourceByKey('leads');

// A Sunday, deliberately: the week arithmetic is where "this week" goes wrong.
const SUNDAY = new Date(2026, 7, 30, 14, 30); // 30 Aug 2026, a Sunday

describe('resolvePeriod', () => {
  it('gives today as a single inclusive day', () => {
    expect(resolvePeriod('today', {}, SUNDAY)).toEqual({ from: '2026-08-30', to: '2026-08-30' });
  });

  it('puts Sunday at the END of its week, not the start of the next one', () => {
    // getDay() is 0 on Sunday. Treating that as day-zero of the week would
    // report Sunday alone and lose the six days it belongs with.
    expect(resolvePeriod('this_week', {}, SUNDAY)).toEqual({ from: '2026-08-24', to: '2026-08-30' });
  });

  it('handles a midweek day', () => {
    const wed = new Date(2026, 7, 26, 9, 0); // Wednesday
    expect(resolvePeriod('this_week', {}, wed)).toEqual({ from: '2026-08-24', to: '2026-08-30' });
  });

  it('closes a month on its real last day', () => {
    expect(resolvePeriod('this_month', {}, SUNDAY)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    // February, and a leap year at that — a hard-coded 30 would be wrong twice.
    expect(resolvePeriod('this_month', {}, new Date(2024, 1, 10))).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('rolls last month back across a year boundary', () => {
    expect(resolvePeriod('last_month', {}, new Date(2026, 0, 15)))
      .toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('resolves the quarter the date sits in', () => {
    expect(resolvePeriod('this_quarter', {}, SUNDAY)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(resolvePeriod('this_quarter', {}, new Date(2026, 0, 5))).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });

  it('counts "last 7 days" as today plus the six before it', () => {
    expect(resolvePeriod('last_7_days', {}, SUNDAY)).toEqual({ from: '2026-08-24', to: '2026-08-30' });
    expect(resolvePeriod('last_30_days', {}, SUNDAY)).toEqual({ from: '2026-08-01', to: '2026-08-30' });
  });

  it('returns null for all-time, which is not the same as an open range', () => {
    expect(resolvePeriod('all', {}, SUNDAY)).toBeNull();
    expect(resolvePeriod('nonsense', {}, SUNDAY)).toBeNull();
  });

  it('keeps a one-sided custom range open on the missing end', () => {
    expect(resolvePeriod('custom', { from: '2026-01-01' }, SUNDAY)).toEqual({ from: '2026-01-01', to: null });
    expect(resolvePeriod('custom', {}, SUNDAY)).toBeNull();
  });
});

describe('periodOps', () => {
  const amount = fieldByKey(payments, 'payment_date');   // datetime
  const month  = fieldByKey(payroll,  'pay_month');      // month
  const due    = fieldByKey(sourceByKey('sacco_contributions'), 'due_date'); // date

  it('makes a timestamp range half-open so the last day is not lost', () => {
    const ops = periodOps(amount, { from: '2026-08-01', to: '2026-08-31' });
    expect(ops.map((o) => o.method)).toEqual(['gte', 'lt']);
    // The upper bound is the START of 1 September. `lte '2026-08-31'` would
    // mean midnight and drop everything paid during the 31st.
    expect(new Date(ops[1].args[1]).getDate()).toBe(1);
    expect(new Date(ops[1].args[1]).getMonth()).toBe(8); // September
  });

  it('compares a month column against month keys, not dates', () => {
    // '2026-08' >= '2026-08-01' is FALSE, so a date bound here returns nothing.
    expect(periodOps(month, { from: '2026-08-01', to: '2026-08-31' })).toEqual([
      { method: 'gte', args: ['pay_month', '2026-08'] },
      { method: 'lte', args: ['pay_month', '2026-08'] },
    ]);
  });

  it('leaves a plain date column inclusive on both ends', () => {
    expect(periodOps(due, { from: '2026-08-01', to: '2026-08-31' })).toEqual([
      { method: 'gte', args: ['due_date', '2026-08-01'] },
      { method: 'lte', args: ['due_date', '2026-08-31'] },
    ]);
  });
});

describe('filterOps', () => {
  const amount = fieldByKey(payments, 'amount');
  const status = fieldByKey(payments, 'payment_status');
  const notes  = fieldByKey(payments, 'notes');

  it('translates the numeric comparisons', () => {
    expect(filterOps(amount, { operator: 'gte', values: ['500'] }))
      .toEqual([{ method: 'gte', args: ['amount', 500] }]);
    expect(filterOps(amount, { operator: 'between', values: ['500', '1000'] }))
      .toEqual([{ method: 'gte', args: ['amount', 500] }, { method: 'lte', args: ['amount', 1000] }]);
  });

  it('applies NOTHING when a two-value filter is half filled', () => {
    // The failure this prevents: degrading to `amount >= 500` and presenting
    // the answer to a question the user did not ask, with no sign anything
    // went wrong.
    expect(filterOps(amount, { operator: 'between', values: ['500'] })).toEqual([]);
    expect(filterOps(amount, { operator: 'between', values: ['500', ''] })).toEqual([]);
  });

  it('drops a filter whose value is not a number', () => {
    expect(filterOps(amount, { operator: 'gte', values: ['abc'] })).toEqual([]);
  });

  it('wraps contains and starts-with correctly', () => {
    expect(filterOps(notes, { operator: 'contains', values: ['refund'] }))
      .toEqual([{ method: 'ilike', args: ['notes', '%refund%'] }]);
    expect(filterOps(notes, { operator: 'starts_with', values: ['REF'] }))
      .toEqual([{ method: 'ilike', args: ['notes', 'REF%'] }]);
  });

  it('builds in-lists and quotes their members', () => {
    expect(filterOps(status, { operator: 'any_of', values: ['completed', 'pending'] }))
      .toEqual([{ method: 'in', args: ['payment_status', ['completed', 'pending']] }]);
    // A value carrying a quote must not be able to truncate the list.
    expect(filterOps(status, { operator: 'none_of', values: ['a"b'] }))
      .toEqual([{ method: 'not', args: ['payment_status', 'in', '("a""b")'] }]);
  });

  it('ignores an empty list rather than matching nothing', () => {
    expect(filterOps(status, { operator: 'any_of', values: [] })).toEqual([]);
    expect(filterOps(status, { operator: 'any_of', values: ['', null] })).toEqual([]);
  });

  it('handles the no-value operators', () => {
    expect(filterOps(notes, { operator: 'is_empty', values: [] }))
      .toEqual([{ method: 'is', args: ['notes', null] }]);
    expect(filterOps(notes, { operator: 'is_not_empty', values: [] }))
      .toEqual([{ method: 'not', args: ['notes', 'is', null] }]);
    const done = fieldByKey(sourceByKey('follow_ups'), 'is_completed');
    expect(filterOps(done, { operator: 'is_true', values: [] }))
      .toEqual([{ method: 'is', args: ['is_completed', true] }]);
  });

  it('reads "is" on a timestamp as the whole day, not one instant', () => {
    const ops = filterOps(fieldByKey(payments, 'payment_date'), { operator: 'is', values: ['2026-08-30'] });
    expect(ops.map((o) => o.method)).toEqual(['gte', 'lt']);
  });

  it('refuses an operator that does not apply to the field type', () => {
    expect(filterOps(amount, { operator: 'contains', values: ['5'] })).toEqual([]);
  });

  it('refuses to filter on a joined column', () => {
    // Filtering an embed turns it into an inner join, which would silently drop
    // every payment whose client row is gone.
    const clientName = fieldByKey(payments, 'client_name');
    expect(filterOps(clientName, { operator: 'contains', values: ['Otieno'] })).toEqual([]);
  });
});

describe('buildSelect', () => {
  it('always asks for id, so rows have a stable React key', () => {
    expect(buildSelect(payments, ['amount'])).toBe('id,amount');
  });

  it('collapses several fields on one embed into a single alias', () => {
    // client:clients(full_name),client:clients(phone) is not valid PostgREST.
    const select = buildSelect(payroll, ['employee_name', 'department', 'gross_salary']);
    expect(select).toBe('id,gross_salary,employee:user_profiles(full_name,department)');
  });

  it('keeps separate embeds separate', () => {
    const select = buildSelect(payments, ['client_name', 'asset_code']);
    expect(select).toBe('id,client:clients(full_name),asset:assets(asset_code)');
  });
});

describe('validateDefinition', () => {
  it('drops a column the catalogue no longer has, and says so', () => {
    const res = validateDefinition({
      sourceKey: 'payments',
      fields: ['amount', 'secret_column'],
      filters: [],
    });
    expect(res.definition.fields).toEqual(['amount']);
    expect(res.errors.join(' ')).toMatch(/secret_column/);
    expect(res.ok).toBe(true);
  });

  it('drops a filter naming an unknown column', () => {
    // The case that matters: a saved definition hand-edited in the database to
    // name a column the builder never offered.
    const res = validateDefinition({
      sourceKey: 'employees',
      fields: ['full_name'],
      filters: [{ field: 'bank_account_number', operator: 'contains', values: ['1'] }],
    });
    expect(res.definition.filters).toEqual([]);
    expect(res.errors.join(' ')).toMatch(/bank_account_number/);
  });

  it('rejects a source that no longer exists', () => {
    const res = validateDefinition({ sourceKey: 'auth_users', fields: ['id'] });
    expect(res.ok).toBe(false);
    expect(res.definition).toBeNull();
  });

  it('resets an unknown period rather than passing it through', () => {
    const res = validateDefinition({ sourceKey: 'payments', fields: ['amount'], period: { preset: 'since_forever' } });
    expect(res.definition.period.preset).toBe('all');
    expect(res.errors.join(' ')).toMatch(/period/i);
  });

  it('refuses to sort by a joined column', () => {
    const res = validateDefinition({
      sourceKey: 'payments', fields: ['amount'],
      sort: { field: 'client_name', direction: 'asc' },
    });
    expect(res.definition.sort).toBeNull();
  });

  it('gives a grouped report a count when no aggregate was chosen', () => {
    const res = validateDefinition({
      sourceKey: 'payments', fields: [],
      groupBy: { field: 'payment_method' },
    });
    expect(res.ok).toBe(true);
    expect(res.definition.aggregates).toEqual([{ field: 'payment_method', fn: 'count' }]);
  });

  it('will not average a non-numeric column', () => {
    const res = validateDefinition({
      sourceKey: 'payments', fields: ['amount'],
      aggregates: [{ field: 'payment_method', fn: 'avg' }, { field: 'amount', fn: 'sum' }],
    });
    expect(res.definition.aggregates).toEqual([{ field: 'amount', fn: 'sum' }]);
  });

  it('is not ok with no columns and no grouping', () => {
    const res = validateDefinition({ sourceKey: 'payments', fields: [] });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/at least one column/i);
  });
});

describe('buildQueryPlan', () => {
  it('puts the tenant predicate in, from the session and not the definition', () => {
    const { plan } = buildQueryPlan(
      { sourceKey: 'payments', fields: ['amount'], period: { preset: 'all' } },
      { adminId: 'tenant-1', now: SUNDAY },
    );
    expect(plan.ops[0]).toEqual({ method: 'eq', args: ['admin_id', 'tenant-1'] });
  });

  it('cannot be talked into another tenant by the definition', () => {
    const { plan } = buildQueryPlan(
      {
        sourceKey: 'payments', fields: ['amount'], period: { preset: 'all' },
        // A hand-edited saved report trying to name someone else's books.
        filters: [{ field: 'admin_id', operator: 'is', values: ['tenant-2'] }],
      },
      { adminId: 'tenant-1', now: SUNDAY },
    );
    const tenantOps = plan.ops.filter((o) => o.args[0] === 'admin_id');
    expect(tenantOps).toEqual([{ method: 'eq', args: ['admin_id', 'tenant-1'] }]);
  });

  it('adds no tenant predicate where RLS scopes through a parent', () => {
    const { plan } = buildQueryPlan(
      { sourceKey: 'leads', fields: ['full_name'], period: { preset: 'all' } },
      { adminId: 'tenant-1', now: SUNDAY },
    );
    expect(plan.ops).toEqual([]);
  });

  it('applies the source base filter, which the user cannot remove', () => {
    const { plan } = buildQueryPlan(
      { sourceKey: 'employees', fields: ['full_name'], period: { preset: 'all' } },
      { adminId: 'tenant-1', now: SUNDAY },
    );
    // user_profiles also holds the tenant's customers and the platform owner.
    expect(plan.ops).toContainEqual({
      method: 'not', args: ['role', 'in', '("client","super_admin","sacco_member")'],
    });
  });

  it('resolves the period against the run clock, not the saved date', () => {
    const { plan } = buildQueryPlan(
      { sourceKey: 'payments', fields: ['amount'], period: { preset: 'this_month' } },
      { adminId: 't', now: SUNDAY },
    );
    expect(plan.range).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('falls back to newest-first on the source date when nothing is chosen', () => {
    const { plan } = buildQueryPlan(
      { sourceKey: 'payments', fields: ['amount'], period: { preset: 'all' } },
      { adminId: 't', now: SUNDAY },
    );
    expect(plan.order).toEqual({ column: 'payment_date', ascending: false });
  });

  it('selects the group and aggregate columns even when they are not displayed', () => {
    const { plan } = buildQueryPlan(
      {
        sourceKey: 'payments', fields: [], period: { preset: 'all' },
        groupBy: { field: 'payment_method' },
        aggregates: [{ field: 'amount', fn: 'sum' }],
      },
      { adminId: 't', now: SUNDAY },
    );
    expect(plan.select).toBe('id,payment_method,amount');
  });
});

describe('applyOps', () => {
  it('calls each op on the builder in order', () => {
    const calls = [];
    const fake = {
      eq:  (...a) => { calls.push(['eq', a]);  return fake; },
      gte: (...a) => { calls.push(['gte', a]); return fake; },
    };
    applyOps(fake, [
      { method: 'eq',  args: ['admin_id', 't'] },
      { method: 'gte', args: ['amount', 100] },
    ]);
    expect(calls).toEqual([['eq', ['admin_id', 't']], ['gte', ['amount', 100]]]);
  });
});

describe('shapeRows', () => {
  it('reads a value through an embed', () => {
    const rows = [{ id: '1', amount: 100, client: { full_name: 'Achieng' } }];
    expect(shapeRows(rows, payments, ['amount', 'client_name'])).toEqual([
      { __id: '1', amount: 100, client_name: 'Achieng' },
    ]);
  });

  it('takes the first row when PostgREST returns an embed as an array', () => {
    const rows = [{ id: '1', client: [{ full_name: 'Achieng' }] }];
    expect(shapeRows(rows, payments, ['client_name'])[0].client_name).toBe('Achieng');
  });

  it('gives null, not a crash, when the parent row is gone', () => {
    const rows = [{ id: '1', client: null }];
    expect(shapeRows(rows, payments, ['client_name'])[0].client_name).toBeNull();
  });
});

describe('formatCell', () => {
  it('formats money for the screen and leaves it numeric for a file', () => {
    expect(formatCell(1250.5, 'money')).toBe('KES 1,250.5');
    // A CSV cell of "KES 1,250" is text, and a column of text does not add up.
    expect(formatCell(1250.5, 'money', { forExport: true })).toBe(1250.5);
  });

  it('renders a month key as a month', () => {
    expect(formatCell('2026-08', 'month')).toBe('Aug 2026');
  });

  it('shows a dash on screen for a blank, and nothing in a file', () => {
    expect(formatCell(null, 'text')).toBe('—');
    expect(formatCell(null, 'text', { forExport: true })).toBe('');
  });

  it('reads booleans as yes and no', () => {
    expect(formatCell(true, 'boolean')).toBe('Yes');
    expect(formatCell(false, 'boolean')).toBe('No');
  });
});

describe('cellLabel', () => {
  it('shows the label the user picked the value by', () => {
    const status = fieldByKey(payments, 'payment_status');
    expect(cellLabel('completed', status)).toBe('Completed');
  });

  it('keeps a value the vocabulary has never heard of', () => {
    // A legacy row rendering as blank is a row the reader thinks was never
    // written. Same rule as sourceMeta in crmVocabulary.
    const status = fieldByKey(payments, 'payment_status');
    expect(cellLabel('part_settled', status)).toBe('Part Settled');
  });
});

describe('applyAggregate', () => {
  const rows = [{ a: 10 }, { a: 20 }, { a: null }, { a: 'x' }];

  it('ignores non-numbers rather than producing NaN', () => {
    expect(applyAggregate(rows, 'a', 'sum')).toBe(30);
    expect(applyAggregate(rows, 'a', 'avg')).toBe(15);   // over 2 values, not 4
    expect(applyAggregate(rows, 'a', 'min')).toBe(10);
    expect(applyAggregate(rows, 'a', 'max')).toBe(20);
  });

  it('counts rows, including the blank ones', () => {
    expect(applyAggregate(rows, 'a', 'count')).toBe(4);
  });

  it('returns null, not zero, when there is nothing to average', () => {
    // Zero is a figure somebody would act on. Null renders as "—".
    expect(applyAggregate([{ a: null }], 'a', 'avg')).toBeNull();
  });
});

describe('groupKeyOf', () => {
  const method = fieldByKey(payments, 'payment_method');
  const paid   = fieldByKey(payments, 'payment_date');

  it('gives blanks their own named bucket instead of dropping them', () => {
    expect(groupKeyOf(null, method, null)).toMatchObject({ key: '__none__', label: 'Not recorded' });
  });

  it('buckets timestamps by the chosen granularity', () => {
    expect(groupKeyOf('2026-08-30T09:00:00Z', paid, 'month').key).toBe('2026-08');
    expect(groupKeyOf('2026-08-30T09:00:00Z', paid, 'year').key).toBe('2026');
    expect(groupKeyOf('2026-08-30T09:00:00Z', paid, 'day').key).toBe('2026-08-30');
  });
});

describe('buildReport', () => {
  const rows = [
    { id: '1', amount: 100, payment_method: 'mpesa', client: { full_name: 'A' } },
    { id: '2', amount: 250, payment_method: 'cash',  client: { full_name: 'B' } },
    { id: '3', amount: 150, payment_method: 'mpesa', client: { full_name: 'C' } },
  ];

  it('totals the numeric columns of a detail report', () => {
    const report = buildReport(rows, payments, {
      fields: ['client_name', 'amount'], filters: [], aggregates: [], groupBy: null,
    });
    expect(report.rowCount).toBe(3);
    expect(report.totals).toEqual({ amount: 500 });
    expect(report.columns.map((c) => c.label)).toEqual(['Client', 'Amount']);
  });

  it('groups and aggregates', () => {
    const report = buildReport(rows, payments, {
      fields: [], filters: [], groupBy: { field: 'payment_method', granularity: null },
      aggregates: [{ field: 'amount', fn: 'sum' }, { field: 'amount', fn: 'count' }],
    });
    expect(report.rows).toEqual([
      { __id: 'cash',  __group__: 'Cash',   __count: 1, sum__amount: 250, count__amount: 1 },
      { __id: 'mpesa', __group__: 'Mpesa',  __count: 2, sum__amount: 250, count__amount: 2 },
    ]);
    expect(report.totals.sum__amount).toBe(500);
  });

  it('takes the overall average across rows, not the average of the group averages', () => {
    const report = buildReport(rows, payments, {
      fields: [], filters: [], groupBy: { field: 'payment_method', granularity: null },
      aggregates: [{ field: 'amount', fn: 'avg' }],
    });
    // Groups average 250 and 125; their mean is 187.5. The real average of
    // 100/250/150 is 166.67, and that is what the totals line must say.
    expect(report.totals.avg__amount).toBeCloseTo(500 / 3, 6);
  });
});

describe('toExportRows', () => {
  it('keys rows by the labels shown on screen and keeps money numeric', () => {
    const report = buildReport(
      [{ id: '1', amount: 100, payment_status: 'completed' }],
      payments,
      { fields: ['payment_status', 'amount'], filters: [], aggregates: [], groupBy: null },
    );
    const out = toExportRows(report);
    expect(out.columns).toEqual(['Status', 'Amount']);
    expect(out.rows).toEqual([{ Status: 'Completed', Amount: 100 }]);
  });
});

describe('describeFilter / describeDefinition', () => {
  it('says what a filter did, in words', () => {
    expect(describeFilter(payments, { field: 'payment_status', operator: 'any_of', values: ['completed', 'pending'] }))
      .toBe('Status is any of Completed, Pending');
    expect(describeFilter(payments, { field: 'amount', operator: 'between', values: [100, 500] }))
      .toBe('Amount is between KES 100 and KES 500');
    expect(describeFilter(payments, { field: 'notes', operator: 'is_empty', values: [] }))
      .toBe('Notes is blank');
  });

  it('says nothing for a filter that was never completed', () => {
    expect(describeFilter(payments, { field: 'amount', operator: 'between', values: [100] })).toBeNull();
  });

  it('leads with the period the report covers', () => {
    const lines = describeDefinition(
      payments,
      { filters: [{ field: 'payment_status', operator: 'is', values: ['completed'] }] },
      { from: '2026-08-01', to: '2026-08-31' },
    );
    expect(lines[0]).toBe('Paid on between 01 Aug 2026 and 31 Aug 2026');
    expect(lines[1]).toBe('Status is Completed');
  });

  it('names the lead vocabulary the agent portal writes', () => {
    // One vocabulary, both ends: a report that spelled these differently from
    // the portal would under-count every source.
    expect(describeFilter(leads, { field: 'source', operator: 'is', values: ['social_media'] }))
      .toBe('Lead source is Social Media');
  });
});
