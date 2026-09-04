/**
 * End-to-end test of the payment approval workflow that this app actually has.
 *
 * SCOPE — read this before adding cases.
 *
 * The workflow as specified is: Agent Portal → FinHub Validation → Super Admin
 * Approval → Two-Step Verification → FinHub Execution → Payment Confirmation →
 * Reconciliation → Receipt. What is implemented is the two ends of that:
 *
 *   Agent Portal (useSalesAgentPortal.requestWithdrawal)
 *        ↓  a row in agent_wallets, tx_type='withdrawal'
 *   Super Admin Approval (useSuperAdminDashboard.approve/rejectWithdrawalRequest)
 *        ↓  status flips, audit_logs row written
 *   [nothing further]
 *
 * There is no validation stage, no second checker on this path, no execution
 * step, no reconciliation and no receipt. The maker_checker_queue exists and is
 * covered separately in makerCheckerWorkflow.test.jsx, but nothing on the
 * withdrawal path ever writes to it — approval here is single-signature.
 *
 * These tests therefore cover the real path end to end and pin the defects
 * found along the way. Cases under "known defects" assert the CURRENT wrong
 * behaviour on purpose, each with a BUG note saying what it should be, so that
 * fixing one turns this suite red at the exact line describing the fix.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase, resetFakeIds } from '../../test-utils/fakeSupabase';

const AGENT_USER  = { id: 'user_agent_1',  email: 'agent@ararat.co.ke' };
const ADMIN_USER  = { id: 'user_admin_1',  email: 'super@ararat.co.ke' };

/* The module is imported by three different specifiers across the tree
   ('../lib/supabase', '/src/lib/supabase.js'); all resolve to this one file. */
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
  useAuth: () => ({ user: authUser, userProfile: { id: authUser.id, full_name: 'Test User', role: 'super_admin' } }),
  AuthProvider: ({ children }) => children,
}));

vi.mock('../../services/emailService', () => ({
  sendAssistRequest: vi.fn(async () => ({ ok: true })),
  sendAssistUpdate:  vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../services/credentialsEmailService', () => ({
  emailLoginCredentials: vi.fn(async () => ({ ok: true })),
}));

const { useSalesAgentPortal }    = await import('../../hooks/useSalesAgentPortal');
const { useSuperAdminDashboard } = await import('../../hooks/useSuperAdminDashboard');

const AGENT_ROW = {
  id: 'agent_1', user_id: AGENT_USER.id, full_name: 'Grace Mwangi',
  agent_code: 'GM-40182', email: AGENT_USER.email, agent_plan: 'bronze',
  total_sales: 0, total_commission: 0,
};

/** A commission credit, i.e. money the agent is owed. */
const credit = (amount, o = {}) => ({
  id: o.id || `wallet_credit_${amount}`, agent_id: 'agent_1', tx_type: 'credit',
  total_earned: amount, total_withdrawn: 0, available_balance: amount,
  description: 'Commission', created_at: '2026-09-01T08:00:00.000Z', ...o,
});

const seed = ({ wallets = [], extraFailures = {} } = {}) => createFakeSupabase({
  // Live, not a snapshot: the workflow hands off from the agent to the approver
  // mid-test, and each audit row must be attributed to whoever is acting.
  user: () => authUser,
  failures: extraFailures,
  tables: {
    agents: [AGENT_ROW],
    user_profiles: [
      { id: ADMIN_USER.id, full_name: 'Peter Otieno', role: 'super_admin', email: ADMIN_USER.email, admin_id: null, is_active: true },
      { id: AGENT_USER.id, full_name: 'Grace Mwangi', role: 'sales_agent',  email: AGENT_USER.email, admin_id: ADMIN_USER.id, is_active: true },
    ],
    agent_wallets: wallets,
    audit_logs: [], clients: [], assets: [], payments: [], leads: [],
    sales_expenses: [], agent_assists: [], contracts: [], sales_targets: [],
  },
});

