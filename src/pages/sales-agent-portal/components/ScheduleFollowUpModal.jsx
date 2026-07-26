import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';

// ── Input class helper (matches CreateClientModal) ──────────────────────────
const ic = (err) =>
  `w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-background text-foreground transition-colors ${
    err ? 'border-red-400 bg-red-50' : 'border-border'
  }`;

const APPOINTMENT_TYPES = [
  { value: 'follow_up',      label: 'Follow-up',      icon: 'PhoneCall',  hint: 'Check back in' },
  { value: 'phone_call',     label: 'Phone Call',     icon: 'Phone',      hint: 'Scheduled call' },
  { value: 'office_meeting', label: 'Office Meeting', icon: 'Briefcase',  hint: 'They come in' },
  { value: 'site_visit',     label: 'Site Visit',     icon: 'MapPin',     hint: 'You go to them' },
];

// "Check me next week" shortcuts — the whole point of the segment.
const QUICK_WHEN = [
  { label: 'Tomorrow',   days: 1 },
  { label: 'In 3 days',  days: 3 },
  { label: 'Next week',  days: 7 },
  { label: 'In 2 weeks', days: 14 },
  { label: 'Next month', days: 30 },
];

const REMINDER_OFFSETS = [
  { label: '1 hour before',  minutes: 60 },
  { label: '3 hours before', minutes: 180 },
  { label: 'Morning of (8am)', minutes: 'morning' },
  { label: 'A day before',   minutes: 1440 },
];

// <input type="datetime-local"> wants local wall-clock time, not an ISO string.
const toLocalInput = (date) => {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const ScheduleFollowUpModal = ({ isOpen, onClose, onSubmit, leads = [], prefillLead = null }) => {
  const defaultWhen = useMemo(() => {
    // Default to a week out at 10:00 — the most common "check me next week".
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(10, 0, 0, 0);
    return toLocalInput(d);
  }, []);

  const [form, setForm] = useState({
    leadId:          prefillLead?.id || '',
    leadName:        prefillLead?.full_name || '',
    appointmentType: 'follow_up',
    scheduledAt:     defaultWhen,
    reminderOffset:  60,
    location:        '',
    notes:           '',
  });
  const [errors, setErrors]   = useState({});
  const [saving, setSaving]   = useState(false);
  const [apiError, setApiError] = useState('');

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    setErrors(p => ({ ...p, [k]: '' }));
    setApiError('');
  };

  const openLeads = (leads || []).filter(l => l.stage !== 'closed');

  const handleLeadPick = (leadId) => {
    const lead = (leads || []).find(l => l.id === leadId);
    setForm(p => ({ ...p, leadId, leadName: lead?.full_name || p.leadName }));
    setErrors(p => ({ ...p, leadId: '' }));
  };

  const applyQuick = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(10, 0, 0, 0);
    set('scheduledAt', toLocalInput(d));
  };

  // Turn the chosen offset into an absolute reminder time.
  const computeRemindAt = () => {
    if (!form.scheduledAt) return null;
    const appt = new Date(form.scheduledAt);
    if (form.reminderOffset === 'morning') {
      const m = new Date(appt);
      m.setHours(8, 0, 0, 0);
      // An 8am appointment would otherwise "remind" after the fact.
      return m < appt ? m : new Date(appt.getTime() - 60 * 60 * 1000);
    }
    return new Date(appt.getTime() - Number(form.reminderOffset) * 60 * 1000);
  };

  const validate = () => {
    const e = {};
    if (!form.leadName.trim()) e.leadName = 'Choose a lead or type who this is with';
    if (!form.scheduledAt)     e.scheduledAt = 'Pick a date and time';
    else if (new Date(form.scheduledAt) < new Date()) e.scheduledAt = 'That time has already passed';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    setApiError('');
    try {
      await onSubmit({
        leadId:          form.leadId || null,
        leadName:        form.leadName.trim(),
        appointmentType: form.appointmentType,
        scheduledAt:     form.scheduledAt,
        remindAt:        computeRemindAt(),
        location:        form.location.trim(),
        notes:           form.notes.trim(),
      });
      onClose();
    } catch (err) {
      setApiError(err?.message || 'Could not save the appointment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const remindAt = computeRemindAt();

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="CalendarPlus" size={18} color="var(--color-primary)" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Schedule Follow-up</h2>
              <p className="text-xs text-muted-foreground">You'll get a portal alert and an email reminder</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Who */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Lead</label>
            {openLeads.length > 0 ? (
              <select
                value={form.leadId}
                onChange={e => handleLeadPick(e.target.value)}
                className={ic(errors.leadName)}
              >
                <option value="">— Select a lead —</option>
                {openLeads.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.full_name}{l.phone ? ` · ${l.phone}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.leadName}
                onChange={e => set('leadName', e.target.value)}
                placeholder="Who is this follow-up with?"
                className={ic(errors.leadName)}
              />
            )}
            {errors.leadName && <p className="mt-1 text-xs text-red-500">{errors.leadName}</p>}
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {APPOINTMENT_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set('appointmentType', t.value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    form.appointmentType === t.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  <Icon name={t.icon} size={14} color="currentColor" />
                  <span className="text-left leading-tight">
                    {t.label}
                    <span className="block text-xs opacity-60 font-normal">{t.hint}</span>
                  </span>
                </button>
              ))}
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
                  onClick={() => applyQuick(q.days)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <input
              type="datetime-local"
              value={form.scheduledAt}
              onChange={e => set('scheduledAt', e.target.value)}
              className={ic(errors.scheduledAt)}
            />
            {errors.scheduledAt && <p className="mt-1 text-xs text-red-500">{errors.scheduledAt}</p>}
          </div>

          {/* Reminder */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Remind me</label>
            <div className="flex flex-wrap gap-2">
              {REMINDER_OFFSETS.map(r => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => set('reminderOffset', r.minutes)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    form.reminderOffset === r.minutes
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {remindAt && (
              <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                <Icon name="Mail" size={12} color="currentColor" />
                Email reminder on {remindAt.toLocaleString('en-GB', {
                  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            )}
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              Location <span className="text-muted-foreground/60 font-normal normal-case">(optional)</span>
            </label>
            <input
              type="text"
              value={form.location}
              onChange={e => set('location', e.target.value)}
              placeholder="e.g. Their office, Westlands · or 'Phone'"
              className={ic(false)}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              What to discuss <span className="text-muted-foreground/60 font-normal normal-case">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="e.g. Said to check back after payday — wants the 3-bedroom unit"
              className={`${ic(false)} resize-none`}
            />
          </div>

          {apiError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-center gap-2">
              <Icon name="AlertCircle" size={14} color="#dc2626" />
              {apiError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-5 py-2.5 border border-border text-muted-foreground text-sm font-medium rounded-xl hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {saving ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Scheduling...
              </>
            ) : (
              <><Icon name="CalendarPlus" size={15} color="currentColor" /> Schedule Follow-up</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default ScheduleFollowUpModal;
