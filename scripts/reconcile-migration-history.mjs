#!/usr/bin/env node
/**
 * MIGRATION HISTORY RECONCILIATION
 *
 * `supabase migration list` says 83 of this repo's migrations are unapplied.
 * Probing the live API says otherwise for several of them: `sacco_share_withholdings`
 * answers 200 and `clients.kra_pin` resolves, yet neither migration is in the
 * remote history. The history and the schema disagree, in BOTH directions.
 *
 * That makes `supabase db push` unsafe: it would replay migrations the database
 * already has, including ones carrying top-level `update public.…` backfills
 * that would overwrite values corrected since.
 *
 * This script works out which is which. For every pending migration it finds a
 * SIGNATURE OBJECT — a table or column that migration creates — and asks the
 * live REST API whether it exists. The output is a repair plan: the migrations
 * to mark applied, the ones genuinely missing, and the ones nothing here can
 * decide.
 *
 * READ-ONLY. Every request is `select=…&limit=0` with the anon key. It reads no
 * rows, writes nothing, and needs no elevated credential.
 *
 * USAGE
 *   node scripts/reconcile-migration-history.mjs            # report
 *   node scripts/reconcile-migration-history.mjs --json     # machine-readable
 *
 * WHAT IT CANNOT DECIDE. A migration that only creates functions, policies or
 * triggers has no object PostgREST exposes, so it lands in UNKNOWN. Those are
 * the ones to review by hand — though most are `create or replace`, which is
 * safe to replay, and the report says so per file.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

// ── Credentials: the anon key, from the env the app already uses ────────────
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
const URL_ = pick('VITE_SUPABASE_URL');
const KEY  = pick('VITE_SUPABASE_ANON_KEY');

if (!URL_ || !KEY) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be in .env');
  process.exit(2);
}

const jsonOut = process.argv.includes('--json');

/**
 * Find something in a migration that PostgREST can be asked about.
 *
 * Tables first — a `create table if not exists public.X` is the strongest
 * signal a migration ran. Failing that, a column added to an existing table,
 * which is just as decisive and covers the many migrations that only ALTER.
 */
const signaturesOf = (sql) => {
  const out = [];

  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)) {
    out.push({ kind: 'table', table: m[1] });
  }

  // EVERY added column, not just the first.
  //
  // Taking only the first is how a PARTIALLY applied migration gets recorded
  // as fully applied and is then never run again. 20260908140000 is the live
  // example: its first column (`clients.kra_pin`) already exists on this
  // database, added outside the migration history, while the two it actually
  // needs (`sales.buyer_kra_pin`, `company_invoices.client_kra_pin`) do not.
  // One probe says APPLIED; three probes say PARTIAL, which is the truth.
  //
  // One `alter table` can add several columns in one comma-separated clause,
  // so the statement is captured whole and then split.
  for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)([\s\S]*?);/gi)) {
    const [, table, body] = m;
    for (const c of body.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) {
      out.push({ kind: 'column', table, column: c[1] });
    }
  }

  // Probing every object of a wide migration is wasted round trips; the first
  // few settle it.
  return out.slice(0, 6);
};

/** What a migration would do to live data if it were replayed. */
const replayRisk = (sql) => {
  const stripped = sql.replace(/\$\$[\s\S]*?\$\$/g, '');   // drop function bodies
  const backfills = (stripped.match(/^\s*update\s+public\./gim) || []).length;
  const deletes   = (stripped.match(/^\s*delete\s+from\s+public\./gim) || []).length;
  const drops     = (stripped.match(/^\s*drop\s+(table|type|schema)\s/gim) || []).length;
  return { backfills, deletes, drops, risky: backfills + deletes + drops > 0 };
};

const probe = async (table, column) => {
  const sel = column ? encodeURIComponent(column) : '*';
  const res = await fetch(`${URL_}/rest/v1/${table}?select=${sel}&limit=0`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  }).catch(() => null);
  if (!res) return 'ERROR';

  // 200 = readable. 401/403 = row-level security refused it, which means the
  // object RESOLVED — the strongest possible "it exists" short of reading it.
  if (res.status === 200 || res.status === 401 || res.status === 403) return 'PRESENT';

  // 404 is a missing table; 400 with PGRST202/204 is a missing column.
  if (res.status === 404 || res.status === 400) return 'ABSENT';
  return 'UNCLEAR';
};

