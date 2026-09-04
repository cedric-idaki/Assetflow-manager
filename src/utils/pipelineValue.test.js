import { describe, it, expect } from 'vitest';
import {
  parseBudgetRange,
  leadValue,
  leadProbability,
  weightedValue,
  isOpenLead,
  parseLocalDate,
  summariseOpportunities,
  forecastByMonth,
  formatCompactMoney,
  formatMoney,
} from './pipelineValue';

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

// A fixed "now" so month boundaries are the same on every machine that runs
// this — mid-month on purpose, so "this month" has room on both sides.
const NOW = new Date(2026, 7, 15, 12, 0, 0).getTime(); // 15 Aug 2026, local

describe('parseBudgetRange', () => {
  it('reads a plain number, with or without separators', () => {
    expect(parseBudgetRange('2000000')).toMatchObject({ value: 2000000, kind: 'exact' });
    expect(parseBudgetRange('2,000,000')).toMatchObject({ value: 2000000, kind: 'exact' });
  });

  it('expands k / m / b suffixes, upper or lower case', () => {
    expect(parseBudgetRange('500k').value).toBe(500000);
    expect(parseBudgetRange('5M').value).toBe(5000000);
    expect(parseBudgetRange('1.5m').value).toBe(1500000);
    expect(parseBudgetRange('2B').value).toBe(2000000000);
  });

  it('strips currency words without eating the number', () => {
    expect(parseBudgetRange('KES 3,500,000').value).toBe(3500000);
    expect(parseBudgetRange('Ksh 3.5M').value).toBe(3500000);
    expect(parseBudgetRange('KShs. 750,000').value).toBe(750000);
  });

  it('takes the LOW end of a range, never the optimistic end', () => {
    const r = parseBudgetRange('2,000,000 - 5,000,000');
    expect(r).toMatchObject({ value: 2000000, kind: 'range', low: 2000000, high: 5000000 });
  });

  it('reads a range written with an en dash or the word "to"', () => {
    expect(parseBudgetRange('2,000,000 – 5,000,000').value).toBe(2000000);
    expect(parseBudgetRange('500k to 1m')).toMatchObject({ low: 500000, high: 1000000 });
  });

  it('lends the magnitude across a range that only wrote it once', () => {
    // "2 - 5M" means two million to five million; a bare 2 is not a budget.
    expect(parseBudgetRange('2 - 5M')).toMatchObject({ low: 2000000, high: 5000000 });
    // ...but a low end that already stands on its own is left alone.
    expect(parseBudgetRange('500000 - 2M')).toMatchObject({ low: 500000, high: 2000000 });
  });

  it('sorts a range that was written backwards', () => {
    expect(parseBudgetRange('5M - 2M')).toMatchObject({ low: 2000000, high: 5000000 });
  });

  it('marks a ceiling and a floor as what they are', () => {
    expect(parseBudgetRange('under 500k')).toMatchObject({ value: 500000, kind: 'ceiling' });
    expect(parseBudgetRange('under_500k')).toMatchObject({ value: 500000, kind: 'ceiling' });
    expect(parseBudgetRange('up to 2M')).toMatchObject({ kind: 'ceiling' });
    expect(parseBudgetRange('above 2M')).toMatchObject({ value: 2000000, kind: 'floor' });
    expect(parseBudgetRange('2M+')).toMatchObject({ value: 2000000, kind: 'floor' });
  });

  it('refuses text that is not money', () => {
    expect(parseBudgetRange('3 bedroom')).toBeNull();
    expect(parseBudgetRange('negotiable')).toBeNull();
    expect(parseBudgetRange('')).toBeNull();
    expect(parseBudgetRange('   ')).toBeNull();
    expect(parseBudgetRange(null)).toBeNull();
    expect(parseBudgetRange(undefined)).toBeNull();
  });

  it('refuses a number too small to be a price here', () => {
    // Without a floor, "2 acres" becomes a KES 2 opportunity that gets summed.
    expect(parseBudgetRange('2 acres')).toBeNull();
    expect(parseBudgetRange('999')).toBeNull();
    expect(parseBudgetRange('1000')).toMatchObject({ value: 1000 });
  });

  it('does not read a suffix out of the middle of a word', () => {
    // The 'b' of "bedroom" must not turn 5 into five billion.
    expect(parseBudgetRange('5 bedroom')).toBeNull();
    expect(parseBudgetRange('4 km from town')).toBeNull();
  });
});

