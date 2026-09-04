/**
 * An in-memory stand-in for the Supabase client, good enough to run whole
 * workflows through the real hooks.
 *
 * The existing tests in this repo mock `supabase.from()` per test with a
 * builder that returns canned rows. That proves a query was *issued*, but it
 * cannot prove a workflow: it never stores anything, so "the row's status is
 * now approved" is not a question it can answer. Payment approval is exactly
 * the case where that matters — the thing under test is the state a row ends
 * up in and the audit record written beside it, across two different hooks.
 *
 * So this double keeps real tables in memory and mutates them. Reads see what
 * writes did, which is what makes an end-to-end assertion possible.
 *
 * Supported surface (only what the hooks under test actually call):
 *   from(t).select(cols, { count, head }) .eq .neq .in .not .gte .lte
 *          .order .limit .range .maybeSingle .single
 *   from(t).insert(rowOrRows).select().maybeSingle()
 *   from(t).update(patch).eq/.in
 *   from(t).delete().eq
 *   auth.getUser() / auth.getSession()
 *   channel(name).on().subscribe(), removeChannel()
 *   rpc(name, args)
 *
 * Query builders are thenable, like PostgREST's, so `await` works at any point
 * in the chain.
 */

let idSeq = 0;
const nextId = (table) => `${table}_${String(++idSeq).padStart(3, '0')}`;

/** Reset ids so assertions on generated ids are stable per test. */
export const resetFakeIds = () => { idSeq = 0; };

const clone = (row) => JSON.parse(JSON.stringify(row));

/**
 * @param {object}  opts
 * @param {object}  opts.tables   seed rows keyed by table name
 * @param {object|Function} opts.user  the row auth.getUser() reports. Pass a
 *                                function when the signed-in user changes over
 *                                the life of the client — a workflow that hands
 *                                off from an agent to an approver needs the
 *                                audit rows attributed to whoever is acting.
 * @param {object}  opts.failures inject errors, keyed `table.op` or `table.*`,
 *                                e.g. { 'agent_wallets.update': { code: 'PGRST204',
 *                                       message: "Could not find the 'status' column" } }
 */
