import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AssistRequestsPanel from './AssistRequestsPanel';

// The gold agent's side of the feature: a bronze agent's request has to be
// readable by the agent being asked. These cover the ways it silently was not.

const bronze = { id: 'b1', full_name: 'timothy odinga', agent_code: 'AGT-1', region: 'Nairobi' };

const request = (id, note, extra = {}) => ({
  id,
  status: 'requested',
  amount: 1000,
  admin_name: 'carsoko',
  note,
  created_at: new Date().toISOString(),
  bronze_agent_id: 'b1',
  gold_agent_id: 'g1',
  bronze,
  ...extra,
});

const bucketsFor = (incoming) => ({
  incoming,
  outgoing: [],
  pending: incoming.filter(a => a.status === 'requested'),
  active: [],
  history: [],
  actionable: incoming.filter(a => a.status === 'requested').length,
  unclaimed: 0,
});

const noop = () => {};

describe('AssistRequestsPanel — gold agent inbox', () => {
  it('shows every pending request, who sent it and what they asked for', () => {
    const buckets = bucketsFor([
      request('a1', 'Assistance to make sales'),
      request('a2', 'assistant to make sale'),
    ]);

    render(
      <AssistRequestsPanel
        buckets={buckets}
        loading={false}
        isGoldAgent
        onRespond={noop}
        onComplete={noop}
        onCancel={noop}
      />
    );

    expect(screen.getAllByText(/timothy odinga needs help/)).toHaveLength(2);
    expect(screen.getByText('Assistance to make sales')).toBeInTheDocument();
    expect(screen.getByText('assistant to make sale')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /accept/i })).toHaveLength(2);
  });

  // The agent profile that decides which side the agent is on resolves after the
  // first render. The tab used to be picked once, on mount, from the pre-load
  // value — leaving a gold agent parked on an empty "Sent" tab.
  it('switches to the incoming tab when the gold profile resolves after mount', () => {
    const buckets = { ...bucketsFor([request('a1', 'Assistance to make sales')]), outgoing: [request('o1', 'mine')] };

    const { rerender } = render(
      <AssistRequestsPanel buckets={buckets} loading={false} isGoldAgent={false}
        onRespond={noop} onComplete={noop} onCancel={noop} />
    );

    rerender(
      <AssistRequestsPanel buckets={buckets} loading={false} isGoldAgent
        onRespond={noop} onComplete={noop} onCancel={noop} />
    );

    expect(screen.getByText(/timothy odinga needs help/)).toBeInTheDocument();
  });

  // An empty inbox and a failed load rendered identically, and "no bronze agent
  // needs help right now" is the one an agent believes.
  it('says the list may be incomplete when the fetch failed', () => {
    const onRefresh = vi.fn();

    render(
      <AssistRequestsPanel
        buckets={bucketsFor([])}
        loading={false}
        isGoldAgent
        error="permission denied"
        onRefresh={onRefresh}
        onRespond={noop} onComplete={noop} onCancel={noop}
      />
    );

    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  // The kind of help is what a gold agent triages on before reading a word of
  // anyone's note — it used to be buried in free text, if it was said at all.
  it('shows what kind of help each request is', () => {
    const buckets = bucketsFor([
      request('a1', 'client is keen', { help_type: 'sales_assist' }),
      request('a2', 'account is live', { help_type: 'installation_training' }),
    ]);

    render(
      <AssistRequestsPanel buckets={buckets} loading={false} isGoldAgent
        onRespond={noop} onComplete={noop} onCancel={noop} />
    );

    expect(screen.getByText('Assistant to make sales')).toBeInTheDocument();
    expect(screen.getByText('Installation and training')).toBeInTheDocument();
  });
});

// Declining used to be a single optional text box, so in practice a request came
// back "no" with nothing attached and the bronze agent could not tell whether to
// ask someone else or fix something first.
describe('AssistRequestsPanel — declining', () => {
  const openDecline = (onRespond) => {
    render(
      <AssistRequestsPanel
        buckets={bucketsFor([request('a1', 'needs a walkthrough')])}
        loading={false}
        isGoldAgent
        onRespond={onRespond}
        onComplete={noop}
        onCancel={noop}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
  };

  it('will not send a decline until a reason is picked', () => {
    const onRespond = vi.fn();
    openDecline(onRespond);

    const confirm = screen.getByRole('button', { name: /decline request/i });
    expect(confirm).toBeDisabled();

    fireEvent.click(confirm);
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('passes the picked reason and the detail back', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined);
    openDecline(onRespond);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'out_of_region' } });
    fireEvent.change(screen.getByPlaceholderText(/anything else/i), {
      target: { value: 'Kisumu is a 6h drive' },
    });
    fireEvent.click(screen.getByRole('button', { name: /decline request/i }));

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1));
    const [assist, decision, reason] = onRespond.mock.calls[0];
    expect(assist.id).toBe('a1');
    expect(decision).toBe('declined');
    expect(reason).toEqual({ reasonCode: 'out_of_region', reason: 'Kisumu is a 6h drive' });
  });

  // "Other" names nothing on its own, so it has to come with words.
  it('demands the detail when the reason is Other', async () => {
    const onRespond = vi.fn();
    openDecline(onRespond);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'other' } });
    expect(screen.getByRole('button', { name: /decline request/i })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/say what the reason is/i), {
      target: { value: 'I am leaving the company' },
    });
    fireEvent.click(screen.getByRole('button', { name: /decline request/i }));

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1));
    expect(onRespond.mock.calls[0][2]).toEqual({
      reasonCode: 'other', reason: 'I am leaving the company',
    });
  });

  // The bronze agent's own list: a decline they cannot read the reason for is
  // the same dead end as no answer at all.
  it('shows the reason on the requesting agent\'s sent list', () => {
    const declined = request('a1', 'needs a walkthrough', {
      status: 'declined',
      decline_reason_code: 'unavailable',
      decline_reason: 'Fully booked / not available — back next month',
      gold: { id: 'g1', full_name: 'grace mwangi' },
    });

    render(
      <AssistRequestsPanel
        buckets={{ ...bucketsFor([]), outgoing: [declined] }}
        loading={false}
        isGoldAgent={false}
        onRespond={noop} onComplete={noop} onCancel={noop}
      />
    );

    expect(screen.getByText(/Fully booked \/ not available — back next month/)).toBeInTheDocument();
  });
});
