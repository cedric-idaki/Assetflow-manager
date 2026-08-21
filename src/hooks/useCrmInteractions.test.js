import { describe, it, expect } from 'vitest';
import {
  daysSince,
  deriveInteractionStats,
  deriveStaleLeads,
  outcomeMeta,
  typeMeta,
  STALE_CONTACT_DAYS,
} from './useCrmInteractions';

// A fixed "now" so the boundary cases stay boundary cases.
const NOW = new Date('2026-08-20T12:00:00.000Z').getTime();
const DAY = 86400000;
const at = (days) => new Date(NOW + days * DAY).toISOString();

const touch = (o = {}) => ({
  id: 'i-1',
  agent_id: 'agent-1',
  lead_id: 'lead-1',
  interaction_type: 'call',
  direction: 'outbound',
  outcome: null,
  occurred_at: at(-1),
  ...o,
});

const lead = (o = {}) => ({
  id: 'lead-1',
  full_name: 'Alice Mwangi',
  stage: 'contacted',
  converted_at: null,
  last_contact_at: at(-2),
  created_at: at(-40),
  ...o,
});

describe('daysSince', () => {
  it('counts whole days back from now', () => {
    expect(daysSince(at(-3), NOW)).toBe(3);
    expect(daysSince(at(0), NOW)).toBe(0);
  });

  it('returns null for missing or unparseable dates', () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('not a date', NOW)).toBeNull();
  });
});

describe('deriveInteractionStats', () => {
  it('counts an empty book as zero rather than throwing', () => {
    const s = deriveInteractionStats([], NOW);
    expect(s.total).toBe(0);
    expect(s.thisWeek).toBe(0);
    expect(s.positiveRate).toBeNull();
  });

  it('splits the week from the month at the right boundary', () => {
    const s = deriveInteractionStats([
      touch({ id: 'a', occurred_at: at(-1) }),
      touch({ id: 'b', occurred_at: at(-6) }),
      touch({ id: 'c', occurred_at: at(-8) }),   // outside the week
      touch({ id: 'd', occurred_at: at(-40) }),  // outside the month
    ], NOW);
    expect(s.thisWeek).toBe(2);
    expect(s.thisMonth).toBe(3);
    expect(s.total).toBe(4);
  });

  it('rates only the contacts that carry an outcome', () => {
    // 1 positive, 1 negative, 1 unrated: 50%, not 33%. An agent who skips the
    // dropdown must not be scored as having failed.
    const s = deriveInteractionStats([
      touch({ id: 'a', outcome: 'deal_agreed' }),
      touch({ id: 'b', outcome: 'no_answer' }),
      touch({ id: 'c', outcome: null }),
    ], NOW);
    expect(s.positiveRate).toBe(50);
  });

  it('counts distinct people, not rows', () => {
    const s = deriveInteractionStats([
      touch({ id: 'a', lead_id: 'lead-1' }),
      touch({ id: 'b', lead_id: 'lead-1' }),
      touch({ id: 'c', lead_id: null, client_id: 'client-9' }),
      touch({ id: 'd', lead_id: null, client_id: null, contact_name: 'Walk-in' }),
    ], NOW);
    expect(s.contactsTouched).toBe(3);
  });

  it('tallies by type for the filter chips', () => {
    const s = deriveInteractionStats([
      touch({ id: 'a', interaction_type: 'call' }),
      touch({ id: 'b', interaction_type: 'call' }),
      touch({ id: 'c', interaction_type: 'meeting' }),
    ], NOW);
    expect(s.byType.call).toBe(2);
    expect(s.byType.meeting).toBe(1);
  });

  it('falls back to created_at when a row has no occurred_at', () => {
    const s = deriveInteractionStats(
      [{ id: 'a', occurred_at: null, created_at: at(-2) }],
      NOW,
    );
    expect(s.thisWeek).toBe(1);
  });
});

describe('deriveStaleLeads', () => {
  it('leaves recently contacted leads alone', () => {
    expect(deriveStaleLeads([lead({ last_contact_at: at(-2) })], NOW)).toHaveLength(0);
  });

  it('flags a lead once it crosses the quiet threshold', () => {
    const rows = deriveStaleLeads([lead({ last_contact_at: at(-STALE_CONTACT_DAYS) })], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].quietDays).toBe(STALE_CONTACT_DAYS);
  });

  it('ignores converted and closed leads — they are not owed a call', () => {
    const rows = deriveStaleLeads([
      lead({ id: 'a', last_contact_at: at(-60), converted_at: at(-30) }),
      lead({ id: 'b', last_contact_at: at(-60), stage: 'closed' }),
    ], NOW);
    expect(rows).toHaveLength(0);
  });

  it('treats a never-contacted lead by its registration date', () => {
    const rows = deriveStaleLeads([lead({ last_contact_at: null, created_at: at(-30) })], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].quietDays).toBe(30);
  });

  it('surfaces a lead with no usable dates rather than hiding it', () => {
    // No last_contact_at and no created_at is exactly the row most likely to be
    // forgotten, so it must not be filtered out by an unparseable date.
    const rows = deriveStaleLeads([lead({ last_contact_at: null, created_at: null })], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].quietDays).toBeNull();
  });

  it('sorts coldest first, with never-contacted at the top', () => {
    const rows = deriveStaleLeads([
      lead({ id: 'a', last_contact_at: at(-20) }),
      lead({ id: 'b', last_contact_at: at(-45) }),
      lead({ id: 'c', last_contact_at: null, created_at: null }),
    ], NOW);
    expect(rows.map(r => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('metadata lookups', () => {
  it('never returns undefined for an unknown type', () => {
    expect(typeMeta('carrier_pigeon').icon).toBe('Circle');
  });

  it('returns null for an unknown outcome so callers can skip the badge', () => {
    expect(outcomeMeta('vibes')).toBeNull();
    expect(outcomeMeta('deal_agreed').sentiment).toBe('positive');
  });
});
