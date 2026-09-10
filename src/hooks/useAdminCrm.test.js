import { describe, it, expect } from 'vitest';
import {
  deriveClientBook, bucketFollowUps, summariseAdminCrm, dailyActivity,
  isTenantOwned, buildClientCrmExport, buildActivityExport, CLIENT_QUIET_DAYS,
} from './useAdminCrm';

const NOW = new Date('2026-08-30T12:00:00.000Z').getTime();
const DAY = 86400000;
const at = (days, hours = 0) => new Date(NOW + days * DAY + hours * 3600000).toISOString();

const client = (o = {}) => ({
  id: `c-${Math.random()}`,
  full_name: 'Jane Mwangi',
  account_number: 'AC-001',
  client_status: 'active',
  outstanding_balance: 0,
  interaction_count: 0,
  last_contact_at: null,
  last_interaction_type: null,
  ...o,
});

const touch = (o = {}) => ({
  id: `i-${Math.random()}`,
  agent_id: null,
  client_id: null,
  interaction_type: 'call',
  direction: 'outbound',
  outcome: null,
  occurred_at: at(-1),
  ...o,
});

const follow = (o = {}) => ({
  id: `f-${Math.random()}`,
  agent_id: null,
  client_id: null,
  appointment_type: 'call',
  scheduled_at: at(1),
  is_completed: false,
  completed_at: null,
  ...o,
});

describe('isTenantOwned', () => {
  it('is true only when no agent wrote the row', () => {
    expect(isTenantOwned({ agent_id: null })).toBe(true);
    expect(isTenantOwned({ agent_id: undefined })).toBe(true);
    expect(isTenantOwned({ agent_id: 'a1' })).toBe(false);
    expect(isTenantOwned(null)).toBe(false);
  });
});

describe('deriveClientBook', () => {
  it('marks a client nobody has ever contacted', () => {
    const [row] = deriveClientBook({ clients: [client({ id: 'c1' })], now: NOW });
    expect(row.contactState).toBe('never');
    expect(row.lastContactAt).toBeNull();
    expect(row.quietDays).toBeNull();
    expect(row.touchCount).toBe(0);
  });

  it('separates a recently contacted client from one that has gone quiet', () => {
    const book = deriveClientBook({
      clients: [
        client({ id: 'warm', last_contact_at: at(-2) }),
        client({ id: 'cold', last_contact_at: at(-(CLIENT_QUIET_DAYS + 5)) }),
      ],
      now: NOW,
    });
    expect(book.find(c => c.id === 'warm').contactState).toBe('recent');
    expect(book.find(c => c.id === 'cold').contactState).toBe('quiet');
    expect(book.find(c => c.id === 'cold').quietDays).toBe(CLIENT_QUIET_DAYS + 5);
  });

  it('prefers a freshly logged contact over a stale column, and vice versa', () => {
    // The trigger has not caught up yet: the fetched touch is newer.
    const [optimistic] = deriveClientBook({
      clients: [client({ id: 'c1', last_contact_at: at(-40) })],
      interactions: [touch({ client_id: 'c1', occurred_at: at(0) })],
      now: NOW,
    });
    expect(optimistic.lastContactAt).toBe(at(0));
    expect(optimistic.contactState).toBe('recent');

    // The touch window has aged past this client's real last contact: the
    // column is authoritative and the client is NOT reported as never-contacted.
    const [windowed] = deriveClientBook({
      clients: [client({ id: 'c1', last_contact_at: at(-5), interaction_count: 12 })],
      interactions: [],
      now: NOW,
    });
    expect(windowed.lastContactAt).toBe(at(-5));
    expect(windowed.touchCount).toBe(12);
  });

  it('attaches the soonest open follow-up and flags an overdue one', () => {
    const [row] = deriveClientBook({
      clients: [client({ id: 'c1' })],
      followUps: [
        follow({ id: 'later', client_id: 'c1', scheduled_at: at(5) }),
        follow({ id: 'soon', client_id: 'c1', scheduled_at: at(-1) }),
        follow({ id: 'done', client_id: 'c1', scheduled_at: at(-9), is_completed: true }),
      ],
      now: NOW,
    });
    expect(row.nextFollowUp.id).toBe('soon');
    expect(row.followUpOverdue).toBe(true);
    expect(row.openFollowUps).toBe(2);
  });

  it('orders a client timeline newest first and keeps agent-logged contact in it', () => {
    const [row] = deriveClientBook({
      clients: [client({ id: 'c1' })],
      interactions: [
        touch({ id: 'old', client_id: 'c1', occurred_at: at(-9) }),
        touch({ id: 'new', client_id: 'c1', occurred_at: at(-1), agent_id: 'a1' }),
      ],
      now: NOW,
    });
    expect(row.touches.map(t => t.id)).toEqual(['new', 'old']);
    expect(row.lastTouch.agent_id).toBe('a1');
  });
});

