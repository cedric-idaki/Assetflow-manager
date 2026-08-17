import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// A stand-in for AuthContext whose current user the test drives directly.
let currentUser = null;
const useAuth = vi.fn(() => ({ user: currentUser }));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: (...args) => useAuth(...args),
}));

const { useAuthScopedLoader } = await import('./useAuthScopedLoader');

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const load  = vi.fn();
const reset = vi.fn();

const Probe = () => {
  useAuthScopedLoader(load, reset);
  return null;
};

// Re-renders the same mounted tree after changing who is signed in.
const renderWithUser = (user) => {
  currentUser = user ? { id: user } : null;
  return render(<Probe />);
};

const signIn = (rerender, user) => {
  currentUser = user ? { id: user } : null;
  act(() => { rerender(<Probe />); });
};

beforeEach(() => {
  load.mockReset();
  reset.mockReset();
  currentUser = null;
});

describe('useAuthScopedLoader', () => {
  it('does not fetch while nobody is signed in', () => {
    renderWithUser(null);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads once when a user signs in', () => {
    const { rerender } = renderWithUser(null);
    signIn(rerender, USER_A);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not re-fetch on an unrelated re-render', () => {
    const { rerender } = renderWithUser(USER_A);
    expect(load).toHaveBeenCalledTimes(1);
    signIn(rerender, USER_A);
    signIn(rerender, USER_A);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('clears the previous user\'s data BEFORE loading the next user\'s', () => {
    const order = [];
    load.mockImplementation(() => order.push('load'));
    reset.mockImplementation(() => order.push('reset'));

    const { rerender } = renderWithUser(USER_A);
    order.length = 0;

    signIn(rerender, USER_B);

    // The reset has to come first: if the fetch went out first, user B would
    // render user A's rows for as long as the request took.
    expect(order).toEqual(['reset', 'load']);
  });

  it('clears data on sign-out and does not fetch again', () => {
    const { rerender } = renderWithUser(USER_A);
    load.mockClear();
    reset.mockClear();

    signIn(rerender, null);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });

  it('reloads for the next user after a sign-out / sign-in cycle', () => {
    const { rerender } = renderWithUser(USER_A);
    signIn(rerender, null);
    load.mockClear();

    signIn(rerender, USER_B);

    expect(load).toHaveBeenCalledTimes(1);
  });
});
