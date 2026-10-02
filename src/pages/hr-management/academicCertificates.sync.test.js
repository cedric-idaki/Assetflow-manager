/**
 * The HR page names the certificates column in CERTS_FIELD, and migration
 * 20261002120000 creates it. Drift is silent for the same reason as the contact
 * documents (see contactDocuments.sync.test.js): the employee list selects the
 * column in a tier of its own and quietly steps down when that select fails, so
 * a typo would hide every certificate and refuse every upload.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const sql  = read('supabase/migrations/20261002120000_employee_academic_certificates.sql');
const page = read('src/pages/hr-management/index.jsx');

const field = /const CERTS_FIELD = '([a-z_]+)';/.exec(page)?.[1];

describe('HR academic certificates mirror migration 20261002120000', () => {
  it('the page declares the column', () => {
    expect(field).toBe('academic_certificates');
  });

  it('the migration adds it to user_profiles as a jsonb array defaulting to empty', () => {
    expect(sql).toMatch(new RegExp(`add column if not exists ${field}\\s+jsonb not null default '\\[\\]'::jsonb`));
    expect(sql).toContain(`check (jsonb_typeof(${field}) = 'array')`);
  });
});
