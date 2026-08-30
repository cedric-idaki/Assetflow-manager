/**
 * The pipeline, in money.
 *
 * The arithmetic itself is pinned in src/utils/pipelineValue.test.js. What
 * these tests cover is the part an agent can be misled by: whether the screen
 * keeps STATED money and ESTIMATED money apart.
 *
 * That distinction is the whole reason the migration refused to backfill
 * deal_value out of the free-text budget note. If a figure this app inferred
 * from "under 500k" renders identically to one the agent typed, the backfill
 * happened anyway — just in the browser, where it is harder to see and
 * impossible to audit. So the marker is tested, not assumed.
 *
 * The rest is the worklist behaviour: an unpriced deal has to be findable and
 * fixable in one click, or the pipeline figure stays a guess forever.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import OpportunitiesPanel from './OpportunitiesPanel';

const lead = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  full_name: 'A Lead',
  stage: 'qualified',
  converted_at: null,
  deal_value: null,
  budget_range: null,
  win_probability: null,
  expected_close_date: null,
  ...over,
});

const LEADS = [
  lead({ id: 'priced',    full_name: 'Jane Mwangi',  deal_value: 4000000, stage: 'proposal_sent' }),
  lead({ id: 'estimated', full_name: 'Peter Otieno', budget_range: '2,000,000 - 5,000,000' }),
  lead({ id: 'bare',      full_name: 'Grace Wanjiru', stage: 'contacted' }),
];

const setup = (props = {}) => {
  const onSaveDeal = props.onSaveDeal || vi.fn().mockResolvedValue(undefined);
  render(<OpportunitiesPanel leads={LEADS} onSaveDeal={onSaveDeal} {...props} />);
  return { onSaveDeal, user: userEvent.setup() };
};

describe('headline figures', () => {
  it('splits the pipeline into money that was stated and money that was inferred', () => {
    setup();
    // 4M stated + 2M read out of Peter's budget note = 6M open.
    expect(screen.getByText('KES 6.0M')).toBeInTheDocument();
    expect(screen.getByText(/KES 4\.0M stated · KES 2\.0M estimated/)).toBeInTheDocument();
  });

  it('weights the forecast rather than quoting the raw pipeline', () => {
    setup();
    // 4M × 60% (proposal) + 2M × 40% (qualified) + 0 = 3.2M
    expect(screen.getByText('KES 3.2M')).toBeInTheDocument();
  });

  it('says plainly how many deals have no price on them', () => {
    setup();
    expect(screen.getByText(/2 open deals carry no value/)).toBeInTheDocument();
    expect(screen.getByText(/1 already has a figure in the budget note/)).toBeInTheDocument();
  });
});

describe('stated vs estimated, per deal', () => {
  it('marks an inferred figure as an estimate and leaves a stated one alone', () => {
    setup();
    const peter = screen.getByText('Peter Otieno').closest('li');
    expect(within(peter).getByText('estimated')).toBeInTheDocument();

    const jane = screen.getByText('Jane Mwangi').closest('li');
    expect(within(jane).queryByText('estimated')).not.toBeInTheDocument();
    expect(within(jane).getByText(/weighted/)).toBeInTheDocument();
  });

  it('says "No value" rather than showing a confident zero', () => {
    setup();
    const grace = screen.getByText('Grace Wanjiru').closest('li');
    expect(within(grace).getByText('No value')).toBeInTheDocument();
    expect(within(grace).queryByText(/KES 0/)).not.toBeInTheDocument();
  });
});

describe('pricing a deal', () => {
  it('turns a budget note into a stated value in one click', async () => {
    const { onSaveDeal, user } = setup();

    const peter = screen.getByText('Peter Otieno').closest('li');
    await user.click(within(peter).getByRole('button', { name: /Use KES 2\.0M/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSaveDeal).toHaveBeenCalledWith('estimated', expect.objectContaining({
      dealValue: 2000000,
    }));
  });

  it('sends null, not zero, when a value is cleared', async () => {
    const { onSaveDeal, user } = setup();

    const jane = screen.getByText('Jane Mwangi').closest('li');
    await user.click(within(jane).getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByPlaceholderText('0'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // "I don't know what this is worth" and "this is worth nothing" are
    // different answers, and only one of them belongs in a forecast.
    expect(onSaveDeal).toHaveBeenCalledWith('priced', expect.objectContaining({
      dealValue: null,
    }));
  });

  it('refuses an impossible win chance instead of saving it', async () => {
    const { onSaveDeal, user } = setup();

    const jane = screen.getByText('Jane Mwangi').closest('li');
    await user.click(within(jane).getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByPlaceholderText(/stage default/), '150');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSaveDeal).not.toHaveBeenCalled();
    expect(screen.getByText(/between 0 and 100/)).toBeInTheDocument();
  });

  it('keeps the editor open when the save fails, so nothing typed is lost', async () => {
    const onSaveDeal = vi.fn().mockRejectedValue(new Error('Network is down'));
    const { user } = setup({ onSaveDeal });

    const jane = screen.getByText('Jane Mwangi').closest('li');
    await user.click(within(jane).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Network is down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});

describe('worklists', () => {
  it('lists the unpriced deals, budget-hint ones first', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Needs a value/ }));

    const names = screen.getAllByRole('button')
      .map(b => b.textContent)
      .filter(t => ['Peter Otieno', 'Grace Wanjiru', 'Jane Mwangi'].includes(t));

    expect(names).toEqual(['Peter Otieno', 'Grace Wanjiru']);
  });

  it('congratulates rather than nags when every deal is priced', () => {
    render(
      <OpportunitiesPanel
        leads={[lead({ deal_value: 1000000 })]}
        onSaveDeal={vi.fn()}
      />,
    );
    expect(screen.queryByText(/carry no value/)).not.toBeInTheDocument();
  });

  it('shows an empty book without inventing a pipeline', () => {
    render(<OpportunitiesPanel leads={[]} onSaveDeal={vi.fn()} />);
    expect(screen.getByText('No open deals')).toBeInTheDocument();
    // Not "KES NaN", and not a blank where a number should be.
    expect(screen.getAllByText('KES 0').length).toBeGreaterThan(0);
  });
});
