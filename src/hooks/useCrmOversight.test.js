import { describe, it, expect } from 'vitest';
import { summarisePipeline, buildAgentScorecards, buildCrmTotals } from './useCrmOversight';
import { STALE_CONTACT_DAYS } from './useCrmInteractions';

const NOW = new Date('2026-08-20T12:00:00.000Z').getTime();
const DAY = 86400000;
const at = (days) => new Date(NOW + days * DAY).toISOString();

const agent = (id, o = {}) => ({
  id, full_name: `Agent ${id}`, agent_code: `AG-${id}`, region: 'Nairobi', ...o,
});

const lead = (o = {}) => ({
  id: `lead-${Math.random()}`,
  agent_id: 'a1',
  stage: 'contacted',
  converted_at: null,
  last_contact_at: at(-1),
  created_at: at(-10),
  ...o,
});

const touch = (o = {}) => ({
  id: `i-${Math.random()}`,
  agent_id: 'a1',
  interaction_type: 'call',
  outcome: null,
  occurred_at: at(-1),
  ...o,
});

const followUp = (o = {}) => ({
  id: `f-${Math.random()}`,
  agent_id: 'a1',
  is_completed: false,
  scheduled_at: at(3),
  ...o,
});

describe('summarisePipeline', () => {
  it('returns a zeroed board for no leads, with every stage present', () => {
    const p = summarisePipeline([]);
    expect(p.total).toBe(0);
    expect(p.byStage.new_lead).toBe(0);
    expect(p.byStage.closed).toBe(0);
    expect(p.conversionRate).toBeNull();
  });

  it('counts by stage and separates open from closed', () => {
    const p = summarisePipeline([
      lead({ stage: 'new_lead' }),
      lead({ stage: 'qualified' }),
      lead({ stage: 'closed', converted_at: at(-2) }),
      lead({ stage: 'closed' }),
    ]);
    expect(p.total).toBe(4);
    expect(p.open).toBe(2);
    expect(p.closed).toBe(2);
    expect(p.converted).toBe(1);
  });

  it('measures conversion against closed leads, not against every lead', () => {
    // 1 of 2 closed leads converted = 50%. Measuring against all 6 would read
    // as 17% and punish an agent for having a healthy open pipeline.
    const p = summarisePipeline([
      lead({ stage: 'new_lead' }), lead({ stage: 'new_lead' }),
      lead({ stage: 'contacted' }), lead({ stage: 'qualified' }),
      lead({ stage: 'closed', converted_at: at(-1) }),
      lead({ stage: 'closed' }),
    ]);
    expect(p.conversionRate).toBe(50);
    expect(p.closeRate).toBe(33);
  });

  it('treats a stage-less lead as a new lead instead of dropping it', () => {
    const p = summarisePipeline([lead({ stage: null })]);
    expect(p.byStage.new_lead).toBe(1);
    expect(p.total).toBe(1);
  });
});

describe('buildAgentScorecards', () => {
  it('gives an agent with no activity a row rather than omitting them', () => {
    // The agent who has logged nothing is the whole reason a supervisor opens
    // this screen; dropping them would hide the problem.
    const cards = buildAgentScorecards({ agents: [agent('a1')], now: NOW });
    expect(cards).toHaveLength(1);
    expect(cards[0].pipeline.total).toBe(0);
    expect(cards[0].touchesThisWeek).toBe(0);
    expect(cards[0].lastTouchAt).toBeNull();
  });

  it('attributes rows to the agent that owns them', () => {
    const cards = buildAgentScorecards({
      agents: [agent('a1'), agent('a2')],
      leads: [lead({ agent_id: 'a1' }), lead({ agent_id: 'a2' }), lead({ agent_id: 'a2' })],
      interactions: [touch({ agent_id: 'a2' })],
      now: NOW,
    });
    const byId = Object.fromEntries(cards.map(c => [c.agentId, c]));
    expect(byId.a1.pipeline.total).toBe(1);
    expect(byId.a2.pipeline.total).toBe(2);
    expect(byId.a2.touchesThisWeek).toBe(1);
    expect(byId.a1.touchesThisWeek).toBe(0);
  });

  it('keeps work owned by an agent the caller cannot read', () => {
    const cards = buildAgentScorecards({
      agents: [],
      leads: [lead({ agent_id: 'ghost' })],
      now: NOW,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('Unknown agent');
    expect(cards[0].pipeline.total).toBe(1);
  });

  it('counts only follow-ups that are open and past their date as overdue', () => {
    const cards = buildAgentScorecards({
      agents: [agent('a1')],
      followUps: [
        followUp({ scheduled_at: at(-2) }),                      // overdue
        followUp({ scheduled_at: at(-5), is_completed: true }),  // done, not overdue
        followUp({ scheduled_at: at(4) }),                       // upcoming
      ],
      now: NOW,
    });
    expect(cards[0].openFollowUps).toBe(2);
    expect(cards[0].overdueFollowUps).toBe(1);
  });

  it('flags open leads nobody has contacted inside the quiet window', () => {
    const cards = buildAgentScorecards({
      agents: [agent('a1')],
      leads: [
        lead({ last_contact_at: at(-1) }),                              // fresh
        lead({ last_contact_at: at(-(STALE_CONTACT_DAYS + 5)) }),       // quiet
        lead({ last_contact_at: at(-60), stage: 'closed' }),            // closed, not owed a call
        lead({ last_contact_at: at(-60), converted_at: at(-50) }),      // converted
      ],
      now: NOW,
    });
    expect(cards[0].neglectedLeads).toBe(1);
  });

  it('reports the most recent contact, not the last row in the array', () => {
    const cards = buildAgentScorecards({
      agents: [agent('a1')],
      interactions: [
        touch({ occurred_at: at(-9) }),
        touch({ occurred_at: at(-2) }),
        touch({ occurred_at: at(-30) }),
      ],
      now: NOW,
    });
    expect(cards[0].quietDays).toBe(2);
  });

  it('sorts the busiest pipeline to the top', () => {
    const cards = buildAgentScorecards({
      agents: [agent('quiet'), agent('busy')],
      leads: [
        lead({ agent_id: 'busy' }), lead({ agent_id: 'busy' }), lead({ agent_id: 'busy' }),
        lead({ agent_id: 'quiet' }),
      ],
      now: NOW,
    });
    expect(cards[0].agentId).toBe('busy');
  });
});

describe('buildCrmTotals', () => {
  it('counts an agent as active only if they logged something this week', () => {
    const scorecards = buildAgentScorecards({
      agents: [agent('a1'), agent('a2')],
      interactions: [
        touch({ agent_id: 'a1', occurred_at: at(-2) }),
        touch({ agent_id: 'a2', occurred_at: at(-20) }),
      ],
      now: NOW,
    });
    const totals = buildCrmTotals({
      scorecards,
      interactions: [touch({ occurred_at: at(-2) }), touch({ occurred_at: at(-20) })],
      now: NOW,
    });
    expect(totals.agents).toBe(2);
    expect(totals.activeAgents).toBe(1);
    expect(totals.touchesThisWeek).toBe(1);
  });

  it('leaves the conversion rate null rather than reporting 0% with no leads', () => {
    const totals = buildCrmTotals({ scorecards: [], interactions: [], now: NOW });
    expect(totals.conversionRate).toBeNull();
    expect(totals.openLeads).toBe(0);
  });
});
