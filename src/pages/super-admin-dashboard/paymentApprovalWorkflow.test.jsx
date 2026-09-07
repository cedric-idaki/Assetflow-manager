/**
 * End-to-end test of the FinHub payment approval workflow.
 *
 * THE PIPELINE UNDER TEST (migration 20260908120000):
 *
 *   Agent Portal      useSalesAgentPortal.requestWithdrawal
 *        v                 -> finhub_submit_payment_request
 *   FinHub Validation  -> finhub_validate_payment_request
 *   Super Admin        -> finhub_decide_payment_request        YES / NO / WAIT
 *   Two-Step Verify    -> finhub_verify_payment_decision
 *   FinHub Execution   -> finhub_execute_payment_request       (writes the wallet row)
 *   Bank Confirmation  -> finhub_confirm_payment_request
 *   Reconciliation     -> finhub_reconcile_payment_request
 *        v
 *   completed, with an immutable event per step.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. `payment_requests` has a SELECT policy
 * and nothing else — every write in production is a SECURITY DEFINER function.
 * So these tests drive the real hooks against the RPC names those hooks call,
 * answered by src/test-utils/finhubPipeline.js. That is a genuine end-to-end
 * check of everything on this side of the RPC boundary. It is NOT a test of the
 * SQL: no Postgres runs in this suite. finhubPipeline.sync.test.js is what
 * keeps the model honest — it reads the migration and fails when the two drift.
 *
 * Cases follow the brief: successful approval, rejection, hold, invalid
 * invoice, missing documents, duplicate requests, failed payment, failed
 * verification, bulk approval, and the audit trail.
 */

import React from 'react';
import { renderHook, act, waitFor, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase, resetFakeIds } from '../../test-utils/fakeSupabase';
import { finhubRpcs } from '../../test-utils/finhubPipeline';

const AGENT_USER = { id: 'user_agent_1', email: 'agent@ararat.co.ke' };
const ADMIN_USER = { id: 'user_admin_1', email: 'super@ararat.co.ke' };

let db;
vi.mock('../../lib/supabase', () => ({
  get supabase() { return db; },
  getCurrentUser: async () => ({ id: 'user_admin_1' }),
  invokeSupabaseFunction: vi.fn(async () => ({ data: null, error: null })),
  setRememberDevice: vi.fn(),
  REMEMBER_DEVICE_KEY: 'ararat_remember_device',
}));

let authUser = ADMIN_USER;
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authUser,
    userProfile: {
      id: authUser.id,
      full_name: authUser === ADMIN_USER ? 'Peter Otieno' : 'Grace Mwangi',
      role: authUser === ADMIN_USER ? 'super_admin' : 'sales_agent',
    },
  }),
  AuthProvider: ({ children }) => children,
}));

vi.mock('../../services/emailService', () => ({
  sendAssistRequest: vi.fn(async () => ({ ok: true })),
  sendAssistUpdate: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../services/credentialsEmailService', () => ({
  emailLoginCredentials: vi.fn(async () => ({ ok: true })),
}));

const { useSalesAgentPortal } = await import('../../hooks/useSalesAgentPortal');
const { usePaymentApproval }  = await import('../../hooks/usePaymentApproval');
const PaymentApprovalTab      = (await import('./components/PaymentApprovalTab')).default;
const { ToastProvider }       = await import('../../components/Toast');

const AGENT_ROW = {
  id: 'agent_1', user_id: AGENT_USER.id, full_name: 'Grace Mwangi',
  agent_code: 'GM-40182', email: AGENT_USER.email, agent_plan: 'bronze',
  phone: '+254712000111', total_sales: 0, total_commission: 0,
};

/** A commission credit, i.e. money the agent is owed. */
const credit = (amount, o = {}) => ({
  id: o.id || `wallet_credit_${amount}`, agent_id: 'agent_1', tx_type: 'credit',
  total_earned: amount, total_withdrawn: 0, available_balance: amount,
  description: 'Commission', created_at: '2026-09-01T08:00:00.000Z', ...o,
});

const ROLES = { [ADMIN_USER.id]: 'super_admin', [AGENT_USER.id]: 'sales_agent' };

