import { describe, it, expect } from 'vitest';
import {
  summarisePipeline, buildAgentScorecards, buildCrmTotals,
  buildLeaderboard, buildKpiBreakdown, KPI_KEYS, CRM_SUPERVISOR_ROLES,
  AGENT_SORTS, sortScorecards, flatMetric,
  buildSourcePerformance, buildLossAnalysis,
} from './useCrmOversight';
import { LOST_REASON_VALUES, isLostLead, sourceMeta } from '../config/crmVocabulary';
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

describe('won / lost / opportunities', () => {
  it('separates a closed deal that converted from one that did not', () => {
    const p = summarisePipeline([
      lead({ stage: 'closed', converted_at: at(-2) }),
      lead({ stage: 'closed', converted_at: null }),
      lead({ stage: 'closed', converted_at: null }),
    ]);
    expect(p.won).toBe(1);
    expect(p.lost).toBe(2);
  });

  it('does not count an open lead as lost just because it has not converted', () => {
    const p = summarisePipeline([
      lead({ stage: 'new_lead' }), lead({ stage: 'contacted' }),
      lead({ stage: 'qualified' }), lead({ stage: 'proposal_sent' }),
    ]);
    expect(p.lost).toBe(0);
    expect(p.won).toBe(0);
  });

  it('counts a lead converted from an open stage as won, not lost', () => {
    // Conversion does not require passing through 'closed' -- the portal can
    // convert straight from qualified, and that is still a win.
    const p = summarisePipeline([lead({ stage: 'qualified', converted_at: at(-1) })]);
    expect(p.won).toBe(1);
    expect(p.lost).toBe(0);
  });

  it('treats qualified plus proposal_sent as the opportunity pool', () => {
    const p = summarisePipeline([
      lead({ stage: 'qualified' }), lead({ stage: 'qualified' }),
      lead({ stage: 'proposal_sent' }),
      lead({ stage: 'contacted' }), lead({ stage: 'new_lead' }),
    ]);
    expect(p.qualified).toBe(2);
    expect(p.opportunities).toBe(3);
  });

  it('keeps won and converted as the same number so the two can never drift', () => {
    const p = summarisePipeline([
      lead({ stage: 'closed', converted_at: at(-1) }),
      lead({ stage: 'qualified', converted_at: at(-3) }),
    ]);
    expect(p.won).toBe(p.converted);
  });
});

describe('commercial figures', () => {
  it('coerces DECIMAL columns that arrive from PostgREST as strings', () => {
    const [card] = buildAgentScorecards({
      agents: [agent('a1', { total_sales: '5200000.00', total_commission: '208000.50' })],
      now: NOW,
    });
    expect(card.salesValue).toBe(5200000);
    expect(card.commission).toBeCloseTo(208000.5);
  });

  it('falls back to zero rather than NaN when the column is null or junk', () => {
    const [card] = buildAgentScorecards({
      agents: [agent('a1', { total_sales: null, total_commission: 'not a number' })],
      now: NOW,
    });
    expect(card.salesValue).toBe(0);
    expect(card.commission).toBe(0);
    // One NaN would poison every team total on the dashboard.
    const totals = buildCrmTotals({ scorecards: [card], interactions: [], now: NOW });
    expect(Number.isNaN(totals.salesValue)).toBe(false);
    expect(totals.salesValue).toBe(0);
  });

  it('sums sales and commission across the team', () => {
    const scorecards = buildAgentScorecards({
      agents: [
        agent('a1', { total_sales: 5200000, total_commission: 208000 }),
        agent('a2', { total_sales: 4800000, total_commission: 192000 }),
      ],
      now: NOW,
    });
    const totals = buildCrmTotals({ scorecards, interactions: [], now: NOW });
    expect(totals.salesValue).toBe(10000000);
    expect(totals.commission).toBe(400000);
  });

  it('counts employment status separately from whether anyone actually worked', () => {
    // A team can be fully staffed and completely idle. Reporting one number for
    // both is how an idle week gets read as a healthy one.
    const scorecards = buildAgentScorecards({
      agents: [
        agent('a1', { agent_status: 'active' }),
        agent('a2', { agent_status: 'active' }),
        agent('a3', { agent_status: 'terminated' }),
      ],
      interactions: [touch({ agent_id: 'a1', occurred_at: at(-1) })],
      now: NOW,
    });
    const totals = buildCrmTotals({ scorecards, interactions: [], now: NOW });
    expect(totals.agents).toBe(3);
    expect(totals.enabledAgents).toBe(2);
    expect(totals.activeAgents).toBe(1);
  });

  it('reports leads per agent to one decimal, and null with no agents', () => {
    const scorecards = buildAgentScorecards({
      agents: [agent('a1'), agent('a2'), agent('a3')],
      leads: [lead({ agent_id: 'a1' }), lead({ agent_id: 'a2' }), lead({ agent_id: 'a2' }),
              lead({ agent_id: 'a3' }), lead({ agent_id: 'a3' })],
      now: NOW,
    });
    const totals = buildCrmTotals({ scorecards, interactions: [], now: NOW });
    expect(totals.leadsPerAgent).toBe(1.7);
    expect(buildCrmTotals({ scorecards: [], interactions: [], now: NOW }).leadsPerAgent).toBeNull();
  });
});

