/**
 * REPORT ENGINE — turns a report definition into a query, and rows into a report.
 *
 * Everything here is PURE. A definition goes in, a description of a query comes
 * out; rows go in, a shaped report comes out. Nothing in this file touches
 * Supabase, the network or the clock unless the caller hands it a clock. That
 * is deliberate: the interesting bugs in a report builder are all in the
 * translation — a period that resolves to the wrong month, a `between` that
 * quietly drops its upper bound, an average taken over a capped page — and none
 * of those are findable through a UI. They are findable in
 * src/utils/reportQuery.test.js.
 *
 * The one impure helper is applyOps(), which is four lines and exists only so
 * the hook can hand the op list to a real query builder.
 *
 * ── WHY OPS AND NOT A QUERY ──────────────────────────────────────────────────
 *
 * buildQueryPlan() returns `[{ method: 'gte', args: ['amount', 500] }, …]`
 * rather than a chained Supabase builder. A plan can be asserted against; a
 * half-built query object can only be run. It also means the whole translation
 * layer is one testable function instead of being smeared through the hook.
 */

import {
  sourceByKey, fieldByKey, fieldPath, operatorByValue,
  isNumericType, isTemporalType, PERIOD_PRESET_VALUES,
} from '../config/reportSchema';

// ─── SMALL SHARED HELPERS ────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for a Date, in the VIEWER's timezone — not UTC. */
export const toDayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 'YYYY-MM' for a Date, in the viewer's timezone. */
export const toMonthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

/**
 * The instant a local day begins, as an ISO string.
 *
 * Timestamps come back from Postgres in UTC. Nairobi is UTC+3, so "payments on
 * 30 August" filtered with the naive '2026-08-30T00:00:00Z' silently includes
 * three hours of the 29th and drops three hours of the 30th. Building the bound
 * from a local Date and letting toISOString() do the conversion is what keeps
 * a day meaning the day the user is living in.
 */
const startOfLocalDayISO = (dayKey, dayOffset = 0) => {
  const [y, m, d] = String(dayKey).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d + dayOffset, 0, 0, 0, 0).toISOString();
};

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

// ─── REPORTING PERIODS ───────────────────────────────────────────────────────
/**
 * Resolve a period preset against the clock, to two INCLUSIVE day bounds.
 *
 * `now` is a parameter and not a call to new Date() inside, so a test can ask
 * what "this quarter" means on a specific day rather than on the day the suite
 * happens to run. Returns null for 'all' — meaning no date predicate at all,
 * which is different from a range that happens to cover everything.
 */
export const resolvePeriod = (preset, custom = {}, now = new Date()) => {
  const day = (offset = 0) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return toDayKey(d);
  };
  const monthStart = (monthOffset = 0) =>
    toDayKey(new Date(now.getFullYear(), now.getMonth() + monthOffset, 1));
  const monthEnd = (monthOffset = 0) =>
    toDayKey(new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0));

  switch (preset) {
    case 'today':
      return { from: day(0), to: day(0) };

    case 'this_week': {
      // Monday-first. getDay() is 0 for Sunday, which belongs to the week that
      // started six days earlier, not to the one starting tomorrow.
      const dow = now.getDay();
      const backToMonday = dow === 0 ? 6 : dow - 1;
      return { from: day(-backToMonday), to: day(6 - backToMonday) };
    }

    case 'this_month':
      return { from: monthStart(0), to: monthEnd(0) };

    case 'last_month':
      return { from: monthStart(-1), to: monthEnd(-1) };

    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      return {
        from: toDayKey(new Date(now.getFullYear(), q * 3, 1)),
        to:   toDayKey(new Date(now.getFullYear(), q * 3 + 3, 0)),
      };
    }

    case 'this_year':
      return {
        from: toDayKey(new Date(now.getFullYear(), 0, 1)),
        to:   toDayKey(new Date(now.getFullYear(), 11, 31)),
      };

    // "Last 7 days" includes today, so it is today and the six before it. The
    // off-by-one here is the difference between a weekly figure and an
    // eight-day one that never reconciles with anything.
    case 'last_7_days':  return { from: day(-6),  to: day(0) };
    case 'last_30_days': return { from: day(-29), to: day(0) };
    case 'last_90_days': return { from: day(-89), to: day(0) };

    case 'custom': {
      const { from, to } = custom || {};
      if (isBlank(from) && isBlank(to)) return null;
      // A one-sided custom range is legitimate — "everything since we went
      // live" — so the missing end stays open rather than being invented.
      return { from: isBlank(from) ? null : from, to: isBlank(to) ? null : to };
    }

    case 'all':
    default:
      return null;
  }
};