describe('leadValue', () => {
  it('prefers the stated value over the budget note', () => {
    const l = lead({ deal_value: 3000000, budget_range: 'under 500k' });
    expect(leadValue(l)).toMatchObject({ value: 3000000, source: 'stated' });
  });

  it('accepts a numeric string, as PostgREST sends DECIMAL columns', () => {
    expect(leadValue(lead({ deal_value: '2500000.00' }))).toMatchObject({
      value: 2500000, source: 'stated',
    });
  });

  it('treats a deliberate zero as stated, not missing', () => {
    expect(leadValue(lead({ deal_value: 0, budget_range: '5M' }))).toMatchObject({
      value: 0, source: 'stated',
    });
  });

  it('falls back to the budget note, marked as an estimate', () => {
    const v = leadValue(lead({ budget_range: '2,000,000 - 5,000,000' }));
    expect(v.value).toBe(2000000);
    expect(v.source).toBe('estimated');
    expect(v.budget.kind).toBe('range');
  });

  it('returns zero rather than null when there is nothing to read', () => {
    // Every caller sums these; a null here is how a pipeline total becomes NaN.
    expect(leadValue(lead())).toEqual({ value: 0, source: 'none', budget: null });
    expect(leadValue(null)).toEqual({ value: 0, source: 'none', budget: null });
  });
});

describe('leadProbability', () => {
  it('uses the stage default when nobody has assessed the deal', () => {
    expect(leadProbability(lead({ stage: 'new_lead' }))).toBe(10);
    expect(leadProbability(lead({ stage: 'contacted' }))).toBe(20);
    expect(leadProbability(lead({ stage: 'qualified' }))).toBe(40);
    expect(leadProbability(lead({ stage: 'proposal_sent' }))).toBe(60);
  });

  it('lets a per-deal override beat the stage', () => {
    expect(leadProbability(lead({ stage: 'new_lead', win_probability: 85 }))).toBe(85);
    expect(leadProbability(lead({ stage: 'proposal_sent', win_probability: 5 }))).toBe(5);
  });

  it('clamps an out-of-range override rather than trusting it', () => {
    expect(leadProbability(lead({ win_probability: 150 }))).toBe(100);
    expect(leadProbability(lead({ win_probability: -20 }))).toBe(0);
  });

  it('settles at 100 or 0 once the deal is decided, overrides included', () => {
    // A won deal is not a 60% forecast, and a lost one is not money we might
    // still get — whatever the stage weight or override says.
    expect(leadProbability(lead({ stage: 'closed', converted_at: '2026-08-01', win_probability: 60 }))).toBe(100);
    expect(leadProbability(lead({ stage: 'closed', converted_at: null, win_probability: 60 }))).toBe(0);
  });

  it('gives an unrecognised stage no forecast weight at all', () => {
    expect(leadProbability(lead({ stage: 'on_hold' }))).toBe(0);
  });
});

describe('weightedValue', () => {
  it('is value times odds', () => {
    expect(weightedValue(lead({ deal_value: 1000000, stage: 'qualified' }))).toBe(400000);
    expect(weightedValue(lead({ deal_value: 1000000, stage: 'proposal_sent' }))).toBe(600000);
    expect(weightedValue(lead({ deal_value: 1000000, win_probability: 25 }))).toBe(250000);
  });
});

describe('isOpenLead', () => {
  it('excludes converted and closed leads', () => {
    expect(isOpenLead(lead({ stage: 'qualified' }))).toBe(true);
    expect(isOpenLead(lead({ stage: 'closed' }))).toBe(false);
    expect(isOpenLead(lead({ stage: 'qualified', converted_at: '2026-08-01' }))).toBe(false);
    expect(isOpenLead(null)).toBe(false);
  });
});