describe('buildLeaderboard', () => {
  it('ranks by realised sales, not by how many leads an agent is sitting on', () => {
    const scorecards = buildAgentScorecards({
      agents: [
        agent('hoarder', { total_sales: 0 }),
        agent('closer',  { total_sales: 8100000 }),
      ],
      leads: Array.from({ length: 40 }, () => lead({ agent_id: 'hoarder' })),
      now: NOW,
    });
    const board = buildLeaderboard(scorecards);
    expect(board[0].agentId).toBe('closer');
    expect(board[0].rank).toBe(1);
    expect(board[1].agentId).toBe('hoarder');
  });

  it('breaks a sales tie on deals won', () => {
    const scorecards = buildAgentScorecards({
      agents: [agent('a1', { total_sales: 1000 }), agent('a2', { total_sales: 1000 })],
      leads: [lead({ agent_id: 'a2', stage: 'closed', converted_at: at(-1) })],
      now: NOW,
    });
    expect(buildLeaderboard(scorecards)[0].agentId).toBe('a2');
  });

  it('keeps agents who sold nothing instead of hiding them', () => {
    const scorecards = buildAgentScorecards({
      agents: [agent('a1', { total_sales: 500 }), agent('a2', { total_sales: 0 })],
      now: NOW,
    });
    const board = buildLeaderboard(scorecards);
    expect(board).toHaveLength(2);
    expect(board[1].salesValue).toBe(0);
  });

  it('numbers a sliced board from the top of the full ranking', () => {
    const scorecards = buildAgentScorecards({
      agents: [
        agent('a1', { total_sales: 300 }),
        agent('a2', { total_sales: 200 }),
        agent('a3', { total_sales: 100 }),
      ],
      now: NOW,
    });
    const top2 = buildLeaderboard(scorecards, 2);
    expect(top2).toHaveLength(2);
    expect(top2.map(c => c.rank)).toEqual([1, 2]);
  });

  it('orders equal agents by name so the board does not shuffle between refetches', () => {
    const scorecards = buildAgentScorecards({
      agents: [agent('z', { full_name: 'Zoe' }), agent('m', { full_name: 'Mary' })],
      now: NOW,
    });
    expect(buildLeaderboard(scorecards).map(c => c.name)).toEqual(['Mary', 'Zoe']);
  });

  it('does not mutate the scorecards it was handed', () => {
    const scorecards = buildAgentScorecards({
      agents: [agent('a1', { total_sales: 1 }), agent('a2', { total_sales: 9 })],
      now: NOW,
    });
    const before = scorecards.map(c => c.agentId);
    buildLeaderboard(scorecards);
    expect(scorecards.map(c => c.agentId)).toEqual(before);
    expect(scorecards[0].rank).toBeUndefined();
  });
});

