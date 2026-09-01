/**
 * The onboarding vocabulary, and its agreement with the database.
 *
 * Three things here are two copies of one fact:
 *
 *   ONBOARDING_STATUS_VALUES  <->  client_onboardings_status_chk
 *   STEP_STATUS_VALUES        <->  client_onboarding_steps_status_chk
 *   ONBOARDING_STEPS keys     <->  client_onboarding_default_steps()
 *
 * The first two drifting means a status the UI offers is rejected by the write;
 * the third means a step seeded into every new record renders without an icon
 * or a phase. So the migration is read as text and compared, the same way
 * planCatalogs.sync.test.js holds the price catalogues together.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STATUS_VALUES, OPEN_STATUSES, statusMeta, isOpen,
  STEP_STATUS_VALUES, stepStatusMeta,
  ONBOARDING_PHASES, phaseMeta,
  ONBOARDING_STEPS, ONBOARDING_STEP_KEYS, stepMeta, stepIcon, groupStepsByPhase,
  daysBetween, progressOf, isOverdue, scheduleStance, formatDay, nextActionFor,
  ONBOARDING_EXPORT_COLUMNS, buildOnboardingExport,
} from './clientOnboarding';

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260901180000_client_onboarding_tracking.sql',
);
const sql = readFileSync(MIGRATION, 'utf8');

/** The value list out of one `check (col in ('a', 'b'))` clause. */
const checkValues = (constraintName) => {
  const from = sql.indexOf(constraintName);
  if (from === -1) throw new Error(`Constraint not found in the migration: ${constraintName}`);
  const body = sql.slice(from, from + 400);
  const open = body.indexOf('in (');
  const close = body.indexOf('))', open);
  return [...body.slice(open, close).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
};

// Built from local parts, not from a Z timestamp: `date` columns are calendar
// days and "overdue by 3 days" is judged against the reader's own today, so a
// fixture pinned to UTC would pass or fail by the timezone the suite runs in.
const NOW = new Date(2026, 8, 10, 9, 0, 0);
const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => {
  const d = new Date(2026, 8, 10 + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();

const record = (o = {}) => ({
  id: 'ob-1',
  admin_id: 'ad-1',
  client_name: 'Kilimo Traders Ltd',
  entity_type: 'company',
  contact_email: 'ops@kilimo.example',
  contact_phone: '+254700000000',
  account_active: true,
  registered_at: at(2026, 8, 20),
  status: 'scheduled',
  assigned_to: 'u-1',
  assigned_to_name: 'Grace Wanjiru',
  assigned_at: at(2026, 8, 21),
  scheduled_date: day(3),
  installation_date: null,
  completed_at: null,
  completed_by_name: null,
  on_hold_reason: null,
  notes: null,
  steps_total: 11,
  steps_done: 4,
  ...o,
});

const step = (o = {}) => ({
  id: 's-1',
  step_key: 'installation',
  label: 'System installed and verified on site',
  phase: 'install',
  sort_order: 70,
  status: 'pending',
  due_date: null,
  completed_at: null,
  notes: null,
  ...o,
});

describe('agreement with the migration', () => {
  it('offers exactly the statuses client_onboardings_status_chk accepts', () => {
    expect([...ONBOARDING_STATUS_VALUES].sort())
      .toEqual([...checkValues('client_onboardings_status_chk')].sort());
  });

  it('offers exactly the step statuses client_onboarding_steps_status_chk accepts', () => {
    expect([...STEP_STATUS_VALUES].sort())
      .toEqual([...checkValues('client_onboarding_steps_status_chk')].sort());
  });

  it('mirrors the checklist client_onboarding_default_steps() seeds', () => {
    const from = sql.indexOf('client_onboarding_default_steps()');
    const body = sql.slice(from, sql.indexOf('$$;', from));
    const seeded = [...body.matchAll(/\(\s*'([a-z_]+)',\s*'[^']*',\s*'(prepare|install|enable|close)'/g)]
      .map(m => ({ key: m[1], phase: m[2] }));

    expect(seeded.length).toBe(ONBOARDING_STEPS.length);
    expect(seeded.map(s => s.key)).toEqual(ONBOARDING_STEP_KEYS);
    // Phase drives the grouping in the drawer; a step in the wrong group is a
    // checklist that reads out of order.
    expect(seeded.map(s => s.phase)).toEqual(ONBOARDING_STEPS.map(s => s.phase));
  });

  it('keeps the invoice line among the steps it is charged for', () => {
    expect(ONBOARDING_STEP_KEYS).toContain('installation');
    expect(ONBOARDING_STEPS.length).toBeGreaterThan(1);
  });
});

describe('vocabulary', () => {
  it('treats exactly completed and cancelled as closed', () => {
    expect([...OPEN_STATUSES].sort())
      .toEqual(['in_progress', 'not_started', 'on_hold', 'scheduled']);
    expect(isOpen({ status: 'completed' })).toBe(false);
    expect(isOpen({ status: 'cancelled' })).toBe(false);
    expect(isOpen({ status: 'on_hold' })).toBe(true);
  });

  it('falls back to not started on an empty status, and keeps unknown ones', () => {
    expect(statusMeta(undefined).value).toBe('not_started');
    expect(statusMeta('').value).toBe('not_started');

    const odd = statusMeta('awaiting_hardware');
    expect(odd.known).toBe(false);
    expect(odd.label).toBe('Awaiting Hardware');
    // An unrecognised state is work still owed, not work quietly finished.
    expect(odd.open).toBe(true);
  });

  it('counts only "done" as work performed, and settles "skipped" without counting it', () => {
    expect(stepStatusMeta('done')).toMatchObject({ settled: true, counts: true });
    expect(stepStatusMeta('skipped')).toMatchObject({ settled: true, counts: false });
    expect(stepStatusMeta('blocked')).toMatchObject({ settled: false, counts: false });
    expect(stepStatusMeta('what').known).toBe(false);
  });

  it('gives every catalogue step a real phase', () => {
    const phases = ONBOARDING_PHASES.map(p => p.value);
    ONBOARDING_STEPS.forEach(s => expect(phases).toContain(s.phase));
  });

  it('renders a bespoke step from its phase rather than dropping it', () => {
    expect(stepMeta('custom_k3f9').known).toBe(false);
    expect(stepIcon({ step_key: 'custom_k3f9', phase: 'enable' }))
      .toBe(phaseMeta('enable').icon);
    expect(stepIcon({ step_key: 'installation', phase: 'install' })).toBe('Wrench');
  });
});

describe('groupStepsByPhase', () => {
  it('orders phases by the process, and steps by sort_order inside them', () => {
    const groups = groupStepsByPhase([
      step({ id: 'b', step_key: 'training', phase: 'enable', sort_order: 90 }),
      step({ id: 'a', step_key: 'kickoff_call', phase: 'prepare', sort_order: 10 }),
      step({ id: 'c', step_key: 'account_setup', phase: 'install', sort_order: 30 }),
      step({ id: 'd', step_key: 'installation', phase: 'install', sort_order: 70 }),
    ]);
    expect(groups.map(g => g.value)).toEqual(['prepare', 'install', 'enable']);
    expect(groups[1].steps.map(s => s.id)).toEqual(['c', 'd']);
  });

  it('keeps a step whose phase is not in the catalogue', () => {
    const groups = groupStepsByPhase([step({ id: 'x', phase: 'aftercare' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].steps[0].id).toBe('x');
  });

  it('drops empty phases rather than printing bare headings', () => {
    expect(groupStepsByPhase([]).length).toBe(0);
  });
});

describe('progressOf', () => {
  it('uses the counters the database maintains when no steps are loaded', () => {
    expect(progressOf(record({ steps_total: 11, steps_done: 4 }))).toBe(36);
  });

  it('reads an empty checklist as nothing done, never as finished', () => {
    expect(progressOf(record({ steps_total: 0, steps_done: 0 }))).toBe(0);
    expect(progressOf(null)).toBe(0);
  });

  it('drops skipped steps out of both sides of the fraction', () => {
    const steps = [
      step({ id: '1', status: 'done' }),
      step({ id: '2', status: 'done' }),
      step({ id: '3', status: 'skipped' }),
      step({ id: '4', status: 'pending' }),
    ];
    // 2 of 3 applicable, not 2 of 4.
    expect(progressOf(record(), steps)).toBe(67);
  });

  it('reaches 100% when everything left applies and is done', () => {
    const steps = [
      step({ id: '1', status: 'done' }),
      step({ id: '2', status: 'skipped' }),
    ];
    expect(progressOf(record(), steps)).toBe(100);
  });
});

describe('dates', () => {
  it('counts whole days in both directions', () => {
    expect(daysBetween('2026-09-10', '2026-09-12')).toBe(2);
    expect(daysBetween('2026-09-12', '2026-09-10')).toBe(-2);
    expect(daysBetween(null, '2026-09-10')).toBeNull();
  });

  it('ignores the time of day', () => {
    expect(daysBetween('2026-09-10', '2026-09-10T23:30:00')).toBe(0);
    expect(daysBetween('2026-09-10T00:05:00', '2026-09-11T23:55:00')).toBe(1);
  });

  // A `date` column carries no timezone. Reading '2026-09-02' as UTC midnight
  // prints it as the 1st anywhere behind UTC, which is how a booked
  // installation quietly moves a day in an export.
  it('reads a bare date as the calendar day it says, in any timezone', () => {
    expect(formatDay('2026-09-02')).toContain('02');
    const [row] = buildOnboardingExport([record({ scheduled_date: '2026-09-02' })]);
    expect(row.Scheduled).toBe('2026-09-02');
  });

  it('shows an em dash rather than "Invalid Date"', () => {
    expect(formatDay(null)).toBe('—');
    expect(formatDay('not a date')).toBe('—');
  });
});

describe('isOverdue', () => {
  it('is true only for open work whose booked date has passed', () => {
    expect(isOverdue(record({ scheduled_date: day(-1) }), NOW)).toBe(true);
    expect(isOverdue(record({ scheduled_date: day(0) }), NOW)).toBe(false);
    expect(isOverdue(record({ scheduled_date: day(2) }), NOW)).toBe(false);
  });

  it('never flags a finished or abandoned installation', () => {
    expect(isOverdue(record({ scheduled_date: day(-30), status: 'completed' }), NOW)).toBe(false);
    expect(isOverdue(record({ scheduled_date: day(-30), status: 'cancelled' }), NOW)).toBe(false);
  });

  it('is false when nothing was ever booked', () => {
    expect(isOverdue(record({ scheduled_date: null }), NOW)).toBe(false);
  });
});

describe('scheduleStance', () => {
  it('says how late, in days, and marks it urgent', () => {
    const s = scheduleStance(record({ scheduled_date: day(-3) }), NOW);
    expect(s).toMatchObject({ tone: 'red', urgent: true });
    expect(s.label).toBe('Overdue by 3 days');
  });

  it('singularises one day late', () => {
    expect(scheduleStance(record({ scheduled_date: day(-1) }), NOW).label)
      .toBe('Overdue by 1 day');
  });

  it('names today and tomorrow instead of printing a date', () => {
    expect(scheduleStance(record({ scheduled_date: day(0) }), NOW).label).toBe('Due today');
    expect(scheduleStance(record({ scheduled_date: day(1) }), NOW).label).toBe('Due tomorrow');
    expect(scheduleStance(record({ scheduled_date: day(4) }), NOW).label).toBe('Due in 4 days');
  });

  it('reports the installation date once the job is signed off', () => {
    const s = scheduleStance(record({
      status: 'completed', installation_date: '2026-09-02', scheduled_date: day(-8),
    }), NOW);
    expect(s.tone).toBe('emerald');
    expect(s.urgent).toBe(false);
    expect(s.label).toContain('Installed');
  });

  it('says so plainly when nothing has been booked', () => {
    expect(scheduleStance(record({ scheduled_date: null }), NOW).label).toBe('No date set');
  });
});

describe('nextActionFor', () => {
  it('asks for an owner before it asks for a date', () => {
    expect(nextActionFor(record({ assigned_to: null, scheduled_date: null }), NOW))
      .toBe('Assign someone');
  });

  it('asks for a date once somebody owns it', () => {
    expect(nextActionFor(record({ scheduled_date: null }), NOW)).toBe('Book a date');
  });

  it('asks for a rebook when the booked date has gone by', () => {
    expect(nextActionFor(record({ scheduled_date: day(-4) }), NOW)).toBe('Rebook or complete');
  });

  it('surfaces the hold reason, and says nothing about finished work', () => {
    expect(nextActionFor(record({ status: 'on_hold', on_hold_reason: 'Awaiting the till number' }), NOW))
      .toBe('Awaiting the till number');
    expect(nextActionFor(record({ status: 'completed' }), NOW)).toBeNull();
  });
});

describe('buildOnboardingExport', () => {
  const [row] = buildOnboardingExport([record({
    status: 'completed',
    installation_date: '2026-09-02',
    completed_at: at(2026, 9, 3, 14),
    completed_by_name: 'Grace Wanjiru',
    notes: 'Two site visits.\n  Second one finished it.',
  })]);

  it('names every column it produces, and produces every column it names', () => {
    expect(Object.keys(row).sort()).toEqual([...ONBOARDING_EXPORT_COLUMNS].sort());
  });

  it('writes dates a spreadsheet can sort', () => {
    expect(row.Scheduled).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.Installed).toBe('2026-09-02');
    expect(row.Completed).toBe('2026-09-03');
  });

  it('writes progress as a number, not a percentage string', () => {
    expect(row['Progress (%)']).toBe(36);
    expect(row['Steps done']).toBe(4);
  });

  it('flattens a multi-line note into one cell', () => {
    expect(row.Notes).toBe('Two site visits. Second one finished it.');
  });

  it('leaves missing dates blank rather than writing a dash into a date column', () => {
    const [blank] = buildOnboardingExport([record({ scheduled_date: null, installation_date: null })]);
    expect(blank.Scheduled).toBe('');
    expect(blank.Installed).toBe('');
  });
});
