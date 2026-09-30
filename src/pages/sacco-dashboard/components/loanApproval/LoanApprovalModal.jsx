import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import { supabase } from '../../../../lib/supabase';
import Icon from '../../../../components/AppIcon';
import { Modal, Badge, PrimaryButton, GhostButton, TextInput, KES, fmtDateTime } from '../_shared';
import {
  fetchLoanSteps, startApproval, sendApprovalOtp, decideApprovalStep, actionableStepIds,
} from '../../../../services/loanApprovalService';

/**
 * One loan's approval chain, and the place each level's decision is recorded.
 *
 * Recording a decision is three moves: send the named approver a code, type
 * the code they read back, approve or reject. The code is what ties the
 * decision to the person named on the level rather than to whoever happens to
 * be logged in. Every check — turn order, code, expiry, attempts — is made by
 * the server; this screen only shows which buttons are worth pressing.
 */

const StepRow = ({ step, actionable, waitingOn, onDecided }) => {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [code, setCode] = useState('');
  const [comment, setComment] = useState('');
  const [deciding, setDeciding] = useState(null);

  const send = async (channel) => {
    setSending(true);
    try {
      const r = await sendApprovalOtp(step.id, channel);
      setSentTo(r);
      setCode('');
      toast.success(`Code sent by ${r.channel === 'sms' ? 'SMS' : 'email'} to ${r.destination}.`);
    } catch (e) {
      toast.error(e.message || 'Could not send the code.');
    } finally { setSending(false); }
  };

  const decide = async (decision) => {
    if (code.replace(/\D/g, '').length !== 6) { toast.error('Enter the 6-digit code the approver received.'); return; }
    if (decision === 'rejected' && !comment.trim()) { toast.error('Give a reason for rejecting.'); return; }
    setDeciding(decision);
    try {
      const r = await decideApprovalStep(step.id, code, decision, comment);
      if (!r?.ok) {
        toast.error(r?.attempts_left != null ? `${r.error} ${r.attempts_left} attempt(s) left.` : r?.error);
        if (r?.attempts_left === 0 || /new one/i.test(r?.error || '')) setSentTo(null);
        return;
      }
      toast.success(decision === 'approved'
        ? (r.loan_status === 'approved' ? 'Final approval recorded — the loan is approved and ready to disburse.' : `${step.level_name} approved.`)
        : 'Loan rejected.');
      onDecided(r);
    } catch (e) {
      toast.error(e.message || 'Could not record the decision.');
    } finally { setDeciding(null); }
  };

  return (
    <div className={`p-3 rounded-lg border ${actionable ? 'border-primary/40' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Level {step.level_no} · {step.level_name}</p>
          <p className="text-sm font-medium text-foreground mt-0.5">{step.approver_name}</p>
          <p className="text-xs text-muted-foreground">
            {[step.approver_email, step.approver_phone].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Badge status={step.status} />
      </div>

      {step.status !== 'pending' && step.status !== 'cancelled' && (
        <p className="text-xs text-muted-foreground mt-2">
          {step.status === 'approved' ? 'Approved' : 'Rejected'} {fmtDateTime(step.decided_at)}
          {step.verified_via && ` · OTP verified by ${step.verified_via === 'sms' ? 'SMS' : 'email'}`}
          {step.comment && <> · <span className="text-foreground">&ldquo;{step.comment}&rdquo;</span></>}
        </p>
      )}

      {step.status === 'pending' && !actionable && waitingOn && (
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
          <Icon name="Lock" size={12} color="currentColor" /> Waiting for {waitingOn} to approve first.
        </p>
      )}

      {actionable && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {step.approver_email && (
              <GhostButton icon="Mail" onClick={() => send('email')} disabled={sending}>
                {sentTo?.channel === 'email' ? 'Resend email code' : 'Email code'}
              </GhostButton>
            )}
            {step.approver_phone && (
              <GhostButton icon="MessageSquare" onClick={() => send('sms')} disabled={sending}>
                {sentTo?.channel === 'sms' ? 'Resend SMS code' : 'SMS code'}
              </GhostButton>
            )}
            {sending && <span className="text-xs text-muted-foreground">Sending…</span>}
            {sentTo && !sending && (
              <span className="text-xs text-muted-foreground">
                Sent to {sentTo.destination} · valid {sentTo.expires_minutes || 10} min
              </span>
            )}
          </div>

          {sentTo && (
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
              <TextInput
                inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                placeholder="6-digit code" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                aria-label="Verification code"
              />
              <TextInput
                placeholder="Comment (required to reject)" value={comment}
                onChange={(e) => setComment(e.target.value)} aria-label="Comment"
              />
              <div className="sm:col-span-2 flex items-center justify-end gap-2">
                <GhostButton icon="X" onClick={() => decide('rejected')} disabled={!!deciding}
                  className="text-red-600">
                  {deciding === 'rejected' ? 'Rejecting…' : 'Reject'}
                </GhostButton>
                <PrimaryButton icon="Check" onClick={() => decide('approved')} disabled={!!deciding}>
                  {deciding === 'approved' ? 'Approving…' : 'Approve'}
                </PrimaryButton>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const LoanApprovalModal = ({ loan, onClose, onChanged }) => {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [loanStatus, setLoanStatus] = useState(loan?.status);
  const [mode, setMode] = useState(loan?.approval_mode || 'sequential');

  const load = useCallback(async () => {
    if (!loan?.id) return;
    setLoading(true);
    try {
      // Status and mode are read fresh with the steps: the row the table
      // handed us predates whatever this modal has just done to the loan.
      const [rows, { data: live }] = await Promise.all([
        fetchLoanSteps(loan.id),
        supabase.from('sacco_loans').select('status, approval_mode').eq('id', loan.id).maybeSingle(),
      ]);
      setSteps(rows);
      if (live) { setLoanStatus(live.status); setMode(live.approval_mode || 'sequential'); }
    }
    catch (e) { toastRef.current.error(e.message || 'Could not load the approval chain.'); }
    finally { setLoading(false); }
  }, [loan?.id]);

  useEffect(() => {
    setLoanStatus(loan?.status);
    setMode(loan?.approval_mode || 'sequential');
    load();
  }, [loan?.id, loan?.status, loan?.approval_mode, load]);

  const start = async () => {
    setStarting(true);
    try {
      await startApproval(loan.id);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.message || 'Could not start the approval workflow.');
    } finally { setStarting(false); }
  };

  const onDecided = async () => {
    await load();
    onChanged?.();
  };

  const actionable = loanStatus === 'pending' ? actionableStepIds(steps, mode) : new Set();
  const sorted = [...steps].sort((a, b) => a.level_no - b.level_no);
  const firstOpen = sorted.find((s) => s.status !== 'approved');

  return (
    <Modal
      open={!!loan} onClose={onClose} wide
      title={loan ? `Approvals · ${loan.member?.full_name || 'Loan'} · ${KES(loan.principal)}` : ''}
      footer={<GhostButton onClick={onClose}>Close</GhostButton>}
    >
      {loading && steps.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading approval chain…</p>
      ) : steps.length === 0 ? (
        <div className="text-center py-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            This application was submitted before the approval workflow was set up, so it has no approval chain yet.
          </p>
          {loanStatus === 'pending' && (
            <PrimaryButton icon="Play" onClick={start} disabled={starting}>
              {starting ? 'Starting…' : 'Start approval workflow'}
            </PrimaryButton>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground capitalize">{mode}</span> approval ·{' '}
              {steps.filter((s) => s.status === 'approved').length} of {steps.length} approved
            </p>
            <Badge status={loanStatus} />
          </div>
          {loanStatus === 'approved' && (
            <div className="flex items-start gap-2 p-3 rounded-lg border bg-emerald-50 border-emerald-200">
              <Icon name="CheckCircle2" size={15} color="#059669" />
              <p className="text-xs text-emerald-800">
                Every level has approved. Close this and press <strong>Disburse</strong> on the loan to generate its repayment schedule.
              </p>
            </div>
          )}
          {sorted.map((s) => (
            <StepRow
              key={s.id} step={s}
              actionable={actionable.has(s.id)}
              waitingOn={mode === 'sequential' && firstOpen && firstOpen.id !== s.id ? firstOpen.level_name : null}
              onDecided={onDecided}
            />
          ))}
        </div>
      )}
    </Modal>
  );
};

export default LoanApprovalModal;
