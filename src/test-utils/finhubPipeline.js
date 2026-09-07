/**
 * An in-memory model of the FinHub payment pipeline's server side.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT.
 *
 * `payment_requests` has a SELECT policy and nothing else: every write in
 * production goes through a SECURITY DEFINER function in migration
 * 20260908120000. A test that drove the workflow with `.insert()` and
 * `.update()` would therefore exercise a path the live database refuses, and
 * would keep passing after somebody broke the real one. So the workflow tests
 * call the same RPC names the hooks call, and this file answers them.
 *
 * That makes these tests an honest end-to-end check of EVERYTHING ON THIS SIDE
 * of the RPC boundary: that the hooks call the right function in the right
 * order, that the two-step decision genuinely needs its second call, that a
 * stale digest is refused, that a bulk batch settles or refuses whole, that the
 * screens surface what comes back. It does NOT prove the SQL. Only Postgres can
 * do that, and no Postgres runs in this suite.
 *
 * WHICH MEANS THIS FILE IS A MIRROR AND THE MIGRATION IS THE ORIGINAL. When the
 * two disagree, the SQL is right. finhubPipeline.sync.test.js reads the
 * migration and fails if the status list or the transition table here has
 * drifted from it — the same treatment planCatalogs and etimsCodes already get.
 */

export const PIPELINE_STATUSES = [
  'draft',
  'submitted',
  'under_validation',
  'pending_approval',
  'approved',
  'rejected',
  'on_hold',
  'processing',
  'executed',
  'failed',
  'cancelled',
  'reconciliation_required',
  'completed',
];

/** Transcribed from payment_request_transition_ok(). */
export const PIPELINE_TRANSITIONS = [
  ['draft', 'submitted'],
  ['draft', 'cancelled'],
  ['submitted', 'under_validation'],
  ['submitted', 'cancelled'],
  ['under_validation', 'pending_approval'],
  ['under_validation', 'cancelled'],
  ['pending_approval', 'approved'],
  ['pending_approval', 'rejected'],
  ['pending_approval', 'on_hold'],
  ['pending_approval', 'cancelled'],
  ['on_hold', 'pending_approval'],
  ['on_hold', 'approved'],
  ['on_hold', 'rejected'],
  ['on_hold', 'cancelled'],
  ['approved', 'processing'],
  ['approved', 'cancelled'],
  ['processing', 'executed'],
  ['processing', 'failed'],
  ['executed', 'reconciliation_required'],
  ['executed', 'failed'],
  ['reconciliation_required', 'completed'],
  ['reconciliation_required', 'failed'],
  ['failed', 'pending_approval'],
  ['failed', 'cancelled'],
];

const canMove = (from, to) =>
  from === to || PIPELINE_TRANSITIONS.some(([f, t]) => f === from && t === to);

/**
 * A cheap stand-in for encode(digest(text,'sha256'),'hex').
 *
 * It only has to be a FUNCTION OF THE SAME INPUTS: the tests care that the
 * digest changes when the request changes and that a stale one is refused, not
 * that it is SHA-256. Using a real hash here would test the crypto, not the
 * flow.
 */
const digest = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return `d${(h >>> 0).toString(16).padStart(8, '0')}`;
};

const money = (n) => Number(n || 0).toFixed(2);

/** Transcribed from payment_request_decision_terms(). */
export const decisionTerms = (row) => {
  const lines = [
    `Request ${row.request_no}`,
    `Type: ${row.request_type}`,
    `Amount: ${row.currency} ${money(row.amount)}`,
    `Payee: ${row.payee_name || '(not stated)'}`,
    `Invoice: ${row.invoice_ref || '(none)'}`,
    `FinHub validation: ${
      row.validation_passed === null || row.validation_passed === undefined
        ? 'not run'
        : row.validation_passed ? 'passed' : 'raised exceptions'}`,
    `Decision: ${row.pending_decision || '(none)'}`,
    `Reason: ${row.pending_reason || '(none)'}`,
  ];
  return {
    request_id: row.id,
    request_no: row.request_no,
    amount: row.amount,
    currency: row.currency,
    lines,
    hash: digest(lines.join('\n')),
  };
};

/**
 * Build the rpcs map for createFakeSupabase.
 *
 * @param {object} opts
 * @param {Function} opts.roleOf  (userId) => 'super_admin' | 'admin' | 'sales_agent'
 * @param {Function} opts.agentOf (userId) => agent id or null
 */
