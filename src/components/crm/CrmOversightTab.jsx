import React, { useState, useMemo } from 'react';
import Icon from '../AppIcon';
import { useCrmOversight, PIPELINE_STAGES } from '../../hooks/useCrmOversight';
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

const KpiCard = ({ label, value, subtitle, icon, tone = 'text-foreground', iconColor = 'var(--color-muted-foreground)' }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="flex items-center gap-2 mb-1">
      <Icon name={icon} size={15} color={iconColor} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
    <p className={`text-2xl font-bold ${tone}`}>{value}</p>
    {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
  </div>
);

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
const SORTS = [
  { value: 'open',     label: 'Open leads',    fn: (a, b) => b.pipeline.open - a.pipeline.open },
  { value: 'activity', label: 'Contacts/week', fn: (a, b) => b.touchesThisWeek - a.touchesThisWeek },
  { value: 'overdue',  label: 'Overdue',       fn: (a, b) => b.overdueFollowUps - a.overdueFollowUps },
  { value: 'quiet',    label: 'Neglected',     fn: (a, b) => b.neglectedLeads - a.neglectedLeads },
  { value: 'name',     label: 'Name',          fn: (a, b) => a.name.localeCompare(b.name) },
];

const AgentScorecards = ({ scorecards, onSelect, selectedId, onExport }) => {
  const [sort, setSort] = useState('open');

  const sorted = useMemo(() => {
    const fn = SORTS.find(s => s.value === sort)?.fn;
    return fn ? [...scorecards].sort(fn) : scorecards;
  }, [scorecards, sort]);

  const handleExport = () => {
    onExport?.(
      scorecards.map(c => ({
        agent:              c.name,
        code:               c.code || '',
        region:             c.region || '',
        total_leads:        c.pipeline.total,
        open_leads:         c.pipeline.open,
        converted:          c.pipeline.converted,
        conversion_rate:    c.pipeline.conversionRate ?? '',
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
            {SORTS.map(s => (
              <button
                key={s.value}
                onClick={() => setSort(s.value)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  sort === s.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {s.label}
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
                <th className="text-left font-medium px-5 py-2.5">Agent</th>
                <th className="text-right font-medium px-3 py-2.5">Open</th>
                <th className="text-right font-medium px-3 py-2.5">Converted</th>
                <th className="text-right font-medium px-3 py-2.5" title="Contacts logged in the last 7 days">Week</th>
                <th className="text-right font-medium px-3 py-2.5" title="Share of rated contacts that went well">Positive</th>
                <th className="text-right font-medium px-3 py-2.5" title="Follow-ups scheduled but past their date">Overdue</th>
                <th className="text-right font-medium px-3 py-2.5" title={`Open leads with no contact for ${STALE_CONTACT_DAYS}+ days`}>Neglected</th>
                <th className="text-right font-medium px-5 py-2.5">Last contact</th>
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
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                        {initials(c.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.code || '—'}{c.region ? ` · ${c.region}` : ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-foreground">{c.pipeline.open}</td>
                  <td className="px-3 py-3 text-right text-foreground">{c.pipeline.converted}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${
                    c.touchesThisWeek === 0 ? 'text-red-600' : 'text-emerald-600'
                  }`}>
                    {c.touchesThisWeek}
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">
                    {c.positiveRate === null ? '—' : `${c.positiveRate}%`}
                  </td>
                  <td className={`px-3 py-3 text-right font-semibold ${
                    c.overdueFollowUps > 0 ? 'text-red-600' : 'text-muted-foreground'
                  }`}>
                    {c.overdueFollowUps}
                  </td>
                  <td className={`px-3 py-3 text-right font-semibold ${
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
    canView, isPlatformOwner, scorecards, totals, pipeline,
    neglectedLeads, recentInteractions, leads, interactions,
    loading, error, refetch,
  } = useCrmOversight();

  const [selectedAgent, setSelectedAgent] = useState(null);
  // The customer record sits above everything: a supervisor opens it from the
  // agent drill-down or from the gone-quiet list, and it carries the agent's
  // name so they know whose relationship they are reading.
  const [openLead, setOpenLead] = useState(null);

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
          value={totals.openLeads}
          subtitle={`${totals.totalLeads} registered in total`}
          icon="Target"
          iconColor="#d97706"
        />
        <KpiCard
          label="Contacts this week"
          value={totals.touchesThisWeek}
          subtitle={`${totals.interactions} logged all time`}
          icon="Activity"
          iconColor="#059669"
        />
        <KpiCard
          label="Needs attention"
          value={totals.overdueFollowUps + totals.neglectedLeads}
          subtitle={`${totals.overdueFollowUps} overdue · ${totals.neglectedLeads} leads gone quiet`}
          icon="AlertTriangle"
          iconColor={totals.overdueFollowUps + totals.neglectedLeads > 0 ? '#dc2626' : '#6b7280'}
          tone={totals.overdueFollowUps + totals.neglectedLeads > 0 ? 'text-red-600' : 'text-foreground'}
        />
      </div>

      {/* Pipeline + recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PipelineFunnel pipeline={pipeline} />

        <div className="bg-card border border-border rounded-xl">
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
