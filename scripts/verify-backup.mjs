#!/usr/bin/env node
/**
 * BACKUP VERIFICATION
 *
 * Checks what a zero exit code from `pg_dump` does not.
 *
 * The failure this exists to catch is the quiet one. `pg_dump` succeeds on a
 * backup missing 90% of its rows, on one truncated by a disconnect, and on one
 * taken against an empty database. All three produce a plausible file at the
 * expected path, and all three are discovered during the outage.
 *
 * So this reads the archive's own table of contents, counts what is in it,
 * compares against the last run, and looks at the storage copy beside it. It
 * makes no network calls and never touches the live database.
 *
 * USAGE
 *   node scripts/verify-backup.mjs --dump ararat-db-2026-09-08.dump \
 *                                  --storage ./storage-2026-09-08/
 *
 *   --baseline <file>   where to read/write the previous run (default
 *                       .backup-baseline.json beside the dump)
 *   --no-baseline       skip the drift comparison (first ever run)
 *
 * ENVIRONMENT
 *   PG_RESTORE_BIN      path to pg_restore. Set this when the machine has
 *                       several Postgres versions installed: reading a dump
 *                       with an OLDER pg_restore than the server that wrote it
 *                       fails outright, and whatever is first on PATH is
 *                       rarely the one you want.
 *
 * EXIT CODES
 *   0  every check passed
 *   1  a check failed — this is an incident, not a retry
 *   2  the script could not run (bad arguments, pg_restore missing)
 *
 * Referenced by docu/BACKUP_PROTOCOL.md §5.1.
 *
 * WHAT HAS BEEN EXERCISED, AND WHAT HAS NOT. The TOC parsing, the argument
 * handling and the failure paths have been run. The success path against a
 * REAL pg_dump archive has not — the machine this was written on has no
 * Postgres client tools. The first genuine end-to-end run is training session A4
 * (docu/TRAINING.md), which is deliberately structured around it: take a real
 * backup, verify it, then truncate the file and watch this script catch it.
 * Treat the first run as part of the drill, not as a formality.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// ── The tables whose absence makes a restore worthless ──────────────────────
// Not "important tables" in general — these are the ones holding money,
// identity and the audit trail. A backup missing any of them is not a partial
// backup, it is a useless one.
const CRITICAL_TABLES = [
  'clients',
  'payments',
  'sales',
  'assets',
  'sacco_members',
  'sacco_loans',
  'sacco_shares',
  'user_profiles',
  'audit_logs',
  'company_invoices',
];

// Every private bucket. A public bucket losing its contents is embarrassing; a
// private one losing them is a regulatory finding.
const PRIVATE_BUCKETS = [
  'kyc-documents',
  'contracts',
  'esign-documents',
  'signed-certificates',
  'employee-documents',
  'sacco-asset-documents',
  'sacco-loan-collateral',
  'payment-request-documents',
  'document-archive',
];

// Anything matching these must never appear inside a backup artifact. A key
// sitting in the same folder as the data it protects defeats the point of
// holding it separately.
const SECRET_PATTERNS = [
  /PII_ENC_KEY\s*=/,
  /MPESA_CRED_ENC_KEY\s*=/,
  /ETIMS_CRED_ENC_KEY\s*=/,
  /SIGNNOW_CRED_ENC_KEY\s*=/,
  /SERVICE_ROLE_KEY\s*=/,
  /\bsb_secret_[A-Za-z0-9_-]{10,}/,
];

// A count this much below the baseline is not natural attrition.
const DRIFT_FLOOR = 0.9;

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const dumpPath    = flag('dump');
const storagePath = flag('storage');
const noBaseline  = has('no-baseline');

if (!dumpPath) {
  console.error('usage: node scripts/verify-backup.mjs --dump <file.dump> [--storage <dir>]');
  process.exit(2);
}

const baselinePath = flag('baseline', join(dirname(resolve(dumpPath)), '.backup-baseline.json'));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const bytes = (n) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// ── 1. The archive is readable ──────────────────────────────────────────────
console.log('\nDatabase dump');

if (!existsSync(dumpPath)) {
  check('dump exists', false, dumpPath);
  process.exit(1);
}

const size = statSync(dumpPath).size;
// A dump of this schema is megabytes. Anything under 100 KB is a header and an
// error message.
check('dump exists and is not a stub', size > 100 * 1024, bytes(size));

let toc = '';
try {
  toc = execFileSync(process.env.PG_RESTORE_BIN || 'pg_restore', ['--list', dumpPath], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  check('dump is a readable archive', true, 'pg_restore --list succeeded');
} catch (err) {
  // Distinguish "pg_restore is not installed" from "this dump is broken". The
  // first is a machine that cannot run the check; the second is an incident.
  // Reporting a missing tool as a failed backup sends somebody off to re-take
  // a backup that was fine.
  if (err.code === 'ENOENT') {
    console.error('');
    console.error('  ----  pg_restore not found. Install the Postgres client tools, or set');
    console.error('        PG_RESTORE_BIN to its path. The backup has NOT been verified.');
    console.error('');
    process.exit(2);
  }
  // A truncated file fails HERE, which is exactly the case a size check misses.
  check('dump is a readable archive', false, String(err.message).split('\n')[0]);
  console.error('\nThe archive could not be read. Take the backup again before doing anything else.\n');
  process.exit(1);
}

// ── 2. It contains the tables that matter ───────────────────────────────────
const tables = new Set(
  [...toc.matchAll(/TABLE DATA public (\S+)/g)].map(m => m[1]),
);
const schemaTables = new Set(
  [...toc.matchAll(/TABLE public (\S+)/g)].map(m => m[1]),
);

check('schema present', schemaTables.size > 50, `${schemaTables.size} tables defined`);

const missing = CRITICAL_TABLES.filter(t => !tables.has(t) && !schemaTables.has(t));
check('critical tables present', missing.length === 0,
  missing.length ? `missing: ${missing.join(', ')}` : `${CRITICAL_TABLES.length} checked`);

// Policies and functions are not decoration: a restore without them is a
// database where every tenant can read every other tenant.
const policies  = (toc.match(/ POLICY /g) || []).length;
const functions = (toc.match(/ FUNCTION /g) || []).length;
check('RLS policies present', policies > 20, `${policies} policies`);
check('functions present', functions > 20, `${functions} functions`);

// ── 3. It is not wildly smaller than last time ──────────────────────────────
const current = {
  takenAt: new Date().toISOString(),
  dump: dumpPath,
  sizeBytes: size,
  tables: schemaTables.size,
  policies,
  functions,
};

if (!noBaseline && existsSync(baselinePath)) {
  try {
    const prev = JSON.parse(readFileSync(baselinePath, 'utf8'));
    const ratio = (a, b) => (b > 0 ? a / b : 1);

    check('size has not collapsed since last run',
      ratio(size, prev.sizeBytes) >= DRIFT_FLOOR,
      `${bytes(size)} vs ${bytes(prev.sizeBytes)} on ${prev.takenAt.slice(0, 10)}`);

    check('table count has not dropped',
      schemaTables.size >= prev.tables,
      `${schemaTables.size} vs ${prev.tables}`);

    check('policy count has not dropped',
      policies >= prev.policies,
      `${policies} vs ${prev.policies}`);
  } catch (err) {
    check('baseline readable', false, err.message);
  }
} else {
  console.log('  ----  no baseline to compare against; this run becomes the baseline');
}

// ── 4. Storage ──────────────────────────────────────────────────────────────
if (storagePath) {
  console.log('\nStorage copy');

  if (!existsSync(storagePath)) {
    check('storage copy exists', false, storagePath);
  } else {
    const present = new Set(
      readdirSync(storagePath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name),
    );

    const absent = PRIVATE_BUCKETS.filter(b => !present.has(b));
    check('every private bucket is in the copy', absent.length === 0,
      absent.length ? `missing: ${absent.join(', ')}` : `${PRIVATE_BUCKETS.length} buckets`);

    // A bucket directory that exists and is empty is the failure mode of a
    // download that was interrupted partway.
    const empty = PRIVATE_BUCKETS
      .filter(b => present.has(b))
      .filter(b => {
        try {
          return readdirSync(join(storagePath, b)).length === 0;
        } catch { return true; }
      });
    check('no private bucket copied empty', empty.length === 0,
      empty.length ? `empty: ${empty.join(', ')}` : 'all populated');
  }
}

// ── 5. No secrets travelling with the data ──────────────────────────────────
console.log('\nSecret hygiene');

const scanFolder = storagePath && existsSync(storagePath) ? storagePath : dirname(resolve(dumpPath));
const leaked = [];
try {
  for (const entry of readdirSync(scanFolder, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(env|json|txt|sh|cfg|ini|yaml|yml)$/i.test(entry.name)) continue;
    const text = readFileSync(join(scanFolder, entry.name), 'utf8');
    if (SECRET_PATTERNS.some(re => re.test(text))) leaked.push(entry.name);
  }
} catch { /* an unreadable folder is not a leak */ }

check('no encryption key or service key beside the backup', leaked.length === 0,
  leaked.length ? `found in: ${leaked.join(', ')}` : 'clean');

// ── Result ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
console.log('');

if (failed.length === 0) {
  try {
    writeFileSync(baselinePath, JSON.stringify(current, null, 2));
  } catch { /* a baseline we cannot write is not a failed backup */ }
  console.log(`ALL CHECKS PASSED — ${results.length} checks. Record this in the backup log.`);
  process.exit(0);
}

// The baseline is deliberately NOT updated on failure: a bad run must not
// become the yardstick the next one is measured against.
console.error(`${failed.length} CHECK(S) FAILED:`);
failed.forEach(f => console.error(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
console.error('\nThis is an incident. Do not re-run and hope — see docu/BACKUP_PROTOCOL.md §5.\n');
process.exit(1);