describe('bucketFollowUps', () => {
  it('sorts appointments into the day they belong to', () => {
    const d = bucketFollowUps([
      follow({ id: 'overdue', scheduled_at: at(-3) }),
      follow({ id: 'today', scheduled_at: at(0, 4) }),
      follow({ id: 'week', scheduled_at: at(3) }),
      follow({ id: 'later', scheduled_at: at(20) }),
      follow({ id: 'done', scheduled_at: at(-10), is_completed: true, completed_at: at(-10) }),
    ], NOW);

    expect(d.overdue.map(f => f.id)).toEqual(['overdue']);
    expect(d.today.map(f => f.id)).toEqual(['today']);
    expect(d.thisWeek.map(f => f.id)).toEqual(['week']);
    expect(d.later.map(f => f.id)).toEqual(['later']);
    expect(d.completed.map(f => f.id)).toEqual(['done']);
    expect(d.open).toBe(4);
  });

  it('treats an appointment with no usable date as needing attention', () => {
    const d = bucketFollowUps([follow({ id: 'x', scheduled_at: null })], NOW);
    expect(d.overdue.map(f => f.id)).toEqual(['x']);
  });

  it('puts the longest-overdue appointment first', () => {
    const d = bucketFollowUps([
      follow({ id: 'yesterday', scheduled_at: at(-1) }),
      follow({ id: 'last-week', scheduled_at: at(-7) }),
    ], NOW);
    expect(d.overdue.map(f => f.id)).toEqual(['last-week', 'yesterday']);
  });

  it('reports completion as a share of everything booked, and null when nothing was', () => {
    expect(bucketFollowUps([], NOW).completionRate).toBeNull();
    const d = bucketFollowUps([
      follow({ is_completed: true }),
      follow({ is_completed: true }),
      follow({ scheduled_at: at(2) }),
      follow({ scheduled_at: at(3) }),
    ], NOW);
    expect(d.completionRate).toBe(50);
  });
});

describe('dailyActivity', () => {
  it('fills quiet days with zero rather than dropping them', () => {
    const rows = dailyActivity([touch({ occurred_at: at(-1) })], NOW, 5);
    expect(rows).toHaveLength(5);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(1);
    // Oldest first, so a sparkline reads left to right.
    expect(new Date(rows[0].date).getTime()).toBeLessThan(new Date(rows[4].date).getTime());
  });

  it('ignores contacts outside the window and unparseable dates', () => {
    const rows = dailyActivity([
      touch({ occurred_at: at(-60) }),
      touch({ occurred_at: null }),
      touch({ occurred_at: 'not a date' }),
    ], NOW, 7);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(0);
  });
});

