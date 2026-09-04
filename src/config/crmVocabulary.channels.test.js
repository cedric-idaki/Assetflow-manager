/**
 * The contact-channel vocabulary lives in five places and they must agree:
 *
 *   src/config/crmVocabulary.js                          — what the agent picks
 *   supabase/migrations/20260829140000_followup_channels.sql
 *                                                        — what follow_ups accepts
 *   supabase/migrations/20260820120000_crm_interactions_and_oversight.sql
 *                                                        — what crm_interactions accepts
 *   supabase/functions/send-email/index.ts               — the reminder email wording
 *   supabase/functions/agent-followup-reminders/index.ts — the notification wording
 *
 * The copies exist because a Deno edge function cannot import the frontend
 * bundle and Postgres cannot import either. That makes drift silent and
 * expensive in a specific way: add a channel here alone and every agent who
 * picks it has their follow-up rewritten to 'other' by the database trigger,
 * with no error anywhere — the appointment saves, the channel just quietly
 * isn't what they chose. Add it to the SQL alone and the reminder email calls
 * it "Follow-up".
 *
 * So this test reads the SQL and TypeScript as text and asserts they still
 * match. Add a channel in one file and it fails until you add it everywhere —
 * which is the point.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  CONTACT_CHANNELS,
  SCHEDULABLE_CHANNELS,
  LOGGABLE_CHANNELS,
  FOLLOW_UP_CHANNEL_VALUES,
  channelMeta,
  toChannelValue,
  toFollowUpChannel,
} from './crmVocabulary';

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const CHANNEL_MIGRATION = read('supabase/migrations/20260829140000_followup_channels.sql');
const CRM_MIGRATION     = read('supabase/migrations/20260820120000_crm_interactions_and_oversight.sql');
const SEND_EMAIL        = read('supabase/functions/send-email/index.ts');
const REMINDER_WORKER   = read('supabase/functions/agent-followup-reminders/index.ts');

/** Every single-quoted literal inside the parenthesised list at `from`. */
const literalsAfter = (source, marker) => {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Marker not found: ${marker}`);
  const open = source.indexOf('(', start);
  // Walk to the matching close paren so a nested one cannot end the list early.
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === '(') depth += 1;
    else if (source[end] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return [...source.slice(open, end).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
};

/** The keys of an object literal that follows `marker`, up to its closing brace. */
const objectKeys = (source, marker) => {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Marker not found: ${marker}`);
  const open = source.indexOf('{', start);
  const end  = source.indexOf('\n};', open);
  const body = source.slice(open, end === -1 ? source.length : end);
  return [...body.matchAll(/(?:^|[\s,{])([a-z_]+)\s*:/gm)].map(m => m[1]);
};

