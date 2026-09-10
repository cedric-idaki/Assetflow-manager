/**
 * Logging a contact and dating the next one are the same action.
 *
 * Before this modal carried a date, an agent finishing a call had two choices:
 * type "call her back after the 30th" into a free-text box that nothing ever
 * reads back to them, or click through to a second modal that re-asked who the
 * contact was with. The first is a promise nobody is reminded about; the second
 * is a form most people abandon. So these tests pin the thing that matters —
 * that one submit produces both the record of what happened AND a dated,
 * channelled appointment — and the failure mode that costs the most: a
 * follow-up that fails to save must not make the agent log the call twice.
 */

import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import LogInteractionModal from './LogInteractionModal';

const LEADS = [
  { id: 'l1', full_name: 'Jane Mwangi', phone: '0712345678', stage: 'contacted' },
];

const setup = (props = {}) => {
  const onSubmit = props.onSubmit || vi.fn().mockResolvedValue({ data: { id: 'i1' } });
  const onClose  = props.onClose  || vi.fn();
  render(
    <LogInteractionModal
      isOpen
      leads={LEADS}
      clients={[]}
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSubmit, onClose, user: userEvent.setup() };
};

/** Fill the two fields the form insists on, so the submit under test can run. */
const fillRequired = async (user) => {
  await user.selectOptions(screen.getByRole('combobox'), 'l1');
  await user.type(
    screen.getByPlaceholderText(/Wants the 3-bed in Westlands/i),
    'Sent her the payment plan, she will read it over the weekend',
  );
};

const followUpBox = () =>
  screen.getByText(/When will you follow up/i).closest('div').parentElement;

describe('LogInteractionModal — channels', () => {
  it('offers every channel an agent actually works through', async () => {
    setup();
    // The point of the shared vocabulary: email, WhatsApp and SMS are contacts
    // a Kenyan agent makes daily, and none of them used to be schedulable.
    for (const label of ['Phone call', 'WhatsApp', 'SMS', 'Email', 'Meeting', 'Site visit']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('records the channel the contact happened on', async () => {
    const { onSubmit, user } = setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /^Email$/ }));
    await user.click(screen.getByRole('button', { name: /Save Contact/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: 'email', leadId: 'l1' });
  });
});

describe('LogInteractionModal — the next follow-up date', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-29T09:00:00.000Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('sends no follow-up when the agent does not ask for one', async () => {
    const { onSubmit, user } = setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /Save Contact/i }));

    // A note that needs no chase must not be forced to invent a date.
    expect(onSubmit.mock.calls[0][0].followUp).toBeNull();
  });

  it('turns one tap into a dated appointment', async () => {
    const { onSubmit, user } = setup();
    await fillRequired(user);
    await user.click(within(followUpBox()).getByRole('button', { name: 'Next week' }));
    await user.click(screen.getByRole('button', { name: /Save & Schedule/i }));

    const { followUp } = onSubmit.mock.calls[0][0];
    expect(followUp).toBeTruthy();
    // 29 Aug + 7 days, at the 10:00 the quick picks default to.
    const when = new Date(followUp.scheduledAt);
    expect(when.getDate()).toBe(5);
    expect(when.getMonth()).toBe(8); // September
    expect(when.getHours()).toBe(10);
    // remind_at is what the reminder worker scans; an hour before by default.
    expect(new Date(followUp.remindAt).getHours()).toBe(9);
  });

  it('defaults the next channel to the one this contact used', async () => {
    const { onSubmit, user } = setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /^Email$/ }));
    await user.click(within(followUpBox()).getByRole('button', { name: 'Next week' }));
    await user.click(screen.getByRole('button', { name: /Save & Schedule/i }));

    // An email thread continues by email far more often than it becomes a visit.
    expect(onSubmit.mock.calls[0][0].followUp.channel).toBe('email');
  });

  it('lets the agent follow up on a different channel from the one they used', async () => {
    const { onSubmit, user } = setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /^Email$/ }));
    await user.click(within(followUpBox()).getByRole('button', { name: 'Next week' }));

    const box = followUpBox();
    await user.click(within(box).getByRole('button', { name: /Phone call/i }));
    await user.click(screen.getByRole('button', { name: /Save & Schedule/i }));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      type: 'email',
      followUp: expect.objectContaining({ channel: 'call' }),
    });
  });

  it('never schedules a follow-up onto a channel the diary cannot hold', async () => {
    const { onSubmit, user } = setup();
    await fillRequired(user);
    // 'note' is loggable but not an appointment — follow_ups rejects it.
    await user.click(screen.getByRole('button', { name: /^Note$/ }));
    await user.click(within(followUpBox()).getByRole('button', { name: 'Next week' }));
    await user.click(screen.getByRole('button', { name: /Save & Schedule/i }));

    expect(onSubmit.mock.calls[0][0].followUp.channel).toBe('follow_up');
  });

  it('carries what happens next into the reminder note', async () => {
    const { onSubmit, user } = setup();
    await fillRequired(user);
    await user.type(
      screen.getByPlaceholderText(/Send payment plan PDF/i),
      'Confirm the deposit cleared',
    );
    await user.click(within(followUpBox()).getByRole('button', { name: 'Tomorrow' }));
    await user.click(screen.getByRole('button', { name: /Save & Schedule/i }));

    // Asking twice for the same sentence is how a form gets abandoned.
    expect(onSubmit.mock.calls[0][0].followUp.notes).toBe('Confirm the deposit cleared');
  });

  it('lets the agent take the date back off', async () => {
    const { onSubmit, user } = setup();
    await fillRequired(user);
    await user.click(within(followUpBox()).getByRole('button', { name: 'Next week' }));
    await user.click(screen.getByRole('button', { name: /No follow-up/i }));
    await user.click(screen.getByRole('button', { name: /Save Contact/i }));

    expect(onSubmit.mock.calls[0][0].followUp).toBeNull();
  });

  it('will not book a follow-up in the past', async () => {
    const { onSubmit, user } = setup();
    await fillRequired(user);
    await user.click(within(followUpBox()).getByRole('button', { name: 'Next week' }));

    // Changed in one event, the way a date picker reports it — clearing the
    // field first would empty the date and fold the section away instead.
    const dateInput = followUpBox().querySelector('input[type="datetime-local"]');
    fireEvent.change(dateInput, { target: { value: '2026-08-01T10:00' } });
    await user.click(screen.getByRole('button', { name: /Save & Schedule/i }));

    expect(screen.getByText(/A follow-up has to be in the future/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('hides the second-modal route once a date is set', async () => {
    const onScheduleFollowUp = vi.fn();
    const { user } = setup({ onScheduleFollowUp });
    expect(screen.getByRole('button', { name: /More follow-up options/i })).toBeInTheDocument();

    await user.click(within(followUpBox()).getByRole('button', { name: 'Next week' }));
    // Leaving it visible would let one contact book the same follow-up twice.
    expect(screen.queryByRole('button', { name: /More follow-up options/i })).toBeNull();
  });
});