describe('parseLocalDate', () => {
  it('reads a DATE column as a local day, not a UTC instant', () => {
    // new Date('2026-08-31') is UTC midnight, which is 30 Aug locally anywhere
    // west of Greenwich — the deal would drop out of the month it is due in.
    const d = parseLocalDate('2026-08-31');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(31);
  });

  it('passes a Date through and rejects nonsense', () => {
    const d = new Date(2026, 0, 2);
    expect(parseLocalDate(d)).toBe(d);
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate('not a date')).toBeNull();
  });
});

describe('summariseOpportunities', () => {
  const book = [
    lead({ stage: 'new_lead',      deal_value: 1000000 }),                                   // w 100k
    lead({ stage: 'contacted',     deal_value: 2000000 }),                                   // w 400k
    lead({ stage: 'qualified',     deal_value: 4000000, expected_close_date: '2026-08-28' }), // w 1.6M
    lead({ stage: 'proposal_sent', deal_value: 5000000, expected_close_date: '2026-08-01' }), // overdue, w 3M
    lead({ stage: 'proposal_sent', deal_value: 3000000, expected_close_date: '2026-11-10' }), // w 1.8M
    lead({ stage: 'qualified',     budget_range: '2M - 6M' }),                                // estimated 2M, w 800k
    lead({ stage: 'contacted' }),                                                             // no value at all
    lead({ stage: 'closed', converted_at: '2026-08-05', deal_value: 8000000 }),               // won this month
    lead({ stage: 'closed', converted_at: '2026-05-05', deal_value: 6000000 }),               // won earlier
    lead({ stage: 'closed', converted_at: null, deal_value: 9000000 }),                       // lost
  ];

  const s = summariseOpportunities(book, NOW);

  it('counts only still-winnable deals as open pipeline', () => {
    expect(s.open.count).toBe(7);
    // 1 + 2 + 4 + 5 + 3 + 2 (estimated) + 0 = 17M
    expect(s.open.value).toBe(17000000);
  });

  it('keeps stated money and estimated money apart, and they sum to the total', () => {
    expect(s.statedValue).toBe(15000000);
    expect(s.estimatedValue).toBe(2000000);
    expect(s.statedValue + s.estimatedValue).toBe(s.open.value);
  });

  it('weights the forecast by stage', () => {
    // 100k + 400k + 1.6M + 3M + 1.8M + 800k + 0
    expect(s.open.weighted).toBe(7700000);
  });

  it('counts an opportunity as a qualified-or-proposal deal', () => {
    expect(s.opportunities.count).toBe(4);
    expect(s.opportunities.value).toBe(14000000);
  });

  it('splits the open book by stage, and the columns add up to the total', () => {
    expect(s.byStage.new_lead.count).toBe(1);
    expect(s.byStage.contacted.count).toBe(2);
    expect(s.byStage.qualified.count).toBe(2);
    expect(s.byStage.proposal_sent.count).toBe(2);
    // The panel shows these under the headline figure; if they disagreed with
    // it, the agent would be right not to trust either.
    const summed = Object.values(s.byStage).reduce((t, b) => t + b.value, 0);
    expect(summed).toBe(s.open.value);
  });

  it('gives an empty column to a stage with nothing in it', () => {
    const one = summariseOpportunities([lead({ stage: 'qualified', deal_value: 1000 })], NOW);
    expect(one.byStage.new_lead).toMatchObject({ count: 0, value: 0 });
  });

  it('separates deals due this month from ones whose date has already passed', () => {
    expect(s.closingThisMonth.count).toBe(1);
    expect(s.closingThisMonth.value).toBe(4000000);
    expect(s.overdue.count).toBe(1);
    expect(s.overdue.value).toBe(5000000);
  });

  it('lists open deals with no close date rather than dropping them', () => {
    expect(s.undated.count).toBe(4);
  });

  it('flags what still needs a value, and which of those are one click away', () => {
    // Two open deals lack a stated value; one of them has a readable budget.
    expect(s.unvalued.count).toBe(2);
    expect(s.unvalued.withBudgetHint).toBe(1);
  });

  it('separates won this month from won ever', () => {
    expect(s.won.count).toBe(2);
    expect(s.won.value).toBe(14000000);
    expect(s.wonThisMonth.count).toBe(1);
    expect(s.wonThisMonth.value).toBe(8000000);
  });

  it('counts the full size of a lost deal, not a fraction of it', () => {
    expect(s.lost.count).toBe(1);
    expect(s.lost.value).toBe(9000000);
  });

  it('measures the win rate in money, not headcount', () => {
    // 14M won against 9M lost. By count it would be 2 of 3, a flattering 67%.
    expect(s.valueWinRate).toBe(61);
  });

  it('averages only the won deals that carry a value', () => {
    expect(s.avgWonValue).toBe(7000000);
  });

  it('names the biggest open deal', () => {
    expect(s.biggest.deal_value).toBe(5000000);
  });

  it('survives an empty book without inventing numbers', () => {
    const e = summariseOpportunities([], NOW);
    expect(e.open).toMatchObject({ count: 0, value: 0, weighted: 0 });
    expect(e.valueWinRate).toBeNull();
    expect(e.avgWonValue).toBeNull();
    expect(e.biggest).toBeNull();
  });

  it('ignores holes in the list', () => {
    const withHoles = summariseOpportunities([null, undefined, lead({ deal_value: 1000 })], NOW);
    expect(withHoles.open.count).toBe(1);
  });

  it('never lets a deal be counted in two buckets', () => {
    const total = s.open.count + s.won.count + s.lost.count;
    expect(total).toBe(book.length);
  });
});