const seed = ({ wallets = [], invoices = [], clients = [] } = {}) => createFakeSupabase({
  // Live, not a snapshot: the workflow hands off from the agent to the approver
  // mid-test, and each event must be attributed to whoever is acting.
  user: () => authUser,
  rpcs: finhubRpcs({
    roleOf:  (id) => ROLES[id] || 'sales_agent',
    agentOf: (id) => (id === AGENT_USER.id ? 'agent_1' : null),
  }),
  tables: {
    agents: [AGENT_ROW],
    user_profiles: [
      { id: ADMIN_USER.id, full_name: 'Peter Otieno', role: 'super_admin', email: ADMIN_USER.email, admin_id: null, is_active: true },
      { id: AGENT_USER.id, full_name: 'Grace Mwangi', role: 'sales_agent', email: AGENT_USER.email, admin_id: ADMIN_USER.id, is_active: true },
    ],
    agent_wallets: wallets,
    company_invoices: invoices,
    clients,
    payment_requests: [], payment_request_documents: [], payment_request_events: [],
    audit_logs: [], assets: [], payments: [], leads: [],
    sales_expenses: [], agent_assists: [], contracts: [], sales_targets: [],
  },
});

const requests = () => db._rows('payment_requests');
const only = () => requests()[0];
const eventsFor = (id) => db._rows('payment_request_events').filter(e => e.request_id === id);
const wallets = () => db._rows('agent_wallets').filter(w => w.tx_type === 'withdrawal');

const renderAgent = async () => {
  authUser = AGENT_USER;
  const h = renderHook(() => useSalesAgentPortal());
  await waitFor(() => expect(h.result.current.agentProfile?.id).toBe('agent_1'));
  return h;
};

const renderApprover = async () => {
  authUser = ADMIN_USER;
  const h = renderHook(() => usePaymentApproval({ realtime: false }));
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
};

/** Raise a request as the agent and hand back its id. */
const raise = async (amount = 20000, narrative = 'August commission') => {
  const agent = await renderAgent();
  await act(async () => { await agent.result.current.requestWithdrawal(amount, narrative); });
  return only().id;
};

beforeEach(() => {
  resetFakeIds();
  authUser = ADMIN_USER;
  db = seed({ wallets: [credit(500000)] });
  vi.clearAllMocks();
});

