import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { INTERACTION_TYPES, INTERACTION_OUTCOMES } from '../../../hooks/useCrmInteractions';
import { SCHEDULABLE_CHANNELS, channelMeta, toFollowUpChannel } from '../../../config/crmVocabulary';

// ── Input class helper (matches ScheduleFollowUpModal / CreateClientModal) ───
const ic = (err) =>
  `w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-background text-foreground transition-colors ${
    err ? 'border-red-400 bg-red-50' : 'border-border'
  }`;

// A call that just happened is the overwhelming case, so "now" is the default
// and these are for the ones written up later in the day.
const QUICK_WHEN = [
  { label: 'Just now',   minutesAgo: 0 },
  { label: '1 hr ago',   minutesAgo: 60 },
  { label: 'This morning', minutesAgo: 'morning' },
  { label: 'Yesterday',  minutesAgo: 1440 },
];

const DURATIONS = [5, 15, 30, 60];

// "Check me next week" — the whole reason the next-follow-up block is here and
// not behind a second modal. Same offsets ScheduleFollowUpModal offers.
const QUICK_NEXT = [
  { label: 'Tomorrow',   days: 1 },
  { label: 'In 3 days',  days: 3 },
  { label: 'Next week',  days: 7 },
  { label: 'In 2 weeks', days: 14 },
  { label: 'Next month', days: 30 },
];

const REMINDER_OFFSETS = [
  { label: '1 hr before',  minutes: 60 },
  { label: '3 hrs before', minutes: 180 },
  { label: 'Morning of',   minutes: 'morning' },
  { label: 'A day before', minutes: 1440 },
];