describe('access control invariants', () => {
  // These mirror properties enforced in the database by public.is_crm_supervisor()
  // and the supervisors_read_tenant_* policies. RLS itself can only be proven
  // against a live database -- see scripts/verify-crm-tenant-isolation.sql --
  // but the client must never be the thing that widens scope either.

  it('never admits a sales agent to the supervisor view', () => {
    // The whole reason is_crm_supervisor() is not is_staff_member(): an agent
    // reading this screen would be reading their colleagues' books.
    expect(CRM_SUPERVISOR_ROLES).not.toContain('sales_agent');
    expect(CRM_SUPERVISOR_ROLES).not.toContain('client');
    expect(CRM_SUPERVISOR_ROLES).not.toContain('sacco_member');
  });

  it('lists exactly the roles the database policy admits', () => {
    // Drifting from public.is_crm_supervisor() either shows a supervisor an
    // empty screen, or offers a screen the database will refuse to fill.
    expect([...CRM_SUPERVISOR_ROLES].sort()).toEqual(
      ['admin', 'director', 'manager', 'sacco_admin', 'super_admin'],
    );
  });

  it('attributes every scorecard row to the agent that owns it', () => {
    // A foreign row can never be aggregated into one of our agents' numbers.
    const scorecards = buildAgentScorecards({
      agents: [agent('mine')],
      leads: [lead({ agent_id: 'mine' }), lead({ agent_id: 'other-tenant' })],
      interactions: [touch({ agent_id: 'other-tenant' })],
      now: NOW,
    });
    const mine = scorecards.find(c => c.agentId === 'mine');
    expect(mine.pipeline.total).toBe(1);
    expect(mine.interactions).toBe(0);
  });

  it('gives a foreign agent its own bucket rather than folding it into the tenant', () => {
    // buildAgentScorecards deliberately keeps unknown agent_ids visible instead
    // of discarding them; useCrmOversight then drops them by filtering to the
    // caller's own agent rows. Losing them HERE would hide a leak rather than
    // prevent one.
    const scorecards = buildAgentScorecards({
      agents: [agent('mine')],
      leads: [lead({ agent_id: 'other-tenant' })],
      now: NOW,
    });
    expect(scorecards.map(c => c.agentId)).toContain('other-tenant');

    const tenantOnly = buildCrmTotals({
      scorecards: scorecards.filter(c => c.agentId === 'mine'),
      interactions: [],
      now: NOW,
    });
    expect(tenantOnly.totalLeads).toBe(0);
  });
});

