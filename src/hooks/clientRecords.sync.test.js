/**
 * useClientRecords is a CLIENT of migration 20260911120000. This test reads the
 * SQL and fails when the two drift.
 *
 * Why it earns a file: three of the hook's constants are copies of decisions
 * made in Postgres, and nothing else would notice if one side moved.
 *
 *   BLOCKING_SCORE  the screen greys out "Create" at the same score the server
 *                   refuses at. Raise the SQL threshold alone and the button is
 *                   enabled for a record the database will reject; lower it and
 *                   the UI blocks a record the database would have accepted.
 *
 *   DUPLICATE_CODE  the SQLSTATE that means "already on file". The message is
 *                   written for a person; the code is the only thing a switch
 *                   statement may key on. If the migration stops raising it,
 *                   the duplicate panel silently becomes a red error box.
 *
 *   argument names  PostgREST matches RPC arguments BY NAME. A renamed
 *                   parameter is not a type error and not a runtime error
 *                   either — the argument is simply dropped and the function
 *                   runs with its default, which for p_lead_id means a customer
 *                   created with no link to the lead they came from.
 *
 * Same treatment finhubPipeline.sync.test.js gives the payment pipeline.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { BLOCKING_SCORE, DUPLICATE_CODE, CLIENT_PAGE_SIZE, describeMatch, isBlockingMatch } from './useClientRecords';

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260911120000_finhub_client_records.sql',
);

const sql = readFileSync(MIGRATION, 'utf8');

/** The parameter list of a `create or replace function` block, names only. */
const paramsOf = (fnName) => {
  const block = new RegExp(
    `create or replace function public\\.${fnName}\\s*\\(([\\s\\S]*?)\\)\\s*returns`, 'i',
  ).exec(sql);
  if (!block) return null;
  return (block[1].match(/\bp_[a-z_]+/g) || []);
};

describe('useClientRecords mirrors migration 20260911120000', () => {
  it('the migration this depends on is present', () => {
    expect(sql).toContain('finhub_create_client');
    expect(sql).toContain('finhub_find_client_duplicates');
  });

  it('every RPC the hook calls is defined in it', () => {
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/useClientRecords.js'), 'utf8');
    const called = [...hook.matchAll(/supabase\.rpc\(\s*'([a-z_]+)'/g)].map(m => m[1]);

    expect(called.length).toBeGreaterThan(0);
    called.forEach((fn) => {
      expect(sql).toContain(`create or replace function public.${fn}(`);
    });
  });

  it('passes argument names the functions actually declare', () => {
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/useClientRecords.js'), 'utf8');

    // Each rpc('name', { ... }) call, paired with the p_ keys in its argument
    // object. PostgREST drops an argument whose name the function does not
    // declare, silently, so an unknown key is a defect this must catch.
    // `[^{}]*` rather than a lazy `[\s\S]*?`: an argument object contains no
    // nested braces, so this stops at ITS OWN closing brace. A lazy match runs
    // past a single-line call into the next one and pairs the wrong arguments
    // with the wrong function.
    const calls = [...hook.matchAll(/supabase\.rpc\(\s*'([a-z_]+)',\s*\{([^{}]*)\}\s*\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(4);

    calls.forEach(([, fnName, body]) => {
      const declared = paramsOf(fnName);
      expect(declared, `public.${fnName} is not declared in the migration`).not.toBeNull();
      const passed = [...body.matchAll(/(p_[a-z_]+)\s*:/g)].map(m => m[1]);
      expect(passed.length).toBeGreaterThan(0);
      passed.forEach(arg => {
        expect(declared, `${fnName} does not declare ${arg}`).toContain(arg);
      });
    });
  });

  it('blocks at the same match score the server refuses at', () => {
    const gate = /d\.match_score\s*>=\s*(\d+)/.exec(sql);
    expect(gate).not.toBeNull();
    expect(BLOCKING_SCORE).toBe(Number(gate[1]));
  });

  it('the duplicate refusal raises the SQLSTATE the UI switches on', () => {
    const refusal = /A client record already exists for these details[\s\S]*?errcode = '([A-Z0-9]{5})'/.exec(sql);
    expect(refusal).not.toBeNull();
    expect(DUPLICATE_CODE).toBe(refusal[1]);
  });

  it('pages the book at the size the RPC defaults to', () => {
    const dflt = /create or replace function public\.finhub_client_book\([\s\S]*?p_limit\s+integer default (\d+)/.exec(sql);
    expect(dflt).not.toBeNull();
    expect(CLIENT_PAGE_SIZE).toBe(Number(dflt[1]));
  });

  it('one lead can only ever produce one client record', () => {
    // The whole anti-duplicate guarantee rests on this index. Without it the
    // idempotent branch in finhub_create_client is a race, not a rule.
    expect(sql).toMatch(
      /create unique index if not exists idx_clients_lead_unique\s+on public\.clients \(lead_id\)\s+where lead_id is not null/i,
    );
  });

  it('the book returns the true row count beside the page', () => {
    // A page reduced into a total is a total that is wrong past the page size.
    expect(sql).toMatch(/count\(\*\) over \(\) as total_count/i);
  });

  it('names every match reason the scan can return', () => {
    const scan = /create or replace function public\.finhub_client_duplicate_scan[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/.exec(sql);
    expect(scan).not.toBeNull();
    const reasons = [...scan[1].matchAll(/then '([a-z_]+)'\s+end/g)].map(m => m[1]);
    expect(new Set(reasons)).toEqual(new Set(['kra_pin', 'national_id', 'phone', 'email', 'name']));
    // describeMatch must have a word for each of them, or the panel says
    // "the same national_id" to somebody at a desk.
    reasons.forEach(r => {
      expect(describeMatch([r])).not.toContain('_');
    });
  });
});

describe('describeMatch', () => {
  it('reads as a sentence for one, two and three reasons', () => {
    expect(describeMatch(['phone'])).toBe('the same phone number');
    expect(describeMatch(['phone', 'email'])).toBe('the same phone number and email');
    expect(describeMatch(['kra_pin', 'phone', 'email']))
      .toBe('the same KRA PIN, phone number and email');
  });

  it('says something rather than nothing when the server sent no reasons', () => {
    expect(describeMatch([])).toBe('the details entered');
    expect(describeMatch()).toBe('the details entered');
  });
});

describe('isBlockingMatch', () => {
  it('treats a name-only match as a suggestion, not a blocker', () => {
    // Name scores 10 in the migration; two people sharing one is a Tuesday.
    expect(isBlockingMatch({ match_score: 10 })).toBe(false);
    expect(isBlockingMatch({ match_score: 25 })).toBe(true);
    expect(isBlockingMatch({ match_score: 50 })).toBe(true);
  });

  it('survives the score arriving as a string, which is how PostgREST sends it', () => {
    expect(isBlockingMatch({ match_score: '30' })).toBe(true);
    expect(isBlockingMatch({})).toBe(false);
  });
});
