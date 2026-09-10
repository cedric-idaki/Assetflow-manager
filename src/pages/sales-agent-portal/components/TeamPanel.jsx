import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { Sk, Empty, StatTile, fmtMoney, fmtDate, fmtAgo, initials } from '../../../components/crm/crmFormat';
import { useSalesTeam } from '../../../hooks/useSalesTeam';
import { buildTeamExport } from '../../../config/salesHierarchy';
import { stageMeta, sourceMeta, lostReasonMeta } from '../../../config/crmVocabulary';
import { formatCompactMoney } from '../../../utils/pipelineValue';

/**
 * A sales manager's team, inside the portal they already use.
 *
 * The manager is an ordinary agent everywhere else on this page — their own
 * leads, their own wallet, their own target. This view answers the one question
 * a flat portal could never answer: what are the people reporting to me doing.
 *
 * READ ONLY, and visibly so. There is no button here that writes to an agent's
 * book, because there is no policy that would accept one — a manager watches
 * their team's pipeline, they do not work it. Every action offered is a way of
 * LOOKING at something (open the roster, sort by value, export), and the two
 * lists that are not just numbers are the two a manager can actually act on by
 * talking to somebody: deals nobody has touched, and deals that were lost.
 *
 * Sorted by MONEY, not by name or headcount. The agent sitting on 40 dead leads
 * is not the one to speak to first; the agent sitting on the biggest untouched
 * pipeline is.
 */

const Avatar = ({ name }) => (
  <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-xs flex-shrink-0">
    {initials(name)}
  </div>
);

