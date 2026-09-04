import React, { useState } from 'react';
import Icon from '../AppIcon';
import { Sk, Empty, fmtWhen, fmtDue, ChannelBadge, AuthorBadge } from './crmFormat';
import { INTERACTION_OUTCOMES } from '../../hooks/useCrmInteractions';

/**
 * The administrator's diary: everything the office has promised to do.
 *
 * Ordered by urgency rather than by date, because the two are not the same:
 * the appointment that is four days late outranks the one at four o'clock, and
 * a diary sorted purely chronologically buries the failures at the top where
 * they get scrolled past.
 *
 * The tenant's own appointments are actionable; an agent's are shown for
 * context and are read-only, because the write policies accept nothing else.
 * A "mark done" button on an agent's appointment would fail every time.
 */

// <input type="datetime-local"> wants local wall-clock time, not an ISO string.
const toLocalInput = (date) => {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const BUCKETS = [
  { key: 'overdue',  label: 'Overdue',    icon: 'AlertTriangle', tone: 'bad',
    empty: 'Nothing is late. That is the whole point of the screen.' },
  { key: 'today',    label: 'Today',      icon: 'Sun',           tone: 'warn',
    empty: 'Nothing booked for the rest of today.' },
  { key: 'thisWeek', label: 'This week',  icon: 'CalendarDays',  tone: 'default',
    empty: 'Nothing else booked this week.' },
  { key: 'later',    label: 'Later',      icon: 'CalendarRange', tone: 'default',
    empty: 'Nothing booked beyond this week.' },
];

const TONE_HEAD = {
  bad:     'text-red-600',
  warn:    'text-amber-600',
  default: 'text-foreground',
};

/**
 * One appointment, with the two things you ever do to it: close it off, or
 * move it. Exported because the client record shows the same rows and the same
 * buttons, and a second copy there would be a second place for "mark done" to
 * drift out of step with what the write policies actually accept.
 *
 * An agent's appointment and a completed one are both read-only: the first
 * because the policies reject it, the second because it is finished.
 */
export const DiaryRow = ({ f, name, onComplete, onReschedule, onDelete }) => {
  const canEdit  = !f.agent_id && !f.is_completed;
  const overdue  = !f.is_completed && new Date(f.scheduled_at).getTime() < Date.now();
  const [mode, setMode] = useState(null);           // 'done' | 'move' | null
  const [when, setWhen] = useState(() => toLocalInput(f.scheduled_at || Date.now()));
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  const run = async (fn) => {
    setBusy(true);
    setErr('');
    const res = await fn();
    if (res?.error) { setErr(res.error); setBusy(false); return; }
    setBusy(false);
    setMode(null);
  };

  return (
    <div className={`p-3 rounded-xl border ${overdue ? 'border-red-200 bg-red-50/40' : 'border-border bg-card'}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <Icon
            name={overdue ? 'AlertTriangle' : 'CalendarClock'}
            size={16}
            color={overdue ? '#DC2626' : 'var(--color-muted-foreground)'}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">
              {name || f.lead_name || 'Unnamed contact'}
            </span>
            <ChannelBadge value={f.appointment_type} />
            <AuthorBadge row={f} />
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs flex-wrap">
            <span className="text-muted-foreground">{fmtWhen(f.scheduled_at)}</span>
            <span className={overdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
              · {fmtDue(f.scheduled_at)}
            </span>
            {f.location && <span className="text-muted-foreground">· {f.location}</span>}
          </div>
          {f.notes && <p className="text-xs text-foreground mt-1.5">{f.notes}</p>}
          {err && <p className="text-xs text-red-600 mt-1.5">{err}</p>}
        </div>

        {canEdit && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setMode(mode === 'done' ? null : 'done')}
              title="Mark done"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
            >
              <Icon name="Check" size={15} color="currentColor" />
            </button>
            <button
              onClick={() => setMode(mode === 'move' ? null : 'move')}
              title="Reschedule"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Icon name="CalendarClock" size={15} color="currentColor" />
            </button>
            <button
              onClick={() => run(() => onDelete(f.id))}
              title="Remove"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <Icon name="Trash2" size={15} color="currentColor" />
            </button>
          </div>
        )}
      </div>

      {/* Closing it off. The outcome is optional: forcing a label on every tick
          is how a diary stops getting ticked. */}
      {mode === 'done' && (
        <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2">
          <select
            value={outcome}
            onChange={e => setOutcome(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground"
          >
            <option value="">How did it go? (optional)</option>
            {INTERACTION_OUTCOMES.map(o => <option key={o.value} value={o.label}>{o.label}</option>)}
          </select>
          <button
            onClick={() => run(() => onComplete(f.id, outcome))}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Mark done'}
          </button>
          <button onClick={() => setMode(null)} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      )}

      {mode === 'move' && (
        <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={when}
            onChange={e => setWhen(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground"
          />
          <button
            onClick={() => run(() => onReschedule(f.id, new Date(when).toISOString()))}
            disabled={busy || !when}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            {busy ? 'Moving…' : 'Move it'}
          </button>
          <button onClick={() => setMode(null)} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <span className="text-[11px] text-muted-foreground">Moving it re-arms the reminder.</span>
        </div>
      )}
    </div>
  );
};

const FollowUpDiaryPanel = ({
  diary, teamDiary, loading, nameFor,
  onComplete, onReschedule, onDelete, onSchedule,
}) => {
  // The office's own diary is the default: it is the only half that can be
  // acted on. The team view is one click away for "who is seeing this customer
  // this week", which is a supervision question rather than a to-do list.
  const [scope, setScope] = useState('own');
  const active = scope === 'own' ? diary : teamDiary;

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Sk key={i} className="h-24" />)}</div>;
  }

  const nothingAtAll = active.open === 0 && active.completed.length === 0;

  return (
    <div className="space-y-4">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex rounded-xl border border-border overflow-hidden">
          {[
            { value: 'own',  label: 'The office', hint: 'Yours to action' },
            { value: 'team', label: 'Everyone',   hint: 'Agents included' },
          ].map(s => (
            <button
              key={s.value}
              onClick={() => setScope(s.value)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                scope === s.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {active.open} open
            {active.completionRate !== null && ` · ${active.completionRate}% of everything booked was completed`}
          </span>
          <button
            onClick={() => onSchedule(null)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            <Icon name="CalendarPlus" size={14} color="#fff" />
            Schedule
          </button>
        </div>
      </div>

      {nothingAtAll ? (
        <div className="bg-card border border-border rounded-xl">
          <Empty
            icon="CalendarClock"
            title={scope === 'own' ? 'The office diary is empty' : 'Nobody has anything booked'}
            hint="Follow-ups booked here become reminders — the worker emails whoever owns the appointment before it is due."
          />
        </div>
      ) : (
        BUCKETS.map((b) => {
          const rows = active[b.key];
          if (!rows.length) return null;
          return (
            <div key={b.key} className="space-y-2">
              <div className="flex items-center gap-2">
                <Icon name={b.icon} size={14} color="currentColor" className={TONE_HEAD[b.tone]} />
                <h4 className={`text-xs font-semibold uppercase tracking-wide ${TONE_HEAD[b.tone]}`}>
                  {b.label}
                </h4>
                <span className="text-xs text-muted-foreground">({rows.length})</span>
              </div>
              {rows.map(f => (
                <DiaryRow
                  key={f.id}
                  f={f}
                  name={nameFor(f)}
                  onComplete={onComplete}
                  onReschedule={onReschedule}
                  onDelete={onDelete}
                />
              ))}
            </div>
          );
        })
      )}

      {active.completed.length > 0 && (
        <details className="bg-card border border-border rounded-xl">
          <summary className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer">
            Recently completed ({active.completed.length})
          </summary>
          <div className="px-4 pb-4 space-y-2">
            {active.completed.slice(0, 25).map(f => (
              <div key={f.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border last:border-0">
                <Icon name="CheckCircle2" size={14} color="#059669" />
                <span className="font-medium text-foreground truncate">{nameFor(f) || f.lead_name || '—'}</span>
                <ChannelBadge value={f.appointment_type} />
                <span className="text-muted-foreground ml-auto">{fmtWhen(f.completed_at || f.scheduled_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

export default FollowUpDiaryPanel;