/**
 * The query ops that restrict a temporal column to a resolved period.
 *
 * Three shapes, because three storage formats. Getting this wrong is invisible:
 * a mismatched comparison returns rows, just not the right ones.
 */
export const periodOps = (field, range) => {
  if (!field || !range) return [];
  const { column, type } = field;
  const ops = [];

  if (type === 'month') {
    // 'YYYY-MM' compares lexicographically, so the bounds must be month keys
    // too. '2026-08' >= '2026-08-01' is false — see FIELD_TYPES.
    if (range.from) ops.push({ method: 'gte', args: [column, String(range.from).slice(0, 7)] });
    if (range.to)   ops.push({ method: 'lte', args: [column, String(range.to).slice(0, 7)] });
    return ops;
  }

  if (type === 'datetime') {
    // Half-open on the upper bound: `< start of the day after`. `<= the day
    // itself` would mean midnight and drop everything that happened during the
    // last day of the range.
    if (range.from) {
      const iso = startOfLocalDayISO(range.from);
      if (iso) ops.push({ method: 'gte', args: [column, iso] });
    }
    if (range.to) {
      const iso = startOfLocalDayISO(range.to, 1);
      if (iso) ops.push({ method: 'lt', args: [column, iso] });
    }
    return ops;
  }

  // Plain DATE columns: inclusive on both ends, string compare is chronological.
  if (range.from) ops.push({ method: 'gte', args: [column, range.from] });
  if (range.to)   ops.push({ method: 'lte', args: [column, range.to] });
  return ops;
};

// ─── FILTERS ─────────────────────────────────────────────────────────────────
/**
 * PostgREST's `in` list is a literal, so each member is quoted and any embedded
 * quote doubled. Without this a status of `O"Brien` truncates the list and the
 * filter silently matches something else.
 */
const inList = (values) =>
  `(${values.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')})`;

const coerce = (field, raw) => {
  if (isNumericType(field.type)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === 'month') return String(raw).slice(0, 7);
  return String(raw);
};

/**
 * One filter → the ops that express it.
 *
 * Returns [] for a filter that is not fully specified. That is the important
 * behaviour: a `between` missing its upper bound must apply NOTHING rather than
 * degrade to a one-sided `>=`, because the user asked a bounded question and a
 * half-applied filter answers a different one while looking answered.
 */
