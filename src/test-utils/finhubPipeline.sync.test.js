/**
 * The pipeline model in finhubPipeline.js is a MIRROR of migration
 * 20260908120000. This test reads the SQL and fails when the two drift.
 *
 * Why it is worth a file of its own: the workflow tests are only as truthful as
 * that mirror. Add a status to the enum, or a transition to
 * payment_request_transition_ok(), and every workflow assertion keeps passing
 * against a model that no longer describes production — which is worse than no
 * test, because it says the flow is covered when it is not.
 *
 * Same treatment planCatalogs.sync.test.js gives the server price catalog, and
 * for the same reason.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PIPELINE_STATUSES, PIPELINE_TRANSITIONS } from './finhubPipeline';

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260908120000_finhub_payment_approval.sql',
);

const sql = readFileSync(MIGRATION, 'utf8');

/** The enum body, with SQL comments stripped so the values come out clean. */
const enumValues = (typeName) => {
  const block = new RegExp(
    `create type public\\.${typeName} as enum\\s*\\(([\\s\\S]*?)\\);`, 'i',
  ).exec(sql);
  if (!block) return null;
  return block[1]
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
    .match(/'([a-z_]+)'/g)
    ?.map(v => v.replace(/'/g, '')) || [];
};

describe('finhubPipeline mirrors the migration', () => {
  it('the migration this mirrors is present', () => {
    expect(sql).toContain('payment_request_transition_ok');
    expect(sql).toContain('finhub_submit_payment_request');
  });

  it('has exactly the thirteen statuses the enum declares, in order', () => {
    const declared = enumValues('payment_request_status');
    expect(declared).not.toBeNull();
    expect(declared).toHaveLength(13);
    expect(PIPELINE_STATUSES).toEqual(declared);
  });

  it('has the same three decisions the enum declares', () => {
    expect(enumValues('payment_request_decision')).toEqual(['approve', 'reject', 'hold']);
  });

  it('has exactly the transitions payment_request_transition_ok allows', () => {
    const body = /payment_request_transition_ok[\s\S]*?select \(p_from, p_to\) in \(([\s\S]*?)\n  \);/i.exec(sql);
    expect(body).not.toBeNull();

    const declared = [...body[1].matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)]
      .map(m => [m[1], m[2]]);

    // Order is irrelevant to a set of legal moves; membership is not.
    const key = (p) => p.join('->');
    expect(new Set(PIPELINE_TRANSITIONS.map(key)))
      .toEqual(new Set(declared.map(key)));
    expect(PIPELINE_TRANSITIONS).toHaveLength(declared.length);
  });

  it('leaves rejected, completed and cancelled terminal', () => {
    ['rejected', 'completed', 'cancelled'].forEach(terminal => {
      expect(PIPELINE_TRANSITIONS.filter(([from]) => from === terminal)).toEqual([]);
    });
  });

  it('names every RPC the hook calls', () => {
    [
      'finhub_submit_payment_request',
      'finhub_validate_payment_request',
      'finhub_decide_payment_request',
      'finhub_verify_payment_decision',
      'finhub_bulk_decide_payment_requests',
      'finhub_verify_bulk_decision',
      'finhub_execute_payment_request',
      'finhub_fail_payment_request',
      'finhub_confirm_payment_request',
      'finhub_reconcile_payment_request',
      'finhub_cancel_payment_request',
      'finhub_resume_payment_request',
      'finhub_attach_payment_document',
      'payment_request_totals',
    ].forEach(fn => {
      expect(sql).toContain(`create or replace function public.${fn}`);
    });
  });

  it('grants execute on those RPCs to authenticated and nothing to anon', () => {
    // A function the browser cannot call is a feature that does not ship; one
    // anon can call is a payout anybody can reach.
    expect(sql).toMatch(/grant\s+execute on function public\.finhub_submit_payment_request[\s\S]*?to authenticated/);
    expect(sql).toMatch(/revoke execute on function public\.finhub_decide_payment_request[\s\S]*?from public, anon/);
  });

  it('keeps the tables writable only through those functions', () => {
    // SELECT policies exist; there must be no INSERT/UPDATE/DELETE policy on
    // payment_requests, or the whole status machine is bypassable by a PATCH.
    expect(sql).toContain('create policy payreq_select on public.payment_requests');
    expect(sql).not.toMatch(/create policy \w+ on public\.payment_requests\s+for (insert|update|delete)/i);
    expect(sql).toContain('grant select on public.payment_requests          to authenticated;');
  });

  it('keeps the audit trail append-only', () => {
    expect(sql).toContain('payment_request_events is append-only');
    expect(sql).toMatch(/before update or delete on public\.payment_request_events/i);
  });

  it('gates agent_wallets withdrawals behind a processing request', () => {
    expect(sql).toContain('agent_wallet_withdrawal_gate');
    expect(sql).toMatch(/before insert on public\.agent_wallets/i);
    expect(sql).toContain("if v_status <> 'processing' then");
  });
});
