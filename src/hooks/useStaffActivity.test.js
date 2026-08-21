import { describe, it, expect } from 'vitest';
import {
  buildStaffCards,
  buildStaffTotals,
  actionMeta,
  daysSince,
  IDLE_DAYS,
} from './useStaffActivity';

const NOW = new Date('2026-08-20T12:00:00.000Z').getTime();
const DAY = 86400000;
const at = (days) => new Date(NOW + days * DAY).toISOString();

const person = (o = {}) => ({
  id: 'u1', full_name: 'Grace Mwangi', email: 'grace@example.com',
  role: 'accountant', is_active: true, ...o,
});

const log = (o = {}) => ({
  id: 'l1', user_id: 'u1', action: 'create', table_name: 'payments',
  created_at: at(-1), ...o,
});

describe('daysSince', () => {
  it('counts back in whole days and tolerates junk', () => {
    expect(daysSince(at(-5), NOW)).toBe(5);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('nonsense', NOW)).toBeNull();
  });
});

describe('buildStaffCards', () => {
  it('tallies actions by type', () => {
    const [c] = buildStaffCards({
      staff: [person()],
      logs: [
        log({ id: 'a', action: 'create' }),
        log({ id: 'b', action: 'create' }),
        log({ id: 'c', action: 'update' }),
        log({ id: 'd', action: 'delete' }),
        log({ id: 'e', action: 'login' }),
      ],
      now: NOW,
    });
    expect(c.actions).toBe(5);
    expect(c.creates).toBe(2);
    expect(c.updates).toBe(1);
    expect(c.deletes).toBe(1);
    expect(c.logins).toBe(1);
  });

  it('counts distinct active days, not raw actions', () => {
    const [c] = buildStaffCards({
      staff: [person()],
      logs: [
        log({ id: 'a', created_at: at(-1) }),
        log({ id: 'b', created_at: at(-1) }),
        log({ id: 'c', created_at: at(-4) }),
      ],
      now: NOW,
    });
    expect(c.actions).toBe(3);
    expect(c.activeDays).toBe(2);
  });

  it('reports what they spend most time on', () => {
    const [c] = buildStaffCards({
      staff: [person()],
      logs: [
        log({ id: 'a', table_name: 'payments' }),
        log({ id: 'b', table_name: 'payments' }),
        log({ id: 'c', table_name: 'clients' }),
      ],
      now: NOW,
    });
    expect(c.topArea).toEqual({ table: 'payments', count: 2 });
  });

  it('marks a staff member with no activity as never active', () => {
    const [c] = buildStaffCards({ staff: [person()], logs: [], now: NOW });
    expect(c.actions).toBe(0);
    expect(c.neverActive).toBe(true);
    expect(c.activityVisible).toBe(true);
    expect(c.lastActiveAt).toBeNull();
  });

  // The distinction the whole report hangs on: an unreadable row must never be
  // presented as an idle one. Showing 0 there would accuse somebody of doing
  // nothing when the truth is that their rows are stamped under another tenant.
  it('does NOT report an unreadable person as having done nothing', () => {
    const [c] = buildStaffCards({
      staff: [person({ ownershipMismatch: true })],
      logs: [],
      now: NOW,
    });
    expect(c.activityVisible).toBe(false);
    expect(c.neverActive).toBe(false);
    expect(c.ownershipMismatch).toBe(true);
  });

  it('treats a mismatched person whose rows DID come back as visible', () => {
    const [c] = buildStaffCards({
      staff: [person({ ownershipMismatch: true })],
      logs: [log()],
      now: NOW,
    });
    expect(c.activityVisible).toBe(true);
    expect(c.actions).toBe(1);
  });

  it('keeps a log whose author is not in the staff list rather than dropping it', () => {
    const cards = buildStaffCards({
      staff: [person()],
      logs: [log({ id: 'x', user_id: 'ghost' })],
      now: NOW,
    });
    expect(cards).toHaveLength(2);
    expect(cards.find(c => c.userId === 'ghost').name).toBe('Unknown user');
  });

  it('sorts busiest first and leaves idle people on the page', () => {
    const cards = buildStaffCards({
      staff: [person({ id: 'quiet', full_name: 'Quiet Person' }), person({ id: 'busy', full_name: 'Busy Person' })],
      logs: [log({ id: 'a', user_id: 'busy' }), log({ id: 'b', user_id: 'busy' })],
      now: NOW,
    });
    expect(cards.map(c => c.userId)).toEqual(['busy', 'quiet']);
    expect(cards[1].actions).toBe(0);
  });
});

describe('buildStaffTotals', () => {
  const cards = (logs, staff) => buildStaffCards({ staff, logs, now: NOW });

  it('counts who was active in the last seven days', () => {
    const staff = [person({ id: 'a', full_name: 'A' }), person({ id: 'b', full_name: 'B' })];
    const logs = [
      log({ id: '1', user_id: 'a', created_at: at(-2) }),
      log({ id: '2', user_id: 'b', created_at: at(-30) }),
    ];
    const t = buildStaffTotals({ cards: cards(logs, staff), logs, now: NOW });
    expect(t.staff).toBe(2);
    expect(t.activeThisWeek).toBe(1);
    expect(t.actionsThisWeek).toBe(1);
    expect(t.actions).toBe(2);
  });

  it('counts an idle person and a never-active one alike', () => {
    const staff = [person({ id: 'a', full_name: 'A' }), person({ id: 'b', full_name: 'B' })];
    const logs = [log({ id: '1', user_id: 'a', created_at: at(-(IDLE_DAYS + 1)) })];
    const t = buildStaffTotals({ cards: cards(logs, staff), logs, now: NOW });
    expect(t.idle).toBe(2);
  });

  it('counts unreadable people separately from idle ones', () => {
    const staff = [person({ id: 'a', ownershipMismatch: true })];
    const t = buildStaffTotals({ cards: cards([], staff), logs: [], now: NOW });
    expect(t.unreadable).toBe(1);
    expect(t.idle).toBe(0);
  });

  it('surfaces deletions, which are the ones worth noticing', () => {
    const staff = [person()];
    const logs = [log({ id: '1', action: 'delete' }), log({ id: '2', action: 'create' })];
    const t = buildStaffTotals({ cards: cards(logs, staff), logs, now: NOW });
    expect(t.deletes).toBe(1);
  });
});

describe('actionMeta', () => {
  it('never returns undefined for an unrecognised action', () => {
    expect(actionMeta('teleported').icon).toBe('Activity');
    expect(actionMeta('delete').tone).toBe('red');
  });
});
