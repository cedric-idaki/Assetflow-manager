/**
 * Encrypted employee payroll/identity data — the browser's side.
 *
 * bank_account, nssf_number and next_of_kin_id no longer live on user_profiles.
 * They are AES-256-GCM ciphertext in employee_private_data, a table with RLS on
 * and zero policies, so there is nothing for supabase-js to select here. Every
 * read and write goes through the employee-pii edge function, which holds the
 * key. See supabase/migrations/20260813180000_employee_private_data_encryption.sql.
 *
 * Consequences worth knowing before using these fields anywhere new:
 *   • They cannot be filtered, sorted or searched in SQL. Ciphertext is opaque,
 *     and a fresh IV per write means the same account number encrypts
 *     differently every time.
 *   • They arrive on a second round trip, so a list view should not fetch them.
 *     Fetch for the record actually being opened.
 */

import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

/** The fields this service carries. Anything else stays on user_profiles. */
export const PII_FIELDS = ['bank_account', 'nssf_number', 'next_of_kin_id'];

const EMPTY = Object.freeze(
  PII_FIELDS.reduce((acc, f) => ({ ...acc, [f]: '' }), {}),
);

/** A blank record, for a new employee or a failed fetch. */
export const emptyPii = () => ({ ...EMPTY });

const invoke = async (body) => {
  const { data, error } = await supabase.functions.invoke('employee-pii', { body });
  if (error) {
    // supabase-js collapses a non-2xx into a generic FunctionsHttpError, so dig
    // the real message out of the response before surfacing it — "Failed to
    // send a request" tells an operator nothing about a missing key.
    let detail = error.message;
    try {
      const parsed = await error.context?.json?.();
      if (parsed?.error) detail = parsed.error;
    } catch { /* response wasn't JSON — keep the generic message */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data ?? {};
};

/**
 * Decrypted values for one employee, as `{ bank_account, nssf_number,
 * next_of_kin_id }` with '' for anything unset.
 *
 * Returns blanks rather than throwing when the fetch fails: the HR form must
 * still open and remain usable for the twenty-odd fields that are not
 * encrypted. `ok` distinguishes "nothing on file" from "could not read", so the
 * caller can warn instead of silently presenting empty inputs as the truth —
 * saving those blanks back would erase the real values.
 */
export const fetchEmployeePii = async (userId) => {
  if (!userId) return { ...emptyPii(), ok: true };
  try {
    const { values } = await invoke({ action: 'read', userIds: [userId] });
    const row = values?.[userId] ?? {};
    return {
      ...PII_FIELDS.reduce((acc, f) => ({ ...acc, [f]: row[f] ?? '' }), {}),
      ok: true,
    };
  } catch (err) {
    logger.error('employee-pii read failed', err);
    return { ...emptyPii(), ok: false, error: err.message };
  }
};

/**
 * Decrypted values for many employees at once, as
 * `{ ok, values: { [userId]: { bank_account, ... } } }`.
 *
 * For genuine bulk needs — a payroll run, a statutory export. Do NOT reach for
 * this to populate a list view: it decrypts every row on the server and hands
 * the whole set to the browser, which is the pattern the encryption exists to
 * discourage. Fetch per-record where a user has actually asked to see one.
 *
 * `ok: false` on failure rather than blanks, so a caller can refuse to produce
 * a document full of empty fields that reads as "no data on file".
 */
export const fetchEmployeePiiBatch = async (userIds) => {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return { ok: true, values: {} };
  try {
    const { values } = await invoke({ action: 'read', userIds: ids });
    return { ok: true, values: values ?? {} };
  } catch (err) {
    logger.error('employee-pii batch read failed', err);
    return { ok: false, values: {}, error: err.message };
  }
};

/**
 * Seals and stores the supplied fields for one employee. Omit a field to leave
 * it untouched; pass '' to clear it.
 *
 * Throws on failure — unlike the read path, a silent failure here means an
 * operator believes they saved a bank account number that was never stored.
 */
export const saveEmployeePii = async (userId, fields) => {
  if (!userId) throw new Error('Cannot save private data without an employee id.');

  const payload = {};
  for (const field of PII_FIELDS) {
    if (field in fields) payload[field] = fields[field] ?? '';
  }
  if (!Object.keys(payload).length) return { updated: [] };

  return invoke({ action: 'write', userId, fields: payload });
};

/**
 * Moves any remaining plaintext into sealed storage. Super admin only, safe to
 * repeat, and a prerequisite for the migration that drops the old columns.
 */
export const backfillEmployeePii = () => invoke({ action: 'backfill' });