export const createFakeSupabase = ({ tables = {}, user = { id: 'user_super_admin' }, failures = {} } = {}) => {
  const db = {};
  Object.entries(tables).forEach(([name, rows]) => { db[name] = rows.map(clone); });

  const rowsOf = (name) => (db[name] || (db[name] = []));
  const currentUser = () => (typeof user === 'function' ? user() : user);

  /** Every mutation that reached the "database", in order. */
  const writes = [];

  const failureFor = (table, op) => failures[`${table}.${op}`] || failures[`${table}.*`] || null;

  function from(name) {
    const preds = [];
    let op = 'select';
    let values = null;
    let head = false;
    let wantCount = false;
    let orderKey = null;
    let orderAsc = true;
    let limitN = null;
    let sliceFrom = null;
    let sliceTo = null;
    let single = null; // 'maybe' | 'one'

    const matching = () => rowsOf(name).filter((r) => preds.every((p) => p(r)));

    const execute = () => {
      const failure = failureFor(name, op);
      if (failure) return { data: null, count: null, error: failure };

      if (op === 'insert') {
        const created = values.map((v) => ({
          id: v.id ?? nextId(name),
          created_at: v.created_at ?? new Date().toISOString(),
          ...v,
        }));
        rowsOf(name).push(...created);
        writes.push({ table: name, op: 'insert', rows: created.map(clone) });
        const data = created.map(clone);
        return { data: single ? (data[0] ?? null) : data, count: null, error: null };
      }

      if (op === 'update') {
        const hit = matching();
        hit.forEach((r) => Object.assign(r, values));
        writes.push({ table: name, op: 'update', patch: clone(values), ids: hit.map((r) => r.id) });
        const data = hit.map(clone);
        return { data: single ? (data[0] ?? null) : data, count: null, error: null };
      }

      if (op === 'delete') {
        const hit = matching();
        const ids = new Set(hit.map((r) => r.id));
        db[name] = rowsOf(name).filter((r) => !ids.has(r.id));
        writes.push({ table: name, op: 'delete', ids: [...ids] });
        return { data: hit.map(clone), count: null, error: null };
      }

      // select
      const all = matching();
      const total = all.length;
      if (head) return { data: null, count: total, error: null };

      let out = all.map(clone);
      if (orderKey) {
        out.sort((a, b) => {
          const x = a[orderKey], y = b[orderKey];
          if (x === y) return 0;
          return (x > y ? 1 : -1) * (orderAsc ? 1 : -1);
        });
      }
      if (sliceFrom !== null) out = out.slice(sliceFrom, sliceTo + 1);
      if (limitN !== null) out = out.slice(0, limitN);

      if (single === 'one' && out.length !== 1) {
        return { data: null, count: null, error: { code: 'PGRST116', message: 'Results contain 0 rows' } };
      }
      return {
        data: single ? (out[0] ?? null) : out,
        count: wantCount ? total : null,
        error: null,
      };
    };

    const builder = {
      select(_cols, opts = {}) {
        if (op === 'select') { head = !!opts.head; wantCount = opts.count === 'exact'; }
        return builder;
      },
      insert(v) { op = 'insert'; values = Array.isArray(v) ? v : [v]; return builder; },
      update(v) { op = 'update'; values = v; return builder; },
      delete()  { op = 'delete'; return builder; },

      eq(col, val)  { preds.push((r) => r[col] === val); return builder; },
      neq(col, val) { preds.push((r) => r[col] !== val); return builder; },
      in(col, vals) { preds.push((r) => (vals || []).includes(r[col])); return builder; },
      gte(col, val) { preds.push((r) => r[col] >= val); return builder; },
      lte(col, val) { preds.push((r) => r[col] <= val); return builder; },
      is(col, val)  { preds.push((r) => (r[col] ?? null) === val); return builder; },
      not(col, operator, val) {
        if (operator === 'eq') preds.push((r) => r[col] !== val);
        else if (operator === 'is') preds.push((r) => (r[col] ?? null) !== val);
        return builder;
      },
      or() { return builder; },

      order(col, opts = {}) { orderKey = col; orderAsc = opts.ascending !== false; return builder; },
      limit(n) { limitN = n; return builder; },
      range(a, b) { sliceFrom = a; sliceTo = b; return builder; },

      maybeSingle() { single = 'maybe'; return builder; },
      single()      { single = 'one';   return builder; },

      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      catch(fn) { return Promise.resolve(execute()).catch(fn); },
      finally(fn) { return Promise.resolve(execute()).finally(fn); },
    };

    return builder;
  }

  const channels = [];
  const channel = (name) => {
    const ch = { name, handlers: [], subscribed: false,
      on(_evt, _filter, handler) { this.handlers.push(handler); return this; },
      subscribe(cb) { this.subscribed = true; cb?.('SUBSCRIBED'); return this; },
    };
    channels.push(ch);
    return ch;
  };

  return {
    from,
    channel,
    removeChannel: (ch) => { const i = channels.indexOf(ch); if (i >= 0) channels.splice(i, 1); },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getUser:    async () => ({ data: { user: currentUser() }, error: null }),
      getSession: async () => {
        const u = currentUser();
        return { data: { session: u ? { user: u } : null }, error: null };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },

    /* ---- test-only handles ---- */
    _db: db,
    _writes: writes,
    _channels: channels,
    _rows: (name) => rowsOf(name).map(clone),
    _row: (name, id) => { const r = rowsOf(name).find((x) => x.id === id); return r ? clone(r) : null; },
    _fail: (key, error) => { failures[key] = error; },
    _healAll: () => { Object.keys(failures).forEach((k) => delete failures[k]); },
  };
};

export default createFakeSupabase;
