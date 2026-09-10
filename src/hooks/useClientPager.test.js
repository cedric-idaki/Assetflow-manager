import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useClientPager } from './useClientPager';

const list = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }));

describe('useClientPager', () => {
  it('slices the first page and reports the whole list as the total', () => {
    const { result } = renderHook(() => useClientPager(list(600), 25));

    expect(result.current.rows).toHaveLength(25);
    expect(result.current.rows[0].id).toBe('m0');
    // The number that matters: 600, not the 25 on screen and not a 500 cap.
    expect(result.current.total).toBe(600);
    expect(result.current.pageCount).toBe(24);
    expect(result.current.from).toBe(1);
    expect(result.current.to).toBe(25);
  });

  it('slices a middle page and reports its true row range', () => {
    const { result } = renderHook(() => useClientPager(list(600), 25));

    act(() => result.current.setPage(3));

    expect(result.current.rows[0].id).toBe('m75');
    expect(result.current.rows).toHaveLength(25);
    expect(result.current.from).toBe(76);
    expect(result.current.to).toBe(100);
  });

  it('gives the last page only the rows that remain', () => {
    const { result } = renderHook(() => useClientPager(list(605), 25));

    act(() => result.current.setPage(24));

    expect(result.current.rows).toHaveLength(5);
    expect(result.current.from).toBe(601);
    expect(result.current.to).toBe(605);
  });

  // Filtering while deep in the list used to leave the user on a page beyond
  // the end of the new result — an empty table that reads as "no matches".
  it('follows a shrinking list back to its last page', async () => {
    const { result, rerender } = renderHook(({ items }) => useClientPager(items, 25), {
      initialProps: { items: list(600) },
    });

    act(() => result.current.setPage(20));
    expect(result.current.page).toBe(20);

    rerender({ items: list(30) });

    await waitFor(() => expect(result.current.page).toBe(1));
    expect(result.current.rows).toHaveLength(5);
  });

  // A changed reset key means "this is a different list", which is a different
  // event from "the same list got shorter" and wants the opposite landing.
  it('goes to the first page when the reset key changes', async () => {
    const { result, rerender } = renderHook(
      ({ items, key }) => useClientPager(items, 25, key),
      { initialProps: { items: list(600), key: '' } }
    );

    act(() => result.current.setPage(20));
    expect(result.current.page).toBe(20);

    rerender({ items: list(99), key: 'jane' });

    await waitFor(() => expect(result.current.page).toBe(0));
    expect(result.current.rows[0].id).toBe('m0');
  });

  // The ordering trap: a reset and a clamp land in the same commit, and a
  // positional clamp would read the pre-reset page and undo the reset.
  it('lands on the first page, not the last, when the key and the length change together', async () => {
    const { result, rerender } = renderHook(
      ({ items, key }) => useClientPager(items, 25, key),
      { initialProps: { items: list(600), key: '' } }
    );

    act(() => result.current.setPage(23));
    rerender({ items: list(99), key: 'search' });

    await waitFor(() => expect(result.current.page).toBe(0));
    expect(result.current.from).toBe(1);
  });

  it('stays put when the list changes but the key does not', async () => {
    const { result, rerender } = renderHook(
      ({ items, key }) => useClientPager(items, 25, key),
      { initialProps: { items: list(600), key: 'same' } }
    );

    act(() => result.current.setPage(4));
    rerender({ items: list(599), key: 'same' });

    await waitFor(() => expect(result.current.rows).toHaveLength(25));
    expect(result.current.page).toBe(4);
  });

  it('handles an empty list without claiming a first row', () => {
    const { result } = renderHook(() => useClientPager([], 25));

    expect(result.current.rows).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.from).toBe(0);
    expect(result.current.to).toBe(0);
    expect(result.current.pageCount).toBe(1);
  });

  it('treats a missing list as empty rather than throwing', () => {
    const { result } = renderHook(() => useClientPager(undefined, 25));
    expect(result.current.rows).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('keeps a list that fits on one page free of paging', () => {
    const { result } = renderHook(() => useClientPager(list(12), 25));
    expect(result.current.pageCount).toBe(1);
    expect(result.current.rows).toHaveLength(12);
    expect(result.current.to).toBe(12);
  });
});
