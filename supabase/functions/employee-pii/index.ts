/// <reference lib="deno.ns" />
//
// employee-pii — the only door to encrypted employee payroll/identity data.
//
// employee_private_data has RLS enabled with zero policies and no grants, so
// nothing in the browser can read or write it. This function runs under the
// service role and is the sole access path. See
// 20260813180000_employee_private_data_encryption.sql for why the values moved
// off user_profiles in the first place.
//
// Rules this function exists to enforce:
//
//  1. VALUES ARE SEALED BEFORE THEY TOUCH THE DATABASE, with AES-256-GCM under
//     PII_ENC_KEY, which lives only in function secrets. Each value is bound to
//     its employee id AND its field name as GCM additional authenticated data,
//     so ciphertext cannot be copied onto another employee's row, or moved from
//     nssf_number_enc into bank_account_enc, and still decrypt.
//
//  2. A CALLER ONLY EVER REACHES THEIR OWN TENANT'S EMPLOYEES. The tenant is
//     derived from the caller's JWT, never from the request body. Requesting
//     another tenant's employee id returns nothing for it rather than an error,
//     so this cannot be used to probe which ids exist.
//
//  3. DECRYPTION IS ROLE-GATED to the roles that can already open the HR page
//     (RoleGuard in src/Routes.jsx: hr, admin, super_admin, sacco_admin). A
//     bank account number should not be reachable through an API by a role that
//     has no screen for it.
//
// verify_jwt = true: the JWT is what establishes the tenant.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authenticateCaller, requireRole, type Caller } from '../_shared/auth.ts';
import {
  DecryptError,
  MissingKeyError,
  decryptSecret,
  encryptSecret,
  keyConfigured,
} from '../_shared/crypto.ts';
import { callerIdentity, openRequest } from '../_shared/http.ts';

const API_VERSIONS = ['2026-08-21'];

/**
 * Mirrors the HR page's RoleGuard. Kept as a literal rather than derived from
 * is_global_viewer(): `director` is a global *viewer* for oversight reporting,
 * which is not the same as needing staff bank account numbers in the clear.
 * Presence flags remain visible to directors through
 * employee_private_data_status().
 */
const PII_ROLES = ['hr', 'admin', 'super_admin', 'sacco_admin'];

/** Roles that may read across every tenant. */
const GLOBAL_ROLES = ['super_admin', 'director'];

/** Plaintext column on user_profiles → ciphertext column on the vault table. */
const FIELDS = {
  bank_account: 'bank_account_enc',
  nssf_number: 'nssf_number_enc',
  next_of_kin_id: 'next_of_kin_id_enc',
} as const;

type FieldName = keyof typeof FIELDS;
const FIELD_NAMES = Object.keys(FIELDS) as FieldName[];

const isGlobal = (caller: Caller) =>
  caller.kind === 'service' || GLOBAL_ROLES.includes(caller.role);

/**
 * The tenant a caller belongs to. Matches current_admin_id() in SQL: a tenant
 * owner's own admin_id is NULL, and they are their own tenant.
 */
const tenantOf = (caller: Caller): string | null =>
  caller.kind === 'service' ? null : caller.adminId ?? caller.userId;

type Vault = {
  user_id: string;
  admin_id: string | null;
  bank_account_enc: string | null;
  nssf_number_enc: string | null;
  next_of_kin_id_enc: string | null;
};

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Which plaintext columns still exist. bank_account and nssf_number live in the
 * production database but were never created by a migration, so a fresh
 * environment legitimately lacks them and a blind select would fail outright.
 * Probed once per instance.
 */
let legacyColumns: FieldName[] | null = null;

async function detectLegacyColumns(db: Db): Promise<FieldName[]> {
  if (legacyColumns) return legacyColumns;
  const found: FieldName[] = [];
  for (const field of FIELD_NAMES) {
    const { error } = await db.from('user_profiles').select(field).limit(1);
    if (!error) found.push(field);
  }
  legacyColumns = found;
  return found;
}

