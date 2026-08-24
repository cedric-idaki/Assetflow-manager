import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Server-side pagination + search for a Supabase table.
 *
 * WHY THIS EXISTS
 *
 * Every list in this app used to be fetched as `.limit(CAP)` and then filtered
 * in the browser. That is wrong in a way users cannot see: a sacco with 600
 * members got the newest 500, and the search box filtered only those 500. The
 * missing 100 were not "on another page" — they were invisible and
 * unsearchable, with no error and no notice. From the treasurer's seat that
 * reads as "the system lost my members", which is the worst kind of bug: it
 * looks like data loss and destroys trust in every other number on screen.
 *
 * This hook moves both the windowing and the searching into Postgres, so the
 * rows on screen are a true page of the whole book and the search covers all
 * of it. `total` is the real row count, which lets the UI state plainly how
 * many records exist rather than implying the page is everything.
 *
 * WHAT IT OWNS
 *
 * The select, the exact count, the ordering and the range are all built here
 * so a caller cannot forget the count (which is what makes an honest "of N"
 * possible) or apply a range twice. Callers contribute only the parts that are
 * genuinely theirs: which table, which columns, which tenant filter.
 *
 * @param {object}   opts
 * @param {string}   opts.table          table name
 * @param {string}   [opts.columns]      PostgREST select list, joins included
 * @param {Function} [opts.applyFilters] (query) => query — tenant/status filters.
 *                                       Kept in a ref, so it does NOT need to be
 *                                       memoised by the caller.
 * @param {object}   [opts.order]        { column, ascending }
 * @param {string[]} [opts.searchColumns] columns matched case-insensitively
 * @param {string}   [opts.search]       raw user input; debounced internally
 * @param {number}   [opts.pageSize]
 * @param {boolean}  [opts.enabled]      false while auth/tenant is unresolved
 * @param {Array}    [opts.deps]         values that should reset to page 1 and
 *                                       refetch (e.g. a status filter)
 */

/** How long to wait after the last keystroke before querying. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Make a user's search term safe to embed in a PostgREST `or=(...)` filter.
 *
 * The `or` filter is a comma-separated, parenthesised mini-language, so a term
 * containing `,` or `)` does not merely fail to match — it changes the shape of
 * the filter and can widen it to rows the user should never see. `%` and `_`
 * are LIKE wildcards and `*` is PostgREST's alias for `%`, so those are escaped
 * to keep a search for "50%" from matching everything.
 *
 * Exported for direct testing: this is security-relevant, not cosmetic.
 */
export const sanitizeSearchTerm = (term) => {
  if (typeof term !== 'string') return '';
  return term
    .trim()
    // Structural characters in the or() grammar. Removed, not escaped —
    // PostgREST offers no escape for them inside an unquoted filter value.
    .replace(/[,()\\]/g, ' ')
    // LIKE / PostgREST wildcards, neutralised so they match literally.
    .replace(/[%_*]/g, (m) => `\\${m}`)
    .replace(/\s+/g, ' ')
    .trim();
};

export const usePagedQuery = ({
  table,
  columns = '*',
  applyFilters,
  order = { column: 'created_at', ascending: false },
  searchColumns = [],
  search = '',
  pageSize = 25,
  enabled = true,
  deps = [],
}) => {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(0);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // Debounced copy of `search`, so typing does not fire a query per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  // Refs so callers never have to memoise. Same reasoning as useAuthScopedLoader:
  // correctness should not depend on a caller remembering useCallback.
  const filtersRef = useRef(applyFilters);
  filtersRef.current = applyFilters;
  const orderRef = useRef(order);
  orderRef.current = order;
  const searchColsRef = useRef(searchColumns);
  searchColsRef.current = searchColumns;

  /**
   * Guards against out-of-order responses. Typing "ja" then "jane" fires two
   * queries; if "ja" (the larger result) lands second, the user sees the wrong
   * rows for the term in the box. Only the newest request may write state.
   */
  const seqRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * Serialised filter values. `applyFilters` is held in a ref so callers need
   * no memoisation, which means its identity can NOT drive the refetch — this
   * key does. It has to reach fetchPage's dependency list as well as the page
   * reset below: a filter changed while already on page one moves no page
   * number, so without it the query would never re-run and the table would go
   * on showing rows the filter excludes.
   */
  const depsKey = JSON.stringify(deps);

  // A new search or filter changes which rows exist, so the current page number
  // is meaningless against the new result set. Without this, searching while on
  // page 7 lands on page 7 of 2 — an empty table that looks like "no results".
  const searchKey = `${debouncedSearch}|${depsKey}`;
  const firstKeyRef = useRef(searchKey);
  useEffect(() => {
    if (firstKeyRef.current === searchKey) return;
    firstKeyRef.current = searchKey;
    setPage(0);
  }, [searchKey]);

  const fetchPage = useCallback(async (targetPage) => {
    if (!enabled) return;
    const seq = ++seqRef.current;
    setLoading(true);

    try {
      // `count: 'exact'` rides along on the same request — PostgREST returns it
      // in the Content-Range header, so an honest total costs no extra round trip.
      let query = supabase.from(table).select(columns, { count: 'exact' });

      query = filtersRef.current ? filtersRef.current(query) : query;

      const term = sanitizeSearchTerm(debouncedSearch);
      const cols = searchColsRef.current;
      if (term && cols?.length) {
        query = query.or(cols.map((c) => `${c}.ilike.%${term}%`).join(','));
      }

      const ord = orderRef.current;
      if (ord?.column) query = query.order(ord.column, { ascending: !!ord.ascending });

      const from = targetPage * pageSize;
      const { data, count, error: qErr } = await query.range(from, from + pageSize - 1);
      if (qErr) throw qErr;

      // A slower earlier request must not overwrite a newer one's rows.
      if (seq !== seqRef.current) return;

      const totalRows = count ?? 0;

      /**
       * Deleting the only row on the last page leaves the user staring at an
       * empty table with pages beneath them. Step back one page and let the
       * next run render real rows instead of a dead end.
       */
      const lastPage = Math.max(0, Math.ceil(totalRows / pageSize) - 1);
      if (targetPage > lastPage && totalRows > 0) {
        setPage(lastPage);
        return;
      }

      setRows(data || []);
      setTotal(totalRows);
      setError(null);
    } catch (e) {
      if (seq !== seqRef.current) return;
      // Surfaced, not swallowed. A list that fails silently is indistinguishable
      // from a list that is genuinely empty, and the user acts on the wrong one.
      setError(e?.message || 'Could not load this list.');
      setRows([]);
      setTotal(0);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [enabled, table, columns, debouncedSearch, pageSize, depsKey]);

  useEffect(() => { fetchPage(page); }, [fetchPage, page]);

  const refresh = useCallback(() => fetchPage(page), [fetchPage, page]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return {
    rows,
    total,
    page,
    setPage,
    pageSize,
    pageCount,
    // 1-indexed inclusive bounds for display: "Showing 26–50 of 1,240".
    from: total === 0 ? 0 : page * pageSize + 1,
    to:   Math.min(total, (page + 1) * pageSize),
    loading,
    error,
    refresh,
    isFirst: page === 0,
    isLast:  page >= pageCount - 1,
  };
};

export default usePagedQuery;
