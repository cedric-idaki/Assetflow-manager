import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MembersTab from './MembersTab';

// The roster used to be fetched with .limit(500) and filtered in the browser,
// so a sacco past 500 members had members that were invisible AND unsearchable
// — no error, no notice. These cover the two halves of the fix: the table shows
// a real page of the whole roster, and the search reaches all of it.

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1', email: 'admin@sacco.co.ke' } }),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) } },
}));

const member = (i) => ({
  id: `m${i}`,
  full_name: `Member ${String(i).padStart(4, '0')}`,
  member_no: `MEM-${String(i).padStart(4, '0')}`,
  phone: '+254700000000',
  email: `m${i}@example.com`,
  member_role: 'member',
  status: 'active',
  kyc_status: 'verified',
  monthly_contribution: 1000,
  joined_at: '2026-01-01',
  user_id: null,
});

const roster = (n) => Array.from({ length: n }, (_, i) => member(i + 1));

const buildCtx = (over = {}) => ({
  members: roster(600),
  membersTruncated: false,
  addMember: vi.fn(),
  updateMember: vi.fn(),
  exportCSV: vi.fn(),
  refreshMembers: vi.fn(),
  sacco: { id: 's1', name: 'Umoja Sacco' },
  ...over,
});

const pagerNav = () => screen.getByRole('navigation', { name: /pagination/i });

beforeEach(() => vi.clearAllMocks());

describe('sacco dashboard — members roster', () => {
  it('renders one page of rows, not the whole roster', () => {
    render(<MembersTab ctx={buildCtx()} />);

    expect(screen.getByText('Member 0001')).toBeInTheDocument();
    expect(screen.getByText('Member 0025')).toBeInTheDocument();
    // Page two has not been rendered into the DOM.
    expect(screen.queryByText('Member 0026')).not.toBeInTheDocument();
  });

  // The heart of it: the user must be told the other 575 exist.
  it('states the true total rather than implying the page is everything', () => {
    render(<MembersTab ctx={buildCtx()} />);

    const nav = pagerNav();
    expect(nav).toHaveTextContent('1–25');
    expect(nav).toHaveTextContent('600');
  });

  it('reaches a member who sits far past the old 500-row cap', () => {
    render(<MembersTab ctx={buildCtx()} />);

    // Member 0590 was fetched but unreachable before: beyond the cap and
    // therefore beyond the client-side filter too.
    expect(screen.queryByText('Member 0590')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search by name or member no/i), {
      target: { value: 'MEM-0590' },
    });

    expect(screen.getByText('Member 0590')).toBeInTheDocument();
  });

  it('walks to the last page and shows only the rows that remain', () => {
    render(<MembersTab ctx={buildCtx({ members: roster(605) })} />);

    fireEvent.click(within(pagerNav()).getByRole('button', { name: 'Page 25' }));

    expect(screen.getByText('Member 0605')).toBeInTheDocument();
    expect(pagerNav()).toHaveTextContent('601–605');
  });

  // Searching from deep in the roster must land on the FIRST matches. Merely
  // clamping into range would drop the user on the tail of the new result set,
  // which hides the best matches behind a page number they did not choose.
  it('goes back to page one when a search narrows the roster', () => {
    render(<MembersTab ctx={buildCtx()} />);

    fireEvent.click(within(pagerNav()).getByRole('button', { name: 'Page 24' }));
    expect(pagerNav()).toHaveTextContent('576–600');

    fireEvent.change(screen.getByPlaceholderText(/search by name or member no/i), {
      target: { value: 'Member 00' },
    });

    expect(screen.getByText('Member 0001')).toBeInTheDocument();
    expect(pagerNav()).toHaveTextContent('1–25');
  });

  // The other half of that rule: a roster edit is not a new search, so it must
  // not throw the user back to page one mid-task.
  it('keeps the user on their page when a member is removed', () => {
    const ctx = buildCtx();
    const { rerender } = render(<MembersTab ctx={ctx} />);

    fireEvent.click(within(pagerNav()).getByRole('button', { name: 'Page 2' }));
    expect(pagerNav()).toHaveTextContent('26–50');

    rerender(<MembersTab ctx={{ ...ctx, members: roster(599) }} />);

    expect(pagerNav()).toHaveTextContent('26–50');
  });

  // "No members yet" in front of a treasurer who has 600 members reads as
  // data loss. The two situations now say different things.
  it('distinguishes an empty roster from a search that matched nothing', () => {
    const { unmount } = render(<MembersTab ctx={buildCtx()} />);
    fireEvent.change(screen.getByPlaceholderText(/search by name or member no/i), {
      target: { value: 'zzzz-no-such-member' },
    });

    expect(screen.getByText(/no members match that search/i)).toBeInTheDocument();
    // Tells them the roster is intact, so an unlucky search never reads as loss.
    expect(screen.getByText(/clear the search to see all 600 members/i)).toBeInTheDocument();
    expect(screen.queryByText(/no members yet/i)).not.toBeInTheDocument();
    unmount();

    render(<MembersTab ctx={buildCtx({ members: [] })} />);
    expect(screen.getByText(/no members yet/i)).toBeInTheDocument();
  });

  it('hides the pager when the roster fits on one page', () => {
    render(<MembersTab ctx={buildCtx({ members: roster(12) })} />);
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
    expect(screen.getByText('Member 0012')).toBeInTheDocument();
  });

  it('warns out loud if a roster ever exceeds the fetch ceiling', () => {
    render(<MembersTab ctx={buildCtx({ membersTruncated: true })} />);
    expect(screen.getByText(/only the most recent/i)).toBeInTheDocument();
  });

  it('exports the whole roster, not the visible page', () => {
    const ctx = buildCtx();
    render(<MembersTab ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    expect(ctx.exportCSV).toHaveBeenCalledTimes(1);
    expect(ctx.exportCSV.mock.calls[0][0]).toHaveLength(600);
  });
});
