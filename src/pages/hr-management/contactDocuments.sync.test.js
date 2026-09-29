/**
 * The HR page names the four contact-document columns (next of kin + secondary
 * contact, ID scan + photo) in its own CONTACT_DOC_FIELDS list, and migration
 * 20260925190000 creates them. This test reads both and fails when they drift.
 *
 * Why it earns a file: a misspelt column is not a visible error here. The
 * employee list selects these columns in a tier of their own and quietly steps
 * down a tier when that select fails — so a typo would never break the page, it
 * would just make every contact document vanish, and each upload would then be
 * refused as an unknown column.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const sql  = read('supabase/migrations/20260925190000_employee_contact_documents.sql');
const page = read('src/pages/hr-management/index.jsx');

const listBody = /const CONTACT_DOC_FIELDS = \[([\s\S]*?)\];/.exec(page)?.[1] ?? '';
const fields = [...listBody.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

describe('HR contact documents mirror migration 20260925190000', () => {
  it('the page declares an ID document and a photo for both contacts', () => {
    expect(fields).toEqual([
      'next_of_kin_id_document_url',
      'next_of_kin_photo_url',
      'secondary_contact_id_document_url',
      'secondary_contact_photo_url',
    ]);
  });

  it.each(fields)('%s is added to user_profiles by the migration', (col) => {
    expect(sql).toMatch(new RegExp(`add column if not exists ${col}\\s+text`));
  });

  it.each(fields)('%s has an upload slot in the employee form', (col) => {
    expect(page).toContain(`field="${col}"`);
  });

  it.each(fields)('%s is shown on the employee detail drawer', (col) => {
    expect(page).toContain(`employee.${col}`);
  });
});