export const filterOps = (field, filter) => {
  if (!field || !filter) return [];
  const op = operatorByValue(filter.operator);
  if (!op) return [];
  if (!op.types.includes(field.type)) return [];
  // Joined columns would need an inner join to filter on, which drops
  // parentless rows — see the note on joined() in reportSchema.
  if (field.join || field.filterable === false) return [];

  const values = Array.isArray(filter.values) ? filter.values : [];
  const { column, type } = field;

  switch (op.value) {
    case 'is_true':      return [{ method: 'is',  args: [column, true] }];
    case 'is_false':     return [{ method: 'is',  args: [column, false] }];
    case 'is_empty':     return [{ method: 'is',  args: [column, null] }];
    case 'is_not_empty': return [{ method: 'not', args: [column, 'is', null] }];
    default: break;
  }

  if (op.arity === 'list') {
    const list = values.filter((v) => !isBlank(v)).map((v) => coerce(field, v));
    if (list.length === 0) return [];
    return op.value === 'any_of'
      ? [{ method: 'in',  args: [column, list] }]
      : [{ method: 'not', args: [column, 'in', inList(list)] }];
  }

  if (op.arity === 2) {
    const [a, b] = values;
    if (isBlank(a) || isBlank(b)) return [];
    if (isTemporalType(type)) {
      return periodOps(field, { from: String(a), to: String(b) });
    }
    const lo = coerce(field, a);
    const hi = coerce(field, b);
    if (lo === null || hi === null) return [];
    return [
      { method: 'gte', args: [column, lo] },
      { method: 'lte', args: [column, hi] },
    ];
  }

  // Single-value operators.
  const raw = values[0];
  if (isBlank(raw)) return [];
  const value = coerce(field, raw);
  if (value === null) return [];

  switch (op.value) {
    case 'is':
      // An `=` against a timestamp column means one exact instant, which is
      // never what "is 30 August" means. Treat it as the whole day.
      return type === 'datetime'
        ? periodOps(field, { from: String(raw), to: String(raw) })
        : [{ method: 'eq', args: [column, value] }];
    case 'is_not':
      return [{ method: 'neq', args: [column, value] }];
    case 'contains':
      return [{ method: 'ilike', args: [column, `%${value}%`] }];
    case 'starts_with':
      return [{ method: 'ilike', args: [column, `${value}%`] }];
    case 'gt':  return [{ method: 'gt',  args: [column, value] }];
    case 'gte': return [{ method: 'gte', args: [column, value] }];
    case 'lt':  return [{ method: 'lt',  args: [column, value] }];
    case 'lte': return [{ method: 'lte', args: [column, value] }];
    case 'after':
      // Strictly after the named day, so the day itself is excluded.
      return type === 'month'
        ? [{ method: 'gt', args: [column, String(value).slice(0, 7)] }]
        : type === 'datetime'
          ? [{ method: 'gte', args: [column, startOfLocalDayISO(String(raw), 1)] }]
          : [{ method: 'gt', args: [column, String(raw)] }];
    case 'before':
      return type === 'month'
        ? [{ method: 'lt', args: [column, String(value).slice(0, 7)] }]
        : type === 'datetime'
          ? [{ method: 'lt', args: [column, startOfLocalDayISO(String(raw))] }]
          : [{ method: 'lt', args: [column, String(raw)] }];
    default:
      return [];
  }
};

// ─── SELECT ──────────────────────────────────────────────────────────────────
/**
 * The PostgREST select string for a set of fields.
 *
 * Columns reached through an embed are grouped by alias, because
 * `client:clients(full_name),client:clients(phone)` is not a valid select —
 * PostgREST wants one embed per alias with its columns inside it.
 */
export const buildSelect = (source, fieldKeys) => {
  const own = [];
  const embeds = new Map(); // alias -> { table, columns:Set }

  fieldKeys.forEach((key) => {
    const field = fieldByKey(source, key);
    if (!field) return;
    if (field.join) {
      const { alias, table, column } = field.join;
      if (!embeds.has(alias)) embeds.set(alias, { table, columns: new Set() });
      embeds.get(alias).columns.add(column);
    } else if (field.column) {
      own.push(field.column);
    }
  });

  // `id` is always fetched: React needs a stable key for each row, and a report
  // whose rows are keyed by array index re-renders wrongly the moment it is
  // sorted. It is never displayed.
  const parts = ['id', ...Array.from(new Set(own))];
  embeds.forEach(({ table, columns }, alias) => {
    parts.push(`${alias}:${table}(${Array.from(columns).join(',')})`);
  });
  return parts.join(',');
};

// ─── DEFINITION ──────────────────────────────────────────────────────────────
/** A blank report against a source, with its suggested columns already picked. */
export const emptyDefinition = (source) => ({
  sourceKey: source?.key || null,
  fields: [...(source?.defaultFields || [])],
  filters: [],
  period: { preset: source?.dateField ? 'this_month' : 'all', from: null, to: null },
  sort: source?.dateField ? { field: null, direction: 'desc' } : null,
  groupBy: null,
  aggregates: [],
});

