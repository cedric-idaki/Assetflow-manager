import React, { useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { downloadCSV } from '../../../utils/exportUtils';
import useClientOnboarding from '../../../hooks/useClientOnboarding';
import OnboardingDrawer from './OnboardingDrawer';
import {
  ONBOARDING_STATUSES, statusMeta, scheduleStance, progressOf,
  nextActionFor, formatDay, buildOnboardingExport, ONBOARDING_EXPORT_COLUMNS,
} from '../../../config/clientOnboarding';

/**
 * INSTALLATION & ONBOARDING BOARD
 *
 * The platform bills every new tenant a one-time "Installation & onboarding"
 * fee. This is the screen that says whether it was delivered — for each client:
 * what state the installation is in, who is responsible for it, the date it is
 * booked for, the date it happened, and how much of the checklist is signed off.
 *
 * The KPI row is the whole book, straight from client_onboarding_summary(). The
 * table below it is filtered and paged, so the two are deliberately not derived
 * from each other: narrowing the list must not move the count of what is
 * overdue.
 *
 * Rows are ordered by the server with unfinished work first and the soonest
 * booking at the top. This screen exists to show what is still owed, so a
 * hundred completed installations must never push today's job below the fold.
 */

const TONE_BADGE = {
  slate:   'bg-slate-100 text-slate-700',
  blue:    'bg-blue-100 text-blue-700',
  amber:   'bg-amber-100 text-amber-700',
  orange:  'bg-orange-100 text-orange-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  red:     'bg-red-100 text-red-700',
};

const TONE_TEXT = {
  slate:   'text-muted-foreground',
  blue:    'text-blue-600',
  amber:   'text-amber-600',
  orange:  'text-orange-600',
  emerald: 'text-emerald-600',
  red:     'text-red-600',
};

const TONE_BAR = {
  slate:   'bg-slate-400',
  blue:    'bg-blue-500',
  amber:   'bg-amber-500',
  orange:  'bg-orange-500',
  emerald: 'bg-emerald-500',
  red:     'bg-red-500',
};

const Sk = ({ className = '' }) => (
  <div className={`animate-pulse bg-muted rounded-lg ${className}`} />
);

const StatusPill = ({ status }) => {
  const meta = statusMeta(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${TONE_BADGE[meta.tone] || TONE_BADGE.slate}`}>
      <Icon name={meta.icon} size={11} color="currentColor" />
      {meta.label}
    </span>
  );
};

/**
 * Progress as a bar plus the fraction it came from.
 *
 * Both, because a percentage on its own hides the size of the job: "45%" reads
 * the same whether five steps remain or one, and 5/11 does not.
 */
const ProgressBar = ({ record }) => {
  const pct = progressOf(record);
  const done = Number(record?.steps_done) || 0;
  const total = Number(record?.steps_total) || 0;
  const tone = pct >= 100 ? 'emerald' : pct > 0 ? 'blue' : 'slate';

  return (
    <div className="min-w-[7.5rem]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-foreground">{pct}%</span>
        <span className="text-[10px] text-muted-foreground">{done}/{total}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${TONE_BAR[tone]}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
};

const KpiCard = ({ title, value, subtitle, icon, iconBg, iconColor, alert }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="flex items-start justify-between mb-2">
      <p className="text-xs text-muted-foreground font-medium leading-snug">{title}</p>
      <div className={`flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0 ${iconBg}`}>
        <Icon name={icon} size={17} color={iconColor} />
      </div>
    </div>
    <h3 className={`text-2xl font-bold leading-none ${alert ? 'text-red-600' : 'text-foreground'}`}>{value}</h3>
    {subtitle && <p className="text-[11px] text-muted-foreground mt-1.5">{subtitle}</p>}
  </div>
);

const OnboardingTab = ({ onExport }) => {
  const onboarding = useClientOnboarding();
  const {
    rows, summary, installers, loading, error,
    statusFilter, setStatusFilter,
    assigneeFilter, setAssigneeFilter,
    search, setSearch,
    refetch,
  } = onboarding;

  const [openId, setOpenId] = useState(null);

  const openRecord = useMemo(
    () => rows.find(r => r.id === openId) || null,
    [rows, openId],
  );

  // What the platform still owes, as opposed to what it has on its books.
  const outstanding = summary.total - summary.completed - summary.cancelled;

  const handleExport = () => {
    const shaped = buildOnboardingExport(rows);
    if (!shaped.length) return;
    // downloadCSV when it is available (column order, UTF-8 BOM for Excel), and
    // the dashboard's own exporter otherwise, so this tab behaves like the rest
    // of the screen it is mounted in.
    if (!downloadCSV(shaped, `client_onboarding_${new Date().toISOString().slice(0, 10)}`, ONBOARDING_EXPORT_COLUMNS)) {
      onExport?.(shaped, 'client_onboarding');
    }
  };

  return (
    <div className="space-y-5">

      {/* ── What is owed, over the whole book ───────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Sk key={i} className="h-[104px]" />)
        ) : (
          <>
            <KpiCard
              title="Installations outstanding"
              value={outstanding}
              subtitle={`of ${summary.total} client${summary.total === 1 ? '' : 's'}`}
              icon="Wrench" iconBg="bg-blue-100" iconColor="#1A56DB"
            />
            <KpiCard
              title="Nobody assigned"
              value={summary.unassigned}
              subtitle="Open jobs with no owner"
              icon="UserPlus" iconBg="bg-violet-100" iconColor="#7C3AED"
              alert={summary.unassigned > 0}
            />
            <KpiCard
              title="Overdue"
              value={summary.overdue}
              subtitle="Booked date has passed"
              icon="AlertCircle" iconBg="bg-red-100" iconColor="#DC2626"
              alert={summary.overdue > 0}
            />
            <KpiCard
              title="Due this week"
              value={summary.dueThisWeek}
              subtitle="Booked in the next 7 days"
              icon="CalendarClock" iconBg="bg-amber-100" iconColor="#D97706"
            />
            <KpiCard
              title="Completed"
              value={summary.completed}
              subtitle={
                summary.avgDaysToComplete === null
                  ? 'None signed off yet'
                  : `${summary.avgDaysToComplete} days on average`
              }
              icon="CheckCircle2" iconBg="bg-emerald-100" iconColor="#059669"
            />
          </>
        )}
      </div>

      {/* ── The board ───────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">Client Installation &amp; Onboarding</h2>
            <p className="text-xs text-muted-foreground">
              Every client charged an installation fee, and what has been delivered against it
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <Icon name="Search" size={13} color="var(--color-muted-foreground)" />
              </span>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search client…"
                className="pl-8 pr-3 py-1.5 w-44 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            >
              <option value="all">All statuses</option>
              {ONBOARDING_STATUSES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            <select
              value={assigneeFilter}
              onChange={e => setAssigneeFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            >
              <option value="all">Anyone</option>
              <option value="unassigned">Unassigned</option>
              {installers.map(u => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>

            <button
              onClick={refetch}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="RefreshCw" size={13} color="currentColor" />
              Refresh
            </button>

            <button
              onClick={handleExport}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Icon name="Download" size={13} color="currentColor" />
              Export
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-5 py-3 bg-red-50 border-b border-red-200 text-red-700 text-sm">
            <Icon name="AlertCircle" size={15} color="currentColor" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Sk key={i} className="h-12" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Icon name="PackageCheck" size={28} color="currentColor" />
            <p className="text-sm mt-2">
              {search || statusFilter !== 'all' || assigneeFilter !== 'all'
                ? 'No client matches these filters'
                : 'No client accounts yet'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  {['Client', 'Status', 'Responsible', 'Scheduled', 'Installed', 'Checklist'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const stance = scheduleStance(r);
                  const next = nextActionFor(r);

                  return (
                    <tr
                      key={r.id}
                      onClick={() => setOpenId(r.id)}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                            r.entity_type === 'sacco' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {(r.client_name || 'U')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate max-w-[15rem]">{r.client_name}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[15rem]">
                              {r.entity_type === 'sacco' ? 'Sacco' : 'Company'}
                              {r.contact_email ? ` · ${r.contact_email}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          <StatusPill status={r.status} />
                          {next && (
                            <span className="text-[10px] font-medium text-orange-600">{next}</span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        {r.assigned_to_name ? (
                          <div>
                            <p className="text-foreground">{r.assigned_to_name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              since {formatDay(r.assigned_at)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs italic text-muted-foreground">Unassigned</span>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-foreground">{formatDay(r.scheduled_date)}</p>
                        <p className={`text-[10px] font-medium ${TONE_TEXT[stance.tone] || TONE_TEXT.slate}`}>
                          {stance.label}
                        </p>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatDay(r.installation_date)}
                      </td>

                      <td className="px-4 py-3">
                        <ProgressBar record={r} />
                      </td>

                      <td className="px-4 py-3">
                        <Icon name="ChevronRight" size={15} color="var(--color-muted-foreground)" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openRecord && (
        <OnboardingDrawer
          record={openRecord}
          onboarding={onboarding}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
};

export default OnboardingTab;
