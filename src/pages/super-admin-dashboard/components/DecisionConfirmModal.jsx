import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

/**
 * The second half of a two-step payment decision.
 *
 * WHAT THIS IS FOR. Step one has already run: the database recorded YES / NO /
 * WAIT and a reason, and handed back the exact wording it hashed. Nothing has
 * moved yet — the request is still sitting at pending_approval. This modal
 * shows that wording and, on confirm, sends the hash back.
 *
 * `terms.lines` IS RENDERED VERBATIM AND `terms.hash` IS PASSED THROUGH
 * UNTOUCHED. Both matter. The digest is computed server-side over the request
 * as it stands; if this screen paraphrased the lines, or recomputed the hash,
 * or cached one from an earlier read, the confirmation would be about a
 * different thing than the one the database is going to act on — which is the
 * entire failure a two-step approval exists to prevent. If the request has
 * changed since step one (revalidated, settled in another tab), the RPC
 * refuses and the message says so.
 *
 * There is deliberately no "don't ask again". The whole control is the pause.
 */
const DecisionConfirmModal = ({
  open,
  terms,           // { lines: string[], hash, amount, currency, request_no } or bulk { count, hash, ... }
  decision,        // 'approve' | 'reject' | 'hold'
  reason,
  bulkCount = 0,   // > 0 when confirming a batch
  onConfirm,       // (hash) => Promise
  onCancel,
  busy = false,
}) => {
  const [error, setError] = useState('');

  if (!open || !terms) return null;

  const verb = decision === 'approve' ? 'Approve' : decision === 'reject' ? 'Reject' : 'Place on hold';
  const tone = decision === 'approve'
    ? { bg: 'bg-emerald-600 hover:bg-emerald-700', chip: 'bg-emerald-100 text-emerald-800', icon: 'CheckCircle2', color: '#059669' }
    : decision === 'reject'
      ? { bg: 'bg-red-600 hover:bg-red-700', chip: 'bg-red-100 text-red-800', icon: 'XCircle', color: '#dc2626' }
      : { bg: 'bg-orange-600 hover:bg-orange-700', chip: 'bg-orange-100 text-orange-800', icon: 'PauseCircle', color: '#ea580c' };

  const confirm = async () => {
    setError('');
    try {
      await onConfirm(terms.hash);
    } catch (err) {
      setError(err?.message || 'The confirmation was refused. Nothing has changed.');
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
            <Icon name={tone.icon} size={18} color={tone.color} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              Step 2 of 2 — confirm this decision
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {bulkCount > 0
                ? `${bulkCount} request${bulkCount === 1 ? '' : 's'} will be settled together.`
                : 'Read it once more. Confirming releases the decision.'}
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${tone.chip}`}>
              {verb.toUpperCase()}
            </span>
            {bulkCount > 0 && (
              <span className="text-xs text-muted-foreground">applied to {bulkCount} requests</span>
            )}
          </div>

          {/* Rendered exactly as the database hashed it. Do not reformat. */}
          <div className="bg-muted/50 border border-border rounded-xl p-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              What you are confirming
            </p>
            {Array.isArray(terms.lines) && terms.lines.length > 0 ? (
              <ul className="space-y-1">
                {terms.lines.map((line, i) => (
                  <li key={i} className="text-sm text-foreground font-mono leading-relaxed break-words">{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-foreground">
                {bulkCount} payment request{bulkCount === 1 ? '' : 's'}, decided together.
              </p>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Your reason</p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{reason}</p>
          </div>

          <p className="text-[11px] text-muted-foreground font-mono break-all">
            Verification digest: {terms.hash}
          </p>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
              <Icon name="AlertCircle" size={15} color="#dc2626" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${tone.bg}`}
          >
            {busy ? 'Confirming…' : `Confirm ${verb.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DecisionConfirmModal;
