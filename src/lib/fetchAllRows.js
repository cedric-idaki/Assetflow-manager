/**
 * Reads every row a query matches, a page at a time.
 *
 * WHY THIS EXISTS
 *
 * Once a list is paged for display, two jobs still need the WHOLE set and
 * quietly broke when they were fed the on-screen array instead:
 *
 *   • Export. "Export" on a paged table that writes 25 rows to a CSV named
 *     sacco_contributions.csv is worse than no export — the file looks
 *     complete and is not.
 *   • The journal sync. previewOperations() proposes the postings that the
 *     operational tables imply but the ledger does not carry yet. Fed a capped
 *     array it silently proposes nothing for anything older than the cap, so
 *     those transactions can never be posted and the books stay short.
 *
 * Postgres and PostgREST both cap what one request will return, so "all rows"
 * has to be assembled from ranges. This is deliberately NOT what the UI uses
 * to render — it is for the moments where completeness matters more than
 * latency, and the caller is expected to show a progress or busy state.
 *
 * @param {() => object} buildQuery returns a FRESH Supabase query each call —
 *        a builder cannot be re-ranged once awaited, so this must be a factory,
 *        not a query.
 * @param {object}  [opts]
 * @param {number}  [opts.chunkSize] rows per request
 * @param {number}  [opts.ceiling]   hard stop, so a runaway table cannot hang
 *        the tab forever. Reaching it throws rather than returning a partial
 *        set that would look complete — the whole point here is completeness.
 */
export const fetchAllRows = async (buildQuery, { chunkSize = 1000, ceiling = 100000 } = {}) => {
  const rows = [];

  for (let from = 0; from < ceiling; from += chunkSize) {
    const { data, error } = await buildQuery().range(from, from + chunkSize - 1);
    if (error) throw error;

    const batch = data || [];
    rows.push(...batch);

    // A short page means the end of the set. An exactly-full page is ambiguous,
    // so it costs one more request to be sure.
    if (batch.length < chunkSize) return rows;
  }

  throw new Error(
    `Refusing to load more than ${ceiling.toLocaleString('en-KE')} rows at once. ` +
    'Narrow the date range and try again.'
  );
};

export default fetchAllRows;
