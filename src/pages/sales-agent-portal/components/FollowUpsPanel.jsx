import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { channelMeta } from '../../../config/crmVocabulary';

// Tailwind cannot see class names built at runtime, so every tone a channel can
// carry is spelled out here where the scanner finds it. Same map as
// InteractionTimeline, so a logged email and a scheduled one look alike.
const TONE = {
  blue:    'bg-blue-500/10 text-blue-600',
  emerald: 'bg-emerald-500/10 text-emerald-600',
  violet:  'bg-violet-500/10 text-violet-600',
  amber:   'bg-amber-500/10 text-amber-600',
  orange:  'bg-orange-500/10 text-orange-600',
  indigo:  'bg-indigo-500/10 text-indigo-600',
  slate:   'bg-slate-500/10 text-slate-600',
};

const fmtWhen = (d) =>
  new Date(d).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

// "3 days ago" / "in 2 hours" — the phrasing an agent actually scans for.
const relative = (d) => {
  const diffMs  = new Date(d) - Date.now();
  const past    = diffMs < 0;
  const mins    = Math.round(Math.abs(diffMs) / 60000);
  const hours   = Math.round(mins / 60);
  const days    = Math.round(hours / 24);
  const amount  = mins < 60 ? `${mins}m` : hours < 24 ? `${hours}h` : `${days}d`;
  return past ? `${amount} overdue` : `in ${amount}`;
};