describe('contact channels — the one list', () => {
  it('has no duplicate values', () => {
    const values = CONTACT_CHANNELS.map(c => c.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('gives every channel a label, an icon and a tone', () => {
    for (const c of CONTACT_CHANNELS) {
      expect(c.label, `${c.value} label`).toBeTruthy();
      expect(c.icon,  `${c.value} icon`).toBeTruthy();
      expect(c.tone,  `${c.value} tone`).toBeTruthy();
    }
  });

  it('makes every channel usable for something', () => {
    // A channel that is neither loggable nor schedulable can never be picked,
    // and would only ever show up as an orphan value in a report.
    for (const c of CONTACT_CHANNELS) {
      expect(c.loggable || c.schedulable, `${c.value} is unreachable`).toBe(true);
    }
  });
});

describe('follow_ups.appointment_type — SQL agrees with JS', () => {
  it('accepts exactly the schedulable channels', () => {
    const sqlCheck = literalsAfter(CHANNEL_MIGRATION, 'follow_ups_appointment_type_check\n  check');
    expect(sqlCheck.sort()).toEqual([...FOLLOW_UP_CHANNEL_VALUES].sort());
  });

  it('normalises to the same set the constraint accepts', () => {
    // If the trigger's allow-list and the CHECK ever diverge, the trigger can
    // hand the constraint a value it rejects — and the agent sees a raw
    // Postgres error on an appointment that looked fine.
    const triggerAllows = literalsAfter(CHANNEL_MIGRATION, 'if channel not in');
    const sqlCheck = literalsAfter(CHANNEL_MIGRATION, 'follow_ups_appointment_type_check\n  check');
    expect(triggerAllows.sort()).toEqual(sqlCheck.sort());
  });

  it('backfills every legacy value onto something the constraint accepts', () => {
    // The UPDATE statements in step 1 run before the constraint is added. Any
    // target they write that is not in the set would abort the migration.
    const targets = [...CHANNEL_MIGRATION.matchAll(/set appointment_type = '([a-z_]+)'/g)].map(m => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(FOLLOW_UP_CHANNEL_VALUES).toContain(t);
  });

  it('folds the same aliases the frontend does', () => {
    // Pulled from the trigger's CASE. Each has to survive the round trip, or a
    // browser tab left open across the deploy stores a different channel from
    // the one it displayed.
    const aliases = [...CHANNEL_MIGRATION.matchAll(/when '([a-z_-]+)'\s+then '([a-z_]+)'/g)]
      .filter(m => m[1] !== '');
    expect(aliases.length).toBeGreaterThan(4);
    for (const [, from, to] of aliases) {
      expect(toFollowUpChannel(from), `SQL maps ${from} -> ${to}`).toBe(to);
    }
  });

  it('does not accept a channel that cannot be scheduled', () => {
    // 'note' is a real interaction type but not an appointment. Letting it into
    // the column would put a row in the diary that nobody can act on.
    const sqlCheck = literalsAfter(CHANNEL_MIGRATION, 'follow_ups_appointment_type_check\n  check');
    expect(sqlCheck).not.toContain('note');
    expect(toFollowUpChannel('note')).toBe('follow_up');
  });
});

describe('crm_interactions.interaction_type — SQL agrees with JS', () => {
  it('accepts exactly the loggable channels', () => {
    const enumValues = literalsAfter(CRM_MIGRATION, 'create type public.crm_interaction_type as enum');
    expect(enumValues.sort()).toEqual(LOGGABLE_CHANNELS.map(c => c.value).sort());
  });
});

describe('edge functions can name every channel', () => {
  it('the reminder email has wording for each schedulable channel', () => {
    const keys = objectKeys(SEND_EMAIL, 'const FOLLOW_UP_CHANNELS');
    for (const c of SCHEDULABLE_CHANNELS) expect(keys, c.value).toContain(c.value);
  });

  it('the reminder worker has a label for each schedulable channel', () => {
    const keys = objectKeys(REMINDER_WORKER, 'const CHANNEL_LABELS');
    for (const c of SCHEDULABLE_CHANNELS) expect(keys, c.value).toContain(c.value);
  });
});

describe('channelMeta', () => {
  it('resolves the pre-unification spellings to the same channel', () => {
    expect(channelMeta('phone_call').value).toBe('call');
    expect(channelMeta('office_meeting').value).toBe('meeting');
    expect(channelMeta('PHONE_CALL').value).toBe('call');
  });

  it('keeps a value it has never seen rather than dropping it', () => {
    const meta = channelMeta('carrier_pigeon');
    expect(meta.known).toBe(false);
    expect(meta.label).toBe('Carrier Pigeon');
    expect(meta.icon).toBe('Circle');
  });

  it('describes a missing channel without inventing one', () => {
    expect(channelMeta(null).label).toBe('Contact');
    expect(channelMeta('').value).toBeNull();
  });
});

describe('canonicalising for writes', () => {
  it('passes through a known channel', () => {
    expect(toChannelValue('email')).toBe('email');
    expect(toFollowUpChannel('email')).toBe('email');
  });

  it('folds an alias', () => {
    expect(toChannelValue('phone_call')).toBe('call');
    expect(toFollowUpChannel('office_meeting')).toBe('meeting');
  });

  it('falls back rather than writing a value the column would reject', () => {
    expect(toChannelValue('carrier_pigeon')).toBe('other');
    expect(toFollowUpChannel('carrier_pigeon')).toBe('follow_up');
    expect(toFollowUpChannel(undefined)).toBe('follow_up');
    expect(toFollowUpChannel(null)).toBe('follow_up');
  });

  it('never returns a value outside the constrained set', () => {
    const inputs = ['note', 'proposal', '', null, undefined, 'NOTE', ' Email ', 42, {}];
    for (const input of inputs) {
      expect(FOLLOW_UP_CHANNEL_VALUES, String(input)).toContain(toFollowUpChannel(input));
    }
  });
});
