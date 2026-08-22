import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every query the hook builds, captured so the range/filter/search it actually
// sent is assertable rather than inferred from the rows that come back.
const sent = [];

// What the next .range() resolves with. A function so a test can vary the
// answer (and the delay) per call.
let respond = () => Promise.resolve({ data: [], count: 0, error: null });

const builder = (table) => {
  const q = { table, filters: [], or: null, order: null, range: null, count: null };
  const b = {
    select: (columns, opts) => { q.columns = columns; q.count = opts?.count ?? null; return b; },
    eq:     (c, v) => { q.filters.push([c, v]); return b; },
    or:     (f) => { q.or = f; return b; },
    order:  (c, o) => { q.order = [c, o?.ascending]; return b; },
    range:  (from, to) => {
      q.range = [from, to];
      sent.push(q);
      return respond(sent.length - 1);
    },
  };
  return b;
};

vi.mock('../lib/supabase', () => ({
  supabase: { from: (table) => builder(table) },
}));

const { usePagedQuery, sanitizeSearchTerm } = await import('./usePagedQuery');

const rowsOf = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${offset + i}`, full_name: `Member ${offset + i}` }));

beforeEach(() => {
  sent.length = 0;
  respond = () => Promise.resolve({ data: [], count: 0, error: null });
});

describe('sanitizeSearchTerm', () => {
  it('passes ordinary names through untouched', () => {
    expect(sanitizeSearchTerm('Jane Wanjiku')).toBe('Jane Wanjiku');
    expect(sanitizeSearchTerm('  MEM-001  ')).toBe('MEM-001');
  });

  // The or() filter is a comma/parenthesis grammar. A term carrying those
  // characters does not just fail to match — it restructures the filter, which
  // is how a search box turns into a way to widen a tenant-scoped query.
  it('strips the characters that would restructure a PostgREST or() filter', () => {
    expect(sanitizeSearchTerm('a,b')).toBe('a b');
    expect(sanitizeSearchTerm('x)or(1')).toBe('x or 1');
    expect(sanitizeSearchTerm('back\\slash')).toBe('back slash');
    for (const ch of [',', '(', ')', '\\']) {
      expect(sanitizeSearchTerm(`n${ch}n`)).not.toContain(ch);
    }
  });

  it('escapes LIKE wildcards so a search for "50%" is not a search for everything', () => {
    expect(sanitizeSearchTerm('50%')).toBe('50\\%');
    expect(sanitizeSearchTerm('a_b')).toBe('a\\_b');
    expect(sanitizeSearchTerm('*')).toBe('\\*');
  });

  it('is total over junk input', () => {
    expect(sanitizeSearchTerm(null)).toBe('');
    expect(sanitizeSearchTerm(undefined)).toBe('');
    expect(sanitizeSearchTerm(42)).toBe('');
    expect(sanitizeSearchTerm('   ')).toBe('');
  });
});

describe('usePagedQuery — windowing', () => {
  it('asks Postgres for one page, with an exact count for the honest total', async () => {
    respond = () => Promise.resolve({ data: rowsOf(25), count: 1240, error: null });

    const { result } = renderHook(() => usePagedQuery({
      table: 'sacco_members',
      applyFilters: (q) => q.eq('admin_id', 'admin-1'),
      pageSize: 25,
    }));

    await waitFor(() => expect(result.current.rows).toHaveLength(25));

    expect(sent[0].table).toBe('sacco_members');
    expect(sent[0].count).toBe('exact');
    expect(sent[0].filters).toEqual([['admin_id', 'admin-1']]);
    expect(sent[0].range).toEqual([0, 24]);
    expect(result.current.total).toBe(1240);
  });

  it('reports a 1-indexed inclusive row range for the readout', async () => {
    respond = () => Promise.resolve({ data: rowsOf(25, 50), count: 1240, error: null });

    const { result } = renderHook(() => usePagedQuery({ table: 't', pageSize: 25 }));
    await waitFor(() => expect(result.current.total).toBe(1240));

    act(() => result.current.setPage(2));

    await waitFor(() => expect(result.current.page).toBe(2));
    await waitFor(() => expect(sent.at(-1).range).toEqual([50, 74]));
    expect(result.current.from).toBe(51);
    expect(result.current.to).toBe(75);
    expect(result.current.pageCount).toBe(50);
  });

  it('reads an empty table as 0 of 0 rather than 1 of 0', async () => {
    const { result } = renderHook(() => usePagedQuery({ table: 't', pageSize: 25 }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.from).toBe(0);
    expect(result.current.to).toBe(0);
    expect(result.current.total).toBe(0);
    expect(result.current.pageCount).toBe(1);
  });

  // Deleting the last row of the last page used to leave the user on a page
  // that no longer exists, staring at an empty table.
  it('steps back when the requested page is past the end of a shrunken list', async () => {
    respond = () => Promise.resolve({ data: rowsOf(25), count: 1240, error: null });
    const { result } = renderHook(() => usePagedQuery({ table: 't', pageSize: 25 }));
    await waitFor(() => expect(result.current.total).toBe(1240));

    act(() => result.current.setPage(49));
    await waitFor(() => expect(result.current.page).toBe(49));

    // The list collapses to 30 rows (2 pages) while the user sits on page 50.
    respond = () => Promise.resolve({ data: rowsOf(5), count: 30, error: null });
    act(() => { result.current.refresh(); });

    await waitFor(() => expect(result.current.page).toBe(1));
  });
});

describe('usePagedQuery — search', () => {
  it('searches at the server across every named column, not the loaded page', async () => {
    respond = () => Promise.resolve({ data: rowsOf(2), count: 2, error: null });

    const { result } = renderHook(() => usePagedQuery({
      table: 'sacco_members',
      searchColumns: ['full_name', 'member_no'],
      search: 'wanjiku',
      pageSize: 25,
    }));

    await waitFor(() => expect(sent.at(-1).or).toBeTruthy());
    expect(sent.at(-1).or).toBe('full_name.ilike.%wanjiku%,member_no.ilike.%wanjiku%');
    expect(result.current.total).toBe(2);
  });

  it('sanitises the term before it reaches the filter grammar', async () => {
    renderHook(() => usePagedQuery({
      table: 't',
      searchColumns: ['full_name'],
      search: 'a,b)c',
    }));

    await waitFor(() => expect(sent.at(-1).or).toBeTruthy());
    expect(sent.at(-1).or).toBe('full_name.ilike.%a b c%');
  });

  it('omits the filter entirely when the box is empty', async () => {
    renderHook(() => usePagedQuery({ table: 't', searchColumns: ['full_name'], search: '   ' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].or).toBeNull();
  });

  // Searching from page 7 used to land on page 7 of a 2-page result: an empty
  // table that reads as "no matches" when there are plenty.
  it('returns to the first page when the search changes', async () => {
    respond = () => Promise.resolve({ data: rowsOf(25), count: 1240, error: null });

    const { result, rerender } = renderHook(
      ({ search }) => usePagedQuery({ table: 't', searchColumns: ['full_name'], search, pageSize: 25 }),
      { initialProps: { search: '' } }
    );
    await waitFor(() => expect(result.current.total).toBe(1240));

    act(() => result.current.setPage(7));
    await waitFor(() => expect(result.current.page).toBe(7));

    act(() => rerender({ search: 'jane' }));
    await waitFor(() => expect(result.current.page).toBe(0));
  });

  it('debounces so typing does not fire a query per keystroke', async () => {
    const { rerender } = renderHook(
      ({ search }) => usePagedQuery({ table: 't', searchColumns: ['full_name'], search }),
      { initialProps: { search: 'j' } }
    );
    rerender({ search: 'ja' });
    rerender({ search: 'jan' });
    act(() => rerender({ search: 'jane' }));

    await waitFor(() => expect(sent.at(-1).or).toBe('full_name.ilike.%jane%'));
    // One query for the initial empty-search mount, one for the settled term —
    // not one per character.
    expect(sent.length).toBeLessThanOrEqual(2);
  });
});

describe('usePagedQuery — failure and ordering', () => {
  it('surfaces an error instead of rendering as an empty list', async () => {
    respond = () => Promise.resolve({ data: null, count: null, error: { message: 'permission denied' } });

    const { result } = renderHook(() => usePagedQuery({ table: 't' }));
    await waitFor(() => expect(result.current.error).toBe('permission denied'));

    // The distinction that matters: failed, not empty.
    expect(result.current.rows).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // "ja" returns thousands of rows and resolves slowly; "jane" returns three and
  // resolves fast. Whoever lands last must not win — only the newest may write.
  it('ignores a stale response that lands after a newer one', async () => {
    respond = (i) =>
      i === 0
        ? new Promise((r) => setTimeout(() => r({ data: rowsOf(25), count: 999, error: null }), 60))
        : Promise.resolve({ data: rowsOf(3), count: 3, error: null });

    const { result, rerender } = renderHook(
      ({ search }) => usePagedQuery({ table: 't', searchColumns: ['full_name'], search }),
      { initialProps: { search: 'ja' } }
    );

    act(() => rerender({ search: 'jane' }));

    await waitFor(() => expect(result.current.total).toBe(3));
    // Give the slow first request time to land and try to overwrite.
    await new Promise((r) => setTimeout(r, 100));
    expect(result.current.total).toBe(3);
    expect(result.current.rows).toHaveLength(3);
  });
});