// ── Mark-done inline form ────────────────────────────────────────────────────
const CompleteForm = ({ onConfirm, onCancel }) => {
  const [outcome, setOutcome] = useState('');
  const [saving, setSaving]   = useState(false);

  const confirm = async () => {
    setSaving(true);
    try { await onConfirm(outcome.trim()); } finally { setSaving(false); }
  };

  return (
    <div className="mt-2.5 pt-2.5 border-t border-border/60 space-y-2">
      <input
        type="text"
        autoFocus
        value={outcome}
        onChange={e => setOutcome(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onCancel(); }}
        placeholder="How did it go? e.g. Wants to proceed — send contract"
        className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="flex gap-2">
        <button
          onClick={confirm}
          disabled={saving}
          className="flex-1 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-60 transition-colors"
        >
          {saving ? 'Saving...' : 'Mark Done'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// ── One appointment row ──────────────────────────────────────────────────────
const FollowUpRow = ({ appt, isOverdue, onComplete, onSnooze, onCancel }) => {
  const [mode, setMode] = useState(null); // 'complete' | null
  const [busy, setBusy] = useState(false);
  const channel = channelMeta(appt.appointment_type);
  const dt      = new Date(appt.scheduled_at);

  const snooze = async (days) => {
    setBusy(true);
    try {
      const next = new Date(appt.scheduled_at);
      // Snoozing an already-missed appointment from its original date would
      // land in the past again — push from now instead.
      const base = next < new Date() ? new Date() : next;
      base.setDate(base.getDate() + days);
      await onSnooze(appt.id, base);
    } finally { setBusy(false); }
  };

  return (
    <div className={`p-3 rounded-xl border transition-colors ${
      isOverdue
        ? 'bg-red-50/60 border-red-200 hover:bg-red-50'
        : 'bg-muted/30 border-transparent hover:bg-muted/50'
    }`}>
      <div className="flex items-start gap-3">
        {/* Date block */}
        <div className="flex-shrink-0 w-11 text-center">
          <p className="text-xs font-bold text-muted-foreground uppercase">
            {dt.toLocaleDateString('en-GB', { month: 'short' })}
          </p>
          <p className={`text-lg font-bold leading-none ${isOverdue ? 'text-red-600' : 'text-primary'}`}>
            {dt.getDate()}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-foreground truncate">
              {appt.lead_name || 'Unknown lead'}
            </p>
            <span className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${TONE[channel.tone] || TONE.slate}`}>
              <Icon name={channel.icon} size={10} color="currentColor" />
              {channel.label}
            </span>
          </div>

          <p className={`text-xs font-medium mt-0.5 ${isOverdue ? 'text-red-600' : 'text-muted-foreground'}`}>
            {fmtWhen(appt.scheduled_at)} · {relative(appt.scheduled_at)}
          </p>

          {appt.location && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5 truncate">
              <Icon name="MapPin" size={11} color="currentColor" />
              {appt.location}
            </p>
          )}
          {appt.notes && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{appt.notes}</p>
          )}

          {mode === 'complete' ? (
            <CompleteForm
              onConfirm={async (outcome) => { await onComplete(appt.id, outcome); setMode(null); }}
              onCancel={() => setMode(null)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <button
                onClick={() => setMode('complete')}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                <Icon name="Check" size={11} color="white" /> Done
              </button>
              <button
                onClick={() => snooze(1)}
                disabled={busy}
                className="px-2 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
              >
                +1 day
              </button>
              <button
                onClick={() => snooze(7)}
                disabled={busy}
                className="px-2 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
              >
                +1 week
              </button>
              <button
                onClick={() => onCancel(appt.id)}
                disabled={busy}
                className="ml-auto p-1 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                title="Delete this appointment"
              >
                <Icon name="Trash2" size={12} color="currentColor" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Section wrapper ──────────────────────────────────────────────────────────
const Section = ({ title, count, tone, children }) => {
  if (!count) return null;
  const toneCls = {
    danger: 'text-red-600',
    warn:   'text-amber-600',
    normal: 'text-muted-foreground',
  }[tone] || 'text-muted-foreground';

  return (
    <div className="space-y-2">
      <p className={`text-xs font-bold uppercase tracking-wide ${toneCls}`}>
        {title} · {count}
      </p>
      {children}
    </div>
  );
};

// ── Panel ────────────────────────────────────────────────────────────────────
const FollowUpsPanel = ({
  buckets, completedFollowUps = [], loading,
  onSchedule, onComplete, onSnooze, onCancel,
}) => {
  const [tab, setTab] = useState('open');            // 'open' | 'done'
  const [channelFilter, setChannelFilter] = useState('all');
  const { overdue = [], today = [], thisWeek = [], later = [] } = buckets || {};
  const openCount = overdue.length + today.length + thisWeek.length + later.length;

  // Which channels the open diary actually contains, with counts. Derived from
  // the rows rather than from the vocabulary, so the filter never offers
  // "Email" when there are no emails to write — an empty chip is a dead end.
  const channelCounts = useMemo(() => {
    const counts = new Map();
    for (const a of [...overdue, ...today, ...thisWeek, ...later]) {
      const meta = channelMeta(a.appointment_type);
      const seen = counts.get(meta.value);
      counts.set(meta.value, { ...meta, count: (seen?.count || 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [overdue, today, thisWeek, later]);

  // "Show me just the emails I owe." Work batches by channel — an afternoon of
  // calls is a different sitting from an afternoon of writing — so the diary
  // has to be sliceable that way.
  const onChannel = (a) =>
    channelFilter === 'all' || channelMeta(a.appointment_type).value === channelFilter;

  const shown = {
    overdue:  overdue.filter(onChannel),
    today:    today.filter(onChannel),
    thisWeek: thisWeek.filter(onChannel),
    later:    later.filter(onChannel),
  };
  const shownCount =
    shown.overdue.length + shown.today.length + shown.thisWeek.length + shown.later.length;

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="h-5 bg-muted rounded w-52 mb-4 animate-pulse" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex gap-3 mb-3 animate-pulse">
            <div className="w-11 h-12 rounded-lg bg-muted flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-muted rounded w-2/3" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Icon name="CalendarClock" size={18} color="var(--color-primary)" />
          <div>
            <h3 className="font-heading font-semibold text-base text-foreground">Follow-ups & Appointments</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {overdue.length > 0
                ? `${overdue.length} overdue · ${today.length} due today`
                : today.length > 0
                ? `${today.length} due today`
                : 'Nothing needs your attention right now'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-border overflow-hidden">
            {[
              { key: 'open', label: `Open${openCount ? ` (${openCount})` : ''}` },
              { key: 'done', label: 'Completed' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === t.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={onSchedule}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            <Icon name="CalendarPlus" size={13} color="white" />
            Schedule
          </button>
        </div>
      </div>

      {/* Channel filter — only earns its space once the diary is mixed */}
      {tab === 'open' && channelCounts.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 pb-3 border-b border-border/60">
          <button
            onClick={() => setChannelFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
              channelFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            All {openCount}
          </button>
          {channelCounts.map(c => (
            <button
              key={c.value}
              onClick={() => setChannelFilter(channelFilter === c.value ? 'all' : c.value)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                channelFilter === c.value
                  ? 'bg-primary text-primary-foreground'
                  : `${TONE[c.tone] || TONE.slate} hover:opacity-80`
              }`}
            >
              <Icon name={c.icon} size={11} color="currentColor" />
              {c.label} {c.count}
            </button>
          ))}
        </div>
      )}

      {/* Open */}
      {tab === 'open' && (
        openCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Icon name="CalendarCheck" size={30} color="var(--color-muted-foreground)" />
            <p className="text-sm font-medium text-muted-foreground mt-2">No follow-ups scheduled</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5 max-w-xs">
              When a lead says "check me next week", schedule it here — by call, email,
              WhatsApp or a visit — and you'll be reminded in the portal and by email.
            </p>
            <button onClick={onSchedule} className="mt-3 text-xs text-primary hover:underline font-semibold">
              Schedule a follow-up →
            </button>
          </div>
        ) : shownCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Icon name="Filter" size={26} color="var(--color-muted-foreground)" />
            <p className="text-sm text-muted-foreground mt-2">
              Nothing open on {channelMeta(channelFilter).label.toLowerCase()}
            </p>
            <button
              onClick={() => setChannelFilter('all')}
              className="mt-2 text-xs text-primary hover:underline font-semibold"
            >
              Show all {openCount}
            </button>
          </div>
        ) : (
          <div className="space-y-4 max-h-[460px] overflow-y-auto scrollbar-custom pr-1">
            <Section title="Overdue" count={shown.overdue.length} tone="danger">
              <div className="space-y-2">
                {shown.overdue.map(a => (
                  <FollowUpRow key={a.id} appt={a} isOverdue onComplete={onComplete} onSnooze={onSnooze} onCancel={onCancel} />
                ))}
              </div>
            </Section>
            <Section title="Today" count={shown.today.length} tone="warn">
              <div className="space-y-2">
                {shown.today.map(a => (
                  <FollowUpRow key={a.id} appt={a} onComplete={onComplete} onSnooze={onSnooze} onCancel={onCancel} />
                ))}
              </div>
            </Section>
            <Section title="This week" count={shown.thisWeek.length} tone="normal">
              <div className="space-y-2">
                {shown.thisWeek.map(a => (
                  <FollowUpRow key={a.id} appt={a} onComplete={onComplete} onSnooze={onSnooze} onCancel={onCancel} />
                ))}
              </div>
            </Section>
            <Section title="Later" count={shown.later.length} tone="normal">
              <div className="space-y-2">
                {shown.later.map(a => (
                  <FollowUpRow key={a.id} appt={a} onComplete={onComplete} onSnooze={onSnooze} onCancel={onCancel} />
                ))}
              </div>
            </Section>
          </div>
        )
      )}

      {/* Completed */}
      {tab === 'done' && (
        completedFollowUps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Icon name="History" size={28} color="var(--color-muted-foreground)" />
            <p className="text-sm text-muted-foreground mt-2">No completed follow-ups yet</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[460px] overflow-y-auto scrollbar-custom pr-1">
            {completedFollowUps.map(a => (
              <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl bg-muted/20">
                <div className="w-7 h-7 flex-shrink-0 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Icon name="Check" size={13} color="#059669" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{a.lead_name || 'Unknown lead'}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtWhen(a.scheduled_at)} · {channelMeta(a.appointment_type).label}
                  </p>
                  {a.outcome && (
                    <p className="text-xs text-foreground mt-1 bg-muted rounded-lg px-2 py-1">{a.outcome}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default FollowUpsPanel;
