import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import VotingTab from './VotingTab';

// The member's own ballot. A vote is one-shot and final (RLS drops the UPDATE
// path in 20260822160000_sacco_vote_is_final.sql), so the portal must never
// send one straight off a click: these cover that picking Yes/No/Abstain only
// stages it, that the confirmation reads the choice back, and that dismissing
// the confirmation leaves the member free to vote differently.

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const me = { id: 'me', full_name: 'Jane Wanjiku' };

const motion = {
  id: 'm1', title: 'Approve 2026 investment plan', description: '',
  status: 'open', ballot_type: 'visible', proposer_id: 'p1',
  quorum_percent: 0, voting_end: null,
};

let castVote;

const ctx = (over = {}) => ({
  me, motions: [motion], votes: [],
  proposeMotion: vi.fn(), secondMotion: vi.fn(), castVote,
  getMotionResults: vi.fn(() => Promise.resolve({ yes_count: 0, no_count: 0, abstain_count: 0, total_votes: 0 })),
  ...over,
});

const confirmButton = () => screen.getByRole('button', { name: /Confirm my “.*” vote/ });

beforeEach(() => { castVote = vi.fn(() => Promise.resolve()); });

describe('VotingTab (member portal) — a vote is confirmed before it is cast', () => {
  it('stages the choice without casting it', () => {
    render(<VotingTab ctx={ctx()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Yes$/ }));

    expect(castVote).not.toHaveBeenCalled();
    expect(screen.getByText(/Votes are final/)).toBeInTheDocument();
    expect(confirmButton()).toHaveTextContent('Yes');
  });

  it('casts the staged choice once confirmed', async () => {
    render(<VotingTab ctx={ctx()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Abstain$/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(castVote).toHaveBeenCalledTimes(1));
    expect(castVote).toHaveBeenCalledWith(motion, 'abstain');
  });

  it('casts nothing when the member goes back', () => {
    render(<VotingTab ctx={ctx()} />);
    fireEvent.click(screen.getByRole('button', { name: /^No$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(castVote).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Yes$/ })).toBeInTheDocument();   // may still choose
  });

  it('offers no way to vote again once a ballot is recorded', () => {
    render(<VotingTab ctx={ctx({ votes: [{ motion_id: 'm1', member_id: 'me', choice: 'yes' }] })} />);

    expect(screen.getByText(/You voted Yes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^No$/ })).not.toBeInTheDocument();
  });
});
