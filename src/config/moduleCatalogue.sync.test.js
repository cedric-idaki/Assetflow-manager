/**
 * The module catalogue exists in two places and they must agree:
 *
 *   src/config/modules.js          — label, icon, scope, presets, routes
 *   public.module_catalogue()      — the key list and the dependency graph,
 *                                    redefined by whichever migration touched
 *                                    it last
 *
 * The DATABASE owns enforcement: set_tenant_module() rejects a key the
 * catalogue does not list, and enforce_module_write() gates writes on it. So a
 * module that exists only in modules.js is a module the server has never heard
 * of — the tenant is offered a switch, flips it, and the RPC refuses. A module
 * that exists only in SQL is one nothing in the portal can ever switch on.
 *
 * Three separate files say "change one, change both" in a comment. Nothing
 * checked it until now, and the catalogue has already been redefined by three
 * different migrations. This test reads the newest definition out of the
 * migrations and compares it, the same way planCatalogs.sync.test.js reads
 * _shared/plans.ts.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MODULES, MODULE_KEYS, PRESETS } from './modules';

const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');

/**
 * The catalogue as the database will actually have it: the definition in the
 * LAST migration that redefines it, since each `create or replace` supersedes
 * the one before.
 */
function catalogueFromMigrations() {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // timestamp-prefixed, so lexical order is apply order

  let newest = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const at = sql.lastIndexOf('create or replace function public.module_catalogue()');
    if (at === -1) continue;

    const body = sql.slice(at);
    const from = body.indexOf('values');
    const to = body.indexOf(') as t(module_key, requires)');
    if (from === -1 || to === -1) throw new Error(`Could not parse module_catalogue() in ${file}`);

    const rows = [...body.slice(from, to).matchAll(/\(\s*'([a-z_]+)'\s*,\s*([^)]*?)\)\s*(?:,|$)/g)]
      .map(([, key, requires]) => ({
        key,
        requires: [...requires.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
      }));

    newest = { file, rows };
  }

  if (!newest) throw new Error('No migration defines module_catalogue().');
  return newest;
}

const catalogue = catalogueFromMigrations();
const sqlKeys = catalogue.rows.map((r) => r.key);

describe(`module_catalogue() — newest definition is in ${catalogue.file}`, () => {
  it('parses as a non-trivial catalogue', () => {
    expect(sqlKeys.length).toBeGreaterThan(15);
  });

  it('lists exactly the modules src/config/modules.js does', () => {
    // Sorted: the two files order modules for different readers (the UI groups
    // by scope), and the order carries no meaning to either.
    expect([...sqlKeys].sort()).toEqual([...MODULE_KEYS].sort());
  });

  it('has no module the portal cannot switch on', () => {
    const orphans = sqlKeys.filter((k) => !MODULE_KEYS.includes(k));
    expect(orphans, `in SQL but not in modules.js: ${orphans.join(', ')}`).toEqual([]);
  });

  it('has no module the database would refuse', () => {
    const missing = MODULE_KEYS.filter((k) => !sqlKeys.includes(k));
    expect(missing, `in modules.js but not in SQL: ${missing.join(', ')}`).toEqual([]);
  });

  it('agrees on what each module depends on', () => {
    for (const row of catalogue.rows) {
      const mod = MODULES.find((m) => m.key === row.key);
      expect([...row.requires].sort(), `requires for "${row.key}"`)
        .toEqual([...(mod?.requires ?? [])].sort());
    }
  });

  it('never lets a module depend on one that does not exist', () => {
    for (const row of catalogue.rows) {
      for (const dep of row.requires) {
        expect(sqlKeys, `"${row.key}" requires unknown module "${dep}"`).toContain(dep);
      }
    }
  });

  it('offers only real modules in every preset', () => {
    for (const [preset, keys] of Object.entries(PRESETS)) {
      for (const key of keys) {
        expect(MODULE_KEYS, `preset "${preset}" offers unknown module "${key}"`).toContain(key);
      }
    }
  });

  it('never pre-ticks a module whose dependency is not also pre-ticked', () => {
    // set_tenant_module() enables dependencies transitively, so this would not
    // break — but a preset that quietly switches on a module the registrant did
    // not choose is a surprise, not a feature.
    for (const [preset, keys] of Object.entries(PRESETS)) {
      for (const key of keys) {
        const requires = MODULES.find((m) => m.key === key)?.requires ?? [];
        for (const dep of requires) {
          expect(keys, `preset "${preset}" has "${key}" but not its dependency "${dep}"`)
            .toContain(dep);
        }
      }
    }
  });

  it('does not put eTIMS in any preset', () => {
    // Deliberate — see migration 20260902160000. Filing tax documents on a
    // tenant's behalf is not a default anyone should acquire by ticking a box
    // they did not read.
    expect(sqlKeys).toContain('etims');
    for (const [preset, keys] of Object.entries(PRESETS)) {
      expect(keys, `preset "${preset}" must not pre-tick etims`).not.toContain('etims');
    }
  });
});
