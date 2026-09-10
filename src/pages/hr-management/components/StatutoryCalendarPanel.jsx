/**
 * STATUTORY CALENDAR PANEL
 *
 * The deadline side of payroll. The tab above it already says what the tenant
 * owes — this says when, and whether anyone has filed it.
 *
 * DESIGN RULES THIS PANEL FOLLOWS
 *
 *   Worst first. An overdue return is at the top in red, always. Sorting by
 *   date instead would bury a missed 9th under next month's upcoming ones,
 *   which is exactly the failure the panel exists to prevent.
 *
 *   No fabricated figures. A return whose amount this platform cannot state —
 *   VAT, whose position lives in the ledger — shows a dash and says where to
 *   look, never a zero. A zero reads as "nothing to pay".
 *
 *   "Filed" is a note, not a receipt. The confirmation, the button and the
 *   footnote all say the same thing: this system does not file anything and
 *   cannot confirm that any authority received a return.
 */

import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  RETURN_STATUS_META,
  RETURN_OVERDUE,
  RETURN_DUE_TODAY,
  RETURN_FILED,
} from '../../../config/statutoryReturns';

const fmt = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }) : '—';

// Tailwind cannot see a class name built at runtime, so every variant is
// written out. Keyed on the tone the status vocabulary declares, not on the
// status itself, so two statuses that should look alike cannot drift apart.
const TONE = {
  critical: {
    row: 'border-red-200 bg-red-50',
    chip: 'bg-red-100 text-red-700',
    text: 'text-red-600',
    accent: 'text-red-500',
  },
  warning: {
    row: 'border-amber-200 bg-amber-50',
    chip: 'bg-amber-100 text-amber-800',
    text: 'text-amber-700',
    accent: 'text-amber-600',
  },
  info: {
    row: 'border-border bg-card',
    chip: 'bg-blue-100 text-blue-700',
    text: 'text-foreground',
    accent: 'text-blue-600',
  },
  ok: {
    row: 'border-emerald-200 bg-emerald-50',
    chip: 'bg-emerald-100 text-emerald-700',
    text: 'text-emerald-700',
    accent: 'text-emerald-600',
  },
};

const toneOf = (status) => TONE[RETURN_STATUS_META[status]?.tone || 'info'];

