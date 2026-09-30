import { supabase } from '../lib/supabase';

/**
 * SACCO loan approval workflow — the browser side.
 *
 * Every rule lives in the database (migration 20260930140000): the levels,
 * whose turn it is, the OTP check, and the gate that stops a pending loan
 * going active before its chain is complete. This file only reads the tables
 * (SELECT-only to staff) and calls the functions that are allowed to write.
 * The OTP is generated and delivered by the sacco-loan-approval-otp Edge
 * Function; the plain code never reaches this browser.
 */

export const APPROVAL_MODES = [
  { id: 'sequential', label: 'Sequential', hint: 'Each level waits for the one before it to approve.' },
  { id: 'parallel', label: 'Parallel', hint: 'All levels can decide at the same time; every one must approve.' },
];

/** The sacco's configured chain: { mode, levels[] }. */
export async function fetchApprovalConfig(saccoId) {
  const [{ data: settings, error: sErr }, { data: levels, error: lErr }] = await Promise.all([
    supabase.from('sacco_loan_approval_settings').select('mode').eq('sacco_id', saccoId).maybeSingle(),
    supabase.from('sacco_loan_approval_levels')
      .select('id, level_no, level_name, approver_name, approver_email, approver_phone, is_active')
      .eq('sacco_id', saccoId)
      .order('level_no', { ascending: true }),
  ]);
  if (sErr) throw sErr;
  if (lErr) throw lErr;
  return { mode: settings?.mode || 'sequential', levels: levels || [] };
}

/** Replace the chain wholesale. Levels are saved in the order given. */
export async function saveApprovalConfig(saccoId, mode, levels) {
  const { data, error } = await supabase.rpc('sacco_loan_approval_save_config', {
    p_sacco_id: saccoId,
    p_mode: mode,
    p_levels: levels.map((l) => ({
      level_name: l.level_name,
      approver_name: l.approver_name,
      approver_email: l.approver_email || null,
      approver_phone: l.approver_phone || null,
    })),
  });
  if (error) throw error;
  return data;
}

/** One loan's steps, in level order. */
export async function fetchLoanSteps(loanId) {
  const { data, error } = await supabase
    .from('sacco_loan_approval_steps')
    .select('id, level_no, level_name, approver_name, approver_email, approver_phone, status, comment, verified_via, decided_at')
    .eq('loan_id', loanId)
    .order('level_no', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Steps for many loans at once, grouped by loan_id (for the loans table). */
export async function fetchStepsForLoans(loanIds) {
  if (!loanIds.length) return new Map();
  const { data, error } = await supabase
    .from('sacco_loan_approval_steps')
    .select('loan_id, level_no, status')
    .in('loan_id', loanIds);
  if (error) throw error;
  const byLoan = new Map();
  (data || []).forEach((s) => {
    if (!byLoan.has(s.loan_id)) byLoan.set(s.loan_id, []);
    byLoan.get(s.loan_id).push(s);
  });
  return byLoan;
}

/** Attach the chain to a pending loan created before levels existed. */
export async function startApproval(loanId) {
  const { data, error } = await supabase.rpc('sacco_loan_approval_start', { p_loan_id: loanId });
  if (error) throw error;
  return data;
}

/** Ask the server to send the approver a code. Returns { channel, destination }. */
export async function sendApprovalOtp(stepId, channel) {
  const { data, error } = await supabase.functions.invoke('sacco-loan-approval-otp', {
    body: { action: 'send', step_id: stepId, channel },
  });
  if (error) {
    // functions.invoke hides the body of a non-2xx; our function puts the
    // human-readable reason there.
    let msg = error.message;
    try { msg = (await error.context?.json())?.error || msg; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Record a decision. Resolves to the server's verdict:
 *   { ok: true,  step_status, loan_status }
 *   { ok: false, error, attempts_left? }   — wrong/expired code; not thrown,
 *                                            because the attempt still counted.
 */
export async function decideApprovalStep(stepId, code, decision, comment) {
  const { data, error } = await supabase.rpc('sacco_loan_approval_decide', {
    p_step_id: stepId,
    p_code: code,
    p_decision: decision,
    p_comment: comment || null,
  });
  if (error) throw error;
  return data;
}

/**
 * Which pending steps may act now. Mirrors sacco_loan_approval_assert_actionable
 * for display only — the server re-checks on every send and decide.
 */
export function actionableStepIds(steps, mode) {
  const pending = steps.filter((s) => s.status === 'pending');
  if (mode === 'parallel') return new Set(pending.map((s) => s.id));
  const sorted = [...steps].sort((a, b) => a.level_no - b.level_no);
  const next = sorted.find((s) => s.status !== 'approved');
  return new Set(next && next.status === 'pending' ? [next.id] : []);
}

/** "2 of 3 approved" for a loan's steps. */
export function approvalProgress(steps = []) {
  const approved = steps.filter((s) => s.status === 'approved').length;
  return { approved, total: steps.length };
}
