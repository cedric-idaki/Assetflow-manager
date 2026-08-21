/// <reference lib="deno.ns" />
//
// mpesa-status-query — the reconciler for pushes that never got a usable answer.
//
// Run it every ~2 minutes (Supabase scheduled function / external cron — the
// same mechanism sacco-governance-tick and agent-followup-reminders use).
//
// It exists because two things routinely leave a payment unsettled:
//
//   1. Safaricom's callback never arrives. They get lost. When that happens the
//      customer has paid, the money is in the paybill, and nothing in the
//      system knows — the client polls for three minutes, gives up, tells them
//      "please try again", and they pay twice.
//   2. mpesa-callback deliberately declined to settle, because Daraja could not
//      confirm the outcome at the moment it asked ("the transaction is being
//      processed"). That design only works if something asks again. This is it.
//
// So this worker is load-bearing, not a nicety: since mpesa-callback stopped
// trusting the request body, it is the only thing that resolves a push whose
// confirmation was slow. Keep its interval inside the 3-minute window the
// client polls for, or users will still see spurious timeouts.
//
// It settles ONLY on Safaricom's own answer, through the same
// _shared/mpesa-settle.ts the callback uses, so both paths write the books
// identically. 'unknown' never settles anything.
//
// verify_jwt = false (see config.toml) so the scheduler can invoke it with the
// service-role key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { credsForTransaction, stkQuery } from '../_shared/mpesa.ts';
import { settleFailure, settleSuccess } from '../_shared/mpesa-settle.ts';
import { hashedIp, openRequest } from '../_shared/http.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

/**
 * Don't race a push that is still perfectly healthy. The customer has about a
 * minute to enter their PIN, and the callback lands seconds later; querying
 * before that just burns rate limit on a guaranteed "still processing".
 */
const MIN_AGE_SECONDS = 90;

/**
 * Past this, Daraja generally will not answer for a CheckoutRequestID any more.
 * Stop asking — but leave the row pending and visible rather than inventing an
 * outcome for it. Anything this old needs a human against the Safaricom
 * statement.
 */
const MAX_AGE_DAYS = 7;

/** Bound the work (and the Daraja calls) a single run can do. */
const BATCH_LIMIT = 50;

const API_VERSIONS = ['2026-08-21'];

// ─── Scheduler authentication ─────────────────────────────────────────────────
// config.toml sets verify_jwt = false so the scheduler can invoke this without a
// user JWT — which also means the platform performs no auth at all and anyone
// can POST here. Accept only the service-role key (what the scheduler sends) or
// an explicit CRON_SECRET, compared in constant time.

const safeEqual = (a: string, b: string): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const isScheduler = (req: Request): boolean => {
  const auth = req.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (safeEqual(bearer, SERVICE_KEY)) return true;
  return safeEqual((req.headers.get('x-cron-secret') || '').trim(), CRON_SECRET);
};

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: 'mpesa-status-query',
    methods: 'POST, OPTIONS',
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  // Shadows the module-level helper this file used to define.
  const json = api.json;

  if (!isScheduler(req)) {
    // verify_jwt = false means the platform lets anybody reach this handler, so
    // an attacker can hammer it to grind at the two shared secrets above. The
    // comparison is constant-time, but nothing stopped the attempts themselves.
    // Rejected callers are limited by hashed IP; the real scheduler presents a
    // valid key on its first try and never reaches this branch.
    const over = await api.enforceLimit({
      action: 'unauthorized',
      identity: `ip:${await hashedIp(req, 'mpesa-status-query')}`,
      limit: 10,
      windowSeconds: 300,
    });
    if (over) return over;
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const now = Date.now();
    const olderThan = new Date(now - MIN_AGE_SECONDS * 1000).toISOString();
    const newerThan = new Date(now - MAX_AGE_DAYS * 86_400_000).toISOString();

    const { data: rows, error } = await supabase
      .from('mpesa_transactions')
      .select('*')
      .eq('status', 'pending')
      .is('settled_at', null)
      .lt('created_at', olderThan)
      .gt('created_at', newerThan)
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) throw new Error(`Could not read pending transactions: ${error.message}`);

    const pending = rows ?? [];
    let settled = 0;
    let failed = 0;
    let unresolved = 0;
    let unverifiable = 0;

    for (const txn of pending) {
      const creds = await credsForTransaction(supabase, txn);
      if (!creds) {
        // Platform secrets missing, or the tenant switched their integration
        // off with a payment still in flight. Cannot ask, so cannot settle.
        unverifiable++;
        console.error(
          `No usable credentials to verify ${txn.checkout_request_id} (purpose ${txn.purpose}, admin ${txn.admin_id}). Still pending.`,
        );
        continue;
      }

      await supabase
        .from('mpesa_transactions')
        .update({ last_query_at: new Date().toISOString() })
        .eq('checkout_request_id', txn.checkout_request_id);

      const outcome = await stkQuery(creds, txn.checkout_request_id);

      if (outcome.state === 'unknown') {
        unresolved++;
        continue;
      }

      if (outcome.state === 'success') {
        // No receipt available here — Daraja's query response does not carry
        // one. settleSuccess falls back to a reference derived from the
        // CheckoutRequestID so the payment is still banked and still traceable.
        const claimed = await settleSuccess(supabase, txn, {
          receipt: '',
          phone: txn.phone_number ?? '',
          resultDesc: outcome.resultDesc || 'Confirmed by status query',
        });
        if (claimed) {
          settled++;
          console.warn(
            `Reconciled a payment whose callback never landed: ${txn.checkout_request_id}, purpose ${txn.purpose}, KES ${txn.amount}. Receipt unknown — match against the Safaricom statement.`,
          );
        }
      } else {
        await settleFailure(supabase, txn, {
          resultCode: outcome.resultCode,
          resultDesc: outcome.resultDesc,
        });
        failed++;
      }
    }

    return json({
      ok: true,
      examined: pending.length,
      settled,
      failed,
      unresolved,
      unverifiable,
      // A full batch means there is probably more waiting; the next run takes it.
      more: pending.length === BATCH_LIMIT,
    });
  } catch (err) {
    return api.fail(err);
  }
});