export const finhubRpcs = ({ roleOf, agentOf } = {}) => {
  const role = (u) => (roleOf ? roleOf(u?.id) : 'super_admin');
  const isSuper = (u) => role(u) === 'super_admin';
  const isAdmin = (u) => ['super_admin', 'admin', 'sacco_admin'].includes(role(u));
  const isStaff = (u) => ['super_admin', 'admin', 'sacco_admin', 'sales_agent', 'manager'].includes(role(u));

  let reqSeq = 0;

  const find = (ctx, id) => {
    const row = ctx.rowsOf('payment_requests').find(r => r.id === id);
    if (!row) throw new Error('Payment request not found.');
    return row;
  };

  const event = (ctx, row, type, from, to, reason, detail = {}) => {
    ctx.rowsOf('payment_request_events').push({
      id: ctx.nextId('payment_request_events'),
      request_id: row.id,
      admin_id: row.admin_id,
      seq: ctx.rowsOf('payment_request_events').length + 1,
      event_type: type,
      from_status: from,
      to_status: to,
      actor_id: ctx.user?.id || null,
      actor_name: ctx.user?.full_name || ctx.user?.email || null,
      actor_role: role(ctx.user),
      reason: reason || null,
      detail,
      amount: row.amount,
      occurred_at: new Date().toISOString(),
    });
  };

  const move = (ctx, row, to, type, reason, detail) => {
    if (!canMove(row.status, to)) {
      throw new Error(`A ${row.status} request cannot move to ${to}.`);
    }
    const from = row.status;
    row.status = to;
    row.updated_at = new Date().toISOString();
    event(ctx, row, type, from, to, reason, detail);
    return { ...row };
  };

  return {
    finhub_submit_payment_request: (args, ctx) => {
      if (!isStaff(ctx.user)) throw new Error('Only staff may raise a payment request.');
      if (!(Number(args.p_amount) > 0)) {
        throw new Error('A payment request needs an amount greater than zero.');
      }
      reqSeq += 1;
      const row = {
        id: ctx.nextId('payment_requests'),
        request_no: `PR-2609-${String(reqSeq).padStart(6, '0')}`,
        admin_id: 'admin_1',
        request_type: args.p_request_type || 'agent_commission',
        status: 'draft',
        agent_id: agentOf ? agentOf(ctx.user?.id) : null,
        manager_id: null,
        client_id: args.p_client_id || null,
        invoice_id: args.p_invoice_id || null,
        invoice_ref: args.p_invoice_id
          ? (ctx.rowsOf('company_invoices').find(i => i.id === args.p_invoice_id)?.invoice_no || null)
          : null,
        amount: Number(args.p_amount),
        currency: 'KES',
        payment_method: args.p_payment_method || null,
        payee_name: args.p_payee_name || null,
        payee_account: args.p_payee_account || null,
        payee_phone: args.p_payee_phone || null,
        narrative: args.p_narrative || null,
        submitted_by: ctx.user?.id || null,
        submitted_at: args.p_submit_now === false ? null : new Date().toISOString(),
        validation_passed: null,
        validation_result: {},
        pending_decision: null,
        pending_reason: null,
        pending_terms_hash: null,
        bulk_batch_id: null,
        decision: null,
        decision_reason: null,
        decided_by: null,
        decided_at: null,
        verified_by: null,
        verified_at: null,
        executed_at: null,
        payment_reference: null,
        failure_reason: null,
        wallet_entry_id: null,
        bank_confirmed: null,
        bank_reference: null,
        reconciled_at: null,
        reconciliation_note: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      ctx.rowsOf('payment_requests').push(row);
      event(ctx, row, 'created', null, 'draft', null, { request_no: row.request_no });
      if (args.p_submit_now !== false) move(ctx, row, 'submitted', 'submitted');
      return { ...row };
    },

    finhub_validate_payment_request: (args, ctx) => {
      if (!isAdmin(ctx.user)) throw new Error('Only FinHub staff may validate a payment request.');
      const row = find(ctx, args.p_id);
      if (!['submitted', 'under_validation'].includes(row.status)) {
        throw new Error(`Only a submitted request can be validated; this one is ${row.status}.`);
      }
      if (row.status === 'submitted') move(ctx, row, 'under_validation', 'validation_started');

      const checks = [];
      let passed = true;

      // client
      if (!row.client_id) {
        checks.push({ check: 'client', ok: true, severity: 'info', note: 'No client attached — not required for this request type.' });
      } else if (ctx.rowsOf('clients').some(c => c.id === row.client_id)) {
        checks.push({ check: 'client', ok: true, note: 'Client on file.' });
      } else {
        passed = false;
        checks.push({ check: 'client', ok: false, severity: 'error', note: 'The client on this request no longer exists.' });
      }

      // invoice
      const inv = row.invoice_id
        ? ctx.rowsOf('company_invoices').find(i => i.id === row.invoice_id)
        : null;
      if (!row.invoice_id) {
        checks.push({ check: 'invoice', ok: true, severity: 'info', note: 'No invoice reference supplied.' });
      } else if (!inv) {
        passed = false;
        checks.push({ check: 'invoice', ok: false, severity: 'error', note: 'The referenced invoice does not exist.' });
      } else if (inv.status === 'cancelled') {
        passed = false;
        checks.push({ check: 'invoice', ok: false, severity: 'error', note: 'The referenced invoice is cancelled.' });
      } else {
        checks.push({ check: 'invoice', ok: true, note: `Invoice ${row.invoice_ref}, ${inv.status}, total ${inv.total}.` });
      }

      // amount vs invoice
      if (inv && row.amount > Number(inv.total)) {
        passed = false;
        checks.push({ check: 'amount', ok: false, severity: 'error', note: `Requested ${row.amount} exceeds the invoice total of ${inv.total}.` });
      } else {
        checks.push({ check: 'amount', ok: true, note: 'Amount is within range.' });
      }

      // wallet balance — rejected withdrawals do not count against it
      if (row.agent_id) {
        const balance = ctx.rowsOf('agent_wallets')
          .filter(w => w.agent_id === row.agent_id)
          .reduce((sum, w) => {
            if (w.tx_type === 'credit') return sum + Number(w.total_earned || 0);
            if (w.tx_type === 'withdrawal' && (w.status || 'pending') !== 'rejected') {
              return sum - Number(w.total_withdrawn || 0);
            }
            return sum;
          }, 0);
        if (row.amount > balance) {
          passed = false;
          checks.push({ check: 'balance', ok: false, severity: 'error', available: balance, note: `Requested ${row.amount} against an available balance of ${balance}.` });
        } else {
          checks.push({ check: 'balance', ok: true, available: balance, note: `Available balance ${balance}.` });
        }
      }

      // documents
      const docs = ctx.rowsOf('payment_request_documents').filter(d => d.request_id === row.id);
      if (docs.length === 0) {
        passed = false;
        checks.push({ check: 'documents', ok: false, severity: 'warning', count: 0, note: 'No supporting document attached.' });
      } else {
        checks.push({ check: 'documents', ok: true, count: docs.length, note: `${docs.length} supporting document(s) attached.` });
      }

      // duplicates
      const live = ['draft', 'submitted', 'under_validation', 'pending_approval', 'on_hold',
        'approved', 'processing', 'executed', 'reconciliation_required', 'completed'];
      const dupes = ctx.rowsOf('payment_requests').filter(r =>
        r.id !== row.id &&
        r.agent_id === row.agent_id &&
        Number(r.amount) === Number(row.amount) &&
        live.includes(r.status) &&
        (!row.invoice_id || r.invoice_id === row.invoice_id)).length;
      if (dupes > 0) {
        passed = false;
        checks.push({ check: 'duplicate', ok: false, severity: 'warning', count: dupes, note: `${dupes} similar request(s) in the last 7 days.` });
      } else {
        checks.push({ check: 'duplicate', ok: true, count: 0, note: 'No similar recent request.' });
      }

      row.validation_passed = passed;
      row.validation_result = { passed, checked_at: new Date().toISOString(), checks };
      row.validated_by = ctx.user?.id || null;
      row.validated_at = new Date().toISOString();

      return move(ctx, row, 'pending_approval', 'validated',
        passed ? 'All checks passed.' : 'Validation raised exceptions.', { passed, checks });
    },

    payment_request_decision_terms: (args, ctx) => decisionTerms(find(ctx, args.p_id)),

    finhub_decide_payment_request: (args, ctx) => {
      if (!isSuper(ctx.user)) throw new Error('Only a super admin may decide a payment request.');
      if (!String(args.p_reason || '').trim()) throw new Error('Every decision needs a reason.');
      const row = find(ctx, args.p_id);
      if (!['pending_approval', 'on_hold'].includes(row.status)) {
        throw new Error(`A ${row.status} request is not awaiting a decision.`);
      }
      row.pending_decision = args.p_decision;
      row.pending_reason = String(args.p_reason).trim();
      row.pending_decided_by = ctx.user?.id || null;
      row.pending_decided_at = new Date().toISOString();
      row.bulk_batch_id = null;

      const terms = decisionTerms(row);
      row.pending_terms_hash = terms.hash;
      event(ctx, row, 'decision_recorded', row.status, row.status, row.pending_reason,
        { decision: args.p_decision, awaiting_verification: true });
      return terms;
    },

    finhub_verify_payment_decision: (args, ctx) => {
      if (!isSuper(ctx.user)) throw new Error('Only a super admin may verify a payment decision.');
      const row = find(ctx, args.p_id);
      if (!row.pending_decision) {
        throw new Error('There is no decision awaiting verification on this request.');
      }
      if (args.p_hash !== decisionTerms(row).hash) {
        throw new Error('This request has changed since the decision was reviewed. Read it again before confirming.');
      }
      const to = { approve: 'approved', reject: 'rejected', hold: 'on_hold' }[row.pending_decision];
      const reason = row.pending_reason;
      row.decision = row.pending_decision;
      row.decision_reason = reason;
      row.decided_by = row.pending_decided_by;
      row.decided_at = row.pending_decided_at;
      row.verified_by = ctx.user?.id || null;
      row.verified_at = new Date().toISOString();
      const decision = row.pending_decision;
      row.pending_decision = null;
      row.pending_reason = null;
      row.pending_terms_hash = null;
      return move(ctx, row, to, 'decision_verified', reason,
        { decision, verified_by: ctx.user?.id });
    },

    finhub_bulk_decide_payment_requests: (args, ctx) => {
      if (!isSuper(ctx.user)) throw new Error('Only a super admin may decide payment requests.');
      const ids = args.p_ids || [];
      if (ids.length === 0) throw new Error('No requests selected.');
      const batch = ctx.nextId('batch');
      const hashes = [];
      ids.forEach((id) => {
        const row = find(ctx, id);
        if (!['pending_approval', 'on_hold'].includes(row.status)) {
          throw new Error(`A ${row.status} request is not awaiting a decision.`);
        }
        row.pending_decision = args.p_decision;
        row.pending_reason = String(args.p_reason || '').trim();
        row.pending_decided_by = ctx.user?.id || null;
        row.pending_decided_at = new Date().toISOString();
        const terms = decisionTerms(row);
        row.pending_terms_hash = terms.hash;
        row.bulk_batch_id = batch;
        hashes.push(terms.hash);
        event(ctx, row, 'decision_recorded', row.status, row.status, row.pending_reason,
          { decision: args.p_decision, awaiting_verification: true, batch });
      });
      return {
        batch_id: batch,
        count: ids.length,
        decision: args.p_decision,
        reason: args.p_reason,
        hash: digest([...hashes].sort().join('|')),
      };
    },

    finhub_verify_bulk_decision: (args, ctx) => {
      if (!isSuper(ctx.user)) throw new Error('Only a super admin may verify a payment decision.');
      const rows = ctx.rowsOf('payment_requests')
        .filter(r => r.bulk_batch_id === args.p_batch_id && r.pending_decision);
      if (rows.length === 0) throw new Error('That batch has nothing awaiting verification.');
      const hash = digest(rows.map(r => decisionTerms(r).hash).sort().join('|'));
      if (args.p_hash !== hash) {
        throw new Error('One or more requests in this batch changed since they were reviewed. Nothing has been applied.');
      }
      rows.forEach((row) => {
        const to = { approve: 'approved', reject: 'rejected', hold: 'on_hold' }[row.pending_decision];
        const reason = row.pending_reason;
        row.decision = row.pending_decision;
        row.decision_reason = reason;
        row.decided_by = row.pending_decided_by;
        row.decided_at = row.pending_decided_at;
        row.verified_by = ctx.user?.id || null;
        row.verified_at = new Date().toISOString();
        row.pending_decision = null;
        row.pending_reason = null;
        row.pending_terms_hash = null;
        move(ctx, row, to, 'decision_verified', reason, {});
      });
      return rows.length;
    },

    finhub_execute_payment_request: (args, ctx) => {
      if (!isAdmin(ctx.user)) throw new Error('Only FinHub staff may execute a payment.');
      if (!String(args.p_reference || '').trim()) throw new Error('An executed payment needs a reference.');
      const row = find(ctx, args.p_id);
      if (row.status !== 'approved') {
        throw new Error(`Only an approved request can be executed; this one is ${row.status}.`);
      }
      move(ctx, row, 'processing', 'execution_started');

      let walletId = null;
      if (row.agent_id && row.request_type === 'agent_commission') {
        walletId = ctx.nextId('agent_wallets');
        ctx.rowsOf('agent_wallets').push({
          id: walletId,
          agent_id: row.agent_id,
          total_earned: 0,
          total_withdrawn: row.amount,
          available_balance: -row.amount,
          tx_type: 'withdrawal',
          description: `${row.narrative || 'Commission withdrawal'} [${row.request_no}]`,
          reference_id: row.id,
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewed_by: row.verified_by || 'finhub',
          created_at: new Date().toISOString(),
        });
      }

      row.executed_by = ctx.user?.id || null;
      row.executed_at = new Date().toISOString();
      row.payment_reference = String(args.p_reference).trim();
      row.wallet_entry_id = walletId;
      return move(ctx, row, 'executed', 'executed', null,
        { payment_reference: row.payment_reference, wallet_entry_id: walletId });
    },

    finhub_fail_payment_request: (args, ctx) => {
      if (!isAdmin(ctx.user)) throw new Error('Only FinHub staff may fail a payment.');
      if (!String(args.p_reason || '').trim()) throw new Error('A failed payment needs a reason.');
      const row = find(ctx, args.p_id);
      row.failure_reason = String(args.p_reason).trim();
      return move(ctx, row, 'failed', 'failed', row.failure_reason);
    },

    finhub_confirm_payment_request: (args, ctx) => {
      if (!isAdmin(ctx.user)) throw new Error('Only FinHub staff may confirm a bank credit.');
      const row = find(ctx, args.p_id);
      if (row.status !== 'executed') {
        throw new Error(`Only an executed payment can be confirmed; this one is ${row.status}.`);
      }
      row.bank_confirmed = args.p_credited !== false;
      row.bank_confirmed_at = new Date().toISOString();
      row.bank_reference = String(args.p_bank_reference || '').trim() || null;
      if (!row.bank_confirmed) {
        row.failure_reason = 'Bank did not confirm the credit.';
        return move(ctx, row, 'failed', 'bank_confirmation_failed', 'The bank did not confirm the credit.');
      }
      return move(ctx, row, 'reconciliation_required', 'bank_confirmed', null,
        { bank_reference: row.bank_reference });
    },

    finhub_reconcile_payment_request: (args, ctx) => {
      if (!isAdmin(ctx.user)) throw new Error('Only FinHub staff may reconcile a payment.');
      const row = find(ctx, args.p_id);
      row.reconciled_by = ctx.user?.id || null;
      row.reconciled_at = new Date().toISOString();
      row.reconciliation_note = String(args.p_note || '').trim() || null;
      if (args.p_matched) return move(ctx, row, 'completed', 'reconciled', args.p_note);
      return move(ctx, row, 'failed', 'reconciliation_failed',
        row.reconciliation_note || 'Could not be matched to a bank transaction.');
    },

    finhub_cancel_payment_request: (args, ctx) => {
      const row = find(ctx, args.p_id);
      if (row.submitted_by !== ctx.user?.id && !isAdmin(ctx.user)) {
        throw new Error('Not your payment request.');
      }
      return move(ctx, row, 'cancelled', 'cancelled', args.p_reason);
    },

    finhub_resume_payment_request: (args, ctx) => {
      if (!isSuper(ctx.user)) throw new Error('Only a super admin may take a request off hold.');
      return move(ctx, find(ctx, args.p_id), 'pending_approval', 'resumed', args.p_reason);
    },

    finhub_attach_payment_document: (args, ctx) => {
      const row = find(ctx, args.p_request_id);
      if (row.submitted_by !== ctx.user?.id && !isAdmin(ctx.user)) {
        throw new Error('Not your payment request.');
      }
      if (!['draft', 'submitted', 'under_validation', 'pending_approval', 'on_hold'].includes(row.status)) {
        throw new Error(`A ${row.status} request no longer accepts documents.`);
      }
      const doc = {
        id: ctx.nextId('payment_request_documents'),
        request_id: row.id,
        admin_id: row.admin_id,
        document_type: args.p_document_type || 'other',
        file_name: args.p_file_name,
        file_path: args.p_file_path,
        mime_type: args.p_mime_type || null,
        file_size: args.p_file_size ?? null,
        uploaded_by: ctx.user?.id || null,
        uploaded_at: new Date().toISOString(),
      };
      ctx.rowsOf('payment_request_documents').push(doc);
      event(ctx, row, 'document_attached', row.status, row.status, null,
        { file_name: args.p_file_name, document_type: args.p_document_type });
      return doc;
    },

    payment_request_totals: (_args, ctx) => {
      const by = {};
      ctx.rowsOf('payment_requests').forEach((r) => {
        by[r.status] = by[r.status] || { status: r.status, request_count: 0, total_amount: 0 };
        by[r.status].request_count += 1;
        by[r.status].total_amount += Number(r.amount || 0);
      });
      return Object.values(by);
    },
  };
};

export default finhubRpcs;
