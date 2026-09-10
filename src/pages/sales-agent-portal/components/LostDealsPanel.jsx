import React, { useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { LOST_REASONS, lostReasonMeta, isLostLead } from '../../../config/crmVocabulary';

/**
 * The agent's own lost deals, and the only place they can be explained after
 * the fact.
 *
 * The close-time prompt is skippable on purpose, so without this screen a
 * skipped reason stayed blank forever and a wrong one stayed wrong. That is
 * bad for the agent before it is bad for the report: this is their record of
 * what keeps going wrong, not just their admin's.
 *
 * Only closed-not-won leads appear. A revived or converted lead has its whole
 * lost_* set wiped by trg_leads_stamp_lost, so anything written against a live
 * lead would silently vanish — the panel never offers it.
 */

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const LostDealRow = ({ lead, onSave, busy }) => {
  const meta = lostReasonMeta(lead.lost_reason);
  const [editing, setEditing] = useState(false);
  const [reason, setReason]   = useState(lead.lost_reason || null);
  const [notes, setNotes]     = useState(lead.lost_notes || '');
  const [error, setError]     = useState('');

  const start = () => {
    setReason(lead.lost_reason || null);
    setNotes(lead.lost_notes || '');
    setError('');
    setEditing(true);
  };

  const save = async () => {
    setError('');
    try {
      await onSave(lead.id, { reason, notes });
      setEditing(false);
    } catch (err) {
      setError(err?.message || 'Could not save. Please try again.');
    }
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {lead.full_name || 'Unnamed lead'}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {[lead.asset_interest, lead.phone].filter(Boolean).join(' · ') || 'No details recorded'}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-muted-foreground whitespace-nowrap">
            Lost {fmtDate(lead.lost_at)}
          </p>
        </div>
      </div>

      {!editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* An unexplained loss is the whole point of this screen, so it is
              styled as something to act on rather than as a neutral blank. */}
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border ${
            meta.known
              ? 'bg-muted text-foreground border-border'
              : 'bg-amber-50 text-amber-800 border-amber-200'
          }`}>
            {!meta.known && <Icon name="AlertCircle" size={11} color="currentColor" />}
            {meta.known ? meta.label : 'No reason recorded'}
          </span>

          {lead.lost_notes && (
            <span className="text-xs text-muted-foreground italic truncate max-w-full">
              “{lead.lost_notes}”
            </span>
          )}

          <button
            onClick={start}
            className="ml-auto text-xs font-medium text-primary hover:underline"
          >
            {meta.known ? 'Change' : 'Add reason'}
          </button>
        </div>
      ) : (
        <div className="mt-3 p-3 rounded-xl border border-primary/30 bg-primary/5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {LOST_REASONS.map(r => (
              <button
                key={r.value}
                type="button"
                onClick={() => setReason(r.value)}
                aria-pressed={reason === r.value}
                className={`text-left px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                  reason === r.value
                    ? 'border-primary bg-card font-medium text-foreground'
                    : 'border-transparent hover:bg-card/60 text-muted-foreground'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="What actually happened? (optional)"
            className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || !reason}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
};

const LostDealsPanel = ({ leads = [], loading = false, onSaveReason }) => {
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('all');

  const lost = useMemo(
    () => leads
      .filter(isLostLead)
      .sort((a, b) => new Date(b.lost_at || b.updated_at || 0) - new Date(a.lost_at || a.updated_at || 0)),
    [leads],
  );

  const unexplained = useMemo(() => lost.filter(l => !l.lost_reason), [lost]);
  const shown = filter === 'unexplained' ? unexplained : lost;

  const handleSave = async (leadId, payload) => {
    setBusyId(leadId);
    try {
      await onSaveReason(leadId, payload);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Icon name="XCircle" size={18} color="#dc2626" />
            Lost Deals
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            What went wrong, and what to do differently next time
          </p>
        </div>

        {lost.length > 0 && (
          <div className="flex gap-1">
            {[
              { value: 'all',         label: `All (${lost.length})` },
              { value: 'unexplained', label: `Needs a reason (${unexplained.length})` },
            ].map(t => (
              <button
                key={t.value}
                onClick={() => setFilter(t.value)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  filter === t.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="px-5 py-6 space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse bg-muted rounded-lg" />)}
        </div>
      ) : lost.length === 0 ? (
        <div className="text-center py-12 px-4">
          <div className="w-11 h-11 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
            <Icon name="ThumbsUp" size={19} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-medium text-foreground">No lost deals</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            When you close a lead without a sale you will be asked why, and it will appear here.
          </p>
        </div>
      ) : (
        <>
          {unexplained.length > 0 && filter === 'all' && (
            <div className="flex items-start gap-2 mx-5 mt-4 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <Icon name="Info" size={13} color="currentColor" className="mt-0.5 flex-shrink-0" />
              <span>
                {unexplained.length} of your {lost.length} lost deal{lost.length === 1 ? '' : 's'} has
                no reason recorded. Adding it takes one click and is what turns this list into a pattern.
              </span>
            </div>
          )}

          <ul className="px-5 py-2 divide-y divide-border max-h-[32rem] overflow-y-auto">
            {shown.map(l => (
              <LostDealRow
                key={l.id}
                lead={l}
                busy={busyId === l.id}
                onSave={handleSave}
              />
            ))}
          </ul>

          {shown.length === 0 && (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              Every lost deal has a reason recorded. Nothing to fill in.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default LostDealsPanel;