/** Employees of `userIds` the caller is allowed to touch. */
async function authorisedEmployees(
  db: Db,
  caller: Caller,
  userIds: string[],
): Promise<Map<string, string | null>> {
  if (!userIds.length) return new Map();
  let q = db.from('user_profiles').select('id, admin_id').in('id', userIds);
  if (!isGlobal(caller)) {
    const tenant = tenantOf(caller);
    // A tenant owner's own profile row carries admin_id = NULL, so match the
    // row itself as well or an admin cannot see their own record.
    q = q.or(`admin_id.eq.${tenant},id.eq.${tenant}`);
  }
  const { data, error } = await q;
  if (error) throw new Error(`Could not resolve employees: ${error.message}`);
  return new Map(
    (data as { id: string; admin_id: string | null }[]).map((r) => [r.id, r.admin_id]),
  );
}

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: 'employee-pii',
    methods: 'POST, OPTIONS',
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  // Shadows the module-level helper this file used to define, so every
  // json(...) below emits origin-checked headers.
  const json = api.json;

  try {
    if (!keyConfigured('pii')) {
      return json(
        {
          error:
            'PII_ENC_KEY is not set on this project, so employee private data cannot be read or written. Set it in the Supabase function secrets.',
          code: 'ENC_KEY_MISSING',
        },
        503,
      );
    }

    const auth = await authenticateCaller(req);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const caller = auth.caller;

    const denied = requireRole(caller, PII_ROLES);
    if (denied) return json({ error: denied.error }, denied.status);

    // This is the only path to decrypted bank details, NSSF numbers and
    // next-of-kin IDs. A `read` takes a LIST of user ids, so an authorised but
    // curious — or compromised — HR session could walk the whole tenant a batch
    // at a time and never trip anything. Legitimate use is an HR screen opening
    // one employee, or one page of them.
    const over = await api.enforceLimit({
      action: 'access',
      identity: callerIdentity(caller),
      limit: 30,
      windowSeconds: 60,
    });
    if (over) return over;

    const db: Db = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '');

    // ── read ────────────────────────────────────────────────────────────────
    // { action:'read', userIds:[uuid] } → { values: { [userId]: {field: value} } }
    if (action === 'read') {
      const userIds: string[] = Array.isArray(body.userIds)
        ? body.userIds.filter((v: unknown) => typeof v === 'string')
        : [];
      if (!userIds.length) return json({ values: {} });

      const allowed = await authorisedEmployees(db, caller, userIds);
      if (!allowed.size) return json({ values: {} });
      const ids = [...allowed.keys()];

      const { data: rows, error } = await db
        .from('employee_private_data')
        .select('user_id, admin_id, bank_account_enc, nssf_number_enc, next_of_kin_id_enc')
        .in('user_id', ids);
      if (error) throw new Error(`Could not read private data: ${error.message}`);

      const values: Record<string, Record<string, string | null>> = {};
      const undecryptable: string[] = [];

      for (const row of (rows ?? []) as Vault[]) {
        const out: Record<string, string | null> = {};
        for (const field of FIELD_NAMES) {
          const sealed = row[FIELDS[field]];
          if (!sealed) {
            out[field] = null;
            continue;
          }
          try {
            out[field] = await decryptSecret(sealed, 'pii', {
              recordId: row.user_id,
              field,
            });
          } catch (err) {
            // One unreadable value must not blank out the rest of the record.
            // Report it as null and name it, so a key mismatch surfaces as a
            // fault rather than looking like the field was never filled in.
            out[field] = null;
            undecryptable.push(`${row.user_id}.${field}`);
            console.error(
              `employee-pii: decrypt failed for ${row.user_id}.${field}:`,
              err instanceof DecryptError ? err.message : err,
            );
          }
        }
        values[row.user_id] = out;
      }

      // Transitional: before the backfill runs the values are still in the old
      // plaintext columns. Fall back to them so the HR page does not show blank
      // fields between deploying this and running the backfill.
      //
      // The fallback is per FIELD, not per record. An employee can legitimately
      // be half-migrated — one field sealed by a save, the rest still plaintext —
      // and treating the presence of a vault row as "fully migrated" would hide
      // the fields that had not moved yet.
      //
      // Only fills a field that is null here, so a deliberately cleared value is
      // never resurrected: the write path nulls the plaintext for every field it
      // seals, so a cleared field has no plaintext left to fall back to.
      const legacy = await detectLegacyColumns(db);
      if (legacy.length) {
        const needed = ids.filter((id) =>
          legacy.some((field) => !values[id] || values[id][field] == null)
        );
        if (needed.length) {
          const { data: old } = await db
            .from('user_profiles')
            .select(['id', ...legacy].join(', '))
            .in('id', needed);
          for (const row of (old ?? []) as Record<string, string | null>[]) {
            const id = String(row.id);
            const out = values[id] ??
              FIELD_NAMES.reduce((acc, f) => ({ ...acc, [f]: null }), {} as Record<string, string | null>);
            for (const field of legacy) {
              if (out[field] == null) out[field] = row[field] ?? null;
            }
            values[id] = out;
          }
        }
      }

      return json({
        values,
        ...(undecryptable.length ? { undecryptable } : {}),
        pendingBackfill: legacy.length > 0,
      });
    }

    // ── write ───────────────────────────────────────────────────────────────
    // { action:'write', userId, fields:{ bank_account?, ... } }
    // An omitted field is left alone; an empty/null field is cleared.
    if (action === 'write') {
      const userId = typeof body.userId === 'string' ? body.userId : '';
      if (!userId) return json({ error: 'userId is required.' }, 400);

      const fields = (body.fields ?? {}) as Record<string, unknown>;
      const supplied = FIELD_NAMES.filter((f) => f in fields);
      if (!supplied.length) return json({ ok: true, updated: [] });

      const allowed = await authorisedEmployees(db, caller, [userId]);
      if (!allowed.has(userId)) {
        return json({ error: 'That employee is not in your organisation.' }, 403);
      }

      const patch: Record<string, string | null> = {
        user_id: userId,
        admin_id: allowed.get(userId) ?? tenantOf(caller),
      };

      for (const field of supplied) {
        const raw = fields[field];
        const value = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
        patch[FIELDS[field]] = value
          ? await encryptSecret(value, 'pii', { recordId: userId, field })
          : null;
      }

      const { error } = await db
        .from('employee_private_data')
        .upsert(patch, { onConflict: 'user_id' });
      if (error) throw new Error(`Could not save private data: ${error.message}`);

      // Clear any plaintext left over from before the backfill, so saving an
      // employee never leaves a stale readable copy behind the sealed one.
      const legacy = (await detectLegacyColumns(db)).filter((f) => supplied.includes(f));
      if (legacy.length) {
        const clear: Record<string, null> = {};
        for (const field of legacy) clear[field] = null;
        await db.from('user_profiles').update(clear).eq('id', userId);
      }

      return json({ ok: true, updated: supplied });
    }

    // ── backfill ────────────────────────────────────────────────────────────
    // One-time migration of existing plaintext into sealed storage. Restricted
    // to super_admin: it rewrites every tenant's records, not just the
    // caller's. Idempotent — a row already sealed is skipped, and each value is
    // nulled in user_profiles only after its ciphertext is committed, so an
    // interrupted run loses nothing and can simply be re-run.
    if (action === 'backfill') {
      if (caller.kind !== 'service' && caller.role !== 'super_admin') {
        return json({ error: 'Only a super admin can run the backfill.' }, 403);
      }

      const legacy = await detectLegacyColumns(db);
      if (!legacy.length) {
        return json({
          ok: true,
          sealed: 0,
          scanned: 0,
          message: 'No plaintext columns remain — the backfill has already been completed.',
        });
      }

      const { data: rows, error } = await db
        .from('user_profiles')
        .select(['id', 'admin_id', ...legacy].join(', '));
      if (error) throw new Error(`Could not scan user_profiles: ${error.message}`);

      let sealed = 0;
      const failures: string[] = [];

      for (const row of (rows ?? []) as Record<string, string | null>[]) {
        const userId = String(row.id);
        const patch: Record<string, string | null> = {};

        for (const field of legacy) {
          const value = (row[field] ?? '').toString().trim();
          if (value) {
            patch[FIELDS[field]] = await encryptSecret(value, 'pii', {
              recordId: userId,
              field,
            });
          }
        }
        if (!Object.keys(patch).length) continue;

        const { error: upErr } = await db
          .from('employee_private_data')
          .upsert(
            { user_id: userId, admin_id: row.admin_id ?? null, ...patch },
            { onConflict: 'user_id' },
          );
        if (upErr) {
          failures.push(`${userId}: ${upErr.message}`);
          continue;
        }

        // Only now is it safe to drop the readable copy.
        const clear: Record<string, null> = {};
        for (const field of legacy) clear[field] = null;
        const { error: clrErr } = await db
          .from('user_profiles')
          .update(clear)
          .eq('id', userId);
        if (clrErr) {
          failures.push(`${userId}: sealed but plaintext not cleared — ${clrErr.message}`);
          continue;
        }
        sealed++;
      }

      return json({
        ok: failures.length === 0,
        scanned: (rows ?? []).length,
        sealed,
        columns: legacy,
        ...(failures.length ? { failures } : {}),
        message: failures.length
          ? 'Backfill finished with errors — re-run after resolving them. It is safe to repeat.'
          : 'Backfill complete. Verify, then apply 20260813190000_drop_plaintext_employee_pii.sql.',
      });
    }

    return json({ error: `Unknown action "${action}".` }, 400);
  } catch (err) {
    // MissingKeyError is deliberate operator-facing text ("set PII_ENC_KEY"),
    // not an internal detail, so it survives unchanged.
    if (err instanceof MissingKeyError) {
      return json({ error: err.message, code: 'ENC_KEY_MISSING' }, 503);
    }
    return api.fail(err);
  }
});
