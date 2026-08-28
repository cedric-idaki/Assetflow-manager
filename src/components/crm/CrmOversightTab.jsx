import React, { useState, useMemo } from 'react';
import Icon from '../AppIcon';
import {
  useCrmOversight, PIPELINE_STAGES, buildKpiBreakdown,
  AGENT_SORTS, sortScorecards, flatMetric,
} from '../../hooks/useCrmOversight';
import { typeMeta, outcomeMeta, STALE_CONTACT_DAYS } from '../../hooks/useCrmInteractions';
import CustomerRecord from './CustomerRecord';

/**
 * CRM oversight, shared by the admin and super-admin dashboards.
 *
 * One component rather than the usual per-dashboard copy because the two views
 * are the same view: each supervisor sees the agents whose admin_id is them.
 * A super admin sees the platform sales force it created; an admin sees the
 * agents it created. Scope is decided server-side by RLS, not here, and the
 * markup differs only in a line of wording.
 *
 * Everything on this screen is READ-ONLY. Supervisors watch the pipeline; they
 * do not edit an agent's leads out from under them.
 */

const Sk = ({ className = '' }) => (
  <div className={`animate-pulse bg-muted rounded-lg ${className}`} />
);

const STAGE_BAR = {
  slate:   'bg-slate-400',
  blue:    'bg-blue-500',
  violet:  'bg-violet-500',
  amber:   'bg-amber-500',
  emerald: 'bg-emerald-500',
};

