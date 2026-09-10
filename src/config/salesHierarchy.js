/**
 * The sales floor's org chart, as one vocabulary.
 *
 * A sales manager is an `agents` row with `agent_role = 'manager'`; the agents
 * under them are ordinary rows joined by `agent_manager_assignments`. Migration
 * 20260903120000 explains why a manager is not a separate table and not a
 * `user_profiles.role` — read that header before changing anything here.
 *
 * This module exists because FOUR screens need the same answers and none of
 * them owns the question: the admin dashboard's team panel, the super admin's
 * agent list, the sales agent portal's team view, and the exports that come off
 * all three. If two of them ever disagreed about who counts as an administrator
 * or what "one manager unless authorised" means, the disagreement would show up
 * as a screen that offers an action the database then refuses.
 *
 * EVERY RULE HERE IS A MIRROR, NEVER THE ORIGINAL. The database enforces all of
 * it — is_hierarchy_admin(), the CHECK constraints, uq_agent_one_active_primary
 * and assign_agent_to_manager()'s own guards. What is written here only decides
 * whether the UI bothers asking. A check that exists solely in this file is a
 * check that a POST can walk straight past, so when these fall out of step with
 * the SQL, the SQL is right.
 */

// ── What an agents row can be ──────────────────────────────────────────────
export const AGENT_ROLES = [
  {
    value: 'agent',
    label: 'Sales Agent',
    icon: 'User',
    tone: 'text-blue-700 bg-blue-100',
    description: 'Works their own book and reports to a sales manager.',
  },
  {
    value: 'manager',
    label: 'Sales Manager',
    icon: 'UserCog',
    tone: 'text-purple-700 bg-purple-100',
    description: 'Carries their own number and answers for a team of agents.',
  },
];

/**
 * Describe a role value, including one this list has never heard of.
 *
 * Unknown values are titled and kept rather than dropped: a row that exists
 * must appear somewhere, and silently filtering it would make a roster
 * under-count without saying so. Same stance as crmVocabulary's sourceMeta.
 */
export const agentRoleMeta = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  const hit = AGENT_ROLES.find(r => r.value === key);
  if (hit) return { ...hit, known: true };

  return {
    value: key || 'agent',
    label: key ? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Sales Agent',
    icon: 'User',
    tone: 'text-muted-foreground bg-muted',
    description: '',
    known: false,
  };
};

export const isManager = (agent) => String(agent?.agent_role ?? '').toLowerCase() === 'manager';

// ── Who may redraw the chart ───────────────────────────────────────────────
/**
 * The exact list in public.is_hierarchy_admin().
 *
 * director and manager are NOT here, and the omission is the point. `director`
 * is a role a tenant admin can create, so including it would let a tenant mint
 * itself the power to rewrite its own org chart; `manager` is the office-side
 * supervisory role, and a supervisor who could reassign agents could hand
 * themselves another team's book.
 */
export const HIERARCHY_ADMIN_ROLES = ['super_admin', 'admin', 'sacco_admin'];

export const canAdministerHierarchy = (role) =>
  HIERARCHY_ADMIN_ROLES.includes(String(role ?? '').trim());

// ── The rules, echoed for the form ─────────────────────────────────────────
/**
 * Why this assignment would be refused, or null if it would be accepted.
 *
 * Returns the message the database would raise, in the database's words, so a
 * user who trips a rule reads the same sentence whether the check happened
 * here or 200ms later in Postgres.
 */
export const explainAssignmentProblem = ({
  agent, manager, isPrimary = true, note = '', existingLinks = [],
} = {}) => {
  if (!agent)   return 'Choose a sales agent.';
  if (!manager) return 'Choose a sales manager.';

  if (agent.id === manager.id) return 'An agent cannot report to themselves.';

  if (!isManager(manager)) {
    return `${manager.full_name || 'That agent'} is not a sales manager — promote them first.`;
  }
  if (isManager(agent)) {
    return 'A sales manager cannot be assigned under another manager.';
  }
  if (agent.admin_id && manager.admin_id && agent.admin_id !== manager.admin_id) {
    return 'A reporting line can only be drawn between two agents of your own organisation.';
  }

  // "…unless authorised otherwise": the second manager is the exception, and an
  // exception nobody wrote a reason for is not one.
  if (!isPrimary && String(note ?? '').trim() === '') {
    return 'An additional manager needs a written authorisation — say why this agent reports to two managers.';
  }

  const live = existingLinks.filter(l => l?.is_active && l?.agent_id === agent.id);
  const already = live.find(l => l.manager_id === manager.id);
  if (already && Boolean(already.is_primary) === Boolean(isPrimary)) {
    return `${agent.full_name || 'That agent'} already reports to ${manager.full_name || 'this manager'}.`;
  }
  if (already?.is_primary && !isPrimary) {
    return `${manager.full_name || 'That manager'} already manages ${agent.full_name || 'this agent'} as their primary manager.`;
  }

  return null;
};

/**
 * What the caller is about to do, in a sentence, for the confirm step.
 *
 * Reassignment is the case worth spelling out: it is destructive to a
 * relationship somebody set up on purpose, and "assign" reads like an addition
 * when it is in fact a move.
 */