/** Withdrawal rows only, newest first — the shape the super admin tab reads. */
const withdrawals = () => db._rows('agent_wallets').filter((r) => r.tx_type === 'withdrawal');
const auditFor = (recordId) => db._rows('audit_logs').filter((l) => l.record_id === recordId);

const renderAgent = async () => {
  authUser = AGENT_USER;
  const h = renderHook(() => useSalesAgentPortal());
  await waitFor(() => expect(h.result.current.agentProfile?.id).toBe('agent_1'));
  return h;
};

const renderSuperAdmin = async (expectRequests = null) => {
  authUser = ADMIN_USER;
  const h = renderHook(() => useSuperAdminDashboard());
  if (expectRequests !== null) {
    await waitFor(() => expect(h.result.current.withdrawalRequests).toHaveLength(expectRequests));
  } else {
    await waitFor(() => expect(h.result.current.loading).toBe(false));
  }
  return h;
};

beforeEach(() => {
  resetFakeIds();
  authUser = ADMIN_USER;
  db = seed();
  vi.clearAllMocks();
});

/* ────────────────────────────────────────────────────────────────────────────
   1. HAPPY PATH — request → visible to super admin → approved → audited
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · successful approval', () => {
  it('carries a request from the agent portal through to an approved, audited record', async () => {
    db = seed({ wallets: [credit(50000)] });

    // ── Stage 1: agent raises the request ──────────────────────────────────
    const agent = await renderAgent();
    let created;
    await act(async () => { created = await agent.result.current.requestWithdrawal(20000, 'August commission'); });

    const [request] = withdrawals();
    expect(request).toMatchObject({
      agent_id: 'agent_1',
      tx_type: 'withdrawal',
      total_withdrawn: 20000,
      description: 'August commission',
    });
    expect(request.status).toBeUndefined();     // never set on insert; read as 'pending'

    // the request itself is audited, by the agent, before any approval exists
    const raised = auditFor(created.id);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ action: 'create', table_name: 'agent_wallets', user_id: AGENT_USER.id });
    expect(raised[0].description).toContain('KES 20000');
    expect(raised[0].description).toContain('GM-40182');

    // ── Stage 2: it reaches the super admin queue as pending ───────────────
    const admin = await renderSuperAdmin(1);
    const queued = admin.result.current.withdrawalRequests[0];
    expect(queued.status).toBe('pending');             // null coalesced by the hook
    expect(queued.agent).toMatchObject({ agent_code: 'GM-40182', full_name: 'Grace Mwangi' });

    // ── Stage 3: approval ──────────────────────────────────────────────────
    await act(async () => { await admin.result.current.approveWithdrawalRequest(request.id); });

    const settled = db._row('agent_wallets', request.id);
    expect(settled.status).toBe('approved');
    expect(settled.reviewed_by).toBe('super_admin');
    expect(settled.reviewed_at).toEqual(expect.any(String));

    // ── Stage 4: the approval is audited separately from the request ───────
    const trail = auditFor(request.id);
    expect(trail.map((l) => l.action)).toEqual(['create', 'approve']);
    const approval = trail[1];
    expect(approval).toMatchObject({ table_name: 'agent_wallets', user_id: ADMIN_USER.id });
    expect(approval.new_values).toMatchObject({ status: 'approved', amount: 20000, agent_id: 'agent_1' });

    // ── Stage 5: the refetch feeds the new status back to the UI ───────────
    await waitFor(() => expect(admin.result.current.withdrawalRequests[0].status).toBe('approved'));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   2. REJECTION
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · rejection', () => {
  it('marks the request rejected and records a reject action against it', async () => {
    db = seed({ wallets: [credit(50000), {
      id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_earned: 0,
      total_withdrawn: 15000, available_balance: -15000, description: 'Rent advance',
      created_at: '2026-09-02T09:00:00.000Z',
    }] });

    const admin = await renderSuperAdmin(1);
    await act(async () => { await admin.result.current.rejectWithdrawalRequest('wd_1'); });

    expect(db._row('agent_wallets', 'wd_1')).toMatchObject({ status: 'rejected', reviewed_by: 'super_admin' });

    const [entry] = auditFor('wd_1');
    expect(entry).toMatchObject({ action: 'reject', table_name: 'agent_wallets' });
    expect(entry.new_values).toMatchObject({ status: 'rejected', amount: 15000 });
    expect(entry.description).toContain('rejected withdrawal request of KES 15000');

    await waitFor(() => expect(admin.result.current.withdrawalRequests[0].status).toBe('rejected'));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   3. FAILURE OF THE APPROVAL WRITE ITSELF
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · failed approval write', () => {
  it('leaves the request untouched and writes NO audit entry when the update fails', async () => {
    // This is the CURRENT PRODUCTION FAILURE, not a hypothetical one.
    //
    // approve/reject write `status`, `reviewed_at` and `reviewed_by`. None of
    // the three exist on agent_wallets — confirmed against the live database on
    // 2026-09-04, which holds exactly the nine columns the original migration
    // created. The error below is the verbatim response from that database.
    //
    // So every approval and rejection in production throws here. Worse, the tab
    // wires the button up as `onClick={() => onApprove?.(req.id)}` — the promise
    // is neither awaited nor caught, so the rejection is unhandled and the
    // super admin sees nothing at all: no toast, no error, no change.
    db = seed({
      wallets: [{
        id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_earned: 0,
        total_withdrawn: 15000, available_balance: -15000, created_at: '2026-09-02T09:00:00.000Z',
      }],
      extraFailures: {
        'agent_wallets.update': {
          code: '42703',
          message: 'column agent_wallets.status does not exist',
        },
      },
    });

    const admin = await renderSuperAdmin(1);

    await expect(
      act(async () => { await admin.result.current.approveWithdrawalRequest('wd_1'); }),
    ).rejects.toMatchObject({ code: '42703' });

    // No half-applied state: the row is unchanged and nothing was logged.
    expect(db._row('agent_wallets', 'wd_1').status).toBeUndefined();
    expect(auditFor('wd_1')).toHaveLength(0);
    expect(admin.result.current.withdrawalRequests[0].status).toBe('pending');
  });

  it('surfaces the failure to the caller rather than reporting success', async () => {
    db = seed({ wallets: [{ id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 500 }] });
    const admin = await renderSuperAdmin(1);
    db._fail('agent_wallets.update', { code: '42501', message: 'permission denied for table agent_wallets' });

    await expect(
      act(async () => { await admin.result.current.rejectWithdrawalRequest('wd_1'); }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('treats an update that changed no row as a failure, not a success', async () => {
    // The sharp one. PostgREST answers an UPDATE with 204 No Content and a NULL
    // error even when RLS matched nothing, so a policy silently refusing the
    // write is indistinguishable from a successful one unless the statement
    // asks for the affected ids back. Until 20260904120000 agent_wallets had no
    // UPDATE policy at all, so every approval took exactly this path — and
    // without the .select() the hook would have reported the money released.
    db = seed({ wallets: [{ id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 500 }] });
    const admin = await renderSuperAdmin(1);

    // No error and no matching row — precisely what an RLS denial looks like on
    // the wire. The row is still there; it is just invisible to the statement.
    db._db.agent_wallets = db._db.agent_wallets.map(
      (r) => (r.id === 'wd_1' ? { ...r, id: 'wd_hidden_by_rls' } : r),
    );

    // Caught INSIDE act rather than with `expect(act(…)).rejects`: letting act
    // itself reject leaves React's act queue unflushed, and the next renderHook
    // in the file comes back with a null result.
    let err;
    await act(async () => {
      err = await admin.result.current.approveWithdrawalRequest('wd_1').catch((e) => e);
    });

    expect(err.message).toMatch(/changed no row/i);
    expect(err.message).toMatch(/row-level security/i);
    // It must not leave the reader guessing whether the money moved.
    expect(err.message).toMatch(/Nothing has been paid out/i);
    expect(db._rows('audit_logs')).toHaveLength(0);
  });

  it('refuses a request that is no longer in the queue instead of doing nothing', async () => {
    // This was a bare `return`: clicking Approve on a row another tab had just
    // settled did nothing and said nothing.
    db = seed({ wallets: [{ id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 500 }] });
    const admin = await renderSuperAdmin(1);

    let err;
    await act(async () => {
      err = await admin.result.current.approveWithdrawalRequest('gone').catch((e) => e);
    });

    expect(err.message).toMatch(/no longer in the queue/i);
    expect(db._rows('audit_logs')).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   4. DUPLICATE REQUESTS
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · duplicate requests', () => {
  it('accepts an identical second request — nothing de-duplicates', async () => {
    // BUG: there is no duplicate guard anywhere on this path — not in the hook,
    // not in a DB constraint. An agent who double-submits gets two payable rows
    // and each can be approved independently.
    db = seed({ wallets: [credit(50000)] });
    const agent = await renderAgent();

    await act(async () => { await agent.result.current.requestWithdrawal(20000, 'August commission'); });
    await act(async () => { await agent.result.current.requestWithdrawal(20000, 'August commission'); });

    const rows = withdrawals();
    expect(rows).toHaveLength(2);
    expect(rows[0].total_withdrawn).toBe(rows[1].total_withdrawn);
    expect(rows[0].id).not.toBe(rows[1].id);

    // Both are independently approvable — KES 40 000 out against KES 50 000 earned.
    const admin = await renderSuperAdmin(2);
    await act(async () => {
      await admin.result.current.approveWithdrawalRequest(rows[0].id);
      await admin.result.current.approveWithdrawalRequest(rows[1].id);
    });
    expect(withdrawals().every((r) => r.status === 'approved')).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   5. KNOWN DEFECTS — these pin wrong behaviour on purpose
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · known defects', () => {
  it('BUG: a rejected withdrawal still debits the agent wallet balance', async () => {
    // walletBalance = credits − EVERY withdrawal row, with no status filter
    // (useSalesAgentPortal.js). A request that is refused therefore takes the
    // money out of the agent's visible balance permanently.
    db = seed({ wallets: [credit(50000)] });
    const agent = await renderAgent();
    await waitFor(() => expect(agent.result.current.kpis.walletBalance).toBe(50000));

    let created;
    await act(async () => { created = await agent.result.current.requestWithdrawal(20000, 'August commission'); });
    await act(async () => { await agent.result.current.refetch(); });
    await waitFor(() => expect(agent.result.current.kpis.walletBalance).toBe(30000));

    const admin = await renderSuperAdmin(1);
    await act(async () => { await admin.result.current.rejectWithdrawalRequest(created.id); });

    // Back to the agent's own session before re-reading their wallet: the two
    // hooks share one auth mock, so leaving it on the approver would have the
    // agent hook refetch a profile that is not theirs.
    authUser = AGENT_USER;
    await act(async () => { await agent.result.current.refetch(); });
    await waitFor(() => expect(agent.result.current.agentProfile?.id).toBe('agent_1'));

    // Should be back to 50000 once refused. It is not.
    expect(agent.result.current.kpis.walletBalance).toBe(30000);
  });

  it('BUG: an already-rejected request can still be approved', async () => {
    // Neither hook checks the current status before writing the new one, so
    // there is no terminal state — a decision can be flipped indefinitely, and
    // each flip only appends to the audit trail rather than being refused.
    db = seed({ wallets: [{ id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 15000, status: 'rejected' }] });
    const admin = await renderSuperAdmin(1);

    await act(async () => { await admin.result.current.approveWithdrawalRequest('wd_1'); });

    expect(db._row('agent_wallets', 'wd_1').status).toBe('approved');
    expect(auditFor('wd_1').map((l) => l.action)).toEqual(['approve']);
  });

  it('BUG: settled requests are never filtered out of the queue', async () => {
    // fetchWithdrawalRequests selects on tx_type alone. The tab's badge is
    // `withdrawalRequests.length`, so a year of settled withdrawals shows up as
    // a permanent unread count on the super admin nav.
    db = seed({ wallets: [
      { id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 100, status: 'approved' },
      { id: 'wd_2', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 200, status: 'rejected' },
      { id: 'wd_3', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 300 },
    ] });

    const admin = await renderSuperAdmin(3);
    const queue = admin.result.current.withdrawalRequests;
    expect(queue).toHaveLength(3);
    expect(queue.filter((r) => r.status === 'pending')).toHaveLength(1);
  });

  it('BUG: the hook accepts an over-balance request that the form would block', async () => {
    // The only balance check lives in CommissionDashboard's submit handler.
    // requestWithdrawal itself validates nothing, and there is no DB constraint,
    // so anything reaching the hook by another route is written unchallenged.
    db = seed({ wallets: [credit(1000)] });
    const agent = await renderAgent();

    let created;
    await act(async () => { created = await agent.result.current.requestWithdrawal(9_000_000, 'Oops'); });
    await act(async () => { await agent.result.current.refetch(); });

    expect(db._row('agent_wallets', created.id).total_withdrawn).toBe(9_000_000);
    await waitFor(() => expect(agent.result.current.kpis.walletBalance).toBe(-8_999_000));
  });

  it('BUG: the approver is recorded as a literal, not as the person', async () => {
    // reviewed_by is the hardcoded string 'super_admin' for every approval, so
    // the row cannot say WHICH super admin released the money. The audit_logs
    // entry does carry user_id, which is the only place that survives.
    db = seed({ wallets: [{ id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 15000 }] });
    const admin = await renderSuperAdmin(1);

    await act(async () => { await admin.result.current.approveWithdrawalRequest('wd_1'); });

    expect(db._row('agent_wallets', 'wd_1').reviewed_by).toBe('super_admin');
    expect(auditFor('wd_1')[0].user_id).toBe(ADMIN_USER.id);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   6. STAGES THAT DO NOT EXIST
   These assert absence. If someone implements a stage, the matching test fails
   and should be replaced with a real one.
   ──────────────────────────────────────────────────────────────────────────── */