const StatusPill = ({ status }) => {
  const s = String(status || 'active');
  const tone = s === 'active'   ? 'bg-emerald-100 text-emerald-700'
             : s === 'on_leave' ? 'bg-yellow-100 text-yellow-700'
             : 'bg-red-100 text-red-700';
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${tone}`}>
      {s.replace(/_/g, ' ')}
    </span>
  );
};

/** A target bar. Grey when there is no target — not a full bar, not an empty one. */
const TargetBar = ({ sold, target }) => {
  if (!target || target <= 0) {
    return <span className="text-[11px] text-muted-foreground">No target set</span>;
  }
  const pct = Math.min(100, Math.round((sold / target) * 100));
  return (
    <div className="w-28">
      <div className="flex justify-between text-[11px] mb-0.5">
        <span className="text-muted-foreground">{pct}%</span>
        <span className="text-muted-foreground">{formatCompactMoney(target)}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444',
          }}
        />
      </div>
    </div>
  );
};

const TeamPanel = ({ onExport }) => {
  const {
    isTeamLead, team, summary, pipelineByAgent, needsAttention,
    byStage, ownerOf, loading, error, refetch,
  } = useSalesTeam();

  const [tab, setTab] = useState('roster');

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <Sk key={i} className="h-20" />)}
        </div>
        <Sk className="h-64" />
      </div>
    );
  }

  // The portal hides the toggle for a non-manager, so reaching this is a URL or
  // a reassignment that landed while the page was open. Saying so plainly beats
  // an empty roster that looks like a loading bug.
  if (!isTeamLead) {
    return (
      <div className="bg-card border border-border rounded-xl">
        <Empty
          icon="Users"
          title="You do not manage a team"
          hint="Only sales managers have a team view. An administrator sets this up."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border bg-red-50 border-red-200 text-red-700 text-sm">
          <Icon name="AlertCircle" size={15} color="currentColor" />
          {error}
          <button onClick={refetch} className="ml-auto text-xs font-semibold underline">Retry</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border rounded-xl px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">My team</h2>
          <p className="text-xs text-muted-foreground">
            {summary.headcount} agent{summary.headcount !== 1 ? 's' : ''} reporting to you
            {summary.active !== summary.headcount && ` · ${summary.active} active`}
          </p>
        </div>
        <button
          onClick={() => onExport?.(buildTeamExport(team), 'my_team')}
          disabled={team.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-50"
        >
          <Icon name="Download" size={13} color="currentColor" />
          Export
        </button>
      </div>

      {team.length === 0 ? (
        <div className="bg-card border border-border rounded-xl">
          <Empty
            icon="Users"
            title="No agents report to you yet"
            hint="An administrator assigns agents to your team. Everything they sell will roll up here automatically."
          />
        </div>
      ) : (
        <>
          {/* The team's numbers. From sales_team_stats() — the roll-up is done
              in SQL, so it counts the whole team and not a fetched page. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile icon="TrendingUp" label="Team sales" value={fmtMoney(summary.sales)} />
            <StatTile
              icon="Wallet"
              label="Open pipeline"
              value={fmtMoney(summary.pipeline)}
              hint={`${summary.open} open lead${summary.open !== 1 ? 's' : ''}`}
            />
            <StatTile
              icon="Target"
              label="Attainment"
              value={summary.attainment === null ? 'No target' : `${summary.attainment}%`}
              tone={summary.attainment === null ? 'default'
                  : summary.attainment >= 80 ? 'good' : 'warn'}
            />
            <StatTile
              icon="Percent"
              label="Conversion"
              value={summary.conversionRate === null ? '—' : `${summary.conversionRate}%`}
              hint={summary.conversionRate === null
                ? 'No deal settled yet'
                : `${summary.won} won · ${summary.lost} lost`}
              tone={summary.conversionRate === null ? 'default'
                  : summary.conversionRate >= 50 ? 'good' : 'warn'}
            />
          </div>

          {/* Sub-views */}
          <div className="flex rounded-xl border border-border overflow-hidden w-fit">
            {[
              { id: 'roster',    label: 'Roster',    icon: 'Users' },
              { id: 'pipeline',  label: 'Pipeline',  icon: 'GitBranch' },
              {
                id: 'attention',
                label: 'Needs attention',
                icon: 'AlertTriangle',
                badge: needsAttention.unworked.length,
              },
            ].map(v => (
              <button
                key={v.id}
                onClick={() => setTab(v.id)}
                className={`relative flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors ${
                  tab === v.id ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                <Icon name={v.icon} size={13} color="currentColor" />
                {v.label}
                {v.badge > 0 && (
                  <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {v.badge > 99 ? '99+' : v.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Roster ── */}
          {tab === 'roster' && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      {['Agent', 'Line', 'Leads', 'Won', 'Clients', 'Sales', 'Target', 'Status'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {team.map(r => (
                      <tr key={r.assignment_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar name={r.full_name} />
                            <div>
                              <p className="font-medium text-foreground">{r.full_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {r.agent_code}{r.region ? ` · ${r.region}` : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {r.is_primary ? (
                            <span className="text-xs text-muted-foreground">
                              Primary · since {fmtDate(r.assigned_at)}
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800"
                              title="This agent also reports to another manager"
                            >
                              <Icon name="ShieldCheck" size={11} color="currentColor" />
                              Shared
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground">{r.leads_open}</span>
                          <span className="text-xs text-muted-foreground"> open / {r.leads_total}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-emerald-600">{r.leads_won}</td>
                        <td className="px-4 py-3 text-foreground">{r.clients_total}</td>
                        <td className="px-4 py-3 font-semibold text-emerald-600">{fmtMoney(r.sales_total)}</td>
                        <td className="px-4 py-3">
                          <TargetBar sold={Number(r.sales_total) || 0} target={Number(r.target_amount) || 0} />
                        </td>
                        <td className="px-4 py-3"><StatusPill status={r.agent_status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Pipeline ── */}
          {tab === 'pipeline' && (
            <div className="space-y-4">
              {/* Where the team's work is sitting, stage by stage. */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">Team pipeline by stage</h3>
                {byStage.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No leads on the team yet.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {byStage.map(s => (
                      <div key={s.stage} className="border border-border rounded-lg p-3">
                        <p className="text-xs font-medium text-muted-foreground">{stageMeta(s.stage).label}</p>
                        <p className="text-lg font-bold text-foreground mt-1">{s.count}</p>
                        <p className="text-[11px] text-muted-foreground">{formatCompactMoney(s.value)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Who is carrying what. Richest first — see the header. */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-foreground">Open pipeline by agent</h3>
                  <p className="text-xs text-muted-foreground">
                    Weighted value applies each deal's own chance of closing.
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {pipelineByAgent.map(row => (
                    <div key={row.agent.agent_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <Avatar name={row.agent.full_name} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{row.agent.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.openLeads} open · {row.opportunities} opportunit{row.opportunities === 1 ? 'y' : 'ies'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">{fmtMoney(row.value)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {fmtMoney(row.weighted)} weighted
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Needs attention ── */}
          {tab === 'attention' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-foreground">Never contacted</h3>
                  <p className="text-xs text-muted-foreground">
                    Registered, then left alone. The cheapest pipeline on the team.
                  </p>
                </div>
                {needsAttention.unworked.length === 0 ? (
                  <Empty icon="CheckCircle" title="Every lead has been worked" />
                ) : (
                  <div className="divide-y divide-border">
                    {needsAttention.unworked.map(lead => (
                      <div key={lead.id} className="px-5 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground truncate">{lead.full_name}</p>
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                            {fmtAgo(lead.created_at, { never: 'just now' })}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {ownerOf(lead)} · {stageMeta(lead.stage).label}
                          {lead.source ? ` · ${sourceMeta(lead.source).label}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-foreground">Recently lost</h3>
                  <p className="text-xs text-muted-foreground">
                    Why the team is losing, in the team's own words.
                  </p>
                </div>
                {needsAttention.lost.length === 0 ? (
                  <Empty icon="Smile" title="Nothing lost yet" />
                ) : (
                  <div className="divide-y divide-border">
                    {needsAttention.lost.map(lead => (
                      <div key={lead.id} className="px-5 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground truncate">{lead.full_name}</p>
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                            {fmtDate(lead.lost_at)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {ownerOf(lead)} · {lostReasonMeta(lead.lost_reason).label}
                          {lead.deal_value ? ` · ${formatCompactMoney(lead.deal_value)}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TeamPanel;
