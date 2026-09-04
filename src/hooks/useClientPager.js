import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Paginates a list the app already holds in memory.
 *
 * WHEN TO USE THIS INSTEAD OF usePagedQuery
 *
 * Two shapes of table live in this app and they want opposite treatment:
 *
 *   • Dimension tables — sacco_members, loan products, contribution types.
 *     Bounded by the size of the tenant, and everything else joins to them:
 *     twenty panels resolve a member_id to a name out of the same array. These
 *     are fetched in FULL and paged here, in the browser. Paging them at the
 *     server would blank out every one of those lookups.
 *
 *   • Ledger tables — contributions, share transactions, audit trails. They
 *     grow forever, are never used as a lookup, and must be paged at the
 *     server with usePagedQuery.
 *
 * So this hook exists to keep a long roster renderable without breaking the
 * lookups that depend on having the whole roster. It solves a DOM problem
 * (two thousand <tr> nodes is unusable), not a bandwidth one — which is why
 * search here can stay instant and client-side.
 *
 * @param {Array}  items    the full, already-filtered list
 * @param {number} pageSize rows per page
 * @param {*}      resetKey a value that means "this is a different list now"
 *                          — typically the search term. See below.
 */
export const useClientPager = (items, pageSize = 25, resetKey = null) => {
  const [page, setPage] = useState(0);

  const list  = useMemo(() => items || [], [items]);
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  /**
   * A shrinking list has two very different causes and they want opposite
   * landings, which the item array alone cannot distinguish:
   *
   *   • The user searched. They want the FIRST matches — landing them on the
   *     tail of the result set is disorienting and hides the best matches.
   *   • A row was deleted. They want to stay where they were.
   *
   * So the caller names the thing that means "different list" and a change to
   * it goes to page one; everything else just clamps into range.
   */
  const keyRef = useRef(resetKey);
  useEffect(() => {
    if (keyRef.current === resetKey) return;
    keyRef.current = resetKey;
    setPage(0);
  }, [resetKey]);

  /**
   * Deleting the last row of the last page would otherwise leave the user on a
   * page that no longer exists — an empty table that reads as "no results".
   *
   * Functional, not `setPage(pageCount - 1)`: a reset and a clamp can land in
   * the same commit, and a positional update would read the pre-reset page and
   * overwrite the reset, dropping a fresh search on its last page instead of
   * its first.
   */
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const safePage = Math.min(page, pageCount - 1);

  const rows = useMemo(
    () => list.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [list, safePage, pageSize]
  );

  return {
    rows,
    total,
    page: safePage,
    setPage,
    pageSize,
    pageCount,
    // 1-indexed inclusive bounds, matching usePagedQuery so both drive the
    // same <Pagination> component.
    from: total === 0 ? 0 : safePage * pageSize + 1,
    to:   Math.min(total, (safePage + 1) * pageSize),
  };
};

export default useClientPager;