describe('buildKpiBreakdown', () => {
  // The whole point of the drill-down is that it agrees with the tile above it,
  // so most of these assert the breakdown against the same figure buildCrmTotals
  // produced from the same rows.
  const world = () => {
    const agents = [
      agent('a1', { full_name: 'Mary',  agent_status: 'active', total_sales: 8100000, total_commission: 324000 }),
      agent('a2', { full_name: 'Brian', agent_status: 'active', total_sales: 0,       total_commission: 0 }),
    ];
    const leads = [
      lead({ id: 'l1', agent_id: 'a1', stage: 'qualified',     last_contact_at: at(-1) }),
      lead({ id: 'l2', agent_id: 'a1', stage: 'proposal_sent', last_contact_at: at(-60) }),
      lead({ id: 'l3', agent_id: 'a2', stage: 'closed', converted_at: at(-5) }),
      lead({ id: 'l4', agent_id: 'a2', stage: 'closed', converted_at: null }),
    ];
    const interactions = [
      touch({ id: 'i1', agent_id: 'a1', occurred_at: at(-1) }),
      touch({ id: 'i2', agent_id: 'a1', occurred_at: at(-30) }),
    ];
    const followUps = [
      followUp({ id: 'f1', agent_id: 'a1', lead_id: 'l1', scheduled_at: at(-3), is_completed: false }),
      followUp({ id: 'f2', agent_id: 'a2', lead_id: 'l3', scheduled_at: at(5),  is_completed: false }),
    ];
    const scorecards = buildAgentScorecards({ agents, leads, interactions, followUps, now: NOW });
    const totals = buildCrmTotals({ scorecards, interactions, now: NOW });
    // now: NOW matters. Without it buildKpiBreakdown falls back to Date.now()
    // while the scorecards above are pinned to the fixed clock, and the two
    // disagree about what "this week" and "overdue" mean — which is exactly the
    // drift this whole describe block exists to rule out.
    return { scorecards, leads, interactions, followUps, totals, now: NOW };
  };

  it('returns null for a key it does not know, instead of an empty shell', () => {
    expect(buildKpiBreakdown('not-a-kpi', world())).toBeNull();
  });

  it('builds something for every key the tiles use', () => {
    const w = world();
    for (const key of KPI_KEYS) {
      const d = buildKpiBreakdown(key, w);
      expect(d, key).not.toBeNull();
      expect(d.title, key).toBeTruthy();
      expect(Array.isArray(d.sections), key).toBe(true);
    }
  });

  it('splits agents into who worked this week and who did not', () => {
    const d = buildKpiBreakdown('activeAgents', world());
    const [worked, idle] = d.sections;
    expect(worked.items.map(i => i.primary)).toEqual(['Mary']);
    expect(idle.items.map(i => i.primary)).toEqual(['Brian']);
  });

  it('counts the same open leads the tile counted', () => {
    const w = world();
    const d = buildKpiBreakdown('openLeads', w);
    const shown = d.sections.reduce((n, sec) => n + sec.items.length, 0);
    expect(shown).toBe(w.totals.openLeads);
  });

  it('falls back to recent history when nothing was logged this week', () => {
    const w = world();
    // Push every contact outside the window; the tile reads 0 and the panel
    // must still answer "so when did anyone last speak to a customer".
    w.interactions = [touch({ id: 'i9', agent_id: 'a1', occurred_at: at(-40) })];
    const d = buildKpiBreakdown('contacts', w);
    expect(d.sections[0].items).toHaveLength(0);
    expect(d.sections[1].items).toHaveLength(1);
  });

  it('says why the tile is zero when nothing was ever logged', () => {
    const w = world();
    w.interactions = [];
    expect(buildKpiBreakdown('contacts', w).emptyHint).toMatch(/never been logged|Sales Agent portal/i);
  });

  it('lists overdue follow-ups and quiet leads separately', () => {
    const d = buildKpiBreakdown('attention', world());
    const [overdue, quiet] = d.sections;
    expect(overdue.items.map(i => i.id)).toEqual(['f1']);   // f2 is still in date
    expect(quiet.items.map(i => i.id)).toEqual(['l2']);     // 60 days untouched
  });

  it('explains that a zero sales figure means no completed payment, not a dead column', () => {
    // Before 20260828120000 agents.total_sales had no writer at all, and this
    // hint said so. Now a trigger on payments maintains it, so a zero has a
    // specific cause the reader can act on: no completed payment is credited
    // to an agent. If the hint ever drifts back to blaming the CRM, it is lying.
    const w = world();
    w.totals = { ...w.totals, salesValue: 0 };
    const hint = buildKpiBreakdown('sales', w).emptyHint;
    expect(hint).toMatch(/completed/i);
    expect(hint).toMatch(/payment/i);
  });

  it('ranks the sales breakdown highest first and carries the amount', () => {
    const d = buildKpiBreakdown('sales', world());
    const items = d.sections[0].items;
    expect(items[0].primary).toBe('Mary');
    expect(items[0].amount).toBe(8100000);
    expect(items[1].amount).toBe(0);
  });

  it('shows opportunities split by stage, matching the tile total', () => {
    const w = world();
    const d = buildKpiBreakdown('opportunities', w);
    const shown = d.sections.reduce((n, sec) => n + sec.items.length, 0);
    expect(shown).toBe(w.totals.opportunities);
    expect(d.sections[0].items.map(i => i.id)).toEqual(['l1']);
    expect(d.sections[1].items.map(i => i.id)).toEqual(['l2']);
  });

  it('reports per-agent conversion, and null rather than 0% with nothing closed', () => {
    const d = buildKpiBreakdown('conversion', world());
    const brian = d.sections[0].items.find(i => i.primary === 'Brian');
    const mary  = d.sections[0].items.find(i => i.primary === 'Mary');
    expect(brian.value).toBe('50%');        // 1 won of 2 closed
    expect(mary.value).toBe('no closed leads');
  });

  it('gives lead rows a lead and agent rows an agentId, so both can be opened', () => {
    const w = world();
    expect(buildKpiBreakdown('openLeads', w).sections[0].items[0].lead).toBeTruthy();
    expect(buildKpiBreakdown('sales', w).sections[0].items[0].agentId).toBe('a1');
  });

  it('survives empty data without throwing', () => {
    for (const key of KPI_KEYS) {
      expect(() => buildKpiBreakdown(key, {}), key).not.toThrow();
    }
  });
});

