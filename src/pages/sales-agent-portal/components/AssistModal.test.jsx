import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AssistModal from './AssistModal';

// The bronze agent's side. "What do you need help with?" used to be a free-text
// box, so the same job arrived worded five different ways and nothing about
// assist demand could be counted or routed.

const goldAgents = [
  { id: 'g1', full_name: 'grace mwangi', agent_code: 'GLD-1', region: 'Nairobi' },
];

const openModal = (onAssign = vi.fn().mockResolvedValue({})) => {
  render(
    <AssistModal isOpen onClose={() => {}} goldAgents={goldAgents} onAssign={onAssign} />
  );
  return onAssign;
};

// The three kinds of help a bronze agent actually asks for.
const selects = () => screen.getAllByRole('combobox');

describe('AssistModal — asking for help', () => {
  it('offers the three kinds of help as a picker, not a blank box', () => {
    openModal();
    const [, helpType] = selects();

    const labels = Array.from(helpType.options).map(o => o.textContent);
    expect(labels).toEqual([
      'Select the kind of help you need',
      'Assistant to make sales',
      'Installation and training',
      'Other',
    ]);
  });

  it('will not send without a kind of help picked', async () => {
    const onAssign = openModal();
    const [gold] = selects();

    fireEvent.change(screen.getByPlaceholderText('e.g. Acme Ltd'), { target: { value: 'Acme Ltd' } });
    fireEvent.change(gold, { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/pick what you need help with/i)).toBeInTheDocument();
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('sends the picked type through to the request', async () => {
    const onAssign = openModal();
    const [gold, helpType] = selects();

    fireEvent.change(screen.getByPlaceholderText('e.g. Acme Ltd'), { target: { value: 'Acme Ltd' } });
    fireEvent.change(gold, { target: { value: 'g1' } });
    fireEvent.change(helpType, { target: { value: 'installation_training' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
    expect(onAssign.mock.calls[0][0]).toMatchObject({
      goldAgentId: 'g1',
      adminName:   'Acme Ltd',
      helpType:    'installation_training',
    });
  });

  // "Other" names nothing on its own — the gold agent would be accepting blind.
  it('demands the detail box when the type is Other', async () => {
    const onAssign = openModal();
    const [gold, helpType] = selects();

    fireEvent.change(screen.getByPlaceholderText('e.g. Acme Ltd'), { target: { value: 'Acme Ltd' } });
    fireEvent.change(gold, { target: { value: 'g1' } });
    fireEvent.change(helpType, { target: { value: 'other' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/say what you actually need/i)).toBeInTheDocument();
    expect(onAssign).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/client is ready but/i), {
      target: { value: 'Needs the KRA import run before go-live' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
    expect(onAssign.mock.calls[0][0]).toMatchObject({
      helpType: 'other',
      note:     'Needs the KRA import run before go-live',
    });
  });
});
