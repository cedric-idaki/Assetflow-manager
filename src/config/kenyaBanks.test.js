/**
 * The Branch dropdown is keyed by bank name, so the two lists must agree
 * exactly: a bank with no entry offers no branches, and an entry under a
 * misspelt name is never shown at all. Neither failure makes any noise.
 */
import { describe, it, expect } from 'vitest';
import { KENYA_BANKS, BRANCHES_BY_BANK, branchesFor } from './kenyaBanks';

describe('kenyaBanks', () => {
  it('has a non-empty branch list for every bank', () => {
    for (const bank of KENYA_BANKS) {
      expect(branchesFor(bank).length, bank).toBeGreaterThan(0);
    }
  });

  it('keys branches only by banks that exist', () => {
    expect(Object.keys(BRANCHES_BY_BANK).sort()).toEqual([...KENYA_BANKS].sort());
  });

  it('lists each branch once, alphabetically', () => {
    for (const [bank, branches] of Object.entries(BRANCHES_BY_BANK)) {
      expect(new Set(branches).size, bank).toBe(branches.length);
      expect(branches, bank).toEqual([...branches].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('returns no branches for an unknown or empty bank', () => {
    expect(branchesFor('')).toEqual([]);
    expect(branchesFor('Not A Bank')).toEqual([]);
  });
});