const SENTIMENT_DOT = {
  positive: 'bg-emerald-500',
  negative: 'bg-red-500',
  neutral:  'bg-slate-400',
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
  (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

/** Matches the KES convention used across the admin tabs. */
const fmtMoney = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

/**
 * Compact money for the leaderboard, where the figure is a ranking signal
 * rather than an accounting one and full precision only costs column width.
 */
const fmtCompact = (n) => {
  const v = Number(n || 0);
  if (v >= 1e9) return `KES ${(v / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (v >= 1e6) return `KES ${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `KES ${Math.round(v / 1e3)}K`;
  return fmtMoney(v);
};

// Keys are public.agent_status: active | inactive | on_leave | terminated.
const STATUS_BADGE = {
  active:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive:   'bg-slate-100 text-slate-600 border-slate-200',
  on_leave:   'bg-amber-50 text-amber-700 border-amber-200',
  terminated: 'bg-red-50 text-red-700 border-red-200',
};

const StatusPill = ({ status }) => {
  if (!status) return null;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium capitalize ${
      STATUS_BADGE[status] || STATUS_BADGE.inactive
    }`}>
      {String(status).replace(/_/g, ' ')}
    </span>
  );
};

/**
 * A KPI tile. Clickable when given an onClick, because a number with no way to
 * ask "which ones?" sends the reader back to a spreadsheet.
 *
 * Rendered as a real <button> in that case rather than a div with a handler, so
 * it is reachable by keyboard and announces its expanded state.
 */
const KpiCard = ({
  label, value, subtitle, icon,
  tone = 'text-foreground',
  iconColor = 'var(--color-muted-foreground)',
  onClick, active = false,
}) => {
  const body = (
    <>
      <div className="flex items-center gap-2 mb-1">
        <Icon name={icon} size={15} color={iconColor} />
        <span className="text-xs text-muted-foreground">{label}</span>
        {onClick && (
          <Icon
            name="ChevronDown"
            size={13}
            color="var(--color-muted-foreground)"
            className={`ml-auto transition-transform ${active ? 'rotate-180' : ''}`}
          />
        )}
      </div>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </>
  );

  if (!onClick) {
    return <div className="bg-card border border-border rounded-xl p-4">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`bg-card border rounded-xl p-4 w-full text-left transition-all hover:border-primary/40 hover:shadow-sm ${
        active ? 'border-primary ring-1 ring-primary/20' : 'border-border'
      }`}
    >
      {body}
    </button>
  );
};

// ── KPI drill-down ──────────────────────────────────────────────────────────
const TONE_TEXT = {
  good:  'text-emerald-600',
  bad:   'text-red-600',
  warn:  'text-amber-600',
  plain: 'text-muted-foreground',
};

/**
 * The rows behind whichever tile was clicked.
 *
 * Built from the same arrays the tiles were counted from, so the breakdown can
 * never contradict the number above it. Rows carrying a lead open the customer
 * record; rows carrying an agent select that agent's drill-down.
 */
const KpiBreakdown = ({ detail, onClose, onOpenLead, onSelectAgent }) => {
  if (!detail) return null;

  return (
    <div className="bg-card border border-primary/30 rounded-xl">
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{detail.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{detail.hint}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close breakdown"
          className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0"
        >
          <Icon name="X" size={18} color="var(--color-muted-foreground)" />
        </button>
      </div>

      {/* Why a tile reads zero, said once at the top rather than left to guess. */}
      {detail.emptyHint && (
        <div className="flex items-start gap-2 mx-5 mt-4 px-3 py-2.5 rounded-lg bg-muted/60 text-xs text-muted-foreground">
          <Icon name="Info" size={13} color="var(--color-muted-foreground)" className="mt-0.5 flex-shrink-0" />
          <span>{detail.emptyHint}</span>
        </div>
      )}

      <div className="px-5 py-4 space-y-5 max-h-[28rem] overflow-y-auto">
        {detail.sections.map((sec, si) => (
          <div key={si}>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {sec.label}
            </h4>

            {sec.items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">{sec.empty || 'Nothing here.'}</p>
            ) : (
              <ul className="divide-y divide-border">
                {sec.items.map(item => {
                  const clickable = Boolean(item.lead || item.agentId);
                  return (
                    <li
                      key={item.id}
                      onClick={() => {
                        if (item.lead) onOpenLead?.(item.lead);
                        else if (item.agentId) onSelectAgent?.(item.agentId);
                      }}
                      className={`py-2.5 flex items-center gap-3 ${
                        clickable ? 'cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-lg transition-colors' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{item.primary}</p>
                        {item.secondary && (
                          <p className="text-xs text-muted-foreground truncate">{item.secondary}</p>
                        )}
                      </div>
                      <span className={`text-xs font-medium whitespace-nowrap flex-shrink-0 ${
                        TONE_TEXT[item.tone] || TONE_TEXT.plain
                      }`}>
                        {item.amount !== undefined ? fmtMoney(item.amount) : item.value}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Pipeline funnel ─────────────────────────────────────────────────────────
const PipelineFunnel = ({ pipeline }) => {
  const max = Math.max(1, ...PIPELINE_STAGES.map(s => pipeline.byStage[s.value] || 0));
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">Pipeline</h3>
        <span className="text-xs text-muted-foreground">
          {pipeline.total} lead{pipeline.total === 1 ? '' : 's'} · {pipeline.open} still open
        </span>
      </div>
      <div className="space-y-2.5">
        {PIPELINE_STAGES.map(stage => {
          const n = pipeline.byStage[stage.value] || 0;
          const pct = Math.round((n / max) * 100);
          return (
            <div key={stage.value} className="flex items-center gap-3">
              <span className="w-28 text-xs text-muted-foreground flex-shrink-0">{stage.label}</span>
              <div className="flex-1 h-6 bg-muted rounded-lg overflow-hidden">
                <div
                  className={`h-full ${STAGE_BAR[stage.tone]} transition-all`}
                  style={{ width: `${n === 0 ? 0 : Math.max(pct, 4)}%` }}
                />
              </div>
              <span className="w-10 text-right text-sm font-bold text-foreground flex-shrink-0">{n}</span>
            </div>
          );
        })}
      </div>
      {pipeline.conversionRate !== null && (
        <p className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{pipeline.conversionRate}%</span> of closed leads
          converted into an account. Leads still in play are excluded, so a busy pipeline does not read as a failing one.
        </p>
      )}
    </div>
  );
};

// ── Agent scorecards ────────────────────────────────────────────────────────
// ── Sales-agent leaderboard ───────────────────────────────────────
/**
 * Ranked on realised sales, which is the only figure here the agent cannot
 * inflate by registering leads they never work. Clicking a row opens the same
 * drill-down the scorecard table opens, so the board is a way IN to an agent
 * rather than a decoration.
 */
const MEDAL = ['text-amber-500', 'text-slate-400', 'text-amber-700'];

const Leaderboard = ({ rows, onSelect, selectedId }) => {
  const top = rows.slice(0, 10);
  const anySales = top.some(c => c.salesValue > 0);

  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-base font-semibold text-foreground">Top Sales Agents</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Ranked by sales closed, not by leads held
        </p>
      </div>

      {top.length === 0 ? (
        <div className="text-center py-10 px-4">
          <div className="w-11 h-11 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
            <Icon name="Trophy" size={19} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-medium text-foreground">No agents to rank yet</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {top.map(c => (
            <li
              key={c.agentId}
              onClick={() => onSelect?.(selectedId === c.agentId ? null : c.agentId)}
              className={`flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-colors ${
                selectedId === c.agentId ? 'bg-primary/5' : 'hover:bg-muted/40'
              }`}
            >
              <span className={`w-5 text-sm font-bold tabular-nums ${
                MEDAL[c.rank - 1] || 'text-muted-foreground'
              }`}>
                {c.rank}
              </span>
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                {initials(c.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {c.pipeline.won} won · {c.pipeline.open} open
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold text-foreground whitespace-nowrap">
                  {fmtCompact(c.salesValue)}
                </p>
                {c.commission > 0 && (
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtCompact(c.commission)} comm.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* An all-zero board is not a bug, and saying so stops it being read as one. */}
      {top.length > 0 && !anySales && (
        <p className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
          No sales recorded against any agent yet — the order below falls back to deals won.
        </p>
      )}
    </div>
  );
};


// ── Which lead sources actually work ────────────────────────────────
/**
 * Ranked on deals WON, not on volume. The source that delivers the most leads
 * is routinely not the source that delivers the most customers, and ranking on
 * volume is how a team ends up spending more on the channel that wastes the
 * most of its time.
 */
const SourcePerformance = ({ rows, onSelectSource }) => {
  const best = rows.reduce((m, r) => Math.max(m, r.total), 0) || 1;
  const anyDecided = rows.some(r => r.decided > 0);

  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-base font-semibold text-foreground">Where Leads Come From</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Ranked by deals won — not by how many leads the channel produces
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-10 px-4">
          <div className="w-11 h-11 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
            <Icon name="Share2" size={19} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-medium text-foreground">No leads registered yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Source is chosen when an agent registers a lead.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left  font-medium px-5 py-2.5">Source</th>
                <th className="text-right font-medium px-3 py-2.5">Leads</th>
                <th className="text-right font-medium px-3 py-2.5">Open</th>
                <th className="text-right font-medium px-3 py-2.5">Won</th>
                <th className="text-right font-medium px-3 py-2.5">Lost</th>
                <th className="text-right font-medium px-5 py-2.5"
                    title="Won as a share of leads that actually finished">Conv.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.key}
                  onClick={() => onSelectSource?.(r)}
                  className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <Icon name={r.icon} size={15} color="var(--color-muted-foreground)" className="flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{r.label}</p>
                        {/* Volume as a bar, so the eye can separate "big channel"
                            from "good channel" without reading the numbers. */}
                        <div className="mt-1 h-1 w-24 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary/50 rounded-full"
                            style={{ width: `${Math.round((r.total / best) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right text-foreground">
                    {r.total}
                    <span className="text-xs text-muted-foreground ml-1">({r.shareOfLeads}%)</span>
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{r.open}</td>
                  <td className="px-3 py-3 text-right font-semibold text-emerald-600">{r.won}</td>
                  <td className={`px-3 py-3 text-right ${r.lost > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                    {r.lost}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-foreground whitespace-nowrap">
                    {r.conversionRate === null
                      ? <span className="font-normal text-muted-foreground text-xs">no verdict yet</span>
                      : `${r.conversionRate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && !anyDecided && (
        <p className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
          No lead from any source has been won or lost yet, so no channel can be judged.
          The ranking below is volume only.
        </p>
      )}
    </div>
  );
};

// ── Why we lose ───────────────────────────────────────────────
/**
 * Loss reasons, biggest first, with the coverage figure stated up front.
 *
 * Coverage is not decoration. A breakdown built on a third of the losses is a
 * sample nobody chose, and reading it as the whole picture is how a team fixes
 * the wrong problem with complete confidence. So it is shown before the bars,
 * not in a footnote under them.
 */
const LossAnalysis = ({ analysis, onSelectReason }) => {
  const { totalLost, recorded, unrecorded, coverage, reasons } = analysis;

  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-base font-semibold text-foreground">Why We Lose Deals</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {totalLost === 0
            ? 'No deals lost yet'
            : `${totalLost} lost · reason recorded for ${recorded} of them`}
        </p>
      </div>

      {totalLost === 0 ? (
        <div className="text-center py-10 px-4">
          <div className="w-11 h-11 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
            <Icon name="ThumbsUp" size={19} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-medium text-foreground">Nothing lost yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Agents are asked why when they close a lead without converting it.
          </p>
        </div>
      ) : (
        <>
          {/* Say how complete the picture is BEFORE showing the picture. */}
          {unrecorded > 0 && (
            <div className={`flex items-start gap-2 mx-5 mt-4 px-3 py-2.5 rounded-lg text-xs ${
              coverage !== null && coverage < 50
                ? 'bg-amber-50 border border-amber-200 text-amber-800'
                : 'bg-muted/60 text-muted-foreground'
            }`}>
              <Icon
                name={coverage !== null && coverage < 50 ? 'AlertTriangle' : 'Info'}
                size={13}
                color="currentColor"
                className="mt-0.5 flex-shrink-0"
              />
              <span>
                {unrecorded} of {totalLost} losses have no reason recorded
                {coverage !== null && ` — this breakdown covers ${coverage}% of them`}.
                {coverage !== null && coverage < 50 &&
                  ' Treat it as a hint, not a finding, until more are filled in.'}
              </span>
            </div>
          )}

          {reasons.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No reason has been recorded for any loss yet, so there is nothing to break down.
            </p>
          ) : (
            <ul className="px-5 py-4 space-y-3">
              {reasons.map(r => (
                <li
                  key={r.key}
                  onClick={() => onSelectReason?.(r)}
                  className="cursor-pointer group"
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {r.label}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                      {r.count} · {r.share}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-red-500/70 rounded-full" style={{ width: `${r.share}%` }} />
                  </div>
                  {r.hint && (
                    <p className="text-xs text-muted-foreground mt-1">{r.hint}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

const AgentScorecards = ({ scorecards, onSelect, selectedId, onExport }) => {
  const [sort, setSort] = useState('open');
  // Clicking the active chip reverses it. Worst first is often the useful view
  // (who is neglecting the most leads), and it also gives every chip something
  // visible to do even when the ranking itself cannot change.
  const [flip, setFlip] = useState(false);

  const active = AGENT_SORTS.find(s => s.value === sort) || null;

  const sorted = useMemo(() => sortScorecards(scorecards, sort, flip), [scorecards, sort, flip]);
  const flat   = useMemo(() => flatMetric(scorecards, sort), [scorecards, sort]);

  const pick = (value) => {
    if (value === sort) setFlip(f => !f);
    else { setSort(value); setFlip(false); }
  };

  /** Tints the column currently being ranked so the click has a visible effect. */
  const hl = (col) => (active?.col === col ? 'bg-primary/5' : '');

  const handleExport = () => {
    onExport?.(
      scorecards.map(c => ({
        agent:              c.name,
        code:               c.code || '',
        region:             c.region || '',
        status:             c.status || '',
        total_leads:        c.pipeline.total,
        open_leads:         c.pipeline.open,
        qualified:          c.pipeline.qualified,
        opportunities:      c.pipeline.opportunities,
        deals_won:          c.pipeline.won,
        deals_lost:         c.pipeline.lost,
        converted:          c.pipeline.converted,
        conversion_rate:    c.pipeline.conversionRate ?? '',
        sales_value:        c.salesValue,
        commission:         c.commission,
        contacts_logged:    c.interactions,
        contacts_this_week: c.touchesThisWeek,
        positive_rate:      c.positiveRate ?? '',
        open_follow_ups:    c.openFollowUps,
        overdue_follow_ups: c.overdueFollowUps,
        neglected_leads:    c.neglectedLeads,
        last_contact:       c.lastTouchAt ? fmtDate(c.lastTouchAt) : '',
      })),
      'crm_agent_performance',
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-base font-semibold text-foreground">Agent Performance</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click an agent to see their pipeline and contact history
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex flex-wrap gap-1">
            {AGENT_SORTS.map(s => (
              <button
                key={s.value}
                onClick={() => pick(s.value)}
                aria-pressed={sort === s.value}
                title={sort === s.value
                  ? `Sorted by ${s.label} — click again to reverse`
                  : `Sort by ${s.label}`}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  sort === s.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {s.label}
                {sort === s.value && (
                  <Icon
                    name={flip ? 'ArrowUp' : 'ArrowDown'}
                    size={11}
                    color="currentColor"
                  />
                )}
              </button>
            ))}
          </div>
          {onExport && (
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

      {/* A sort that cannot separate anybody says so, rather than looking broken. */}
      {flat !== null && sorted.length > 0 && (
        <div className="flex items-start gap-2 px-5 py-2.5 border-b border-border bg-muted/40 text-xs text-muted-foreground">
          <Icon name="Info" size={13} color="var(--color-muted-foreground)" className="mt-0.5 flex-shrink-0" />
          <span>
            Every agent has the same <strong className="font-medium text-foreground">{active?.label}</strong>
            {' '}({active?.money ? fmtMoney(flat) : flat}), so this sort cannot rank them.
            The order below falls back to name.
          </span>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-12 px-4">
          <div className="w-11 h-11 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
            <Icon name="UserCheck" size={19} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-medium text-foreground">No sales agents yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            CRM activity appears here as soon as an agent starts working leads.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className={`text-left  font-medium px-5 py-2.5 ${hl('agent')}`}>Agent</th>
                <th className="text-right font-medium px-3 py-2.5" title="Every lead ever registered by this agent">Leads</th>
                <th className={`text-right font-medium px-3 py-2.5 ${hl('open')}`} title="Leads still open, at any stage before closed">Open</th>
                <th className="text-right font-medium px-3 py-2.5" title="Leads at the qualified stage">Qualified</th>
                <th className="text-right font-medium px-3 py-2.5" title="Qualified leads plus those with a proposal out">Opps</th>
                <th className={`text-right font-medium px-3 py-2.5 ${hl('won')}`} title="Leads that converted">Won</th>
                <th className="text-right font-medium px-3 py-2.5" title="Leads closed without converting">Lost</th>
                <th className="text-right font-medium px-3 py-2.5" title="Share of closed leads that converted">Conv.</th>
                <th className={`text-right font-medium px-3 py-2.5 ${hl('sales')}`} title="Realised sales recorded against this agent">Sales</th>
                <th className="text-right font-medium px-3 py-2.5" title="Commission earned to date">Commission</th>
                <th className={`text-right font-medium px-3 py-2.5 ${hl('week')}`} title="Contacts logged in the last 7 days">Week</th>
                <th className={`text-right font-medium px-3 py-2.5 ${hl('overdue')}`} title="Follow-ups scheduled but past their date">Overdue</th>
                <th className={`text-right font-medium px-3 py-2.5 ${hl('neglected')}`} title={`Open leads with no contact for ${STALE_CONTACT_DAYS}+ days`}>Neglected</th>
                <th className="text-right font-medium px-5 py-2.5">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => (
                <tr
                  key={c.agentId}
                  onClick={() => onSelect(selectedId === c.agentId ? null : c.agentId)}
                  className={`border-b border-border last:border-0 cursor-pointer transition-colors ${
                    selectedId === c.agentId ? 'bg-primary/5' : 'hover:bg-muted/40'
                  }`}
                >
                  <td className={`px-5 py-3 ${hl('agent')}`}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                        {initials(c.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-foreground truncate">{c.name}</p>
                          <StatusPill status={c.status} />
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.code || '—'}{c.region ? ` · ${c.region}` : ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{c.pipeline.total}</td>
                  <td className={`px-3 py-3 text-right font-semibold text-foreground ${hl('open')}`}>{c.pipeline.open}</td>
                  <td className="px-3 py-3 text-right text-foreground">{c.pipeline.qualified}</td>
                  <td className="px-3 py-3 text-right text-foreground">{c.pipeline.opportunities}</td>
                  <td className={`px-3 py-3 text-right font-semibold text-emerald-600 ${hl('won')}`}>{c.pipeline.won}</td>
                  <td className={`px-3 py-3 text-right ${c.pipeline.lost > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                    {c.pipeline.lost}
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">
                    {c.pipeline.conversionRate === null ? '—' : `${c.pipeline.conversionRate}%`}
                  </td>
                  <td className={`px-3 py-3 text-right font-semibold text-foreground whitespace-nowrap ${hl('sales')}`}>
                    {c.salesValue > 0 ? fmtMoney(c.salesValue) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground whitespace-nowrap">
                    {c.commission > 0 ? fmtMoney(c.commission) : '—'}
                  </td>
                  <td className={`px-3 py-3 text-right font-semibold ${hl('week')} ${
                    c.touchesThisWeek === 0 ? 'text-red-600' : 'text-emerald-600'
                  }`}>
                    {c.touchesThisWeek}
                  </td>
                  <td className={`px-3 py-3 text-right font-semibold ${hl('overdue')} ${
                    c.overdueFollowUps > 0 ? 'text-red-600' : 'text-muted-foreground'
                  }`}>
                    {c.overdueFollowUps}
                  </td>
                  <td className={`px-3 py-3 text-right font-semibold ${hl('neglected')} ${
                    c.neglectedLeads > 0 ? 'text-amber-600' : 'text-muted-foreground'
                  }`}>
                    {c.neglectedLeads}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                    {c.lastTouchAt
                      ? `${fmtDate(c.lastTouchAt)}${c.quietDays > 0 ? ` (${c.quietDays}d)` : ''}`
                      : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Drill-down for one agent ────────────────────────────────────────────────
const AgentDetail = ({ card, leads, interactions, onClose, onOpenLead }) => (
  <div className="bg-card border border-primary/30 rounded-xl">
    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
          {initials(card.name)}
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">{card.name}</h3>
          <p className="text-xs text-muted-foreground">
            {card.pipeline.open} open · {card.interactions} contact{card.interactions === 1 ? '' : 's'} logged
            {card.lastTouchAt ? ` · last active ${fmtDate(card.lastTouchAt)}` : ' · never active'}
          </p>
        </div>
      </div>
      <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
        <Icon name="X" size={18} color="var(--color-muted-foreground)" />
      </button>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
      {/* Their leads */}
      <div className="px-5 py-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Leads ({leads.length})
          <span className="ml-1.5 font-normal normal-case opacity-70">· click to open the full record</span>
        </h4>
        {leads.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No leads registered.</p>
        ) : (
          <ul className="divide-y divide-border max-h-96 overflow-y-auto">
            {leads.map(l => (
              <li
                key={l.id}
                onClick={() => onOpenLead?.(l)}
                className="py-2.5 flex items-center gap-3 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate hover:text-primary">{l.full_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {(l.stage || '').replace(/_/g, ' ')}
                    {l.asset_interest ? ` · ${l.asset_interest}` : ''}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    {l.interaction_count || 0} contact{(l.interaction_count || 0) === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    {l.last_contact_at ? fmtDate(l.last_contact_at) : 'never contacted'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Their contact history */}
      <div className="px-5 py-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Contact history ({interactions.length})
        </h4>
        {interactions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Nothing logged. This agent has not recorded a single call or meeting.
          </p>
        ) : (
          <ul className="space-y-3 max-h-96 overflow-y-auto">
            {interactions.slice(0, 50).map(i => {
              const t = typeMeta(i.interaction_type);
              const o = outcomeMeta(i.outcome);
              return (
                <li key={i.id} className="flex gap-2.5">
                  <Icon name={t.icon} size={14} color="var(--color-muted-foreground)" className="mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="text-sm font-medium text-foreground">{i.contact_name || t.label}</span>
                      {o && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <span className={`w-1.5 h-1.5 rounded-full ${SENTIMENT_DOT[o.sentiment]}`} />
                          {o.label}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                        {fmtWhen(i.occurred_at)}
                      </span>
                    </div>
                    {i.summary && <p className="text-xs text-muted-foreground mt-0.5">{i.summary}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  </div>
);

// ── Main ────────────────────────────────────────────────────────────────────
const CrmOversightTab = ({ onExport }) => {
  const {
    canView, isPlatformOwner, scorecards, totals, pipeline, leaderboard,
    sources, losses,
    neglectedLeads, recentInteractions, leads, interactions, followUps,
    loading, error, refetch,
  } = useCrmOversight();

  const [selectedAgent, setSelectedAgent] = useState(null);
  // Which KPI tile is expanded, by key. One at a time: two open breakdowns push
  // the table they explain off the screen.
  const [openKpi, setOpenKpi] = useState(null);
  // A source or loss-reason the reader clicked into. Rendered by the SAME
  // component as the KPI drill-downs, because it is the same question — "which
  // ones?" — and a second bespoke panel would only be a second thing to keep
  // consistent.
  const [groupDetail, setGroupDetail] = useState(null);
  // The customer record sits above everything: a supervisor opens it from the
  // agent drill-down or from the gone-quiet list, and it carries the agent's
  // name so they know whose relationship they are reading.
  const [openLead, setOpenLead] = useState(null);

  /** One lead as a drill-down row, shared by both group panels. */
  const leadRow = (l) => ({
    id: l.id,
    primary: l.full_name || 'Unnamed lead',
    secondary: [
      scorecards.find(c => c.agentId === l.agent_id)?.name,
      (l.stage || '').replace(/_/g, ' '),
      l.asset_interest,
    ].filter(Boolean).join(' \u00b7 '),
    value: l.converted_at ? 'won' : (l.stage === 'closed' ? 'lost' : 'open'),
    tone: l.converted_at ? 'good' : (l.stage === 'closed' ? 'bad' : 'plain'),
    lead: l,
  });

  const showSource = (r) => setGroupDetail({
    title: `${r.label} \u2014 ${r.total} lead${r.total === 1 ? '' : 's'}`,
    hint: r.conversionRate === null
      ? 'Nothing from this channel has been won or lost yet, so it cannot be judged.'
      : `${r.won} won and ${r.lost} lost of ${r.decided} finished \u2014 a ${r.conversionRate}% conversion rate.`,
    sections: [{
      label: 'Leads from this source',
      items: r.leads.map(leadRow),
      empty: 'No leads from this source.',
    }],
  });

  const showReason = (r) => setGroupDetail({
    title: `Lost: ${r.label}`,
    hint: r.hint || 'Every lead closed for this reason.',
    sections: [{
      label: `${r.count} lead${r.count === 1 ? '' : 's'}`,
      items: r.leads.map(l => ({
        ...leadRow(l),
        // The free-text half earns its place here: the count says WHAT, this
        // says what actually happened.
        secondary: l.lost_notes
          || [scorecards.find(c => c.agentId === l.agent_id)?.name, 'no note'].filter(Boolean).join(' \u00b7 '),
        value: l.lost_at ? fmtDate(l.lost_at) : '\u2014',
        tone: 'bad',
      })),
      empty: 'No leads recorded under this reason.',
    }],
  });

  const kpiDetail = useMemo(
    () => (openKpi
      ? buildKpiBreakdown(openKpi, { scorecards, leads, interactions, followUps, totals })
      : null),
    [openKpi, scorecards, leads, interactions, followUps, totals],
  );

  const selectedCard = useMemo(
    () => scorecards.find(c => c.agentId === selectedAgent) || null,
    [scorecards, selectedAgent],
  );
  const selectedLeads = useMemo(
    () => (selectedAgent ? leads.filter(l => l.agent_id === selectedAgent) : []),
    [leads, selectedAgent],
  );
  const selectedTouches = useMemo(
    () => (selectedAgent ? interactions.filter(i => i.agent_id === selectedAgent) : []),
    [interactions, selectedAgent],
  );

  if (!canView) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Icon name="Lock" size={22} color="var(--color-muted-foreground)" />
        <p className="text-sm font-medium text-foreground mt-3">CRM oversight is not available for your role</p>
        <p className="text-xs text-muted-foreground mt-1">
          Pipeline and contact history are visible to admins, directors and managers.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Sk key={i} className="h-24" />)}
        </div>
        <Sk className="h-56" />
        <Sk className="h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Icon name="Contact" size={19} color="var(--color-primary)" />
            Customer Relationship Management
          </h2>
          <p className="text-sm text-muted-foreground">
            {isPlatformOwner
              ? 'Your platform sales agents pipeline, contact activity and follow-up discipline'
              : 'Your sales agents pipeline, contact activity and follow-up discipline'}
          </p>
        </div>
        <button
          onClick={refetch}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <Icon name="RefreshCw" size={12} color="currentColor" />
          Refresh
        </button>
      </div>

      {/* A partial failure must not render as a confident dashboard of zeros. */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          <Icon name="AlertCircle" size={15} color="#dc2626" className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Some CRM data could not be loaded</p>
            <p className="text-xs mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Active agents this week"
          onClick={() => setOpenKpi(openKpi === 'activeAgents' ? null : 'activeAgents')}
          active={openKpi === 'activeAgents'}
          value={`${totals.activeAgents} / ${totals.agents}`}
          subtitle={totals.agents - totals.activeAgents > 0
            ? `${totals.agents - totals.activeAgents} logged nothing`
            : 'Everyone is working'}
          icon="UserCheck"
          iconColor="#1A56DB"
          tone={totals.activeAgents === 0 && totals.agents > 0 ? 'text-red-600' : 'text-foreground'}
        />
        <KpiCard
          label="Open leads"
          onClick={() => setOpenKpi(openKpi === 'openLeads' ? null : 'openLeads')}
          active={openKpi === 'openLeads'}
          value={totals.openLeads}
          subtitle={`${totals.totalLeads} registered in total`}
          icon="Target"
          iconColor="#d97706"
        />
        <KpiCard
          label="Contacts this week"
          onClick={() => setOpenKpi(openKpi === 'contacts' ? null : 'contacts')}
          active={openKpi === 'contacts'}
          value={totals.touchesThisWeek}
          subtitle={`${totals.interactions} logged all time`}
          icon="Activity"
          iconColor="#059669"
        />
        <KpiCard
          label="Needs attention"
          onClick={() => setOpenKpi(openKpi === 'attention' ? null : 'attention')}
          active={openKpi === 'attention'}
          value={totals.overdueFollowUps + totals.neglectedLeads}
          subtitle={`${totals.overdueFollowUps} overdue · ${totals.neglectedLeads} leads gone quiet`}
          icon="AlertTriangle"
          iconColor={totals.overdueFollowUps + totals.neglectedLeads > 0 ? '#dc2626' : '#6b7280'}
          tone={totals.overdueFollowUps + totals.neglectedLeads > 0 ? 'text-red-600' : 'text-foreground'}
        />
      </div>

      {/* Commercial KPIs -- how the team is DOING, as opposed to how busy it is.
          Figures come from public.agents, which the sales flow maintains; this
          screen only reads them. There is deliberately no "pipeline value":
          leads carry a free-text budget_range and no numeric amount, so any
          total here would be a guess presented as a number. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total sales"
          onClick={() => setOpenKpi(openKpi === 'sales' ? null : 'sales')}
          active={openKpi === 'sales'}
          value={fmtCompact(totals.salesValue)}
          subtitle={`${totals.won} deal${totals.won === 1 ? '' : 's'} won · ${totals.lost} lost`}
          icon="TrendingUp"
          iconColor="#059669"
        />
        <KpiCard
          label="Total commission"
          onClick={() => setOpenKpi(openKpi === 'commission' ? null : 'commission')}
          active={openKpi === 'commission'}
          value={fmtCompact(totals.commission)}
          subtitle="Earned by the team to date"
          icon="Wallet"
          iconColor="#7c3aed"
        />
        <KpiCard
          label="Opportunities"
          onClick={() => setOpenKpi(openKpi === 'opportunities' ? null : 'opportunities')}
          active={openKpi === 'opportunities'}
          value={totals.opportunities}
          subtitle={`${totals.qualified} qualified · ${totals.opportunities - totals.qualified} with a proposal out`}
          icon="Briefcase"
          iconColor="#d97706"
        />
        <KpiCard
          label="Conversion rate"
          onClick={() => setOpenKpi(openKpi === 'conversion' ? null : 'conversion')}
          active={openKpi === 'conversion'}
          value={totals.conversionRate === null ? '—' : `${totals.conversionRate}%`}
          subtitle={totals.leadsPerAgent === null
            ? `${totals.enabledAgents} of ${totals.agents} agents active`
            : `${totals.leadsPerAgent} leads per agent · ${totals.enabledAgents}/${totals.agents} active`}
          icon="Percent"
          iconColor="#1A56DB"
        />
      </div>

      {/* The rows behind whichever tile was clicked. */}
      <KpiBreakdown
        detail={kpiDetail}
        onClose={() => setOpenKpi(null)}
        onOpenLead={(l) => setOpenLead({
          ...l,
          agentName: scorecards.find(c => c.agentId === l.agent_id)?.name || 'Unknown agent',
        })}
        onSelectAgent={(id) => setSelectedAgent(prev => (prev === id ? null : id))}
      />

      {/* The two questions a sales manager cannot answer from counts alone:
          which channels are worth the money, and why deals die. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SourcePerformance rows={sources} onSelectSource={showSource} />
        <LossAnalysis analysis={losses} onSelectReason={showReason} />
      </div>

      {groupDetail && (
        <KpiBreakdown
          detail={groupDetail}
          onClose={() => setGroupDetail(null)}
          onOpenLead={(l) => setOpenLead({
            ...l,
            agentName: scorecards.find(c => c.agentId === l.agent_id)?.name || 'Unknown agent',
          })}
        />
      )}

      {/* Pipeline + leaderboard, then activity across the full width */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PipelineFunnel pipeline={pipeline} />

        <Leaderboard
          rows={leaderboard}
          onSelect={setSelectedAgent}
          selectedId={selectedAgent}
        />

        <div className="bg-card border border-border rounded-xl lg:col-span-2">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-base font-semibold text-foreground">Latest Contact Activity</h3>
            <p className="text-xs text-muted-foreground mt-0.5">What agents have logged, newest first</p>
          </div>
          <div className="px-5 py-4">
            {recentInteractions.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-11 h-11 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
                  <Icon name="MessageSquare" size={19} color="var(--color-muted-foreground)" />
                </div>
                <p className="text-sm font-medium text-foreground">No contact logged yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Agents record calls, meetings and site visits from their portal. Nothing shows here until they do.
                </p>
              </div>
            ) : (
              <ul className="space-y-3 max-h-80 overflow-y-auto">
                {recentInteractions.slice(0, 20).map(i => {
                  const t = typeMeta(i.interaction_type);
                  const o = outcomeMeta(i.outcome);
                  return (
                    <li key={i.id} className="flex gap-2.5">
                      <Icon name={t.icon} size={14} color="var(--color-muted-foreground)" className="mt-0.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="text-sm font-medium text-foreground truncate">
                            {i.contact_name || t.label}
                          </span>
                          <span className="text-xs text-muted-foreground">· {i.agentName}</span>
                          {o && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <span className={`w-1.5 h-1.5 rounded-full ${SENTIMENT_DOT[o.sentiment]}`} />
                              {o.label}
                            </span>
                          )}
                          <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                            {fmtWhen(i.occurred_at)}
                          </span>
                        </div>
                        {i.summary && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{i.summary}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Agent scorecards */}
      <AgentScorecards
        scorecards={scorecards}
        onSelect={setSelectedAgent}
        selectedId={selectedAgent}
        onExport={onExport}
      />

      {selectedCard && (
        <AgentDetail
          card={selectedCard}
          leads={selectedLeads}
          interactions={selectedTouches}
          onClose={() => setSelectedAgent(null)}
          onOpenLead={(l) => setOpenLead({ ...l, agentName: selectedCard.name })}
        />
      )}

      {/* Leads gone quiet — the intervention list */}
      <div className="bg-card border border-border rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-foreground">Leads Gone Quiet</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Open leads with no recorded contact for {STALE_CONTACT_DAYS}+ days, coldest first · click a row for the full record
            </p>
          </div>
          {onExport && neglectedLeads.length > 0 && (
            <button
              onClick={() => onExport(
                neglectedLeads.map(l => ({
                  lead: l.full_name, phone: l.phone || '', email: l.email || '',
                  agent: l.agentName, stage: l.stage,
                  days_quiet: l.quietDays ?? 'never contacted',
                  interest: l.asset_interest || '', registered: fmtDate(l.created_at),
                })),
                'crm_leads_gone_quiet',
              )}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="Download" size={12} color="currentColor" />
              Export
            </button>
          )}
        </div>

        {neglectedLeads.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="w-11 h-11 rounded-full bg-emerald-100 mx-auto flex items-center justify-center mb-3">
              <Icon name="CheckCircle2" size={19} color="#059669" />
            </div>
            <p className="text-sm font-medium text-foreground">Nothing has gone cold</p>
            <p className="text-xs text-muted-foreground mt-1">
              Every open lead has been contacted within the last {STALE_CONTACT_DAYS} days.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-5 py-2.5">Lead</th>
                  <th className="text-left font-medium px-3 py-2.5">Agent</th>
                  <th className="text-left font-medium px-3 py-2.5">Stage</th>
                  <th className="text-right font-medium px-3 py-2.5">Contacts</th>
                  <th className="text-right font-medium px-5 py-2.5">Quiet for</th>
                </tr>
              </thead>
              <tbody>
                {neglectedLeads.slice(0, 50).map(l => (
                  <tr
                    key={l.id}
                    onClick={() => setOpenLead(l)}
                    className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <p className="font-medium text-foreground hover:text-primary">{l.full_name}</p>
                      <p className="text-xs text-muted-foreground">{l.phone || l.email || '—'}</p>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{l.agentName}</td>
                    <td className="px-3 py-3 text-muted-foreground capitalize">
                      {(l.stage || '').replace(/_/g, ' ')}
                    </td>
                    <td className="px-3 py-3 text-right text-muted-foreground">{l.interaction_count || 0}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                        (l.quietDays ?? 999) >= 30 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {l.quietDays === null ? 'Never contacted' : `${l.quietDays} days`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {neglectedLeads.length > 50 && (
              <p className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
                Showing the 50 coldest of {neglectedLeads.length}. Export for the full list.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Read-only: a supervisor watches the relationship, they do not log
          contacts or book follow-ups on an agent's behalf. */}
      {openLead && (
        <CustomerRecord
          lead={openLead}
          agentName={openLead.agentName}
          readOnly
          onClose={() => setOpenLead(null)}
        />
      )}
    </div>
  );
};

export default CrmOversightTab;