describe('summariseAdminCrm', () => {
  const book = deriveClientBook({
    clients: [
      client({ id: 'c1', last_contact_at: at(-1), outstanding_balance: '1500.50' }),
      client({ id: 'c2', last_contact_at: at(-45), outstanding_balance: '80000' }),
      client({ id: 'c3' }),
      client({ id: 'c4', client_status: 'inactive' }),
    ],
    now: NOW,
  });

  it('reports coverage as the share of the book actually reached', () => {
    const s = summariseAdminCrm({ book, now: NOW });
    expect(s.clients.total).toBe(4);
    expect(s.clients.recent).toBe(1);
    expect(s.clients.quiet).toBe(1);
    expect(s.clients.never).toBe(2);
    expect(s.clients.coverageRate).toBe(25);
    expect(s.clients.active).toBe(3);
  });

  it('lists quiet customers who owe money, biggest debt first', () => {
    const s = summariseAdminCrm({ book, now: NOW });
    expect(s.clients.quietWithBalance.map(c => c.id)).toEqual(['c2']);
    expect(s.clients.quietWithBalance[0].outstanding).toBe(80000);
  });

  it('splits the office own contact from the team contact', () => {
    const s = summariseAdminCrm({
      book,
      interactions: [
        touch({ occurred_at: at(-1) }),
        touch({ occurred_at: at(-2) }),
        touch({ occurred_at: at(-1), agent_id: 'a1' }),
        touch({ occurred_at: at(-20), agent_id: 'a1' }),
      ],
      now: NOW,
    });
    expect(s.activity.total).toBe(4);
    expect(s.activity.ownTotal).toBe(2);
    expect(s.activity.ownThisWeek).toBe(2);
    expect(s.activity.teamTotal).toBe(2);
    expect(s.activity.teamThisWeek).toBe(1);
    expect(s.activity.thisMonth).toBe(4);
  });

  it('counts channels and outcomes, keeping unrated contact out of the rate', () => {
    const s = summariseAdminCrm({
      book,
      interactions: [
        touch({ interaction_type: 'call', outcome: 'interested' }),
        touch({ interaction_type: 'call', outcome: 'no_answer' }),
        touch({ interaction_type: 'whatsapp', outcome: null }),
      ],
      now: NOW,
    });
    expect(s.activity.byChannel[0]).toMatchObject({ value: 'call', count: 2 });
    expect(s.activity.byChannel.find(c => c.value === 'whatsapp').count).toBe(1);
    // One positive of two rated. The unrated WhatsApp is not a failure.
    expect(s.activity.positiveRate).toBe(50);
    expect(s.activity.byOutcome.find(o => o.value === null).label).toBe('Not recorded');
  });

  it('counts direction both ways', () => {
    const s = summariseAdminCrm({
      book,
      interactions: [touch({ direction: 'inbound' }), touch({ direction: 'outbound' }), touch({})],
      now: NOW,
    });
    expect(s.activity.inbound).toBe(1);
    expect(s.activity.outbound).toBe(2);
  });

  it('summarises the diary', () => {
    const s = summariseAdminCrm({
      book,
      followUps: [
        follow({ scheduled_at: at(-2) }),
        follow({ scheduled_at: at(0, 3) }),
        follow({ scheduled_at: at(4) }),
        follow({ is_completed: true }),
      ],
      now: NOW,
    });
    expect(s.diary).toMatchObject({ overdue: 1, today: 1, thisWeek: 1, completed: 1, open: 3 });
  });

  it('has no opinion on an empty tenant rather than a confident zero', () => {
    const s = summariseAdminCrm({ now: NOW });
    expect(s.clients.coverageRate).toBeNull();
    expect(s.activity.positiveRate).toBeNull();
    expect(s.diary.completionRate).toBeNull();
  });
});

describe('exports', () => {
  it('writes a client row a spreadsheet can read without a lookup table', () => {
    const book = deriveClientBook({
      clients: [client({ id: 'c1', full_name: 'Jane', last_contact_at: at(-40), interaction_count: 3 })],
      followUps: [follow({ client_id: 'c1', scheduled_at: at(2) })],
      now: NOW,
    });
    const [row] = buildClientCrmExport(book);
    expect(row.Client).toBe('Jane');
    expect(row['Contacts logged']).toBe(3);
    expect(row['Days quiet']).toBe(40);
    expect(row.Relationship).toBe('quiet');
    expect(row['Next follow-up']).not.toBe('');
  });

  it('says never rather than a blank when nobody has made contact', () => {
    const book = deriveClientBook({ clients: [client({ id: 'c1' })], now: NOW });
    expect(buildClientCrmExport(book)[0]['Last contact']).toBe('never');
  });

  it('labels who logged each communication record', () => {
    const rows = buildActivityExport([
      touch({ contact_name: 'Jane', outcome: 'interested' }),
      touch({ contact_name: 'Peter', agent_id: 'a1', direction: 'inbound' }),
    ]);
    expect(rows[0]).toMatchObject({ Contact: 'Jane', Outcome: 'Interested', 'Logged by': 'Office' });
    expect(rows[1]).toMatchObject({ Direction: 'They contacted us', 'Logged by': 'Agent' });
  });
});
