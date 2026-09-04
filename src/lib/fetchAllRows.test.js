import { describe, it, expect } from 'vitest';
import { fetchAllRows } from './fetchAllRows';

// Records the ranges asked for, so "did it actually page?" is testable rather
// than inferred from the rows that come back.
const fakeTable = (total, { failAt = null } = {}) => {
  const ranges = [];
  const build = () => ({
    range: (from, to) => {
      ranges.push([from, to]);
      if (failAt !== null && ranges.length > failAt) {
        return Promise.resolve({ data: null, error: { message: 'connection lost' } });
      }
      const rows = Array.from(
        { length: Math.max(0, Math.min(to + 1, total) - from) },
        (_, i) => ({ id: from + i })
      );
      return Promise.resolve({ data: rows, error: null });
    },
  });
  return { build, ranges };
};

describe('fetchAllRows', () => {
  it('returns everything a short first page already covers, in one request', async () => {
    const t = fakeTable(120);
    const rows = await fetchAllRows(t.build, { chunkSize: 1000 });

    expect(rows).toHaveLength(120);
    expect(t.ranges).toEqual([[0, 999]]);
  });

  it('walks the ranges until the set is exhausted', async () => {
    const t = fakeTable(2500);
    const rows = await fetchAllRows(t.build, { chunkSize: 1000 });

    expect(rows).toHaveLength(2500);
    expect(rows[0].id).toBe(0);
    expect(rows.at(-1).id).toBe(2499);
    expect(t.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  // An exactly-full last page is indistinguishable from a full one with more
  // behind it, so it costs one extra request to be certain nothing is left.
  it('confirms the end when the last page comes back exactly full', async () => {
    const t = fakeTable(2000);
    const rows = await fetchAllRows(t.build, { chunkSize: 1000 });

    expect(rows).toHaveLength(2000);
    expect(t.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('handles an empty table', async () => {
    const t = fakeTable(0);
    expect(await fetchAllRows(t.build, { chunkSize: 1000 })).toEqual([]);
    expect(t.ranges).toEqual([[0, 999]]);
  });

  // The whole point of this helper is completeness, so a partial result must
  // never be returned as though it were the whole set.
  it('throws rather than returning a partial set when a page fails', async () => {
    const t = fakeTable(5000, { failAt: 1 });
    await expect(fetchAllRows(t.build, { chunkSize: 1000 })).rejects.toThrow(/connection lost/);
  });

  it('throws rather than returning a partial set when the ceiling is reached', async () => {
    const t = fakeTable(100000);
    await expect(fetchAllRows(t.build, { chunkSize: 1000, ceiling: 3000 }))
      .rejects.toThrow(/Refusing to load more than/);
  });

  it('asks for a fresh query each page, since a builder cannot be re-ranged', async () => {
    const seen = new Set();
    let calls = 0;
    const buildQuery = () => {
      const id = ++calls;
      seen.add(id);
      return {
        range: (from, to) => Promise.resolve({
          data: Array.from({ length: Math.max(0, Math.min(to + 1, 1500) - from) }, () => ({ id })),
          error: null,
        }),
      };
    };

    await fetchAllRows(buildQuery, { chunkSize: 1000 });
    expect(seen.size).toBe(2);
  });
});
