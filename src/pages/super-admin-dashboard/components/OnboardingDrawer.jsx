import React, { useEffect, useState, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import {
  ONBOARDING_STATUSES, STEP_STATUSES, statusMeta, stepStatusMeta,
  groupStepsByPhase, stepIcon, progressOf, scheduleStance, formatDay,
} from '../../../config/clientOnboarding';

/**
 * ONE CLIENT'S INSTALLATION
 *
 * Everything the platform records about delivering one onboarding: its state,
 * who owns it, the two dates, the checklist it is made of, and the notes that
 * explain the gaps between them.
 *
 * WHY THE CHECKLIST IS EDITED HERE AND NOT IN THE LIST
 *   Ticking a step is a claim that work was done, and the trigger stamps who
 *   made the claim and when. That deserves the record open in front of you, not
 *   a checkbox in a table row that is one mis-click away from asserting a
 *   training session happened.
 *
 * WHY "MARK COMPLETE" IS A SEPARATE, DELIBERATE BUTTON
 *   The database never completes a record on its own, however many steps are
 *   ticked. Sign-off is the moment the platform stops owing the client
 *   something, so it is a person's decision — and reopening a completed record
 *   clears the completion stamp rather than leaving a date that is no longer
 *   true.
 */

const TONE_BADGE = {
  slate:   'bg-slate-100 text-slate-700',
  blue:    'bg-blue-100 text-blue-700',
  amber:   'bg-amber-100 text-amber-700',
  orange:  'bg-orange-100 text-orange-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  red:     'bg-red-100 text-red-700',
};

const TONE_ACTIVE = {
  slate:   'border-slate-400 bg-slate-100 text-slate-700',
  blue:    'border-blue-400 bg-blue-50 text-blue-700',
  amber:   'border-amber-400 bg-amber-50 text-amber-700',
  orange:  'border-orange-400 bg-orange-50 text-orange-700',
  emerald: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  red:     'border-red-400 bg-red-50 text-red-700',
};

const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
    {children}
    {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
  </div>
);

const inputCls =
  'w-full px-3 py-2 text-sm bg-background border border-border rounded-lg '
  + 'focus:outline-none focus:ring-1 focus:ring-primary text-foreground '
  + 'placeholder:text-muted-foreground';

const OnboardingDrawer = ({ record, onboarding, onClose }) => {
  const {
    installers, steps, stepsLoading, loadSteps,
    assign, setStatus, setDates, saveNotes, complete,
    setStepStatus, updateStep, addStep, removeStep,
  } = onboarding;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notesDraft, setNotesDraft] = useState(record.notes || '');
  const [holdDraft, setHoldDraft] = useState(record.on_hold_reason || '');
  const [newStep, setNewStep] = useState('');
  const [stepDrafts, setStepDrafts] = useState({});

  const rows = steps[record.id] || [];
  const pct = progressOf(record, rows.length ? rows : null);
  const stance = scheduleStance(record);
  const status = statusMeta(record.status);

  useEffect(() => { loadSteps(record.id); }, [record.id, loadSteps]);

  // The record is re-read from the server after every write, so the drafts
  // follow it rather than the other way round — otherwise a value the trigger
  // adjusted (a completion date filled in from the booked date) would be
  // overwritten by whatever was in the box before the save.
  useEffect(() => { setNotesDraft(record.notes || ''); }, [record.notes]);
  useEffect(() => { setHoldDraft(record.on_hold_reason || ''); }, [record.on_hold_reason]);

  const run = useCallback(async (fn) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(e?.message || 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  }, []);

  const stepNote = (s) => (stepDrafts[s.id] !== undefined ? stepDrafts[s.id] : (s.notes || ''));

  const commitStepNote = (s) => {
    const draft = stepDrafts[s.id];
    if (draft === undefined || draft === (s.notes || '')) return;
    run(() => updateStep(record.id, s.id, { notes: draft.trim() || null }));
  };

  const grouped = groupStepsByPhase(rows);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl w-full max-w-3xl shadow-2xl my-6">

        {/* ── Who this is ─────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold flex-shrink-0 ${
              record.entity_type === 'sacco' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {(record.client_name || 'U')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground truncate">{record.client_name}</h3>
              <p className="text-xs text-muted-foreground truncate">
                {record.entity_type === 'sacco' ? 'Sacco' : 'Company'}
                {record.contact_email ? ` · ${record.contact_email}` : ''}
                {record.contact_phone ? ` · ${record.contact_phone}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {err && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <Icon name="AlertCircle" size={15} color="currentColor" />
              {err}
            </div>
          )}

          {/* ── Where it stands ──────────────────────────────────────── */}
          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${TONE_BADGE[status.tone]}`}>
                  <Icon name={status.icon} size={11} color="currentColor" />
                  {status.label}
                </span>
                <span className="text-xs text-muted-foreground">{stance.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">{pct}% complete</span>
                <span className="text-[10px] text-muted-foreground">
                  {record.steps_done || 0}/{record.steps_total || 0} steps
                </span>
              </div>
            </div>

            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>

            {/* Status is set by picking one, not by cycling: an installation
                does not move through these in a fixed order — a job goes on
                hold and comes back, and a booking slips. */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ONBOARDING_STATUSES.map((s) => {
                const active = record.status === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    disabled={busy || active}
                    title={s.hint}
                    onClick={() => run(() => setStatus(record.id, s.value, { onHoldReason: holdDraft }))}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all disabled:cursor-default ${
                      active
                        ? TONE_ACTIVE[s.tone]
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <Icon name={s.icon} size={12} color="currentColor" />
                    {s.label}
                  </button>
                );
              })}
            </div>

            {record.status === 'on_hold' && (
              <Field label="Why is it held?" hint="Cleared automatically when the job leaves this state.">
                <input
                  type="text"
                  value={holdDraft}
                  disabled={busy}
                  onChange={e => setHoldDraft(e.target.value)}
                  onBlur={() => {
                    if ((record.on_hold_reason || '') !== holdDraft) {
                      run(() => setStatus(record.id, 'on_hold', { onHoldReason: holdDraft }));
                    }
                  }}
                  placeholder="Waiting on the client's opening balances"
                  className={inputCls}
                />
              </Field>
            )}
          </div>

          {/* ── Who, and when ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field
              label="Responsible person"
              hint={record.assigned_at ? `Assigned ${formatDay(record.assigned_at)}` : 'Nobody is on this yet'}
            >
              <select
                value={record.assigned_to || ''}
                disabled={busy}
                onChange={e => run(() => assign(record.id, e.target.value || null))}
                className={inputCls}
              >
                <option value="">Unassigned</option>
                {/* A person who has since left keeps their name on the record
                    but is no longer in the picker, so the current value is
                    added back when it is missing. */}
                {record.assigned_to && !installers.some(u => u.id === record.assigned_to) && (
                  <option value={record.assigned_to}>{record.assigned_to_name || 'Former staff member'}</option>
                )}
                {installers.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.email}{u.role ? ` — ${u.role.replace(/_/g, ' ')}` : ''}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Scheduled for" hint="The date the client was promised">
              <input
                type="date"
                value={record.scheduled_date || ''}
                disabled={busy}
                onChange={e => run(() => setDates(record.id, { scheduledDate: e.target.value }))}
                className={inputCls}
              />
            </Field>

            <Field label="Installed on" hint="The date it actually happened">
              <input
                type="date"
                value={record.installation_date || ''}
                disabled={busy}
                onChange={e => run(() => setDates(record.id, { installationDate: e.target.value }))}
                className={inputCls}
              />
            </Field>
          </div>

          {/* ── The checklist ────────────────────────────────────────── */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Icon name="ListChecks" size={15} color="var(--color-muted-foreground)" />
                <h4 className="text-sm font-semibold text-foreground">Installation &amp; onboarding steps</h4>
              </div>
              <span className="text-[11px] text-muted-foreground">
                &quot;Not needed&quot; drops a step out of the total
              </span>
            </div>

            {stepsLoading && rows.length === 0 ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="animate-pulse bg-muted rounded-lg h-10" />
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {grouped.map(group => (
                  <div key={group.value} className="px-4 py-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      <Icon name={group.icon} size={12} color="currentColor" />
                      {group.label}
                    </p>

                    <div className="space-y-2">
                      {group.steps.map((s) => {
                        const meta = stepStatusMeta(s.status);
                        return (
                          <div key={s.id} className="rounded-lg border border-border p-2.5">
                            <div className="flex items-start gap-2.5">
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${TONE_BADGE[meta.tone]}`}>
                                <Icon name={stepIcon(s)} size={13} color="currentColor" />
                              </div>

                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${meta.value === 'skipped' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                                  {s.label}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {s.completed_at
                                    ? `Done ${formatDay(s.completed_at)}${s.completed_by_name ? ` by ${s.completed_by_name}` : ''}`
                                    : s.due_date
                                      ? `Due ${formatDay(s.due_date)}`
                                      : 'No date'}
                                </p>
                              </div>

                              <select
                                value={meta.value}
                                disabled={busy}
                                onChange={e => run(() => setStepStatus(record.id, s.id, e.target.value))}
                                className="px-2 py-1 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                              >
                                {STEP_STATUSES.map(o => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>

                              <input
                                type="date"
                                value={s.due_date || ''}
                                disabled={busy}
                                title="Due date for this step"
                                onChange={e => run(() => updateStep(record.id, s.id, { due_date: e.target.value || null }))}
                                className="px-2 py-1 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                              />

                              {/* Only a step that was added for this client can
                                  be removed. The shipped eleven are what the
                                  platform sells; a step that does not apply is
                                  marked "Not needed", which keeps the record of
                                  the decision. */}
                              {String(s.step_key || '').startsWith('custom_') && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  title="Remove this step"
                                  onClick={() => run(() => removeStep(record.id, s.id))}
                                  className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                                >
                                  <Icon name="Trash2" size={13} color="#DC2626" />
                                </button>
                              )}
                            </div>

                            <input
                              type="text"
                              value={stepNote(s)}
                              disabled={busy}
                              onChange={e => setStepDrafts(prev => ({ ...prev, [s.id]: e.target.value }))}
                              onBlur={() => commitStepNote(s)}
                              placeholder="Add a note — what was done, or what is blocking it"
                              className="mt-2 w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="px-4 py-3 flex items-center gap-2">
                  <input
                    type="text"
                    value={newStep}
                    disabled={busy}
                    onChange={e => setNewStep(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newStep.trim()) {
                        run(async () => { await addStep(record.id, { label: newStep }); setNewStep(''); });
                      }
                    }}
                    placeholder="Add a step this client needs…"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    disabled={busy || !newStep.trim()}
                    onClick={() => run(async () => { await addStep(record.id, { label: newStep }); setNewStep(''); })}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    <Icon name="Plus" size={13} color="currentColor" />
                    Add step
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── The story ────────────────────────────────────────────── */}
          <Field label="Notes" hint="What an installer arriving on this account tomorrow needs to know">
            <textarea
              rows={3}
              value={notesDraft}
              disabled={busy}
              onChange={e => setNotesDraft(e.target.value)}
              onBlur={() => {
                if ((record.notes || '') !== notesDraft) run(() => saveNotes(record.id, notesDraft));
              }}
              placeholder="Site details, who to call, what was agreed…"
              className={inputCls}
            />
          </Field>
        </div>

        {/* ── Sign-off ────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-t border-border">
          <p className="text-[11px] text-muted-foreground">
            {record.completed_at
              ? `Signed off ${formatDay(record.completed_at)}${record.completed_by_name ? ` by ${record.completed_by_name}` : ''}`
              : `Client registered ${formatDay(record.registered_at)}${record.account_active ? '' : ' · account not yet active'}`}
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              Close
            </button>
            {record.status === 'completed' ? (
              <button
                disabled={busy}
                onClick={() => run(() => setStatus(record.id, 'in_progress'))}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-40"
              >
                <Icon name="RotateCcw" size={14} color="currentColor" />
                Reopen
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() => run(() => complete(record.id))}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-all disabled:opacity-40"
              >
                <Icon name="CheckCircle2" size={14} color="currentColor" />
                Mark complete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingDrawer;