describe('agent table sorting', () => {
  const team = () => buildAgentScorecards({
    agents: [
      agent('a1', { full_name: 'Mary',  total_sales: 8100000 }),
      agent('a2', { full_name: 'Brian', total_sales: 4800000 }),
      agent('a3', { full_name: 'John',  total_sales: 5200000 }),
    ],
    leads: [
      lead({ agent_id: 'a2', stage: 'closed', converted_at: at(-1) }),
      lead({ agent_id: 'a3', stage: 'new_lead' }),
      lead({ agent_id: 'a3', stage: 'contacted' }),
    ],
    now: NOW,
  });

  const names = (rows) => rows.map(c => c.name);

  it('ranks biggest first for a number', () => {
    expect(names(sortScorecards(team(), 'sales'))).toEqual(['Mary', 'John', 'Brian']);
  });

  it('reverses when flipped', () => {
    expect(names(sortScorecards(team(), 'sales', true))).toEqual(['Brian', 'John', 'Mary']);
  });

  it('sorts a name A-Z, and Z-A when flipped', () => {
    expect(names(sortScorecards(team(), 'name'))).toEqual(['Brian', 'John', 'Mary']);
    expect(names(sortScorecards(team(), 'name', true))).toEqual(['Mary', 'John', 'Brian']);
  });

  it('breaks ties by name so rows cannot reshuffle between refetches', () => {
    // The realistic case for a young tenant: every metric still zero, so EVERY
    // row is a tie. An unstable comparator makes the table jump on each poll.
    const zeros = buildAgentScorecards({
      agents: [agent('z', { full_name: 'Zoe' }), agent('a', { full_name: 'Ann' }), agent('m', { full_name: 'Mo' })],
      now: NOW,
    });
    const once  = names(sortScorecards(zeros, 'won'));
    const twice = names(sortScorecards([...zeros].reverse(), 'won'));
    expect(once).toEqual(['Ann', 'Mo', 'Zoe']);
    expect(twice).toEqual(once);
  });

  it('does not mutate the array it was given', () => {
    const rows = team();
    const before = names(rows);
    sortScorecards(rows, 'sales');
    expect(names(rows)).toEqual(before);
  });

  it('returns a copy unchanged for an unknown sort key', () => {
    const rows = team();
    expect(names(sortScorecards(rows, 'nonsense'))).toEqual(names(rows));
  });

  it('reports the shared value when a metric cannot separate anyone', () => {
    // Nobody has won anything: "Deals won" is a real answer, not a dead button.
    expect(flatMetric(team(), 'overdue')).toBe(0);
  });

  it('reports null when a metric does separate them', () => {
    expect(flatMetric(team(), 'sales')).toBeNull();
  });

  it('never calls a single agent flat, since one row cannot be ranked anyway', () => {
    const one = buildAgentScorecards({ agents: [agent('a1')], now: NOW });
    expect(flatMetric(one, 'won')).toBeNull();
  });

  it('never reports flat for the name sort', () => {
    expect(flatMetric(team(), 'name')).toBeNull();
  });

  it('gives every sort chip an accessor and a column to highlight', () => {
    for (const s of AGENT_SORTS) {
      expect(typeof s.get, s.value).toBe('function');
      expect(s.col, s.value).toBeTruthy();
      expect(s.label, s.value).toBeTruthy();
    }
  });

  it('sorts every chip without throwing on empty data', () => {
    for (const s of AGENT_SORTS) {
      expect(() => sortScorecards([], s.value), s.value).not.toThrow();
      expect(() => flatMetric([], s.value), s.value).not.toThrow();
    }
  });
});