/**
 * Validate and normalise a definition against the catalogue.
 *
 * Anything the catalogue does not recognise is DROPPED and reported, never
 * passed through. A saved report is a stored document that outlives the session
 * that made it: a column removed by a migration, a source a role has since lost
 * access to, a hand-edited row in the database — all arrive here, and none of
 * them may become part of a query. `errors` is what the UI shows so a report
 * that lost a column says so instead of quietly reporting on less.
 */
export const validateDefinition = (definition, sourceArg = null) => {
  const errors = [];
  const source = sourceArg || sourceByKey(definition?.sourceKey);

  if (!source) {
    return { ok: false, errors: ['That report source no longer exists.'], definition: null, source: null };
  }

  const known = (key) => fieldByKey(source, key);

  const fields = (definition?.fields || []).filter((key) => {
    if (known(key)) return true;
    errors.push(`Column "${key}" is no longer available and has been removed.`);
    return false;
  });

  const filters = (definition?.filters || []).reduce((acc, f) => {
    const field = known(f?.field);
    if (!field) {
      errors.push(`A filter on "${f?.field}" was dropped — that column is no longer available.`);
      return acc;
    }
    const op = operatorByValue(f?.operator);
    if (!op || !op.types.includes(field.type)) {
      errors.push(`A filter on "${field.label}" used an operator that does not apply to it and was dropped.`);
      return acc;
    }
    acc.push({
      field: f.field,
      operator: f.operator,
      values: Array.isArray(f.values) ? f.values : [],
    });
    return acc;
  }, []);

  const presetIn = definition?.period?.preset;
  const preset = PERIOD_PRESET_VALUES.includes(presetIn) ? presetIn : 'all';
  if (presetIn && preset !== presetIn) errors.push('An unknown reporting period was reset to "All time".');
  if (preset !== 'all' && !source.dateField) {
    errors.push(`${source.label} has no date to report a period on — showing everything.`);
  }

  let sort = null;
  if (definition?.sort?.field) {
    const field = known(definition.sort.field);
    if (!field || field.sortable === false || field.join) {
      errors.push('The sort column is not sortable and has been reset.');
    } else {
      sort = { field: definition.sort.field, direction: definition.sort.direction === 'asc' ? 'asc' : 'desc' };
    }
  }

  let groupBy = null;
  if (definition?.groupBy?.field) {
    const field = known(definition.groupBy.field);
    if (!field) {
      errors.push('The grouping column is no longer available — showing detail rows instead.');
    } else {
      groupBy = {
        field: definition.groupBy.field,
        granularity: isTemporalType(field.type)
          ? (['day', 'month', 'year'].includes(definition.groupBy.granularity) ? definition.groupBy.granularity : 'month')
          : null,
      };
    }
  }

  const aggregates = (definition?.aggregates || []).reduce((acc, a) => {
    const field = known(a?.field);
    if (!field) return acc;
    if (a?.fn !== 'count' && !isNumericType(field.type)) return acc;
    if (!['count', 'sum', 'avg', 'min', 'max'].includes(a?.fn)) return acc;
    acc.push({ field: a.field, fn: a.fn });
    return acc;
  }, []);

  // A grouped report with nothing to show per group is a list of group names.
  // Counting the rows in each is the least surprising thing it could mean.
  if (groupBy && aggregates.length === 0) aggregates.push({ field: groupBy.field, fn: 'count' });

  if (fields.length === 0 && !groupBy) {
    errors.push('Pick at least one column to report on.');
  }

  return {
    ok: fields.length > 0 || Boolean(groupBy),
    errors,
    source,
    definition: {
      sourceKey: source.key,
      fields,
      filters,
      period: {
        preset,
        from: definition?.period?.from || null,
        to:   definition?.period?.to   || null,
      },
      sort,
      groupBy,
      aggregates,
    },
  };
};

// ─── QUERY PLAN ──────────────────────────────────────────────────────────────
/**
 * Everything the runner needs to issue one query: what to select, what to
 * narrow by, and in what order.
 *
 * The tenant predicate goes on FIRST and is not derived from anything the
 * definition carries — it comes from the session. A saved report cannot name a
 * tenant, so it cannot be edited into one that reads somebody else's books.
 * Where the source has no tenant column, RLS scopes it through its parent and
 * this adds nothing; see the `tenant` note in reportSchema.
 */
