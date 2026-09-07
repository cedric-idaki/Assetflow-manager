import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import VotingTab from './VotingTab';

// A vote cannot be taken back, and this is the one screen where a clerk casts
// somebody else's. These cover the sequence rather than the styling: picking a
// choice writes nothing, the confirmation names the member and the choice being
// recorded, backing out records nothing at all, and a ballot that landed while
// the modal sat open is caught before it is overwritten.

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const motion = {
  id: 'm1', title: 'Approve 2026 investment plan', description: '',
  status: 'open', ballot_type: 'visible', proposer_id: 'p1', quorum_percent: 0,
};

const members = [
  { id: 'a1', full_name: 'Jane Wanjiku', status: 'active' },
  { id: 'a2', full_name: 'Peter Otieno', status: 'active' },
];

let castVote;

const ctx = (over = {}) => ({
  motions: [motion], members, votes: [],
  createMotion: vi.fn(), secondMotion: vi.fn(), openVoting: vi.fn(),
  castVote, publishResults: vi.fn(), notifyMotion: vi.fn(() => Promise.resolve({ sent: 0, failed: 0 })),
  ...over,
});

// Open the cast-vote modal and stage a choice for Jane, stopping short of the
// confirmation — the state every test below starts from.
const stageJaneYes = () => {
  fireEvent.click(screen.getByText('Cast vote'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a1' } });
  fireEvent.click(screen.getByRole('button', { name: /^Yes$/ }));
};

beforeEach(() => { castVote = vi.fn(() => Promise.resolve()); });

describe('VotingTab — clerk vote entry is two steps', () => {
  it('stages the choice without recording it', () => {
    render(<VotingTab ctx={ctx()} />);
    stageJaneYes();

    expect(castVote).not.toHaveBeenCalled();
    expect(screen.getByText(/Votes are final/)).toBeInTheDocument();
    expect(screen.getByText('Jane Wanjiku')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm “Yes” vote/ })).toBeInTheDocument();
  });

  it('records the staged choice only once it is confirmed', async () => {
    render(<VotingTab ctx={ctx()} />);
    stageJaneYes();
    fireEvent.click(screen.getByRole('button', { name: /Confirm “Yes” vote/ }));

    await waitFor(() => expect(castVote).toHaveBeenCalledTimes(1));
    expect(castVote).toHaveBeenCalledWith(motion, 'a1', 'yes');
  });

  it('records nothing when the clerk goes back', () => {
    render(<VotingTab ctx={ctx()} />);
    stageJaneYes();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(castVote).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();   // back on the picker
  });

  it('will not confirm a choice for a member who has since voted', async () => {
    const { rerender } = render(<VotingTab ctx={ctx()} />);
    stageJaneYes();

    // Jane votes from her own portal while the confirmation sits open.
    rerender(<VotingTab ctx={ctx({ votes: [{ motion_id: 'm1', member_id: 'a1', choice: 'no' }] })} />);
    fireEvent.click(screen.getByRole('button', { name: /Confirm “Yes” vote/ }));

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(castVote).not.toHaveBeenCalled();
  });

  it('needs a member before a choice can be staged', () => {
    render(<VotingTab ctx={ctx()} />);
    fireEvent.click(screen.getByText('Cast vote'));
    fireEvent.click(screen.getByRole('button', { name: /^Yes$/ }));

    expect(castVote).not.toHaveBeenCalled();
    expect(screen.queryByText(/Votes are final/)).not.toBeInTheDocument();
  });
});
