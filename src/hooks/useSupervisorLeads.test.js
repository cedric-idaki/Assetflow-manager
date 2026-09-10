import { describe, it, expect } from 'vitest';
import {
  groupByStage, summariseLeadBook, buildLeadExport, STALE_LEAD_DAYS,
} from './useSupervisorLeads';

const NOW = new Date('2026-08-31T12:00:00.000Z').getTime();
const DAY = 86400000;
const at = (days) => new Date(NOW + days * DAY).toISOString();

const lead = (o = {}) => ({
  id: `l-${Math.random()}`,
  agent_id: null,
  full_name: 'Njeri Kamau',
  phone: '0722000000',
  stage: 'new_lead',
  priority: 'medium',
  deal_value: null,
  budget_range: null,
  win_probability: null,
  converted_at: null,
  lost_reason: null,
  interaction_count: 0,
  last_contact_at: null,
  next_follow_up_at: null,
  created_at: at(-30),
  ...o,
});

describe('groupByStage', () => {
  it('gives every pipeline stage a column, empty ones included', () => {
    const board = groupByStage([lead({ stage: 'qualified' })]);

    expect(Object.keys(board)).toEqual(
      expect.arrayContaining(['new_lead', 'contacted', 'qualified', 'proposal_sent', 'closed']),
    );
    expect(board.qualified).toHaveLength(1);
    expect(board.new_lead).toEqual([]);
    expect(board.closed).toEqual([]);
  });

  it('keeps a lead whose stage the board has never heard of', () => {
    const board = groupByStage([lead({ stage: 'negotiating' })]);
    expect(board.negotiating).toHaveLength(1);
  });

  it('files a lead with no stage under new_lead rather than dropping it', () => {
    const board = groupByStage([lead({ stage: null })]);
    expect(board.new_lead).toHaveLength(1);
  });
});

describe('summariseLeadBook', () => {
  it('separates never-contacted from gone-quiet', () => {
    const never = lead({ last_contact_at: null, interaction_count: 0 });
    const quiet = lead({ last_contact_at: at(-(STALE_LEAD_DAYS + 1)), interaction_count: 3 });
    const fresh = lead({ last_contact_at: at(-1), interaction_count: 1 });

    const s = summariseLeadBook([never, quiet, fresh], NOW);

    expect(s.unworked.map(l => l.id)).toEqual([never.id]);
    expect(s.stale.map(l => l.id)).toEqual([quiet.id]);
  });

  it('counts only settled deals in the conversion rate', () => {
    const won  = lead({ stage: 'closed', converted_at: at(-2) });
    const lost = lead({ stage: 'closed' });
    const open = lead({ stage: 'proposal_sent' });

    const s = summariseLeadBook([won, lost, open], NOW);

    expect(s.won).toBe(1);
    expect(s.lost).toBe(1);
    expect(s.open).toBe(1);
    // One win out of two settled — the open deal must not drag it to 33%.
    expect(s.conversionRate).toBe(50);
  });

  it('reports no conversion rate at all when nothing has settled', () => {
    expect(summariseLeadBook([lead(), lead({ stage: 'contacted' })], NOW).conversionRate).toBeNull();
  });

  it('counts an opportunity only while it is still winnable', () => {
    const qualified = lead({ stage: 'qualified' });
    const proposal  = lead({ stage: 'proposal_sent' });
    const early     = lead({ stage: 'contacted' });
    const banked    = lead({ stage: 'qualified', converted_at: at(-3) });

    const s = summariseLeadBook([qualified, proposal, early, banked], NOW);
    expect(s.opportunities).toBe(2);
  });

  it('weights the forecast by stage odds and leaves settled deals out of it', () => {
    // qualified defaults to 40%, proposal_sent to 60%.
    const a = lead({ stage: 'qualified',     deal_value: 1000000 });
    const b = lead({ stage: 'proposal_sent', deal_value: 2000000 });
    const settled = lead({ stage: 'closed',  deal_value: 5000000 });

    const s = summariseLeadBook([a, b, settled], NOW);

    expect(s.pipelineValue).toBe(3000000);
    expect(s.weightedValue).toBe(1000000 * 0.4 + 2000000 * 0.6);
  });

  it('honours a per-deal probability over the stage default', () => {
    const s = summariseLeadBook([lead({ stage: 'qualified', deal_value: 1000000, win_probability: 90 })], NOW);
    expect(s.weightedValue).toBe(900000);
  });

  it('breaks the book down by stage with a value on each column', () => {
    const s = summariseLeadBook([
      lead({ stage: 'new_lead',  deal_value: 100 }),
      lead({ stage: 'new_lead',  deal_value: 200 }),
      lead({ stage: 'qualified', deal_value: 500 }),
    ], NOW);

    const byStage = Object.fromEntries(s.byStage.map(x => [x.stage, x]));
    expect(byStage.new_lead.count).toBe(2);
    expect(byStage.new_lead.value).toBe(300);
    expect(byStage.qualified.count).toBe(1);
    expect(byStage.proposal_sent.count).toBe(0);
  });

  it('keeps each column identified by its stage, not by its money', () => {
    // `value` on a PIPELINE_STAGES entry is the stage key and `value` here is a
    // total, so a naive spread loses the column identity entirely.
    const s = summariseLeadBook([lead({ stage: 'qualified', deal_value: 500 })], NOW);
    const qualified = s.byStage.find(x => x.stage === 'qualified');

    expect(qualified).toBeDefined();
    expect(qualified.label).toBe('Qualified');
    expect(qualified.value).toBe(500);
  });

  it('survives an empty book without producing NaN', () => {
    const s = summariseLeadBook([], NOW);
    expect(s).toMatchObject({ total: 0, open: 0, won: 0, lost: 0, pipelineValue: 0, weightedValue: 0 });
    expect(s.conversionRate).toBeNull();
  });
});

describe('buildLeadExport', () => {
  it('writes stage labels rather than raw enum values', () => {
    const [row] = buildLeadExport([lead({ stage: 'proposal_sent', deal_value: 750000 })]);
    expect(row.Stage).toBe('Proposal sent');
    expect(row['Deal value']).toBe(750000);
  });

  it('leaves a missing value blank instead of writing a confident zero', () => {
    const [row] = buildLeadExport([lead({ deal_value: null, expected_close_date: null })]);
    expect(row['Deal value']).toBe('');
    expect(row['Expected close']).toBe('');
  });
});
