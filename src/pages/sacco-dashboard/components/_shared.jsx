/**
 * Shared UI primitives for the Sacco dashboard tabs. Uses the app's semantic
 * Tailwind tokens (bg-card, text-foreground, text-primary, …) so it tracks the
 * theme, matching the admin dashboard's look.
 */
import React from 'react';
import Icon from '../../../components/AppIcon';

export const KES = (n) =>
  'KES ' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

// Date + time, for scheduled voting windows.
export const fmtDateTime = (d) => (d
  ? new Date(d).toLocaleString('en-KE', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');

// <input type="datetime-local"> works in LOCAL time with no zone; these convert
// to/from the ISO (UTC) strings the RPCs expect.
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (local) => {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// Live "closes in 2d 4h" counter. Ticks every second; renders `endedLabel` once
// the target passes. Display only — the DB is what actually enforces deadlines.
export const Countdown = ({ targetIso, prefix = '', endedLabel = 'ended', className = '' }) => {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!targetIso) return null;
  const ms = new Date(targetIso).getTime() - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return <span className={className}>{endedLabel}</span>;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  return <span className={className}>{prefix}{text}</span>;
};

// A small amber/emerald pill wrapping a Countdown, for prominent placement.
export const CountdownPill = ({ targetIso, label = 'Closes in', endedLabel = 'Closed' }) => {
  if (!targetIso) return null;
  const ended = new Date(targetIso).getTime() - Date.now() <= 0;
  const cls = ended ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      <Icon name={ended ? 'TimerOff' : 'Timer'} size={12} color="currentColor" />
      {ended ? endedLabel : <Countdown targetIso={targetIso} prefix={`${label} `} endedLabel={endedLabel} />}
    </span>
  );
};

export const DateTimeInput = (props) => (
  <input type="datetime-local" className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary" {...props} />
);

// ── Card wrapper ────────────────────────────────────────────────────────────
export const Card = ({ title, subtitle, actions, children, className = '' }) => (
  <div className={`bg-card border border-border rounded-xl ${className}`}>
    {(title || actions) && (
      <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
        <div>
          {title && <h3 className="font-semibold text-foreground">{title}</h3>}
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
    )}
    <div className="p-4">{children}</div>
  </div>
);

// ── Stat card ───────────────────────────────────────────────────────────────
export const StatCard = ({ label, value, icon, hint, tone = 'primary' }) => {
  const toneBg = {
    primary: 'rgba(52,193,221,0.12)', success: 'rgba(16,185,129,0.12)',
    warning: 'rgba(234,179,8,0.12)', muted: 'rgba(100,116,139,0.12)',
  }[tone] || 'rgba(52,193,221,0.12)';
  const toneColor = {
    primary: '#1da8c5', success: '#059669', warning: '#ca8a04', muted: '#64748b',
  }[tone] || '#1da8c5';
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon && (
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: toneBg }}>
            <Icon name={icon} size={17} color={toneColor} />
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-foreground mt-2">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
};

// ── Status badge ─────────────────────────────────────────────────────────────
const BADGE_TONES = {
  active: 'bg-emerald-100 text-emerald-700', paid: 'bg-emerald-100 text-emerald-700',
  approved: 'bg-emerald-100 text-emerald-700', settled: 'bg-emerald-100 text-emerald-700',
  passed: 'bg-emerald-100 text-emerald-700', closed: 'bg-slate-100 text-slate-600',
  inactive: 'bg-slate-100 text-slate-600', pending: 'bg-amber-100 text-amber-700',
  pending_approval: 'bg-amber-100 text-amber-700', overdue: 'bg-red-100 text-red-700',
  suspended: 'bg-red-100 text-red-700', rejected: 'bg-red-100 text-red-700',
  open: 'bg-sky-100 text-sky-700', proposed: 'bg-sky-100 text-sky-700',
  seconded: 'bg-indigo-100 text-indigo-700', draft: 'bg-slate-100 text-slate-600',
  nominations_open: 'bg-sky-100 text-sky-700', nominations_closed: 'bg-indigo-100 text-indigo-700',
  voting_open: 'bg-emerald-100 text-emerald-700', voting_closed: 'bg-amber-100 text-amber-700',
  results_published: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700',
  withdrawn: 'bg-slate-100 text-slate-600',
};
export const Badge = ({ status }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${BADGE_TONES[status] || 'bg-slate-100 text-slate-600'}`}>
    {String(status || '').replace(/_/g, ' ')}
  </span>
);

// ── Buttons ──────────────────────────────────────────────────────────────────
export const PrimaryButton = ({ icon, children, className = '', ...props }) => (
  <button
    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60 ${className}`}
    style={{ background: 'linear-gradient(135deg, #34c1dd, #1da8c5)' }}
    {...props}
  >
    {icon && <Icon name={icon} size={15} color="currentColor" />}
    {children}
  </button>
);

export const GhostButton = ({ icon, children, className = '', ...props }) => (
  <button
    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all ${className}`}
    {...props}
  >
    {icon && <Icon name={icon} size={15} color="currentColor" />}
    {children}
  </button>
);

// ── Modal ────────────────────────────────────────────────────────────────────
export const Modal = ({ open, onClose, title, children, footer, wide = false }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className={`bg-card border border-border rounded-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-hidden flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><Icon name="X" size={18} color="currentColor" /></button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 p-4 border-t border-border">{footer}</div>}
      </div>
    </div>
  );
};

// ── Form fields ──────────────────────────────────────────────────────────────
export const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-xs font-semibold mb-1.5 text-foreground">{label}</span>
    {children}
  </label>
);

const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary';

export const TextInput = (props) => <input className={inputCls} {...props} />;
export const NumberInput = (props) => <input type="number" className={inputCls} {...props} />;
export const Select = ({ children, ...props }) => <select className={inputCls} {...props}>{children}</select>;

// ── Empty state ──────────────────────────────────────────────────────────────
export const EmptyState = ({ icon = 'Inbox', title, hint }) => (
  <div className="text-center py-10">
    <div className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center" style={{ background: 'rgba(52,193,221,0.1)' }}>
      <Icon name={icon} size={22} color="#1da8c5" />
    </div>
    <p className="text-sm font-semibold text-foreground mt-3">{title}</p>
    {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
  </div>
);

// ── Simple table ─────────────────────────────────────────────────────────────
export const Table = ({ columns, children }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground border-b border-border">
          {columns.map((c) => <th key={c} className="py-2 pr-4 font-medium whitespace-nowrap">{c}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