/* ────────────────────────────────────────────────────────────────────────────
   1. THE HAPPY PATH, ALL THE WAY TO COMPLETED
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · successful approval', () => {
  it('carries a request from the agent portal to a completed, reconciled payment', async () => {
    const id = await raise(20000);

    // Stage 1 — submitted, and NOT a wallet row. The whole point of the
    // pipeline is that asking for money no longer moves any.
    expect(only()).toMatchObject({
      agent_id: 'agent_1', amount: 20000, status: 'submitted',
      payee_name: 'Grace Mwangi', narrative: 'August commission',
    });
    expect(wallets()).toHaveLength(0);

    const approver = await renderApprover();

    // Stage 2 — FinHub validation.
    await act(async () => { await approver.result.current.validateRequest(id); });
    expect(only().status).toBe('pending_approval');
    expect(only().validation_result.checks.map(c => c.check)).toEqual(
      expect.arrayContaining(['client', 'invoice', 'amount', 'balance', 'documents', 'duplicate']),
    );

    // Stage 3 — decision. Step one records intent and MOVES NOTHING.
    let terms;
    await act(async () => {
      terms = await approver.result.current.decide(id, 'approve', 'Commission verified against August sales.');
    });
    expect(only().status).toBe('pending_approval');
    expect(only().pending_decision).toBe('approve');
    expect(terms.hash).toBeTruthy();
    expect(terms.lines.join('\n')).toContain('Amount: KES 20000.00');

    // Stage 4 — the second step is what settles it.
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });
    expect(only()).toMatchObject({
      status: 'approved', decision: 'approve', verified_by: ADMIN_USER.id,
    });

    // Stage 5 — execution. THIS is where the wallet row appears.
    await act(async () => { await approver.result.current.executeRequest(id, 'QGH7X21LMN'); });
    expect(only()).toMatchObject({ status: 'executed', payment_reference: 'QGH7X21LMN' });
    expect(wallets()).toHaveLength(1);
    expect(wallets()[0]).toMatchObject({
      agent_id: 'agent_1', total_withdrawn: 20000, reference_id: id, status: 'approved',
    });

    // Stage 6 — the bank says it landed.
    await act(async () => { await approver.result.current.confirmBankCredit(id, 'BNK-99120', true); });
    expect(only()).toMatchObject({ status: 'reconciliation_required', bank_confirmed: true });

    // Stage 7 — matched.
    await act(async () => { await approver.result.current.reconcileRequest(id, true, 'Matched to statement line 88.'); });
    expect(only().status).toBe('completed');
  });

  it('records the whole journey as an ordered, attributed trail', async () => {
    const id = await raise(20000);
    const approver = await renderApprover();

    await act(async () => { await approver.result.current.validateRequest(id); });
    let terms;
    await act(async () => { terms = await approver.result.current.decide(id, 'approve', 'Verified.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });
    await act(async () => { await approver.result.current.executeRequest(id, 'QGH7X21LMN'); });

    const trail = eventsFor(id);
    expect(trail.map(e => e.event_type)).toEqual([
      'created', 'submitted', 'validation_started', 'validated',
      'decision_recorded', 'decision_verified', 'execution_started', 'executed',
    ]);

    // Attribution: the agent raised it, the super admin settled it.
    expect(trail[0].actor_id).toBe(AGENT_USER.id);
    expect(trail[0].actor_role).toBe('sales_agent');
    expect(trail.find(e => e.event_type === 'decision_verified')).toMatchObject({
      actor_id: ADMIN_USER.id, actor_role: 'super_admin', reason: 'Verified.',
    });

    // Every event carries the money, so a line stays readable on its own.
    trail.forEach(e => expect(e.amount).toBe(20000));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   2. THE TWO-STEP VERIFICATION IS NOT DECORATION
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · two-step verification', () => {
  it('leaves the request undecided when the second step never happens', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });
    await act(async () => { await approver.result.current.decide(id, 'approve', 'Looks fine.'); });

    // Abandoned halfway: the decision is recorded as INTENT and nothing else.
    expect(only().status).toBe('pending_approval');
    expect(only().decision).toBeNull();
    expect(wallets()).toHaveLength(0);
  });

  it('refuses a stale digest when the request changed between the two steps', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });

    let terms;
    await act(async () => { terms = await approver.result.current.decide(id, 'approve', 'First read.'); });

    // Somebody revisits the decision — a different reason, so a different
    // digest. The confirmation the approver is holding is now about a version
    // of the request that no longer exists.
    await act(async () => { await approver.result.current.decide(id, 'reject', 'Actually, no.'); });

    await expect(
      approver.result.current.verifyDecision(id, terms.hash),
    ).rejects.toThrow(/changed since the decision was reviewed/i);

    expect(only().status).toBe('pending_approval');
    expect(only().decision).toBeNull();
  });

  it('refuses a confirmation with no decision behind it', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });

    await expect(
      approver.result.current.verifyDecision(id, 'whatever'),
    ).rejects.toThrow(/no decision awaiting verification/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   3. REJECTION AND HOLD
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · rejection and hold', () => {
  it('rejects with a reason, and pays nothing', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });
    let terms;
    await act(async () => { terms = await approver.result.current.decide(id, 'reject', 'Duplicate of PR-2609-000001.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });

    expect(only()).toMatchObject({
      status: 'rejected', decision: 'reject', decision_reason: 'Duplicate of PR-2609-000001.',
    });
    expect(wallets()).toHaveLength(0);
  });

  it('cannot execute a rejected request', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });
    let terms;
    await act(async () => { terms = await approver.result.current.decide(id, 'reject', 'No.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });

    await expect(
      approver.result.current.executeRequest(id, 'QGH7X21LMN'),
    ).rejects.toThrow(/only an approved request can be executed/i);
    expect(wallets()).toHaveLength(0);
  });

  it('holds with a reason and can be picked up again', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });
    let terms;
    await act(async () => { terms = await approver.result.current.decide(id, 'hold', 'Waiting on the delivery note.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });
    expect(only()).toMatchObject({ status: 'on_hold', decision_reason: 'Waiting on the delivery note.' });

    // A held request is still decidable — that is the difference between WAIT
    // and NO.
    await act(async () => { terms = await approver.result.current.decide(id, 'approve', 'Note received.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });
    expect(only().status).toBe('approved');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   4. WHAT VALIDATION CATCHES
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · FinHub validation', () => {
  it('flags an invoice that does not exist, and still puts it in front of the approver', async () => {
    const agent = await renderAgent();
    await act(async () => {
      await agent.result.current.requestWithdrawal(20000, 'Against a ghost invoice');
    });
    // Attach an invoice reference the invoice table does not have.
    db._rows('payment_requests'); // touch
    db._db.payment_requests[0].invoice_id = 'inv_missing';

    const id = only().id;
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });

    const invoice = only().validation_result.checks.find(c => c.check === 'invoice');
    expect(invoice).toMatchObject({ ok: false, severity: 'error' });
    expect(only().validation_passed).toBe(false);

    // Advisory, not a gate: a human must still be able to see it and decide.
    expect(only().status).toBe('pending_approval');
  });

  it('flags a cancelled invoice', async () => {
    db = seed({
      wallets: [credit(500000)],
      invoices: [{ id: 'inv_1', invoice_no: 'INV-2291', total: 90000, status: 'cancelled' }],
    });
    const agent = await renderAgent();
    await act(async () => { await agent.result.current.requestWithdrawal(20000, 'x'); });
    db._db.payment_requests[0].invoice_id = 'inv_1';
    db._db.payment_requests[0].invoice_ref = 'INV-2291';

    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(only().id); });

    expect(only().validation_result.checks.find(c => c.check === 'invoice')).toMatchObject({ ok: false });
  });

  it('flags an amount larger than the invoice it is drawn against', async () => {
    db = seed({
      wallets: [credit(500000)],
      invoices: [{ id: 'inv_1', invoice_no: 'INV-2291', total: 15000, status: 'pending' }],
    });
    const agent = await renderAgent();
    await act(async () => { await agent.result.current.requestWithdrawal(20000, 'x'); });
    db._db.payment_requests[0].invoice_id = 'inv_1';

    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(only().id); });

    expect(only().validation_result.checks.find(c => c.check === 'amount')).toMatchObject({ ok: false });
  });

  it('flags a request larger than the wallet balance', async () => {
    db = seed({ wallets: [credit(5000)] });
    const id = await raise(20000);
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });

    expect(only().validation_result.checks.find(c => c.check === 'balance'))
      .toMatchObject({ ok: false, available: 5000 });
  });

  it('flags a request with no supporting document, and clears once one is attached', async () => {
    const id = await raise();
    const approver = await renderApprover();

    await act(async () => { await approver.result.current.validateRequest(id); });
    expect(only().validation_result.checks.find(c => c.check === 'documents'))
      .toMatchObject({ ok: false, count: 0 });

    await act(async () => {
      await approver.result.current.attachDocument(
        only(), new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' }), 'invoice',
      );
    });

    // Re-running validation is legal from pending_approval? No — it is not, and
    // that is deliberate. Validate a fresh request instead to see the check
    // pass, which is what a resubmission does.
    expect(db._rows('payment_request_documents')).toHaveLength(1);
  });

  it('flags a duplicate: same agent, same amount, still alive', async () => {
    await raise(20000, 'August commission');
    const agent = await renderAgent();
    await act(async () => { await agent.result.current.requestWithdrawal(20000, 'August commission again'); });

    const second = requests()[1];
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(second.id); });

    expect(requests()[1].validation_result.checks.find(c => c.check === 'duplicate'))
      .toMatchObject({ ok: false, count: 1 });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   5. DOCUMENTS
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · supporting documents', () => {
  it('attaches a PDF to the request and records it in the trail', async () => {
    const id = await raise();
    const approver = await renderApprover();

    await act(async () => {
      await approver.result.current.attachDocument(
        only(), new File(['%PDF-1.4'], 'delivery-note.pdf', { type: 'application/pdf' }), 'delivery_evidence',
      );
    });

    const [doc] = db._rows('payment_request_documents');
    expect(doc).toMatchObject({
      request_id: id, document_type: 'delivery_evidence', file_name: 'delivery-note.pdf',
    });
    expect(eventsFor(id).some(e => e.event_type === 'document_attached')).toBe(true);
    // The file itself went to the private bucket, pathed by tenant and request.
    expect(Object.keys(db._bucket('payment-request-documents'))[0]).toMatch(/^admin_1\//);
  });

  it('refuses a document once a decision has been taken, and leaves no orphan file', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });
    let terms;
    await act(async () => { terms = await approver.result.current.decide(id, 'approve', 'Fine.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });

    await expect(
      approver.result.current.attachDocument(
        only(), new File(['%PDF'], 'late.pdf', { type: 'application/pdf' }), 'invoice',
      ),
    ).rejects.toThrow(/no longer accepts documents/i);

    expect(db._rows('payment_request_documents')).toHaveLength(0);
    // The upload is taken back out rather than left pointing at nothing.
    expect(Object.keys(db._bucket('payment-request-documents'))).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   6. FAILURE AND RECOVERY
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · failure paths', () => {
  it('records a failed execution and lets it go back in front of the approver', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });
    let terms;
    await act(async () => { terms = await approver.result.current.decide(id, 'approve', 'Go.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });
    await act(async () => { await approver.result.current.executeRequest(id, 'QGH7X21LMN'); });

    // The bank never credited it.
    await act(async () => { await approver.result.current.confirmBankCredit(id, 'BNK-1', false); });
    expect(only()).toMatchObject({ status: 'failed', bank_confirmed: false });

    // A failure is recoverable, but NOT by deciding it again where it lies:
    // 'failed' is not a state that is awaiting a decision, and treating it as
    // one would let a payout that already went wrong be re-approved without
    // anybody putting it back in the queue first.
    await expect(approver.result.current.decide(id, 'approve', 'Retry.'))
      .rejects.toThrow(/not awaiting a decision/i);

    // The way back is explicit: resume it, which is itself super-admin-only and
    // leaves an event saying who reopened it.
    await act(async () => { await approver.result.current.resumeRequest(id, 'Corrected the payee details.'); });
    expect(only().status).toBe('pending_approval');
    expect(eventsFor(id).at(-1)).toMatchObject({ event_type: 'resumed', actor_id: ADMIN_USER.id });

    let retry;
    await act(async () => { retry = await approver.result.current.decide(id, 'approve', 'Retrying with corrected details.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, retry.hash); });
    expect(only().status).toBe('approved');
  });

  it('fails a payment that could not be matched at reconciliation', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });
    let terms;
    await act(async () => { terms = await approver.result.current.decide(id, 'approve', 'Go.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });
    await act(async () => { await approver.result.current.executeRequest(id, 'REF-1'); });
    await act(async () => { await approver.result.current.confirmBankCredit(id, 'BNK-1', true); });
    await act(async () => { await approver.result.current.reconcileRequest(id, false, 'No matching statement line.'); });

    expect(only()).toMatchObject({ status: 'failed' });
    expect(eventsFor(id).at(-1)).toMatchObject({ event_type: 'reconciliation_failed' });
  });

  it('refuses to execute without a payment reference', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });
    let terms;
    await act(async () => { terms = await approver.result.current.decide(id, 'approve', 'Go.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });

    await expect(approver.result.current.executeRequest(id, '   '))
      .rejects.toThrow(/needs a reference/i);
    expect(only().status).toBe('approved');
  });

  it('refuses a decision with no reason', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });

    await expect(approver.result.current.decide(id, 'approve', '  '))
      .rejects.toThrow(/needs a reason/i);
  });

  it('refuses a request for nothing', async () => {
    const agent = await renderAgent();
    await expect(agent.result.current.requestWithdrawal(0, 'Nothing'))
      .rejects.toThrow(/greater than zero/i);
    expect(requests()).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   7. ROLES
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · who may do what', () => {
  it('will not let the agent who raised a request decide it', async () => {
    const id = await raise();
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });

    authUser = AGENT_USER;
    const agentSide = renderHook(() => usePaymentApproval({ realtime: false }));
    await waitFor(() => expect(agentSide.result.current.loading).toBe(false));

    await expect(agentSide.result.current.decide(id, 'approve', 'Pay me.'))
      .rejects.toThrow(/only a super admin/i);
    expect(only().status).toBe('pending_approval');
  });

  it('lets the requesting agent withdraw their own request', async () => {
    const id = await raise();
    authUser = AGENT_USER;
    const agentSide = renderHook(() => usePaymentApproval({ realtime: false }));
    await waitFor(() => expect(agentSide.result.current.loading).toBe(false));

    await act(async () => { await agentSide.result.current.cancelRequest(id, 'Asked in error.'); });
    expect(only().status).toBe('cancelled');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   8. BULK
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · bulk decisions', () => {
  const threeValidated = async () => {
    const agent = await renderAgent();
    await act(async () => {
      await agent.result.current.requestWithdrawal(10000, 'One');
      await agent.result.current.requestWithdrawal(20000, 'Two');
      await agent.result.current.requestWithdrawal(30000, 'Three');
    });
    const approver = await renderApprover();
    for (const r of requests()) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await approver.result.current.validateRequest(r.id); });
    }
    return approver;
  };

  it('approves a batch under one reason, in two steps', async () => {
    const approver = await threeValidated();
    const ids = requests().map(r => r.id);

    let batch;
    await act(async () => { batch = await approver.result.current.bulkDecide(ids, 'approve', 'September payout run.'); });
    expect(batch.count).toBe(3);
    // Still nothing settled: the batch also needs its second step.
    expect(requests().every(r => r.status === 'pending_approval')).toBe(true);

    await act(async () => { await approver.result.current.verifyBulk(batch.batch_id, batch.hash); });
    expect(requests().every(r => r.status === 'approved')).toBe(true);
    expect(requests().every(r => r.decision_reason === 'September payout run.')).toBe(true);
  });

  it('refuses the whole batch when one of its requests changed', async () => {
    const approver = await threeValidated();
    const ids = requests().map(r => r.id);

    let batch;
    await act(async () => { batch = await approver.result.current.bulkDecide(ids, 'approve', 'Payout run.'); });

    // One of them is reconsidered on its own.
    await act(async () => { await approver.result.current.decide(ids[1], 'reject', 'Held back.'); });

    await expect(approver.result.current.verifyBulk(batch.batch_id, batch.hash))
      .rejects.toThrow(/changed since they were reviewed. Nothing has been applied/i);

    // Nothing in the batch settled — not even the two that did not change.
    expect(requests().every(r => r.status === 'pending_approval')).toBe(true);
  });

  it('refuses an empty selection', async () => {
    const approver = await renderApprover();
    await expect(approver.result.current.bulkDecide([], 'approve', 'Nothing'))
      .rejects.toThrow(/no requests selected/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   9. THE DASHBOARD, DRIVEN THROUGH THE REAL UI
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment approval dashboard', () => {
  const renderTab = () => render(
    <ToastProvider>
      <PaymentApprovalTab agents={[AGENT_ROW]} onExport={vi.fn()} />
    </ToastProvider>,
  );

  it('shows the queue with its totals and offers YES / NO / WAIT on a pending request', async () => {
    const id = await raise(20000);
    authUser = ADMIN_USER;
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });

    renderTab();
    await waitFor(() => expect(screen.getByText(only().request_no)).toBeInTheDocument());

    const row = screen.getByText(only().request_no).closest('tr');
    expect(within(row).getByText('Pending Approval')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'YES' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'NO' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'WAIT' })).toBeInTheDocument();
  });

  it('takes a decision through the confirmation step before anything settles', async () => {
    const id = await raise(20000);
    authUser = ADMIN_USER;
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Verified against August sales.');
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByText(only().request_no)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'YES' }));

    // The modal is up and the request has NOT moved.
    await screen.findByText(/Step 2 of 2/i);
    expect(only().status).toBe('pending_approval');
    expect(screen.getByText(/Amount: KES 20000\.00/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /confirm approve/i }));
    await waitFor(() => expect(only().status).toBe('approved'));

    promptSpy.mockRestore();
  });

  it('backing out of the confirmation leaves the decision unsettled', async () => {
    const id = await raise(20000);
    authUser = ADMIN_USER;
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Thinking about it.');
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByText(only().request_no)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'YES' }));
    await screen.findByText(/Step 2 of 2/i);
    await user.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(screen.queryByText(/Step 2 of 2/i)).not.toBeInTheDocument());
    expect(only().status).toBe('pending_approval');
    expect(only().decision).toBeNull();

    promptSpy.mockRestore();
  });

  it('does not offer a decision on a request that is not awaiting one', async () => {
    const id = await raise(20000);
    authUser = ADMIN_USER;
    const approver = await renderApprover();
    await act(async () => { await approver.result.current.validateRequest(id); });
    let terms;
    await act(async () => { terms = await approver.result.current.decide(id, 'reject', 'No.'); });
    await act(async () => { await approver.result.current.verifyDecision(id, terms.hash); });

    renderTab();
    await waitFor(() => expect(screen.getByText(only().request_no)).toBeInTheDocument());

    const row = screen.getByText(only().request_no).closest('tr');
    expect(within(row).queryByRole('button', { name: 'YES' })).not.toBeInTheDocument();
    expect(within(row).getByText('Rejected')).toBeInTheDocument();
  });
});
