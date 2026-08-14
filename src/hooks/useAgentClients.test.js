import { describe, it, expect } from 'vitest';
import {
  daysUntil,
  deriveSubscription,
  deriveClientStanding,
  EXPIRING_WINDOW_DAYS,
} from './useAgentClients';

// A fixed "now" so the boundary cases stay boundary cases.
const NOW = new Date('2026-08-13T12:00:00.000Z').getTime();
const DAY = 86400000;
const at = (days) => new Date(NOW + days * DAY).toISOString();

const period = (overrides = {}) => ({
  id: 'sub-1',
  admin_id: 'admin-1',
  plan_name: 'starter',
  status: 'active',
  price_paid: 5000,
  max_users: 5,
  start_date: at(-30),
  end_date: at(30),
  created_at: at(-30),
  ...overrides,
});

describe('daysUntil', () => {
  it('counts forward and backward from now', () => {
    expect(daysUntil(at(10), NOW)).toBe(10);
    expect(daysUntil(at(-3), NOW)).toBe(-3);
    expect(daysUntil(at(0), NOW)).toBe(0);
  });

  it('returns null for missing or unparseable dates', () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil('not a date', NOW)).toBeNull();
  });
});

describe('deriveSubscription', () => {
  it('treats an account with no subscription row as never subscribed', () => {
    const r = deriveSubscription([], NOW);
    expect(r.bucket).toBe('pending');
    expect(r.statusLabel).toBe('Never subscribed');
    expect(r.everPaid).toBe(false);
  });

  it('flags a provisioned-but-unpaid account rather than reading its placeholder dates as active', () => {
    const r = deriveSubscription([period({ status: 'pending', end_date: at(30) })], NOW);
    expect(r.bucket).toBe('pending');
    expect(r.statusLabel).toBe('Never activated');
  });

  it('distinguishes an unpaid renewal from an account that never paid at all', () => {
    const rows = [
      period({ id: 'old', status: 'active',  start_date: at(-60), end_date: at(-30), created_at: at(-60) }),
      period({ id: 'new', status: 'pending', start_date: at(-30), end_date: at(30),  created_at: at(-30) }),
    ];
    const r = deriveSubscription(rows, NOW);
    expect(r.bucket).toBe('pending');
    expect(r.statusLabel).toBe('Renewal unpaid');
    expect(r.everPaid).toBe(true);
  });

  it('marks a running subscription active with the days left', () => {
    const r = deriveSubscription([period({ end_date: at(90) })], NOW);
    expect(r.bucket).toBe('active');
    expect(r.daysRemaining).toBe(90);
    expect(r.statusLabel).toBe('Active · 90 days left');
  });

  it('moves into expiring on the window boundary and not a day earlier', () => {
    expect(deriveSubscription([period({ end_date: at(EXPIRING_WINDOW_DAYS) })], NOW).bucket).toBe('expiring');
    expect(deriveSubscription([period({ end_date: at(EXPIRING_WINDOW_DAYS + 1) })], NOW).bucket).toBe('active');
  });

  it('reads a same-day expiry as expiring today, not expired', () => {
    const r = deriveSubscription([period({ end_date: at(0) })], NOW);
    expect(r.bucket).toBe('expiring');
    expect(r.statusLabel).toBe('Expires today');
  });

  it('reports how long ago a lapsed subscription ran out', () => {
    const r = deriveSubscription([period({ end_date: at(-5) })], NOW);
    expect(r.bucket).toBe('expired');
    expect(r.statusLabel).toBe('Expired 5 days ago');
  });

  it('singularises the day count', () => {
    expect(deriveSubscription([period({ end_date: at(-1) })], NOW).statusLabel).toBe('Expired 1 day ago');
    expect(deriveSubscription([period({ end_date: at(1) })], NOW).statusLabel).toBe('Expires in 1 day');
  });

  it('treats a cancelled subscription as expired whatever its dates say', () => {
    const r = deriveSubscription([period({ status: 'cancelled', end_date: at(60) })], NOW);
    expect(r.bucket).toBe('expired');
    expect(r.statusLabel).toBe('Cancelled');
  });

  it('does not guess a status when the row carries no end date', () => {
    const r = deriveSubscription([period({ end_date: null })], NOW);
    expect(r.bucket).toBe('unknown');
  });

  it('uses the latest period regardless of the order rows arrive in', () => {
    const rows = [
      period({ id: 'old', end_date: at(-40), created_at: at(-70) }),
      period({ id: 'cur', end_date: at(10),  created_at: at(-10) }),
    ];
    const r = deriveSubscription(rows, NOW);
    expect(r.current.id).toBe('cur');
    expect(r.bucket).toBe('expiring');
  });

  it('counts every paid period after the first as a renewal', () => {
    const paid = (i) => period({ id: `p${i}`, end_date: at(30 - i * 30), created_at: at(-i * 30) });
    expect(deriveSubscription([paid(0)], NOW).renewals).toBe(0);
    expect(deriveSubscription([paid(0), paid(1)], NOW).renewals).toBe(1);
    expect(deriveSubscription([paid(0), paid(1), paid(2)], NOW).renewals).toBe(2);
  });

  it('does not count an unpaid period as a renewal', () => {
    const rows = [
      period({ id: 'paid',   status: 'active',  end_date: at(-30), created_at: at(-60) }),
      period({ id: 'unpaid', status: 'pending', end_date: at(30),  created_at: at(-30) }),
    ];
    expect(deriveSubscription(rows, NOW).renewals).toBe(0);
  });
});

describe('deriveClientStanding', () => {
  it('reads a clean active client as active', () => {
    const r = deriveClientStanding({ client_status: 'active', kyc_status: 'verified', outstanding_balance: 0 });
    expect(r.bucket).toBe('active');
    expect(r.statusLabel).toBe('Active');
  });

  it('treats suspended and inactive accounts as lapsed', () => {
    expect(deriveClientStanding({ client_status: 'suspended' }).bucket).toBe('expired');
    expect(deriveClientStanding({ client_status: 'inactive' }).bucket).toBe('expired');
  });

  it('separates an account awaiting activation from a lapsed one', () => {
    const r = deriveClientStanding({ client_status: 'pending' });
    expect(r.bucket).toBe('pending');
    expect(r.statusLabel).toBe('Awaiting activation');
  });

  it('surfaces money owed ahead of a KYC gap, with the amount in the label', () => {
    const r = deriveClientStanding({
      client_status: 'active', kyc_status: 'unverified', outstanding_balance: 12500,
    });
    expect(r.bucket).toBe('attention');
    expect(r.statusLabel).toContain('12,500');
  });

  it('flags unverified KYC when nothing is owed', () => {
    expect(deriveClientStanding({ client_status: 'active', kyc_status: 'unverified' }).statusLabel)
      .toBe('KYC not verified');
    expect(deriveClientStanding({ client_status: 'active', kyc_status: 'under_review' }).statusLabel)
      .toBe('KYC under review');
  });

  it('does not invent a KYC problem when the field is absent', () => {
    expect(deriveClientStanding({ client_status: 'active', outstanding_balance: 0 }).bucket).toBe('active');
  });
});