// <input type="datetime-local"> wants local wall-clock time, not an ISO string.
const toLocalInput = (date) => {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/**
 * Record a contact that has already happened.
 *
 * Deliberately NOT the follow-up modal: that one schedules the future and
 * fires a reminder, this one writes down the past. Conflating them is how a
 * CRM ends up with a diary and no history.
 */
const LogInteractionModal = ({
  isOpen,
  onClose,
  onSubmit,
  leads = [],
  clients = [],
  prefillLead = null,
  prefillClient = null,
  onScheduleFollowUp,
}) => {
  const [form, setForm] = useState({
    leadId:      prefillLead?.id || '',
    clientId:    prefillClient?.id || '',
    contactName: prefillLead?.full_name || prefillClient?.full_name || '',
    type:        'call',
    direction:   'outbound',
    outcome:     '',
    durationMinutes: '',
    occurredAt:  toLocalInput(new Date()),
    summary:     '',
    nextStep:    '',
    // The next follow-up, booked in the same breath. Empty means none: an agent
    // logging a note that needs no chase must not be forced to invent a date.
    followUpAt:      '',
    followUpChannel: '',
    followUpReminder: 60,
  });
  const [errors, setErrors]     = useState({});
  const [saving, setSaving]     = useState(false);
  const [apiError, setApiError] = useState('');

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    setErrors(p => ({ ...p, [k]: '' }));
    setApiError('');
  };

  // Converted leads keep their history but are no longer worked, so the picker
  // leads with the open ones and keeps the rest reachable below.
  const { openLeads, closedLeads } = useMemo(() => ({
    openLeads:   (leads || []).filter(l => l.stage !== 'closed'),
    closedLeads: (leads || []).filter(l => l.stage === 'closed'),
  }), [leads]);

  const handlePickLead = (leadId) => {
    const lead = (leads || []).find(l => l.id === leadId);
    setForm(p => ({
      ...p,
      leadId,
      // Picking a lead clears any client selection: one contact is about one
      // person, and sending both would attach the row to two timelines.
      clientId: leadId ? '' : p.clientId,
      contactName: lead?.full_name || p.contactName,
    }));
    setErrors(p => ({ ...p, contactName: '' }));
  };

  const handlePickClient = (clientId) => {
    const client = (clients || []).find(c => c.id === clientId);
    setForm(p => ({
      ...p,
      clientId,
      leadId: clientId ? '' : p.leadId,
      contactName: client?.full_name || p.contactName,
    }));
    setErrors(p => ({ ...p, contactName: '' }));
  };

  // Until the agent says otherwise, the next touch is on the channel this one
  // was on — an email thread continues by email far more often than it turns
  // into a site visit. One tap changes it.
  const followUpChannel = form.followUpChannel || toFollowUpChannel(form.type);
  const followUpMeta    = channelMeta(followUpChannel);
  const hasFollowUp     = Boolean(form.followUpAt);

  const applyNext = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(10, 0, 0, 0);
    set('followUpAt', toLocalInput(d));
  };

  // Turn the chosen offset into an absolute reminder time — the same arithmetic
  // ScheduleFollowUpModal does, because it feeds the same remind_at column.
  const computeRemindAt = () => {
    if (!form.followUpAt) return null;
    const appt = new Date(form.followUpAt);
    if (form.followUpReminder === 'morning') {
      const m = new Date(appt);
      m.setHours(8, 0, 0, 0);
      // An 8am appointment would otherwise "remind" after the fact.
      return m < appt ? m : new Date(appt.getTime() - 60 * 60 * 1000);
    }
    return new Date(appt.getTime() - Number(form.followUpReminder) * 60 * 1000);
  };

  const applyQuick = (minutesAgo) => {
    const d = new Date();
    if (minutesAgo === 'morning') d.setHours(9, 0, 0, 0);
    else d.setMinutes(d.getMinutes() - minutesAgo);
    set('occurredAt', toLocalInput(d));
  };

  const validate = () => {
    const e = {};
    if (!form.leadId && !form.clientId && !form.contactName.trim()) {
      e.contactName = 'Pick a lead or client, or type who you spoke to';
    }
    if (!form.occurredAt) e.occurredAt = 'When did this happen?';
    else if (new Date(form.occurredAt) > new Date(Date.now() + 60_000)) {
      // A contact in the future is a follow-up, and there is a modal for that.
      e.occurredAt = 'That is in the future — schedule a follow-up instead';
    }
    if (!form.summary.trim()) e.summary = 'Write down what was said — that is the point of logging it';
    if (form.followUpAt && new Date(form.followUpAt) <= new Date()) {
      e.followUpAt = 'A follow-up has to be in the future';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (alsoSchedule = false) => {
    if (!validate()) return;
    setSaving(true);
    setApiError('');
    try {
      const result = await onSubmit({
        leadId:      form.leadId || null,
        clientId:    form.clientId || null,
        contactName: form.contactName.trim(),
        type:        form.type,
        direction:   form.direction,
        outcome:     form.outcome || null,
        durationMinutes: form.durationMinutes || null,
        occurredAt:  new Date(form.occurredAt).toISOString(),
        summary:     form.summary.trim(),
        nextStep:    form.nextStep.trim(),
        // The commitment, dated. Without this the promise lives only in
        // nextStep — a sentence nobody is ever reminded about.
        followUp: hasFollowUp ? {
          channel:     followUpChannel,
          scheduledAt: new Date(form.followUpAt).toISOString(),
          remindAt:    computeRemindAt(),
          // What to do when the reminder lands. The agent has just written it
          // in "what happens next"; asking twice is how a form gets abandoned.
          notes:       form.nextStep.trim(),
        } : null,
      });
      if (result?.error) { setApiError(result.error); return; }

      if (alsoSchedule && onScheduleFollowUp) {
        const lead = (leads || []).find(l => l.id === form.leadId) || null;
        onScheduleFollowUp(lead, followUpChannel);
      }
      onClose();
    } catch (err) {
      setApiError(err?.message || 'Could not save that contact. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const selectedType = INTERACTION_TYPES.find(t => t.value === form.type);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name={selectedType?.icon || 'Phone'} size={18} color="var(--color-primary)" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Log a Contact</h2>
              <p className="text-xs text-muted-foreground">What happened, so the next call starts where this one ended</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Who */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Who</label>
            {(openLeads.length > 0 || closedLeads.length > 0) && (
              <select
                value={form.leadId}
                onChange={e => handlePickLead(e.target.value)}
                className={`${ic(errors.contactName)} mb-2`}
              >
                <option value="">— Select a lead —</option>
                {openLeads.length > 0 && (
                  <optgroup label="Open leads">
                    {openLeads.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.full_name}{l.phone ? ` · ${l.phone}` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {closedLeads.length > 0 && (
                  <optgroup label="Closed / converted">
                    {closedLeads.map(l => (
                      <option key={l.id} value={l.id}>{l.full_name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}

            {clients.length > 0 && (
              <select
                value={form.clientId}
                onChange={e => handlePickClient(e.target.value)}
                className={`${ic(false)} mb-2`}
              >
                <option value="">— or an existing client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}{c.phone ? ` · ${c.phone}` : ''}
                  </option>
                ))}
              </select>
            )}

            <input
              type="text"
              value={form.contactName}
              onChange={e => set('contactName', e.target.value)}
              placeholder="…or just type a name (walk-in, referral, not yet a lead)"
              className={ic(errors.contactName)}
            />
            {errors.contactName && <p className="mt-1 text-xs text-red-500">{errors.contactName}</p>}
          </div>

          {/* How */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">How</label>
            <div className="flex flex-wrap gap-2">
              {INTERACTION_TYPES.filter(t => t.value !== 'other').map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set('type', t.value)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                    form.type === t.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  <Icon name={t.icon} size={13} color="currentColor" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Direction + duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Who started it</label>
              <div className="flex rounded-xl border border-border overflow-hidden">
                {[
                  { value: 'outbound', label: 'I reached out' },
                  { value: 'inbound',  label: 'They contacted me' },
                ].map(d => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => set('direction', d.value)}
                    className={`flex-1 px-2 py-2 text-xs font-semibold transition-colors ${
                      form.direction === d.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                How long <span className="text-muted-foreground/60 font-normal normal-case">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DURATIONS.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set('durationMinutes', form.durationMinutes === m ? '' : m)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      form.durationMinutes === m
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* When */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">When</label>
            <div className="flex flex-wrap gap-2 mb-2.5">
              {QUICK_WHEN.map(q => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => applyQuick(q.minutesAgo)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <input
              type="datetime-local"
              value={form.occurredAt}
              onChange={e => set('occurredAt', e.target.value)}
              className={ic(errors.occurredAt)}
            />
            {errors.occurredAt && <p className="mt-1 text-xs text-red-500">{errors.occurredAt}</p>}
          </div>

          {/* Outcome */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              How did it go <span className="text-muted-foreground/60 font-normal normal-case">(optional)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {INTERACTION_OUTCOMES.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => set('outcome', form.outcome === o.value ? '' : o.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    form.outcome === o.value
                      ? o.sentiment === 'positive'
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                        : o.sentiment === 'negative'
                          ? 'border-red-300 bg-red-50 text-red-700'
                          : 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* What was said */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">What was said</label>
            <textarea
              rows={3}
              value={form.summary}
              onChange={e => set('summary', e.target.value)}
              placeholder="e.g. Wants the 3-bed in Westlands but her loan clears end of month. Asked for the payment plan in writing."
              className={`${ic(errors.summary)} resize-none`}
            />
            {errors.summary && <p className="mt-1 text-xs text-red-500">{errors.summary}</p>}
          </div>

          {/* Next step */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              What happens next <span className="text-muted-foreground/60 font-normal normal-case">(optional)</span>
            </label>
            <input
              type="text"
              value={form.nextStep}
              onChange={e => set('nextStep', e.target.value)}
              placeholder="e.g. Send payment plan PDF, call back after the 30th"
              className={ic(false)}
            />
          </div>

          {/* Next follow-up — the promise, with a date on it */}
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                When will you follow up
                {!hasFollowUp && (
                  <span className="text-muted-foreground/60 font-normal normal-case"> (optional)</span>
                )}
              </label>
              {hasFollowUp && (
                <button
                  type="button"
                  onClick={() => set('followUpAt', '')}
                  className="text-xs font-medium text-muted-foreground hover:text-red-600"
                >
                  No follow-up
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {QUICK_NEXT.map(q => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => applyNext(q.days)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                >
                  {q.label}
                </button>
              ))}
            </div>

            {!hasFollowUp && (
              <p className="mt-2 text-xs text-muted-foreground/80">
                Pick a date and it becomes a real appointment with an email reminder —
                not just a note you have to remember to read.
              </p>
            )}

            {hasFollowUp && (
              <div className="mt-3 space-y-3">
                <input
                  type="datetime-local"
                  value={form.followUpAt}
                  onChange={e => set('followUpAt', e.target.value)}
                  className={ic(errors.followUpAt)}
                />
                {errors.followUpAt && <p className="text-xs text-red-500">{errors.followUpAt}</p>}

                {/* Channel — the thing the old flow could not record at all */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                    How you'll reach them
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SCHEDULABLE_CHANNELS.map(c => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => set('followUpChannel', c.value)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                          followUpChannel === c.value
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                        }`}
                      >
                        <Icon name={c.icon} size={12} color="currentColor" />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reminder */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Remind me</p>
                  <div className="flex flex-wrap gap-1.5">
                    {REMINDER_OFFSETS.map(r => (
                      <button
                        key={r.label}
                        type="button"
                        onClick={() => set('followUpReminder', r.minutes)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          form.followUpReminder === r.minutes
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-card border border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Icon name={followUpMeta.icon} size={12} color="currentColor" />
                  <span>
                    {followUpMeta.label} on{' '}
                    <strong className="text-foreground">
                      {new Date(form.followUpAt).toLocaleString('en-GB', {
                        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </strong>
                    {computeRemindAt() && (
                      <> · reminder {computeRemindAt().toLocaleString('en-GB', {
                        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}</>
                    )}
                  </span>
                </p>
              </div>
            )}
          </div>

          {apiError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-center gap-2">
              <Icon name="AlertCircle" size={14} color="#dc2626" />
              {apiError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-5 py-2.5 border border-border text-muted-foreground text-sm font-medium rounded-xl hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          {/* The long form — a location, a separate agenda. Hidden once a date is
              set above, or clicking it would book the same follow-up twice. */}
          {onScheduleFollowUp && !hasFollowUp && (
            <button
              onClick={() => handleSubmit(true)}
              disabled={saving}
              className="px-4 py-2.5 border border-border text-sm font-medium rounded-xl text-muted-foreground hover:text-primary hover:border-primary/40 disabled:opacity-50 transition-all"
              title="Save this contact, then open the full appointment form"
            >
              More follow-up options
            </button>
          )}
          <button
            onClick={() => handleSubmit(false)}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {saving ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Saving...
              </>
            ) : (
              <>
                <Icon name="Check" size={15} color="currentColor" />
                {hasFollowUp ? 'Save & Schedule' : 'Save Contact'}
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default LogInteractionModal;