export const describeAssignment = ({ agent, manager, isPrimary = true, current = null } = {}) => {
  const who  = agent?.full_name || 'This agent';
  const whom = manager?.full_name || 'this manager';

  if (!isPrimary) return `${who} will also report to ${whom}, on your authorisation.`;
  if (current && current.id !== manager?.id) {
    return `${who} will move from ${current.full_name || 'their current manager'} to ${whom}.`;
  }
  return `${who} will report to ${whom}.`;
};

// ── Reading the chart ──────────────────────────────────────────────────────
/**
 * The roster, grouped under the manager each agent reports to.
 *
 * Agents with no live line are NOT dropped — they come back under `unassigned`,
 * because an agent nobody manages is the single most useful thing this screen
 * can surface, and a grouping that hides them makes the org chart look complete
 * when it is not.
 *
 * `additional` on each team holds the authorised second lines, kept apart from
 * `agents` so a manager's headcount is not inflated by agents they share.
 */
export const buildOrgChart = (agents = [], assignments = []) => {
  const byId = new Map((agents || []).filter(Boolean).map(a => [a.id, a]));
  const live = (assignments || []).filter(l => l?.is_active);

  const managers = (agents || []).filter(isManager);
  const teams = managers.map((manager) => {
    const lines = live.filter(l => l.manager_id === manager.id);
    const primary = lines.filter(l => l.is_primary);
    const extra   = lines.filter(l => !l.is_primary);

    return {
      manager,
      agents: primary.map(l => ({ agent: byId.get(l.agent_id) || null, link: l }))
                     .filter(e => e.agent),
      additional: extra.map(l => ({ agent: byId.get(l.agent_id) || null, link: l }))
                       .filter(e => e.agent),
    };
  });

  const managed = new Set(live.filter(l => l.is_primary).map(l => l.agent_id));
  const unassigned = (agents || []).filter(a => !isManager(a) && !managed.has(a.id));

  return { teams, managers, unassigned };
};

/** Every live manager of one agent, primary first. */
export const managersOf = (agentId, assignments = [], agents = []) => {
  const byId = new Map((agents || []).filter(Boolean).map(a => [a.id, a]));
  return (assignments || [])
    .filter(l => l?.is_active && l.agent_id === agentId)
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)))
    .map(l => ({ link: l, manager: byId.get(l.manager_id) || null }))
    .filter(e => e.manager);
};

// ── The team's numbers ─────────────────────────────────────────────────────
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Roll up the rows public.sales_team_stats() returns.
 *
 * Summed here rather than in SQL only because the rows are already in hand and
 * a team is a handful of people — the per-agent figures themselves come from
 * the database, which is the half that must not be reduced client-side over a
 * paginated array.
 *
 * `attainment` is deliberately null rather than 0 when the team carries no
 * target. Zero reads as "achieved nothing"; null reads as "nobody set a
 * target", and those call for different conversations.
 */
export const summariseTeam = (rows = []) => {
  const list = (rows || []).filter(Boolean);

  const totals = list.reduce((acc, r) => ({
    leads:      acc.leads      + num(r.leads_total),
    open:       acc.open       + num(r.leads_open),
    won:        acc.won        + num(r.leads_won),
    lost:       acc.lost       + num(r.leads_lost),
    pipeline:   acc.pipeline   + num(r.pipeline_value),
    clients:    acc.clients    + num(r.clients_total),
    sales:      acc.sales      + num(r.sales_total),
    commission: acc.commission + num(r.commission_total),
    target:     acc.target     + num(r.target_amount),
  }), {
    leads: 0, open: 0, won: 0, lost: 0, pipeline: 0,
    clients: 0, sales: 0, commission: 0, target: 0,
  });

  const settled = totals.won + totals.lost;

  return {
    ...totals,
    headcount: list.length,
    active: list.filter(r => (r.agent_status || 'active') === 'active').length,
    // Settled deals only: a rate that counted deals still in play reads low all
    // quarter and then climbs for reasons nobody acted on.
    conversionRate: settled ? Math.round((totals.won / settled) * 100) : null,
    attainment: totals.target > 0 ? Math.round((totals.sales / totals.target) * 100) : null,
  };
};

/** CSV rows for a team roster, in the shape a spreadsheet reader expects. */
export const buildTeamExport = (rows = [], managerName = '') => (rows || []).filter(Boolean).map(r => ({
  'Manager': managerName || '',
  'Agent': r.full_name || '',
  'Code': r.agent_code || '',
  'Email': r.email || '',
  'Phone': r.phone || '',
  'Region': r.region || '',
  'Status': r.agent_status || '',
  'Reporting line': r.is_primary ? 'Primary' : 'Additional (authorised)',
  'Since': r.assigned_at ? new Date(r.assigned_at).toISOString().slice(0, 10) : '',
  'Leads': num(r.leads_total),
  'Open leads': num(r.leads_open),
  'Won': num(r.leads_won),
  'Lost': num(r.leads_lost),
  'Pipeline value': num(r.pipeline_value),
  'Clients': num(r.clients_total),
  'Total sales': num(r.sales_total),
  'Commission': num(r.commission_total),
  'Target': num(r.target_amount),
}));
