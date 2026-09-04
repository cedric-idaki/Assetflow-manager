import React, { useState, useMemo } from 'react';
import Icon from '../AppIcon';
import { Sk, Empty, StatTile, fmtDate, fmtMoney, initials } from '../crm/crmFormat';
import AssignManagerModal from './AssignManagerModal';
import { useSalesHierarchy } from '../../hooks/useSalesHierarchy';
import { agentRoleMeta, buildTeamExport } from '../../config/salesHierarchy';

/**
 * The sales org chart, and the controls that redraw it.
 *
 * Shared by the admin dashboard and the super admin dashboard because both run
 * a sales force and the shape is identical — the only difference is whose
 * agents RLS returns, which is settled server-side and not by a prop.
 *
 * THE UNASSIGNED LIST IS THE POINT OF THIS SCREEN. Teams are pleasant to look
 * at; the agents nobody manages are the thing an administrator has to act on,
 * and they are the reason the panel leads with a count of them rather than a
 * count of teams. buildOrgChart deliberately returns them instead of quietly
 * filtering them out.
 *
 * Every mutating control is gated on `canManage`, which mirrors
 * public.is_hierarchy_admin(). The gate is cosmetic: the RPCs re-check it, the
 * assignment table has no write policy, and a guard trigger refuses hand-edits
 * to the agents columns. Hiding the buttons is a courtesy to people who cannot
 * use them, not a security boundary.
 */

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

const RoleBadge = ({ role }) => {
  const meta = agentRoleMeta(role);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.tone}`}>
      <Icon name={meta.icon} size={11} color="currentColor" />
      {meta.label}
    </span>
  );
};

const Avatar = ({ name, tone = 'teal' }) => (
  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${
    tone === 'purple' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'
  }`}>
    {initials(name)}
  </div>
);