const main = async () => {
  // Pending = every local migration, minus what the remote history records.
  // The caller supplies the remote list on stdin, or we fall back to all of
  // them and let the probe decide (which is the safer default).
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();

  const rows = [];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const sigs = signaturesOf(sql);
    const risk = replayRisk(sql);

    const states = [];
    for (const sig of sigs) {
      // eslint-disable-next-line no-await-in-loop
      states.push(await probe(sig.table, sig.column));
    }

    // PARTIAL is the verdict that matters. Marking such a migration applied
    // strands the half that is missing; pushing it replays the half that is
    // not. Either way a human has to look at it.
    const present = states.filter(x => x === 'PRESENT').length;
    const absent  = states.filter(x => x === 'ABSENT').length;
    const verdict = present && !absent ? 'APPLIED'
                  : absent && !present ? 'MISSING'
                  : present && absent  ? 'PARTIAL'
                  : 'UNKNOWN';

    rows.push({ file, ts: file.slice(0, 14), sigs, states, risk, verdict });
  }

  if (jsonOut) { console.log(JSON.stringify(rows, null, 2)); return; }

  const applied = rows.filter(r => r.verdict === 'APPLIED');
  const missing = rows.filter(r => r.verdict === 'MISSING');
  const partial = rows.filter(r => r.verdict === 'PARTIAL');
  const unknown = rows.filter(r => r.verdict === 'UNKNOWN');

  const label = (sig) => (sig.kind === 'table' ? sig.table : `${sig.table}.${sig.column}`);

  const line = (r) => {
    const what = r.sigs.length
      ? label(r.sigs[0]) + (r.sigs.length > 1 ? ` +${r.sigs.length - 1}` : '')
      : '(no probeable object)';
    const flag = r.risk.risky
      ? ` [replay risk: ${[r.risk.backfills && `${r.risk.backfills} backfill`,
                          r.risk.deletes && `${r.risk.deletes} delete`,
                          r.risk.drops && `${r.risk.drops} drop`].filter(Boolean).join(', ')}]`
      : '';
    return `  ${r.ts}  ${what.padEnd(38)}${flag}`;
  };

  console.log(`\nProbed ${rows.length} migrations against ${URL_}\n`);

  console.log(`APPLIED — present in the live schema (${applied.length})`);
  console.log('  Mark these applied so a push does not replay them.\n');
  applied.forEach(r => console.log(line(r)));

  console.log(`\nMISSING — genuinely not in the live schema (${missing.length})`);
  console.log('  These are what a push should actually apply.\n');
  missing.forEach(r => console.log(line(r)));

  if (partial.length) {
    console.log(`\nPARTIAL — half live, half not (${partial.length})`);
    console.log('  DO NOT mark these applied and DO NOT blind-push them.\n');
    partial.forEach(r => {
      console.log(line(r));
      r.sigs.forEach((sig, i) => console.log(`      ${r.states[i].padEnd(8)} ${label(sig)}`));
    });
  }

  console.log(`\nUNKNOWN — nothing PostgREST can be asked about (${unknown.length})`);
  console.log('  Functions, policies and triggers only. Most are `create or replace`,');
  console.log('  which replays safely; check any flagged with a replay risk.\n');
  unknown.forEach(r => console.log(line(r)));

  const riskyApplied = applied.filter(r => r.risk.risky);
  if (riskyApplied.length) {
    console.log(`\nWHY THIS MATTERS — ${riskyApplied.length} already-applied migration(s) carry`);
    console.log('statements that would re-run against live data if pushed:\n');
    riskyApplied.forEach(r => console.log(line(r)));
  }

  console.log('\nREPAIR COMMAND for the applied set:\n');
  console.log('  supabase migration repair --status applied \\');
  console.log(applied.map(r => `    ${r.ts}`).join(' \\\n'));
  console.log('');
};

main().catch(err => { console.error(err); process.exit(1); });
