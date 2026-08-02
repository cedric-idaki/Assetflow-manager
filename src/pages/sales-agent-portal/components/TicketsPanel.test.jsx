import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TicketsPanel from './TicketsPanel';

// Tickets only beat a phone call if the agent can tell, at a glance, which
// threads are waiting on them. These cover the ways that can silently fail.

const ME     = 'me-1';
const bronze = { id: 'b1', full_name: 'timothy odinga', agent_code: 'AGT-1', region: 'Nairobi', agent_plan: 'bronze' };
const gold   = { id: 'g1', full_name: 'achieng otieno', agent_code: 'AGT-9', region: 'Kisumu',  agent_plan: 'gold' };

const ticket = (over = {}) => ({
  id: 't1',
  ticket_no: 'TKT-00001',
  subject: 'Need help onboarding Carsoko',
  category: 'onboarding',
  priority: 'normal',
  status: 'open',
  opened_by_agent_id: bronze.id,
  assigned_agent_id: ME,
  opener: bronze,
  assignee: gold,
  message_count: 2,
  last_message_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...over,
});

const bucketsFor = ({ assigned = [], raised = [], pool = [], closed = [] } = {}, unread = []) => ({
  all: [...assigned, ...raised, ...pool, ...closed],
  assigned, raised, pool, closed,
  unread,
  unreadCount: unread.length,
  actionable: new Set([...unread.map(t => t.id), ...pool.map(t => t.id)]).size,
  awaitingMe: assigned.length,
});

const noop = () => {};

describe('TicketsPanel', () => {
  it('shows the tickets assigned to this agent, who raised them and what about', () => {
    const t = ticket();
    render(
      <TicketsPanel
        buckets={bucketsFor({ assigned: [t] })}
        agentId={ME}
        isGoldAgent
        loading={false}
        isUnread={() => false}
        onOpen={noop}
      />
    );

    expect(screen.getByText('Need help onboarding Carsoko')).toBeInTheDocument();
    expect(screen.getByText(/TKT-00001/)).toBeInTheDocument();
    expect(screen.getByText(/raised by timothy odinga/)).toBeInTheDocument();
  });

  // The profile that says which side this agent is on resolves after the first
  // render. Picking the tab once on mount parks a gold agent on "I raised",
  // which is empty for them — so they conclude nobody has written.
  it('switches to the assigned tab when the gold profile resolves after mount', () => {
    const buckets = bucketsFor({ assigned: [ticket()], raised: [ticket({ id: 't2', subject: 'My own question' })] });

    const { rerender } = render(
      <TicketsPanel buckets={buckets} agentId={ME} isGoldAgent={false} loading={false}
        isUnread={() => false} onOpen={noop} />
    );
    expect(screen.getByText('My own question')).toBeInTheDocument();

    rerender(
      <TicketsPanel buckets={buckets} agentId={ME} isGoldAgent loading={false}
        isUnread={() => false} onOpen={noop} />
    );
    expect(screen.getByText('Need help onboarding Carsoko')).toBeInTheDocument();
  });

  it('opens the thread when a ticket is clicked', () => {
    const t = ticket();
    const onOpen = vi.fn();
    render(
      <TicketsPanel buckets={bucketsFor({ assigned: [t] })} agentId={ME} isGoldAgent loading={false}
        isUnread={() => false} onOpen={onOpen} />
    );

    fireEvent.click(screen.getByText('Need help onboarding Carsoko'));
    expect(onOpen).toHaveBeenCalledWith(t);
  });

  // A pool ticket is the one with nobody's name on it. If claiming needs the
  // thread opened first, two gold agents both start answering it.
  it('lets a gold agent claim an unclaimed ticket straight from the list', async () => {
    const poolTicket = ticket({ id: 't3', assigned_agent_id: null, assignee: null, subject: 'Anyone free today?' });
    const onClaim = vi.fn().mockResolvedValue({});

    render(
      <TicketsPanel buckets={bucketsFor({ pool: [poolTicket] })} agentId={ME} isGoldAgent loading={false}
        isUnread={() => false} onOpen={noop} onClaim={onClaim} />
    );

    fireEvent.click(screen.getByText('Unclaimed'));
    fireEvent.click(screen.getByText('Claim'));
    await waitFor(() => expect(onClaim).toHaveBeenCalledWith(poolTicket));
  });

  // An empty inbox and a failed load render identically, and "nobody has
  // written to you" is the one an agent believes.
  it('says the list may be incomplete when the fetch failed', () => {
    const onRefresh = vi.fn();
    render(
      <TicketsPanel buckets={bucketsFor()} agentId={ME} isGoldAgent loading={false}
        error="permission denied" onRefresh={onRefresh} isUnread={() => false} onOpen={noop} />
    );

    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('marks a ticket with unread messages so it stands out', () => {
    const t = ticket();
    const { container } = render(
      <TicketsPanel buckets={bucketsFor({ assigned: [t] }, [t])} agentId={ME} isGoldAgent loading={false}
        isUnread={(x) => x.id === t.id} onOpen={noop} />
    );

    expect(container.querySelector('.bg-blue-50\\/60')).toBeTruthy();
  });
});
