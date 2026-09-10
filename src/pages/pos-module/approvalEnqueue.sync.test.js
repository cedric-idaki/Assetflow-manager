/**
 * Every write to the approval queue must be one Postgres will accept.
 *
 * WHY THIS IS A STATIC TEST AND NOT A RENDERED ONE.
 *
 * The POS approval gates were broken from the day they shipped and nobody
 * noticed for months. Four defects on one insert: two `action_type` values
 * that are not in the `mc_action_type` enum, and two keys (`initiator_email`,
 * `metadata`) that are not columns on `maker_checker_queue`. Postgres rejected
 * every one of them.
 *
 * None of that is visible from the application side. The call compiles, the
 * types are strings, the object looks reasonable — the truth lives in a
 * migration file. So this test reads the migration and checks the calls
 * against it, the same way finhubPipeline.sync.test.js checks its model
 * against the SQL that owns it.
 *
 * The fourth defect is the one that made the other three survive: the
 * large-transaction insert never looked at its error. The rejection was
 * discarded and the agent was shown a reference number and told the sale was
 * awaiting approval. Nothing was queued and no approver ever saw it. That is
 * checked here too — an unchecked insert on this table is a defect regardless
 * of whether its payload is currently valid.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = resolve(process.cwd());
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const migrationText = () =>
  readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

const sql = migrationText();

/** Enum values, base declaration plus every later ADD VALUE. */
const actionTypes = (() => {
  const base = /create type public\.mc_action_type as enum\s*\(([\s\S]*?)\);/i.exec(sql);
  const values = new Set(
    (base?.[1].match(/'([a-z_]+)'/g) || []).map(v => v.replace(/'/g, '')),
  );
  for (const m of sql.matchAll(
    /alter type public\.mc_action_type add value(?: if not exists)? '([a-z_]+)'/gi,
  )) values.add(m[1]);
  return values;
})();

/** Columns on maker_checker_queue, from CREATE TABLE plus later ALTERs. */
const queueColumns = (() => {
  const block = /create table if not exists public\.maker_checker_queue \(([\s\S]*?)\n\);/i.exec(sql);
  const cols = new Set(
    (block?.[1].split('\n') || [])
      .map(l => l.trim())
      .filter(l => l && !/^(constraint|primary key|unique|check|foreign)/i.test(l))
      .map(l => l.split(/\s+/)[0].toLowerCase())
      .filter(c => /^[a-z_]+$/.test(c)),
  );
  for (const m of sql.matchAll(
    /alter table (?:if exists )?public\.maker_checker_queue\s+add column (?:if not exists )?(\w+)/gi,
  )) cols.add(m[1].toLowerCase());
  return cols;
})();

/** Every source file that inserts into the queue. */
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return walk(full);
  return /\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
});

const callSites = walk(join(ROOT, 'src'))
  .map(file => ({ file, text: readFileSync(file, 'utf8') }))
  .filter(f => f.text.includes("from('maker_checker_queue')"))
  .flatMap(({ file, text }) => {
    const out = [];
    // Capture the object literal passed to .insert({ … }) — balanced to the
    // matching brace so nested objects (change_details) come along.
    const re = /from\('maker_checker_queue'\)\s*\.insert\(\{/g;
    let m;
    while ((m = re.exec(text))) {
      let depth = 1;
      let i = m.index + m[0].length;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth += 1;
        if (text[i] === '}') depth -= 1;
        i += 1;
      }
      const body = text.slice(m.index + m[0].length, i - 1);
      // Look back far enough to see whether the result is destructured.
      const preamble = text.slice(Math.max(0, m.index - 120), m.index);
      out.push({
        file: file.replace(ROOT, '').replace(/\\/g, '/'),
        body,
        checksError: /(const|let)\s*\{[^}]*\berror\b[^}]*\}\s*=\s*await\s*$/.test(preamble.trimEnd() + ' ')
                  || /\{[^}]*\berror\b[^}]*\}\s*=\s*await\s*supabase\.?\s*$/.test(preamble),
      });
    }
    return out;
  });

describe('maker_checker_queue enqueue contract', () => {
  it('the migration defines the enum and the table this test reads', () => {
    expect(actionTypes.size).toBeGreaterThan(5);
    expect(queueColumns.has('action_type')).toBe(true);
    expect(queueColumns.has('change_details')).toBe(true);
  });

  it('finds the call sites', () => {
    // If this drops to zero the test has stopped checking anything.
    expect(callSites.length).toBeGreaterThan(0);
  });

  it('every action_type written is a value the enum actually has', () => {
    const bad = [];
    callSites.forEach(({ file, body }) => {
      const m = /action_type\s*:\s*'([a-z_]+)'/.exec(body);
      if (m && !actionTypes.has(m[1])) bad.push(`${file}: '${m[1]}'`);
    });
    // 'large_transaction' and 'discount_approval' both lived here and both
    // were rejected by Postgres with 22P02.
    expect(bad).toEqual([]);
  });

  it('every key written is a real column', () => {
    const bad = [];
    callSites.forEach(({ file, body }) => {
      // Top-level keys only: nested objects are jsonb payloads, not columns.
      let depth = 0;
      body.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (depth === 0) {
          const key = /^(\w+)\s*:/.exec(trimmed);
          if (key && !queueColumns.has(key[1].toLowerCase())) {
            bad.push(`${file}: ${key[1]}`);
          }
        }
        depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      });
    });
    // `initiator_email` and `metadata` both lived here. Neither exists.
    expect(bad).toEqual([]);
  });

  it('supplies initiator_role, which is NOT NULL', () => {
    const missing = callSites
      .filter(({ body }) => !/initiator_role\s*:/.test(body))
      .map(({ file }) => file);
    expect(missing).toEqual([]);
  });

  it('never discards the insert error', () => {
    // The defect that hid the other three: a bare `await …insert({…})` whose
    // rejection is dropped, after which the UI reports success.
    const unchecked = callSites.filter(c => !c.checksError).map(c => c.file);
    expect(unchecked).toEqual([]);
  });
});