describe('buildSourcePerformance', () => {
  const won  = (o) => lead({ stage: 'closed', converted_at: at(-1), ...o });
  const lost = (o) => lead({ stage: 'closed', converted_at: null,   ...o });
  const open = (o) => lead({ stage: 'contacted', converted_at: null, ...o });

  it('ranks on deals won, not on how many leads the channel produced', () => {
    // The whole point. Cold calling floods the pipeline and closes nobody;
    // referrals trickle in and convert. Ranking on volume would invert this.
    const rows = buildSourcePerformance([
      ...Array.from({ length: 20 }, () => open({ source: 'cold_call' })),
      won({ source: 'referral' }), won({ source: 'referral' }),
    ]);
    expect(rows[0].label).toBe('Referral');
    expect(rows[0].won).toBe(2);
    expect(rows[1].label).toBe('Cold Call');
    expect(rows[1].total).toBe(20);
  });

  it('measures conversion against finished leads, not against every lead', () => {
    // 1 won, 1 lost, 8 still open => 50%, not 10%. Judging a channel on leads
    // that have not finished yet punishes it for being recent.
    const rows = buildSourcePerformance([
      won({ source: 'website' }), lost({ source: 'website' }),
      ...Array.from({ length: 8 }, () => open({ source: 'website' })),
    ]);
    expect(rows[0].decided).toBe(2);
    expect(rows[0].conversionRate).toBe(50);
    expect(rows[0].total).toBe(10);
  });

  it('leaves conversion null when nothing from a source has finished', () => {
    const [row] = buildSourcePerformance([open({ source: 'website' })]);
    expect(row.conversionRate).toBeNull();
    expect(row.decided).toBe(0);
  });

  it('folds case variants of the same source into one row', () => {
    const rows = buildSourcePerformance([
      open({ source: 'Website' }), open({ source: 'website' }), open({ source: 'WEBSITE' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(3);
  });

  it('keeps leads with no source instead of dropping them from the totals', () => {
    // Dropping them would make the report disagree with the pipeline count
    // sitting next to it, which is worse than an untidy row.
    const rows = buildSourcePerformance([
      open({ source: null }), open({ source: '' }), open({ source: 'referral' }),
    ]);
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(3);
    expect(rows.find(r => r.label === 'Unspecified').total).toBe(2);
  });

  it('keeps an unrecognised source under its own readable name', () => {
    const [row] = buildSourcePerformance([open({ source: 'billboard' })]);
    expect(row.label).toBe('Billboard');
    expect(row.known).toBe(false);
  });

  it('reports each source share of all leads', () => {
    const rows = buildSourcePerformance([
      open({ source: 'referral' }), open({ source: 'referral' }),
      open({ source: 'website' }), open({ source: 'website' }),
    ]);
    expect(rows.every(r => r.shareOfLeads === 50)).toBe(true);
  });

  it('carries the leads so a channel can be drilled into', () => {
    const [row] = buildSourcePerformance([open({ source: 'referral', full_name: 'Mary' })]);
    expect(row.leads.map(l => l.full_name)).toEqual(['Mary']);
  });

  it('returns nothing for no leads rather than throwing', () => {
    expect(buildSourcePerformance([])).toEqual([]);
    expect(buildSourcePerformance()).toEqual([]);
  });
});

describe('buildLossAnalysis', () => {
  const lost = (reason, o = {}) =>
    lead({ stage: 'closed', converted_at: null, lost_reason: reason, ...o });

  it('counts only lost leads — a win closed on the same board is not a loss', () => {
    const a = buildLossAnalysis([
      lost('price'),
      lead({ stage: 'closed', converted_at: at(-1) }),  // won
      lead({ stage: 'contacted' }),                     // still open
    ]);
    expect(a.totalLost).toBe(1);
  });

  it('ranks reasons by how often they happen', () => {
    const a = buildLossAnalysis([
      lost('price'), lost('price'), lost('price'),
      lost('financing'), lost('financing'),
      lost('competitor'),
    ]);
    expect(a.reasons.map(r => r.reason)).toEqual(['price', 'financing', 'competitor']);
    expect(a.topReason.count).toBe(3);
  });

  it('reports how much of the loss picture is actually filled in', () => {
    const a = buildLossAnalysis([lost('price'), lost(null), lost(null), lost(null)]);
    expect(a.totalLost).toBe(4);
    expect(a.recorded).toBe(1);
    expect(a.unrecorded).toBe(3);
    expect(a.coverage).toBe(25);
  });

  it('takes each reason share of RECORDED losses, not of all of them', () => {
    // Dividing by all losses would shrink every bar by however much is
    // unrecorded, making the biggest problem look smaller than it is.
    const a = buildLossAnalysis([lost('price'), lost('price'), lost(null), lost(null)]);
    expect(a.reasons[0].share).toBe(100);
  });

  it('gives no coverage figure when nothing has been lost at all', () => {
    const a = buildLossAnalysis([lead({ stage: 'contacted' })]);
    expect(a.totalLost).toBe(0);
    expect(a.coverage).toBeNull();
    expect(a.topReason).toBeNull();
  });

  it('keeps an unrecognised reason rather than silently discarding the loss', () => {
    const a = buildLossAnalysis([lost('act_of_god')]);
    expect(a.recorded).toBe(1);
    expect(a.reasons[0].label).toBe('Act Of God');
  });

  it('carries the leads so a reason can be drilled into', () => {
    const a = buildLossAnalysis([lost('price', { full_name: 'Brian' })]);
    expect(a.reasons[0].leads.map(l => l.full_name)).toEqual(['Brian']);
  });

  it('survives empty input', () => {
    expect(() => buildLossAnalysis([])).not.toThrow();
    expect(() => buildLossAnalysis()).not.toThrow();
  });
});

describe('crm vocabulary', () => {
  it('agrees with the database CHECK constraint on lost_reason', () => {
    // 20260828140000 hard-codes this list. If the UI offers a value the
    // constraint rejects, closing a lead fails at the last possible moment.
    expect([...LOST_REASON_VALUES].sort()).toEqual([
      'changed_mind', 'competitor', 'financing', 'no_response',
      'no_stock', 'not_ready', 'other', 'price', 'unqualified',
    ]);
  });

  it('treats closed-without-converting as lost, and nothing else', () => {
    expect(isLostLead({ stage: 'closed', converted_at: null })).toBe(true);
    expect(isLostLead({ stage: 'closed', converted_at: at(-1) })).toBe(false);
    expect(isLostLead({ stage: 'qualified', converted_at: null })).toBe(false);
    expect(isLostLead(null)).toBe(false);
  });

  it('never returns a blank label for a source', () => {
    for (const v of [null, '', 'referral', 'something_new']) {
      expect(sourceMeta(v).label, String(v)).toBeTruthy();
    }
  });
});