export const buildQueryPlan = (definition, { adminId = null, now = new Date() } = {}) => {
  const { ok, errors, source, definition: def } = validateDefinition(definition);
  if (!ok || !source) return { ok: false, errors, plan: null };

  const ops = [];

  if (source.tenant?.mode === 'column' && adminId) {
    ops.push({ method: 'eq', args: [source.tenant.column, adminId] });
  }

  // Part of what the source IS, not a default the user can drop.
  if (source.baseFilter) {
    const bf = source.baseFilter;
    if (bf.op === 'not.in') ops.push({ method: 'not', args: [bf.column, 'in', inList(bf.value)] });
    else if (bf.op === 'in') ops.push({ method: 'in', args: [bf.column, bf.value] });
    else ops.push({ method: 'eq', args: [bf.column, bf.value] });
  }

  const dateField = source.dateField ? fieldByKey(source, source.dateField)
    // dateField names a COLUMN; most sources expose it under the same key, but
    // not all (payroll's month key, for instance). Fall back to a column match
    // so a source is never silently un-period-filterable.
    || (source.fields || []).find((f) => f.column === source.dateField)
    : null;

  const range = resolvePeriod(def.period.preset, { from: def.period.from, to: def.period.to }, now);
  if (dateField && range) ops.push(...periodOps(dateField, range));

  def.filters.forEach((f) => {
    ops.push(...filterOps(fieldByKey(source, f.field), f));
  });

  // Sort by the chosen column, else newest-first on the source's own date, else
  // let the server decide. An unordered report paginates non-deterministically:
  // the same query run twice can return the same row on two different pages.
  const sortField = def.sort?.field ? fieldByKey(source, def.sort.field) : null;
  const order = sortField
    ? { column: sortField.column, ascending: def.sort.direction === 'asc' }
    : dateField
      ? { column: dateField.column, ascending: false }
      : { column: 'id', ascending: true };

  // Group keys and aggregated columns have to be fetched even when the user did
  // not tick them for display, or the grouping has nothing to read.
  const selectKeys = Array.from(new Set([
    ...def.fields,
    ...(def.groupBy ? [def.groupBy.field] : []),
    ...def.aggregates.map((a) => a.field),
  ]));

  return {
    ok: true,
    errors,
    plan: {
      table: source.table,
      select: buildSelect(source, selectKeys),
      ops,
      order,
      range,
      source,
      definition: def,
    },
  };
};

/** The only impure line in the file: hand a plan's ops to a real query builder. */
export const applyOps = (query, ops) =>
  (ops || []).reduce((q, op) => q[op.method](...op.args), query);

/**
 * The same report, asking for less — the retry after a query the database
 * refused.
 *
 * PostgREST fails a select WHOLE. One column that does not exist on this
 * database, or one embed whose foreign key was never created, and the request
 * returns an error rather than the other eleven columns. Two things in this
 * schema make that a live risk rather than a theoretical one: migrations that
 * are written but not yet applied everywhere (fields marked `pending`), and a
 * migration history that disagrees with the live schema in both directions, so
 * a relationship PostgREST needs for an embed may simply not be there.
 *
 * Dropping the doubtful columns and running again turns "the report is broken"
 * into "the report is missing two columns, and here is which two" — the same
 * trade the HR page makes with its BASE/FULL column sets. `dropped` is what the
 * UI shows, because a silently narrower report is worse than a failed one.
 */
export const stripUnavailable = (definition, source) => {
  const doubtful = new Set(
    (source.fields || [])
      .filter((f) => f.pending || f.join)
      .map((f) => f.key),
  );
  if (doubtful.size === 0) return { definition, dropped: [] };

  const dropped = [];
  const keep = (key) => {
    if (!doubtful.has(key)) return true;
    const f = fieldByKey(source, key);
    if (f && !dropped.includes(f.label)) dropped.push(f.label);
    return false;
  };

  const next = {
    ...definition,
    fields:     definition.fields.filter(keep),
    filters:    definition.filters.filter((f) => keep(f.field)),
    aggregates: definition.aggregates.filter((a) => keep(a.field)),
    sort:    definition.sort?.field    && doubtful.has(definition.sort.field)    ? null : definition.sort,
    groupBy: definition.groupBy?.field && doubtful.has(definition.groupBy.field) ? null : definition.groupBy,
  };

  return { definition: next, dropped };
};

