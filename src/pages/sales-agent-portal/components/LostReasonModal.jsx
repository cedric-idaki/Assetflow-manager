import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { LOST_REASONS } from '../../../config/crmVocabulary';

/**
 * Asked when an agent closes a lead without converting it.
 *
 * This is the only moment the answer is actually known. Ask a week later and
 * nobody remembers; ask in a monthly review and you get a guess. So it is a
 * single click at the exact moment the agent already has the outcome in mind.
 *
 * DELIBERATELY SKIPPABLE. A required field here would be answered with whatever
 * is first in the list by anyone in a hurry, and a loss report full of dutiful
 * "Other" is worse than one that honestly says how much it does not know — the
 * admin view reports its own coverage precisely so an unfilled reason stays
 * visible instead of quietly corrupting the breakdown. Skipping is honest;
 * clicking the nearest option to make a dialog go away is not.
 */
const LostReasonModal = ({ open, lead, onCancel, onConfirm }) => {
  const [reason, setReason] = useState(null);
  const [notes, setNotes]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  // A fresh lead means a fresh answer; leaving the last one selected is how an
  // agent closing three leads in a row marks them all "price".
  useEffect(() => {
    if (open) { setReason(null); setNotes(''); setError(''); setBusy(false); }
  }, [open, lead?.id]);

  if (!open) return null;

  const submit = async (withReason) => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(withReason ? { reason, notes } : null);
    } catch (err) {
      setError(err?.message || 'Could not close the lead. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg my-auto shadow-xl">

        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">Closing without a sale</h3>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {lead?.full_name || 'This lead'} — what happened?
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel"
            className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0 disabled:opacity-50"
          >
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {LOST_REASONS.map(r => (
              <button
                key={r.value}
                type="button"
                onClick={() => setReason(r.value)}
                aria-pressed={reason === r.value}
                className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                  reason === r.value
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'border-border hover:border-primary/40 hover:bg-muted/40'
                }`}
              >
                <span className="text-sm font-medium text-foreground block">{r.label}</span>
                <span className="text-xs text-muted-foreground block mt-0.5">{r.hint}</span>
              </button>
            ))}
          </div>

          <label className="block mt-4">
            <span className="text-xs font-medium text-muted-foreground">
              Anything worth remembering? <span className="font-normal">(optional)</span>
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. wants to come back after the harvest"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          {error && (
            <p className="mt-3 text-xs text-red-600 flex items-start gap-1.5">
              <Icon name="AlertCircle" size={13} color="#dc2626" className="mt-0.5 flex-shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={busy}
            className="px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-50"
          >
            Skip &amp; close
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={busy || !reason}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-all disabled:opacity-40"
          >
            {busy ? 'Closing…' : 'Close lead'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LostReasonModal;