/** One manager, their roster, and what the team is worth. */
const TeamCard = ({
  team, summary, canManage, saving,
  onReassign, onDeactivate, onDemote, onExport, onOpenHistory,
}) => {
  const [open, setOpen] = useState(true);
  const { manager, agents, additional } = team;
  const roster = [...agents, ...additional];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-border">
        <Avatar name={manager.full_name} tone="purple" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-foreground text-sm truncate">{manager.full_name}</p>
            <RoleBadge role="manager" />
            <StatusPill status={manager.agent_status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {manager.agent_code}
            {manager.region ? ` · ${manager.region}` : ''}
            {' · '}
            {agents.length} agent{agents.length !== 1 ? 's' : ''}
            {additional.length > 0 && ` · ${additional.length} shared`}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onExport(team)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Icon name="Download" size={13} color="currentColor" />
            Export
          </button>
          {canManage && (
            <button
              onClick={() => onDemote(manager, agents.length)}
              disabled={saving}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-red-600 hover:border-red-200 transition-all disabled:opacity-50"
            >
              <Icon name="UserMinus" size={13} color="currentColor" />
              Step down
            </button>
          )}
          <button
            onClick={() => setOpen(o => !o)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label={open ? 'Collapse team' : 'Expand team'}
          >
            <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} color="var(--color-muted-foreground)" />
          </button>
        </div>
      </div>

      {/* The team's numbers. Straight from sales_team_stats() — never reduced
          over a fetched page of rows. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border border-b border-border">
        {[
          { label: 'Team sales',  value: fmtMoney(summary.sales) },
          { label: 'Pipeline',    value: fmtMoney(summary.pipeline) },
          { label: 'Open leads',  value: summary.open },
          {
            label: 'Attainment',
            value: summary.attainment === null ? 'No target' : `${summary.attainment}%`,
          },
        ].map(s => (
          <div key={s.label} className="px-4 py-3">
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p className="text-sm font-bold text-foreground mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {open && (
        roster.length === 0 ? (
          <Empty
            icon="Users"
            title="No agents on this team yet"
            hint="Assign an agent from the list below to start building the team."
          />
        ) : (
          <div className="divide-y divide-border">
            {roster.map(({ agent, link }) => (
              <div key={link.id} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                <Avatar name={agent.full_name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground truncate">{agent.full_name}</p>
                    {!link.is_primary && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800"
                        title={link.authorization_note || 'Authorised additional reporting line'}
                      >
                        <Icon name="ShieldCheck" size={11} color="currentColor" />
                        Shared
                      </span>
                    )}
                    <StatusPill status={agent.agent_status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {agent.agent_code}
                    {agent.region ? ` · ${agent.region}` : ''}
                    {' · since '}{fmtDate(link.assigned_at)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onOpenHistory(agent)}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                    title="Reporting history"
                  >
                    <Icon name="History" size={14} color="var(--color-muted-foreground)" />
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => onReassign(agent)}
                        disabled={saving}
                        className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-50"
                      >
                        Reassign
                      </button>
                      <button
                        onClick={() => onDeactivate(link, agent, manager)}
                        disabled={saving}
                        className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-red-600 hover:border-red-200 transition-all disabled:opacity-50"
                      >
                        {link.is_primary ? 'Unassign' : 'End'}
                      </button>
                    </>
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

/** Every reporting line an agent has ever been on, live and closed. */
const HistoryDrawer = ({ agent, lines, agentsById, onClose }) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h3 className="text-base font-semibold text-foreground">Reporting history</h3>
          <p className="text-xs text-muted-foreground">{agent?.full_name} · {agent?.agent_code}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
          <Icon name="X" size={18} color="var(--color-muted-foreground)" />
        </button>
      </div>

      <div className="overflow-y-auto">
        {lines.length === 0 ? (
          <Empty icon="History" title="No reporting lines recorded" hint="This agent has never been assigned to a manager." />
        ) : (
          <div className="divide-y divide-border">
            {lines.map((l) => (
              <div key={l.id} className="px-6 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground">
                    {agentsById.get(l.manager_id)?.full_name || 'Former manager'}
                  </p>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    l.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
                  }`}>
                    {l.is_active ? 'Current' : 'Ended'}
                  </span>
                  {!l.is_primary && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                      Additional
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmtDate(l.assigned_at)} → {l.ended_at ? fmtDate(l.ended_at) : 'present'}
                </p>
                {(l.authorization_note || l.end_reason) && (
                  <p className="text-xs text-muted-foreground mt-1 italic">
                    {l.end_reason || l.authorization_note}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
);

const SalesTeamPanel = ({ onExport }) => {
  const {
    canManage, agents, managers, orgChart, liveLinks,
    loading, saving, error,
    assignManager, setLinkActive, setAgentRole,
    statsFor, summaryFor, primaryManagerOf, historyForAgent, refetch,
  } = useSalesHierarchy();

  const [assignFor, setAssignFor]   = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [promoting, setPromoting]   = useState(false);
  const [notice, setNotice]         = useState(null);

  const agentsById = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents]);
  const floor = summaryFor(null);

  const say = (message, tone = 'success') => {
    setNotice({ message, tone });
    setTimeout(() => setNotice(null), 6000);
  };

  const handleDeactivate = async (link, agent, manager) => {
    const question = link.is_primary
      ? `Unassign ${agent.full_name} from ${manager.full_name}?\n\n`
        + 'They will report to nobody until you assign another manager, and '
        + `${manager.full_name} will lose sight of their pipeline. The record of this `
        + 'reporting line is kept.'
      : `End ${manager.full_name}'s additional oversight of ${agent.full_name}?\n\n`
        + 'Their primary reporting line is unaffected.';

    if (!window.confirm(question)) return;

    const res = await setLinkActive(link.id, false, 'Ended from the sales team panel');
    if (res?.error) say(res.error, 'error');
    else say(`${agent.full_name} no longer reports to ${manager.full_name}.`);
  };

  const handleDemote = async (manager, teamSize) => {
    const question = teamSize > 0
      ? `Step ${manager.full_name} down from sales manager?\n\n`
        + `${teamSize} agent${teamSize !== 1 ? 's' : ''} currently report${teamSize === 1 ? 's' : ''} to them. `
        + 'Every one of those reporting lines will be closed and those agents will '
        + 'be left unassigned until you give them a new manager.'
      : `Step ${manager.full_name} down from sales manager?\n\n`
        + 'They keep their own book, code and commission — only the manager role is removed.';

    if (!window.confirm(question)) return;

    const res = await setAgentRole(manager.id, 'agent');
    if (res?.error) say(res.error, 'error');
    else say(`${manager.full_name} is no longer a sales manager.`);
  };

  const handlePromote = async (agent) => {
    const res = await setAgentRole(agent.id, 'manager');
    if (res?.error) say(res.error, 'error');
    else say(`${agent.full_name} is now a sales manager.`);
    setPromoting(false);
  };

  /**
   * The roster as a file.
   *
   * Built from the rows already on screen rather than re-queried, so the
   * download and the table can never disagree. The lead and pipeline columns
   * come from statsFor(), which is the same source the team header uses.
   */
  const exportTeam = (team) => {
    const stats = new Map(statsFor(team.manager.id).map(r => [r.agent_id, r]));
    const roster = [...team.agents, ...team.additional].map(({ agent, link }) => ({
      ...(stats.get(agent.id) || {}),
      full_name:   agent.full_name,
      agent_code:  agent.agent_code,
      email:       agent.email,
      phone:       agent.phone,
      region:      agent.region,
      agent_status: agent.agent_status,
      is_primary:  link.is_primary,
      assigned_at: link.assigned_at,
      sales_total:      agent.total_sales,
      commission_total: agent.total_commission,
      target_amount:    agent.target_amount,
    }));

    onExport?.(
      buildTeamExport(roster, team.manager.full_name),
      `team_${(team.manager.full_name || 'manager').toLowerCase().replace(/\s+/g, '_')}`,
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <Sk key={i} className="h-20" />)}
        </div>
        <Sk className="h-48" />
        <Sk className="h-32" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {notice && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm ${
          notice.tone === 'error'
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <Icon name={notice.tone === 'error' ? 'AlertCircle' : 'CheckCircle'} size={15} color="currentColor" />
          {notice.message}
        </div>
      )}

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
          <h2 className="text-base font-semibold text-foreground">Sales team structure</h2>
          <p className="text-xs text-muted-foreground">
            {orgChart.teams.length} team{orgChart.teams.length !== 1 ? 's' : ''}
            {' · '}{orgChart.unassigned.length} agent{orgChart.unassigned.length !== 1 ? 's' : ''} unassigned
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setPromoting(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #7e22ce, #6b21a8)' }}
          >
            <Icon name="UserCog" size={13} color="currentColor" />
            New Sales Manager
          </button>
        )}
      </div>

      {/* The whole floor, at a glance. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile icon="UserCog" label="Sales managers" value={managers.length} />
        <StatTile
          icon="Users"
          label="Agents managed"
          value={liveLinks.filter(l => l.is_primary).length}
          hint={orgChart.unassigned.length ? `${orgChart.unassigned.length} still unassigned` : 'Everybody has a manager'}
          tone={orgChart.unassigned.length ? 'warn' : 'good'}
        />
        <StatTile icon="TrendingUp" label="Floor sales" value={fmtMoney(floor.sales)} />
        <StatTile
          icon="Target"
          label="Floor attainment"
          value={floor.attainment === null ? 'No target' : `${floor.attainment}%`}
          tone={floor.attainment === null ? 'default' : floor.attainment >= 80 ? 'good' : 'warn'}
        />
      </div>

      {/* Teams */}
      {orgChart.teams.length === 0 ? (
        <div className="bg-card border border-border rounded-xl">
          <Empty
            icon="Network"
            title="No sales managers yet"
            hint="Promote one of your sales agents to manager, then assign agents to report to them. Everything they sell rolls up to their manager automatically."
            action={canManage ? (
              <button
                onClick={() => setPromoting(true)}
                className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: 'linear-gradient(135deg, #7e22ce, #6b21a8)' }}
              >
                Promote an agent
              </button>
            ) : null}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {orgChart.teams.map(team => (
            <TeamCard
              key={team.manager.id}
              team={team}
              summary={summaryFor(team.manager.id)}
              canManage={canManage}
              saving={saving}
              onReassign={setAssignFor}
              onDeactivate={handleDeactivate}
              onDemote={handleDemote}
              onExport={exportTeam}
              onOpenHistory={setHistoryFor}
            />
          ))}
        </div>
      )}

      {/* The list that actually needs acting on. */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Agents without a manager</h3>
            <p className="text-xs text-muted-foreground">
              Their leads, clients and sales roll up to nobody until they are assigned.
            </p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
            orgChart.unassigned.length ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'
          }`}>
            {orgChart.unassigned.length}
          </span>
        </div>

        {orgChart.unassigned.length === 0 ? (
          <Empty icon="CheckCircle" title="Every agent reports to a manager" />
        ) : (
          <div className="divide-y divide-border">
            {orgChart.unassigned.map(agent => (
              <div key={agent.id} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                <Avatar name={agent.full_name} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{agent.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {agent.agent_code}{agent.region ? ` · ${agent.region}` : ''} · {fmtMoney(agent.total_sales)} sold
                  </p>
                </div>
                <StatusPill status={agent.agent_status} />
                {canManage && (
                  <button
                    onClick={() => setAssignFor(agent)}
                    disabled={saving || managers.length === 0}
                    title={managers.length === 0 ? 'Promote an agent to manager first' : undefined}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}
                  >
                    <Icon name="UserPlus" size={13} color="currentColor" />
                    Assign manager
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Promote: pick an agent to make a manager. */}
      {promoting && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="text-base font-semibold text-foreground">Promote to sales manager</h3>
                <p className="text-xs text-muted-foreground">
                  They keep their own book, code and commission, and gain a team.
                </p>
              </div>
              <button onClick={() => setPromoting(false)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                <Icon name="X" size={18} color="var(--color-muted-foreground)" />
              </button>
            </div>

            <div className="overflow-y-auto divide-y divide-border">
              {agents.filter(a => a.agent_role !== 'manager').length === 0 ? (
                <Empty icon="Users" title="No agents to promote" hint="Create a sales agent first." />
              ) : agents.filter(a => a.agent_role !== 'manager').map(agent => (
                <button
                  key={agent.id}
                  onClick={() => handlePromote(agent)}
                  disabled={saving}
                  className="w-full flex items-center gap-3 px-6 py-3 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  <Avatar name={agent.full_name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{agent.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {agent.agent_code}{agent.region ? ` · ${agent.region}` : ''}
                    </p>
                  </div>
                  <Icon name="ChevronRight" size={16} color="var(--color-muted-foreground)" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {assignFor && (
        <AssignManagerModal
          agent={assignFor}
          managers={managers}
          currentManager={primaryManagerOf(assignFor)}
          existingLinks={liveLinks}
          saving={saving}
          onAssign={assignManager}
          onClose={() => setAssignFor(null)}
        />
      )}

      {historyFor && (
        <HistoryDrawer
          agent={historyFor}
          lines={[
            ...liveLinks.filter(l => l.agent_id === historyFor.id),
            ...historyForAgent(historyFor.id),
          ]}
          agentsById={agentsById}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
};

export default SalesTeamPanel;