// ─── ROW SHAPING ─────────────────────────────────────────────────────────────
const readPath = (row, path) =>
  path.reduce((acc, key) => {
    if (acc === null || acc === undefined) return null;
    // A to-one embed is an object; PostgREST returns an ARRAY when it cannot
    // prove the relationship is to-one. Take the first, rather than rendering
    // "[object Object]" in a column the reader trusts.
    const next = Array.isArray(acc) ? acc[0]?.[key] : acc[key];
    return next === undefined ? null : next;
  }, row);

/** Raw value of one field on one fetched row. */
export const readField = (row, field) => (field ? readPath(row, fieldPath(field)) : null);

/**
 * Fetched rows → one flat object per row, keyed by field key.
 *
 * Everything downstream — the table, the totals, the CSV — reads this shape, so
 * the embed-unwrapping happens exactly once.
 */
export const shapeRows = (rows, source, fieldKeys) => {
  const fields = fieldKeys.map((k) => fieldByKey(source, k)).filter(Boolean);
  return (rows || []).map((row, i) => {
    const out = { __id: row?.id ?? `row-${i}` };
    fields.forEach((f) => { out[f.key] = readField(row, f); });
    return out;
  });
};

// ─── FORMATTING ──────────────────────────────────────────────────────────────
const MONTH_FMT = { month: 'short', year: 'numeric' };
const DATE_FMT  = { day: '2-digit', month: 'short', year: 'numeric' };

/**
 * A cell as the reader should see it.
 *
 * `forExport` drops the thousands separators and the currency prefix from
 * numbers: a CSV cell of "KES 1,250" is text to a spreadsheet, and a column of
 * text does not add up. The screen wants the money to look like money; the file
 * wants it to BE a number.
 */
export const formatCell = (value, type, { forExport = false } = {}) => {
  if (value === null || value === undefined || value === '') return forExport ? '' : '—';

  switch (type) {
    case 'money': {
      const n = Number(value);
      if (!Number.isFinite(n)) return forExport ? '' : '—';
      return forExport ? n : `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return forExport ? '' : '—';
      return forExport ? n : n.toLocaleString('en-KE', { maximumFractionDigits: 2 });
    }
    case 'boolean':
      return value === true ? 'Yes' : value === false ? 'No' : forExport ? '' : '—';
    case 'month': {
      const [y, m] = String(value).split('-').map(Number);
      if (!y || !m) return String(value);
      return forExport ? String(value).slice(0, 7)
        : new Date(y, m - 1, 1).toLocaleDateString('en-GB', MONTH_FMT);
    }
    case 'date':
    case 'datetime': {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);
      if (forExport) return type === 'datetime' ? d.toISOString() : toDayKey(d);
      const base = d.toLocaleDateString('en-GB', DATE_FMT);
      return type === 'datetime'
        ? `${base} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
        : base;
    }
    default:
      return String(value);
  }
};

/** Turn a stored enum value back into the label the user picked it by. */
export const cellLabel = (value, field) => {
  if (field?.options && value !== null && value !== undefined) {
    const hit = field.options.find((o) => o.value === value);
    // Unknown values are titled and KEPT, never blanked — a legacy row that
    // renders as nothing is a row the reader thinks was never written. Same
    // rule as sourceMeta in crmVocabulary.
    if (hit) return hit.label;
    return String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return formatCell(value, field?.type);
};

// ─── AGGREGATION ─────────────────────────────────────────────────────────────
/**
 * The numbers in one column, skipping every cell that has none.
 *
 * The blank check comes BEFORE Number(), because Number(null) and Number('')
 * are both 0 and 0 is finite. Without it an average silently counts every empty
 * cell as a zero and reports a figure that is too low — a payroll column where
 * half the rows predate a field would average to nonsense that still looks like
 * money.
 */
const numbersOf = (rows, key) =>
  rows
    .filter((r) => !isBlank(r[key]))
    .map((r) => Number(r[key]))
    .filter((n) => Number.isFinite(n));

export const applyAggregate = (rows, key, fn) => {
  if (fn === 'count') return rows.length;
  const nums = numbersOf(rows, key);
  if (nums.length === 0) return null;
  switch (fn) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    default:    return null;
  }
};

