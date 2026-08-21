import React, { useState, useMemo } from 'react';
import Icon from '../AppIcon';
import { useStaffActivity, actionMeta, IDLE_DAYS } from '../../hooks/useStaffActivity';

/**
 * Staff Activity — a report inside the Reports hub, for admins and super admins.
 *
 * The sales CRM answers "who is talking to customers". This answers the other
 * half of the same question: who is using the system at all, what are they
 * touching, and who has gone silent. Both dashboards get it; each sees its own
 * people, the same rule the CRM follows.
 *
 * Read-only, and derived entirely from audit_logs — nothing new is recorded.
 */

const TONE_BG = {
  emerald: 'bg-emerald-100 text-emerald-700',
  blue:    'bg-blue-100 text-blue-700',
  red:     'bg-red-100 text-red-700',
  violet:  'bg-violet-100 text-violet-700',
  slate:   'bg-slate-100 text-slate-700',
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const initials = (name) =>
  (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();

const prettyTable = (t) => (t || '').replace(/_/g, ' ');

const Kpi = ({ label, value, subtitle, icon, tone = 'text-foreground', iconColor = 'var(--color-muted-foreground)' }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="flex items-center gap-2 mb-1">
      <Icon name={icon} size={15} color={iconColor} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
    <p className={`text-2xl font-bold ${tone}`}>{value}</p>
    {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
  </div>
);

const StaffActivityReport = ({ from = null, to = null, onExport }) => {
  const { canView, cards, totals, logs, loading, error, refetch } = useStaffActivity({ from, to });
  const [openStaff, setOpenStaff] = useState(null);

  const openCard = useMemo(
    () => cards.find(c => c.userId === openStaff) || null,
    [cards, openStaff],
  );
  const openLogs = useMemo(
    () => (openStaff ? logs.filter(l => l.user_id === openStaff) : []),
    [logs, openStaff],
  );

  const mismatched = useMemo(() => cards.filter(c => c.ownershipMismatch), [cards]);

  const handleExport = () => {
    onExport?.(
      cards.map(c => ({
        staff:          c.name,
        email:          c.email || '',
        role:           c.role || '',
        account_active: c.isActive ? 'yes' : 'no',
        total_actions:  c.activityVisible ? c.actions : 'not visible',
        created:        c.creates,
        updated:        c.updates,
        deleted:        c.deletes,
        sign_ins:       c.logins,
        active_days:    c.activeDays,
        works_on:       c.topArea ? prettyTable(c.topArea.table) : '',
        last_active:    c.lastActiveAt ? fmtDate(c.lastActiveAt) : 'never',
        idle_days:      c.idleDays ?? '',
      })),
      'staff_activity',
    );
  };

  if (!canView) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Icon name="Lock" size={22} color="var(--color-muted-foreground)" />
        <p className="text-sm font-medium text-foreground mt-3">Staff activity is not available for your role</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="animate-pulse bg-muted rounded-xl h-24" />)}
        </div>
        <div className="animate-pulse bg-muted rounded-xl h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Icon name="Activity" size={17} color="var(--color-primary)" />
            Staff Activity
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Who is using the system, what they are touching, and who has gone quiet.
            Built from the audit trail — click anyone for their full log. Your own
            row is included and marked, so the totals cover the whole account.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refetch}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Icon name="RefreshCw" size={12} color="currentColor" />
            Refresh
          </button>
          {onExport && cards.length > 0 && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="Download" size={12} color="currentColor" />
              Export
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          <Icon name="AlertCircle" size={15} color="#dc2626" className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Staff activity could not be loaded</p>
            <p className="text-xs mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* An unreadable row must never be mistaken for an idle one. */}
      {mismatched.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <Icon name="AlertTriangle" size={15} color="#d97706" className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">
              {mismatched.length} {mismatched.length === 1 ? 'person has' : 'people have'} an incomplete ownership record
            </p>
            <p className="text-xs mt-0.5">
              {mismatched.map(m => m.name).join(', ')} — their staff profile is not linked to this account, so their
              activity is recorded under a different tenant and may not appear below. This is a data issue, not
              inactivity: treat their totals as unknown rather than zero.
            </p>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Active this week"
          value={`${totals.activeThisWeek} / ${totals.staff}`}
          subtitle={totals.staff - totals.activeThisWeek > 0
            ? `${totals.staff - totals.activeThisWeek} did nothing`
            : 'Everyone has been working'}
          icon="Users"
          iconColor="#1A56DB"
          tone={totals.activeThisWeek === 0 && totals.staff > 0 ? 'text-red-600' : 'text-foreground'}
        />
        <Kpi
          label="Actions recorded"
          value={totals.actions}
          subtitle={`${totals.actionsThisWeek} in the last 7 days`}
          icon="Activity"
          iconColor="#059669"
        />
        <Kpi
          label={`Quiet ${IDLE_DAYS}+ days`}
          value={totals.idle}
          subtitle={totals.unreadable > 0 ? `${totals.unreadable} more not visible` : 'Everyone else is active'}
          icon="BellOff"
          iconColor={totals.idle > 0 ? '#d97706' : '#6b7280'}
          tone={totals.idle > 0 ? 'text-amber-600' : 'text-foreground'}
        />
        <Kpi
          label="Deletions"
          value={totals.deletes}
          subtitle="Records removed in this period"
          icon="Trash2"
          iconColor={totals.deletes > 0 ? '#dc2626' : '#6b7280'}
          tone={totals.deletes > 0 ? 'text-red-600' : 'text-foreground'}
        />
      </div>

      {/* Staff table */}
      <div className="bg-card border border-border rounded-xl">
        {cards.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-11 h-11 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
              <Icon name="Users" size={19} color="var(--color-muted-foreground)" />
            </div>
            <p className="text-sm font-medium text-foreground">No staff under this account yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Staff you create appear here with everything they do in the system.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-5 py-2.5">Staff member</th>
                  <th className="text-right font-medium px-3 py-2.5">Actions</th>
                  <th className="text-right font-medium px-3 py-2.5" title="Records created">Created</th>
                  <th className="text-right font-medium px-3 py-2.5" title="Records edited">Updated</th>
                  <th className="text-right font-medium px-3 py-2.5" title="Records deleted">Deleted</th>
                  <th className="text-right font-medium px-3 py-2.5" title="Distinct days with any activity">Days on</th>
                  <th className="text-left  font-medium px-3 py-2.5">Works mostly on</th>
                  <th className="text-right font-medium px-5 py-2.5">Last active</th>
                </tr>
              </thead>
              <tbody>
                {cards.map(c => (
                  <tr
                    key={c.userId}
                    onClick={() => setOpenStaff(openStaff === c.userId ? null : c.userId)}
                    className={`border-b border-border last:border-0 cursor-pointer transition-colors ${
                      openStaff === c.userId ? 'bg-primary/5' : 'hover:bg-muted/40'
                    }`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                          {initials(c.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate flex items-center gap-1.5">
                            {c.name}
                            {c.isSelf && (
                              <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                                you
                              </span>
                            )}
                            {!c.isActive && (
                              <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                                disabled
                              </span>
                            )}
                            {c.ownershipMismatch && (
                              <Icon name="AlertTriangle" size={12} color="#d97706" />
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground truncate capitalize">
                            {(c.role || '').replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>
                    </td>

                    {!c.activityVisible ? (
                      <td colSpan={6} className="px-3 py-3 text-center text-xs text-amber-700">
                        Activity not visible — ownership record incomplete
                      </td>
                    ) : (
                      <>
                        <td className={`px-3 py-3 text-right font-semibold ${c.actions === 0 ? 'text-red-600' : 'text-foreground'}`}>
                          {c.actions}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">{c.creates}</td>
                        <td className="px-3 py-3 text-right text-muted-foreground">{c.updates}</td>
                        <td className={`px-3 py-3 text-right ${c.deletes > 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                          {c.deletes}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">{c.activeDays}</td>
                        <td className="px-3 py-3 text-muted-foreground capitalize truncate">
                          {c.topArea ? `${prettyTable(c.topArea.table)} (${c.topArea.count})` : '—'}
                        </td>
                      </>
                    )}

                    <td className="px-5 py-3 text-right text-xs whitespace-nowrap">
                      {!c.activityVisible ? (
                        <span className="text-muted-foreground">unknown</span>
                      ) : c.lastActiveAt ? (
                        <span className={(c.idleDays ?? 0) >= IDLE_DAYS ? 'text-amber-600 font-semibold' : 'text-muted-foreground'}>
                          {fmtDate(c.lastActiveAt)}{c.idleDays > 0 ? ` (${c.idleDays}d)` : ''}
                        </span>
                      ) : (
                        <span className="text-red-600 font-semibold">Never</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drill-down: one person's full log */}
      {openCard && (
        <div className="bg-card border border-primary/30 rounded-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                {initials(openCard.name)}
              </div>
              <div>
                <h4 className="text-base font-semibold text-foreground">{openCard.name}</h4>
                <p className="text-xs text-muted-foreground">
                  {openCard.email || 'no email'} · {openLogs.length} action{openLogs.length === 1 ? '' : 's'}
                  {openCard.lastActiveAt ? ` · last active ${fmtDate(openCard.lastActiveAt)}` : ' · never active'}
                </p>
              </div>
            </div>
            <button onClick={() => setOpenStaff(null)} className="p-1.5 rounded-lg hover:bg-muted">
              <Icon name="X" size={18} color="var(--color-muted-foreground)" />
            </button>
          </div>

          <div className="px-5 py-4">
            {openLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                {openCard.activityVisible
                  ? 'Nothing recorded in this period. This person has not touched the system.'
                  : 'Their activity is recorded under a different tenant and cannot be shown here.'}
              </p>
            ) : (
              <ul className="space-y-3 max-h-96 overflow-y-auto">
                {openLogs.slice(0, 200).map(l => {
                  const m = actionMeta(l.action);
                  return (
                    <li key={l.id} className="flex gap-2.5">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${TONE_BG[m.tone] || TONE_BG.slate}`}>
                        <Icon name={m.icon} size={12} color="currentColor" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="text-sm font-medium text-foreground">{m.label}</span>
                          {l.table_name && (
                            <span className="text-xs text-muted-foreground capitalize">{prettyTable(l.table_name)}</span>
                          )}
                          {l.client_name && (
                            <span className="text-xs text-muted-foreground">· {l.client_name}</span>
                          )}
                          {l.severity && l.severity !== 'info' && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 capitalize">
                              {l.severity}
                            </span>
                          )}
                          <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                            {fmtWhen(l.created_at)}
                          </span>
                        </div>
                        {l.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{l.description}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffActivityReport;