describe('forecastByMonth', () => {
  it('buckets open deals into the months they are due', () => {
    const rows = forecastByMonth([
      lead({ stage: 'qualified',     deal_value: 1000000, expected_close_date: '2026-08-20' }),
      lead({ stage: 'proposal_sent', deal_value: 2000000, expected_close_date: '2026-09-02' }),
      lead({ stage: 'qualified',     deal_value: 4000000, expected_close_date: '2026-09-30' }),
    ], 3, NOW);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ key: '2026-08', count: 1, value: 1000000, weighted: 400000 });
    expect(rows[1]).toMatchObject({ key: '2026-09', count: 2, value: 6000000 });
    expect(rows[2]).toMatchObject({ key: '2026-10', count: 0, value: 0 });
  });

  it('leaves out deals that are undated, settled or beyond the window', () => {
    const rows = forecastByMonth([
      lead({ stage: 'qualified', deal_value: 1000000 }),
      lead({ stage: 'closed', converted_at: '2026-08-01', deal_value: 9000000, expected_close_date: '2026-08-20' }),
      lead({ stage: 'qualified', deal_value: 5000000, expected_close_date: '2027-06-01' }),
    ], 3, NOW);
    expect(rows.reduce((t, r) => t + r.count, 0)).toBe(0);
  });
});

describe('formatting', () => {
  it('shortens money enough to fit a stat tile', () => {
    expect(formatCompactMoney(0)).toBe('KES 0');
    expect(formatCompactMoney(950)).toBe('KES 950');
    expect(formatCompactMoney(12500)).toBe('KES 12.5K');
    expect(formatCompactMoney(125000)).toBe('KES 125K');
    expect(formatCompactMoney(1250000)).toBe('KES 1.3M');
    expect(formatCompactMoney(12500000)).toBe('KES 13M');
    expect(formatCompactMoney(1250000000)).toBe('KES 1.3B');
    expect(formatCompactMoney(-1250000)).toBe('-KES 1.3M');
  });

  it('never renders a missing figure as NaN', () => {
    expect(formatCompactMoney(null)).toBe('KES 0');
    expect(formatCompactMoney(undefined)).toBe('KES 0');
    expect(formatMoney(null)).toBe('KES 0');
  });

  it('keeps the exact digits where precision matters', () => {
    expect(formatMoney(2500000)).toBe(`KES ${(2500000).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  });
});