/** "in 7 days" / "today" / "3 days late" — the only number most people read. */
const countdown = (entry) => {
  if (entry.status === RETURN_FILED) return 'Filed';
  if (entry.daysRemaining === null) return '—';
  if (entry.daysRemaining < 0) {
    return `${entry.daysOverdue} day${entry.daysOverdue === 1 ? '' : 's'} late`;
  }
  if (entry.daysRemaining === 0) return 'Today';
  return `in ${entry.daysRemaining} day${entry.daysRemaining === 1 ? '' : 's'}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// MARK-AS-FILED FORM
//
// Inline rather than a modal: recording a filing is a two-field job done right
// after filing on iTax, and a modal for it would be four extra clicks.
// ─────────────────────────────────────────────────────────────────────────────
const FileForm = ({ entry, onSave, onCancel, saving }) => {
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
            Acknowledgement / e-slip number
          </label>
          <input
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder={`From ${entry.portal}`}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
            Note (optional)
          </label>
          <input
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="e.g. filed by the external accountant"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSave({ reference, notes })}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            <Icon name="Check" size={14} color="currentColor" />
            {saving ? 'Saving…' : 'Record filing'}
          </button>
          <button
            onClick={onCancel}
            className="text-xs font-medium text-muted-foreground hover:text-foreground px-2"
          >
            Cancel
          </button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        This records that <strong>you</strong> filed the return. Ararat does not file on your
        behalf and cannot confirm that {entry.authority} received it.
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ONE RETURN
// ─────────────────────────────────────────────────────────────────────────────
const ReturnRow = ({ entry, onFile, onUnfile, saving }) => {
  const [filing, setFiling] = useState(false);
  const tone = toneOf(entry.status);
  const meta = RETURN_STATUS_META[entry.status] || RETURN_STATUS_META.upcoming;
  const urgent = entry.status === RETURN_OVERDUE || entry.status === RETURN_DUE_TODAY;

  return (
    <div className={`border rounded-xl p-4 ${tone.row}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[200px] flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon name={meta.icon} size={15} color="currentColor" className={tone.accent} />
            <p className="text-sm font-bold text-foreground">{entry.label}</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${tone.chip}`}>
              {meta.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {entry.period} · {entry.authority}
            {entry.portal ? ` · file on ${entry.portal}` : ''}
          </p>
        </div>

        {/* The amount. A return we cannot price says so — never a zero. */}
        <div className="text-right">
          <p className={`text-lg font-bold font-mono ${urgent ? tone.text : 'text-foreground'}`}>
            {entry.amount === null || entry.amount === undefined
              ? '—'
              : entry.amount < 0
                ? `${fmt(Math.abs(entry.amount))} cr`
                : fmt(entry.amount)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {entry.amount === null || entry.amount === undefined
              ? 'Figure is in the Finance Hub VAT panel'
              : entry.amountLabel}
          </p>
        </div>

        <div className="text-right min-w-[110px]">
          <p className={`text-sm font-bold ${tone.text}`}>{countdown(entry)}</p>
          <p className="text-[11px] text-muted-foreground">due {fmtDate(entry.dueDate)}</p>
        </div>

        <div className="flex items-center gap-2">
          {entry.status === RETURN_FILED ? (
            <button
              onClick={() => onUnfile(entry)}
              disabled={saving}
              className="text-xs font-medium text-muted-foreground hover:text-foreground underline disabled:opacity-50"
            >
              Undo
            </button>
          ) : (
            <button
              onClick={() => setFiling((v) => !v)}
              className="inline-flex items-center gap-2 bg-muted text-foreground px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted/70"
            >
              <Icon name="CheckCircle" size={13} color="currentColor" />
              Mark filed
            </button>
          )}
        </div>
      </div>

      {/* The statutory basis, and what it costs to miss it. Shown only where it
          matters — on an upcoming return it is noise; on an overdue one it is
          the reason to act today. */}
      {urgent && entry.penalty && (
        <p className="mt-3 text-[11px] text-red-700 leading-relaxed">
          <strong>If filed late:</strong> {entry.penalty}
        </p>
      )}

      {/* A deadline on a weekend or public holiday. The date is NOT moved — see
          dueDateFor() — so the panel explains rather than deciding. */}
      {entry.fallsOnNonWorkingDay && entry.status !== RETURN_FILED && (
        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
          <Icon name="Info" size={11} color="currentColor" className="inline mr-1 -mt-0.5" />
          The statutory deadline falls on a{' '}
          {entry.nonWorkingReason === 'weekend' ? 'weekend' : entry.nonWorkingReason}.
          {' '}{entry.authority} normally accepts filing on the next working day
          ({fmtDate(entry.nextWorkingDay)}), but that is practice rather than the rule.
        </p>
      )}

      {entry.status === RETURN_FILED && entry.filing?.reference && (
        <p className="mt-2 text-[11px] text-emerald-700">
          Recorded as filed — reference <strong>{entry.filing.reference}</strong>
          {entry.filing.filed_at ? ` on ${fmtDate(entry.filing.filed_at)}` : ''}
        </p>
      )}

      {filing && (
        <FileForm
          entry={entry}
          saving={saving}
          onCancel={() => setFiling(false)}
          onSave={async (values) => {
            const res = await onFile(entry, values);
            if (res?.ok) setFiling(false);
          }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// THE PANEL
// ─────────────────────────────────────────────────────────────────────────────
const StatutoryCalendarPanel = ({
  loading,
  error,
  saving,
  calendar = [],
  history = [],
  summary,
  settings,
  onFile,
  onUnfile,
  onSaveSettings,
}) => {
  const [showFiled, setShowFiled] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState(null);

  const handleFile = async (entry, values) => {
    const res = await onFile({
      returnKey: entry.returnKey,
      period: entry.period,
      dueDate: entry.dueDate,
      amount: entry.amount,
      ...values,
    });
    setNotice(res.ok
      ? { tone: 'ok', text: `${entry.label} for ${entry.period} recorded as filed.` }
      : { tone: 'error', text: res.error });
    return res;
  };

  const handleUnfile = async (entry) => {
    const res = await onUnfile({ returnKey: entry.returnKey, period: entry.period });
    setNotice(res.ok
      ? { tone: 'ok', text: `${entry.label} for ${entry.period} is outstanding again.` }
      : { tone: 'error', text: res.error });
  };

  const rows = showFiled ? history : calendar;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon name="CalendarClock" size={16} color="currentColor" className="text-primary" />
            <h3 className="text-sm font-bold text-foreground">Statutory return deadlines</h3>
            {summary?.actionable > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                {summary.actionable} need{summary.actionable === 1 ? 's' : ''} action
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            PAYE, NSSF and SHIF by the 9th · the housing levy by the 9th working day · VAT by the 20th
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFiled((v) => !v)}
            className="inline-flex items-center gap-2 bg-muted text-foreground px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted/70"
          >
            <Icon name={showFiled ? 'ListFilter' : 'History'} size={13} color="currentColor" />
            {showFiled ? 'Outstanding only' : 'Show filed'}
          </button>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="inline-flex items-center gap-2 bg-muted text-foreground px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted/70"
          >
            <Icon name="Settings" size={13} color="currentColor" />
            Reminders
          </button>
        </div>
      </div>

      {/* ── Reminder settings ─────────────────────────────────────────────── */}
      {showSettings && (
        <div className="border border-border rounded-xl p-4 bg-muted/30 space-y-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={settings?.enabled !== false}
              onChange={(e) => onSaveSettings({ enabled: e.target.checked })}
            />
            <span className="text-xs text-foreground">
              <strong>Email me before each deadline.</strong>
              <span className="block text-muted-foreground mt-0.5">
                Seven days, three days, one day and the morning it falls due — then daily for a
                fortnight if it is still outstanding. Returns you mark as filed stop reminding.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={!!settings?.vat_registered}
              onChange={(e) => onSaveSettings({ vat_registered: e.target.checked })}
            />
            <span className="text-xs text-foreground">
              <strong>This business is VAT-registered.</strong>
              <span className="block text-muted-foreground mt-0.5">
                A registered business owes a VAT3 every month, including a NIL return in a month it
                sold nothing. Without this, VAT deadlines appear only in months where VAT was
                actually posted to the ledger.
              </span>
            </span>
          </label>
        </div>
      )}

      {/* ── Notices ───────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">
          <Icon name="AlertTriangle" size={15} color="currentColor" className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {notice && (
        <div className={`flex items-start gap-3 p-3 rounded-xl border text-xs ${
          notice.tone === 'error'
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
        }`}>
          <Icon
            name={notice.tone === 'ok' ? 'CheckCircle' : 'AlertTriangle'}
            size={15} color="currentColor" className="mt-0.5 shrink-0"
          />
          <p className="flex-1">{notice.text}</p>
          <button onClick={() => setNotice(null)} className="shrink-0 opacity-60 hover:opacity-100">
            <Icon name="X" size={14} color="currentColor" />
          </button>
        </div>
      )}

      {/* ── The list ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2">
          {Array(3).fill(0).map((_, i) => (
            <div key={i} className="animate-pulse bg-muted rounded-xl h-20" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8">
          <Icon name="CheckCircle" size={28} color="currentColor" className="text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">Nothing outstanding</p>
          <p className="text-xs text-muted-foreground mt-1">
            {/* Careful wording. "Nothing due" would be a claim about the tenant's
                whole tax position; this panel only knows about the payroll and
                ledger activity recorded here. */}
            No statutory return is outstanding for the payroll and VAT activity recorded in Ararat.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((entry) => (
            <ReturnRow
              key={entry.key}
              entry={entry}
              saving={saving}
              onFile={handleFile}
              onUnfile={handleUnfile}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
        Figures are taken from the payroll runs recorded here — NSSF and the housing levy include
        the employer's matching half. Ararat does not file returns and cannot confirm that any
        authority has received one; check every figure against your books before filing.
      </p>
    </div>
  );
};

export default StatutoryCalendarPanel;