describe('payment workflow · unimplemented stages', () => {
  it('has no second checker: approval writes nothing to maker_checker_queue', async () => {
    db = seed({ wallets: [{ id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 250000 }] });
    const admin = await renderSuperAdmin(1);

    await act(async () => { await admin.result.current.approveWithdrawalRequest('wd_1'); });

    // Even a quarter-million-shilling release is single-signature.
    expect(db._rows('maker_checker_queue')).toHaveLength(0);
    expect(db._writes.some((w) => w.table === 'maker_checker_queue')).toBe(false);
  });

  it('has no execution or reconciliation: approval touches only the wallet row and the audit log', async () => {
    db = seed({ wallets: [{ id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 15000 }] });
    const admin = await renderSuperAdmin(1);
    const before = db._writes.length;

    await act(async () => { await admin.result.current.approveWithdrawalRequest('wd_1'); });

    const touched = [...new Set(db._writes.slice(before).map((w) => w.table))];
    expect(touched.sort()).toEqual(['agent_wallets', 'audit_logs']);
    // No payment is initiated, no transaction is recorded, no receipt is issued.
    expect(db._rows('payments')).toHaveLength(0);
    expect(db._rows('transactions') ?? []).toHaveLength(0);
  });

  it('has no bulk approval: requests can only be settled one id at a time', async () => {
    db = seed({ wallets: [
      { id: 'wd_1', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 100 },
      { id: 'wd_2', agent_id: 'agent_1', tx_type: 'withdrawal', total_withdrawn: 200 },
    ] });
    const admin = await renderSuperAdmin(2);

    expect(admin.result.current.approveWithdrawalRequest).toHaveLength(1); // (requestId) => …
    expect(Object.keys(admin.result.current)).not.toContain('bulkApproveWithdrawals');

    await act(async () => { await admin.result.current.approveWithdrawalRequest('wd_1'); });
    expect(db._row('agent_wallets', 'wd_2').status).toBeUndefined();
  });
});