/**
 * The bucket a row falls into for a group key.
 *
 * Dates bucket by the chosen granularity, which is the whole point of grouping
 * on one: 4,000 payments grouped by exact timestamp is 4,000 groups. NULL gets
 * its own named bucket rather than being dropped, because "how many have no
 * source recorded" is usually the most interesting row in the report.
 */
export const groupKeyOf = (value, field, granularity) => {
  if (value === null || value === undefined || value === '') {
    return { key: '__none__', label: 'Not recorded', sort: '' };
  }
  if (field && isTemporalType(field.type)) {
    if (field.type === 'month') {
      const key = String(value).slice(0, 7);
      return { key, label: formatCell(key, 'month'), sort: key };
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { key: String(value), label: String(value), sort: String(value) };
    if (granularity === 'year') {
      const key = String(d.getFullYear());
      return { key, label: key, sort: key };
    }
    if (granularity === 'day') {
      const key = toDayKey(d);
      return { key, label: formatCell(key, 'date'), sort: key };
    }
    const key = toMonthKey(d);
    return { key, label: formatCell(key, 'month'), sort: key };
  }
  const key = String(value);
  return { key, label: cellLabel(value, field), sort: key };
};

/**
 * Grouped output: one row per bucket, with the aggregate columns beside it.
 *
 * This runs over rows already fetched, which is only correct if EVERY matching
 * row was fetched. That is why the runner reads through fetchAllRows and throws
 * rather than truncating: an average over the first page is not an average, and
 * it is indistinguishable from a real one on the screen.
 */
export const groupReport = (shaped, source, { groupBy, aggregates }) => {
  const field = fieldByKey(source, groupBy.field);
  const buckets = new Map();

  shaped.forEach((row) => {
    const { key, label, sort } = groupKeyOf(row[groupBy.field], field, groupBy.granularity);
    if (!buckets.has(key)) buckets.set(key, { key, label, sort, rows: [] });
    buckets.get(key).rows.push(row);
  });

  const columns = [
    { key: '__group__', label: field?.label || 'Group', type: 'text' },
    ...aggregates.map((a) => {
      const f = fieldByKey(source, a.field);
      return {
        key: `${a.fn}__${a.field}`,
        label: a.fn === 'count' ? 'Rows' : `${a.fn === 'avg' ? 'Average' : a.fn === 'sum' ? 'Total' : a.fn === 'min' ? 'Lowest' : 'Highest'} ${f?.label || a.field}`,
        type: a.fn === 'count' ? 'number' : (f?.type || 'number'),
        numeric: true,
      };
    }),
  ];

  const rows = Array.from(buckets.values())
    .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
    .map((bucket) => {
      const out = { __id: bucket.key, __group__: bucket.label, __count: bucket.rows.length };
      aggregates.forEach((a) => { out[`${a.fn}__${a.field}`] = applyAggregate(bucket.rows, a.field, a.fn); });
      return out;
    });

  // The totals line is computed over ALL rows, not by adding up the group
  // figures — summing a column of averages is not the overall average.
  const totals = { __group__: `${rows.length} group${rows.length === 1 ? '' : 's'}` };
  aggregates.forEach((a) => { totals[`${a.fn}__${a.field}`] = applyAggregate(shaped, a.field, a.fn); });

  return { columns, rows, totals, rowCount: shaped.length };
};

/** Detail output: the picked columns, plus a total under each numeric one. */
export const detailReport = (shaped, source, { fields }) => {
  const columns = fields.map((key) => {
    const f = fieldByKey(source, key);
    return {
      key,
      label: f?.label || key,
      type: f?.type || 'text',
      options: f?.options || null,
      numeric: isNumericType(f?.type),
    };
  });

  const totals = {};
  let hasTotal = false;
  columns.forEach((c) => {
    if (!c.numeric) return;
    totals[c.key] = applyAggregate(shaped, c.key, 'sum');
    hasTotal = true;
  });

  return {
    columns,
    rows: shaped,
    totals: hasTotal ? totals : null,
    rowCount: shaped.length,
  };
};

/** Fetched rows → the finished report, grouped or detailed. */
export const buildReport = (rows, source, definition) => {
  const selectKeys = Array.from(new Set([
    ...definition.fields,
    ...(definition.groupBy ? [definition.groupBy.field] : []),
    ...definition.aggregates.map((a) => a.field),
  ]));
  const shaped = shapeRows(rows, source, selectKeys);

  return definition.groupBy
    ? groupReport(shaped, source, definition)
    : detailReport(shaped, source, definition);
};

// ─── EXPORT ──────────────────────────────────────────────────────────────────
/**
 * The report as rows of plain objects keyed by column LABEL, for downloadCSV.
 *
 * Labels rather than field keys because the file is read by a person, and
 * "Paid on" is what they saw on screen. toCSV takes the column order from the
 * `columns` argument, so the file matches the table rather than depending on
 * key order.
 */
export const toExportRows = (report) => ({
  columns: report.columns.map((c) => c.label),
  rows: report.rows.map((row) => {
    const out = {};
    report.columns.forEach((c) => {
      const value = row[c.key];
      out[c.label] = c.options
        ? cellLabel(value, c)
        : formatCell(value, c.type, { forExport: true });
    });
    return out;
  }),
});

// ─── PROVENANCE ──────────────────────────────────────────────────────────────
/**
 * One line per filter, in words.
 *
 * Printed at the head of the report and written into the export, because a
 * table of numbers with no statement of what was excluded is a table that gets
 * quoted out of context. Anyone holding the CSV can see it was "Status is any
 * of Completed" and not the whole book.
 */
export const describeFilter = (source, filter) => {
  const field = fieldByKey(source, filter.field);
  const op = operatorByValue(filter.operator);
  if (!field || !op) return null;

  const label = (v) => cellLabel(v, field);
  const values = filter.values || [];

  if (op.arity === 0) return `${field.label} ${op.label}`;
  if (op.arity === 'list') {
    if (values.length === 0) return null;
    return `${field.label} ${op.label} ${values.map(label).join(', ')}`;
  }
  if (op.arity === 2) {
    if (isBlank(values[0]) || isBlank(values[1])) return null;
    return `${field.label} ${op.label} ${label(values[0])} and ${label(values[1])}`;
  }
  if (isBlank(values[0])) return null;
  return `${field.label} ${op.label} ${label(values[0])}`;
};

/** The whole "what this report covers" statement. */
export const describeDefinition = (source, definition, range) => {
  const lines = [];
  if (range) {
    const dateField = fieldByKey(source, source.dateField)
      || (source.fields || []).find((f) => f.column === source.dateField);
    const name = dateField?.label || 'Date';
    if (range.from && range.to)  lines.push(`${name} between ${formatCell(range.from, 'date')} and ${formatCell(range.to, 'date')}`);
    else if (range.from)         lines.push(`${name} from ${formatCell(range.from, 'date')}`);
    else if (range.to)           lines.push(`${name} up to ${formatCell(range.to, 'date')}`);
  }
  (definition.filters || []).forEach((f) => {
    const line = describeFilter(source, f);
    if (line) lines.push(line);
  });
  return lines;
};

export default {
  resolvePeriod, periodOps, filterOps, buildSelect,
  emptyDefinition, validateDefinition, buildQueryPlan, applyOps,
  shapeRows, readField, formatCell, cellLabel,
  applyAggregate, groupKeyOf, groupReport, detailReport, buildReport,
  toExportRows, describeFilter, describeDefinition, stripUnavailable,
};
