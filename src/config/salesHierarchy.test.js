/**
 * The org-chart vocabulary, and its agreement with the database.
 *
 * Two things here are two copies of one fact, and both fail SILENTLY when they
 * drift — which is why they are read out of the migration text rather than
 * retyped as expectations:
 *
 *   AGENT_ROLES values     <->  agents_agent_role_valid
 *   HIERARCHY_ADMIN_ROLES  <->  public.is_hierarchy_admin()
 *
 * Drift in the first means the UI offers a role the write rejects. Drift in the
 * second is worse and quieter: a role listed here but not in the SQL gets an
 * "Assign manager" button that always errors, and a role in the SQL but not
 * here silently loses a power it is supposed to have. Same technique as
 * clientOnboarding.test.js and planCatalogs.sync.test.js.
 *
 * Everything else is ordinary unit testing of the pure helpers — the grouping,
 * the roll-up and the rule messages the forms show.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  AGENT_ROLES, agentRoleMeta, isManager,
  HIERARCHY_ADMIN_ROLES, canAdministerHierarchy,
  explainAssignmentProblem, describeAssignment,
  buildOrgChart, managersOf,
  summariseTeam, buildTeamExport,
} from './salesHierarchy';

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260903120000_sales_manager_hierarchy.sql',
);
const sql = readFileSync(MIGRATION, 'utf8');

// ── Fixtures ───────────────────────────────────────────────────────────────
const TENANT = 'tenant-a';

const mgr = (id, name) => ({
  id, full_name: name, agent_role: 'manager', admin_id: TENANT,
  agent_code: `M-${id}`, agent_status: 'active',
});
const agt = (id, name) => ({
  id, full_name: name, agent_role: 'agent', admin_id: TENANT,
  agent_code: `A-${id}`, agent_status: 'active',
});
const link = (agentId, managerId, over = {}) => ({
  id: `link-${agentId}-${managerId}`,
  agent_id: agentId, manager_id: managerId,
  is_primary: true, is_active: true, admin_id: TENANT,
  assigned_at: '2026-09-01T08:00:00.000Z',
  ...over,
});

const M1 = mgr('m1', 'Grace Mwangi');
const M2 = mgr('m2', 'David Otieno');
const A1 = agt('a1', 'Jane Wanjiru');
const A2 = agt('a2', 'Peter Kimani');
const A3 = agt('a3', 'Aisha Noor');

describe('the vocabulary agrees with the database', () => {
  it('AGENT_ROLES carries exactly the values agents_agent_role_valid allows', () => {
    const from = sql.indexOf('agents_agent_role_valid\n  check');
    expect(from, 'CHECK constraint not found in the migration').toBeGreaterThan(-1);

    const clause = sql.slice(from, from + 200);
    const allowed = [...clause.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

    expect(allowed.length).toBeGreaterThan(0);
    expect(AGENT_ROLES.map(r => r.value).sort()).toEqual([...allowed].sort());
  });

  it('HIERARCHY_ADMIN_ROLES carries exactly the roles is_hierarchy_admin() accepts', () => {
    const from = sql.indexOf('function public.is_hierarchy_admin()');
    expect(from, 'is_hierarchy_admin() not found in the migration').toBeGreaterThan(-1);

    const body = sql.slice(from, sql.indexOf('$$;', from));
    const roles = [...body.matchAll(/'([a-z_]+)'::public\.user_role/g)].map(m => m[1]);

    expect(roles.length).toBeGreaterThan(0);
    expect([...HIERARCHY_ADMIN_ROLES].sort()).toEqual([...roles].sort());
  });

  it('leaves director and manager out of the administering roles', () => {
    // Stated as its own test because it is a decision, not an accident: both
    // roles are ones a tenant can mint or a team lead can hold, and either
    // would let somebody redraw the chart they are measured against.
    expect(canAdministerHierarchy('director')).toBe(false);
    expect(canAdministerHierarchy('manager')).toBe(false);
    expect(canAdministerHierarchy('sales_agent')).toBe(false);
    expect(canAdministerHierarchy('super_admin')).toBe(true);
    expect(canAdministerHierarchy('admin')).toBe(true);
  });

  it('treats a missing or unknown role as no authority', () => {
    expect(canAdministerHierarchy(undefined)).toBe(false);
    expect(canAdministerHierarchy(null)).toBe(false);
    expect(canAdministerHierarchy('')).toBe(false);
    expect(canAdministerHierarchy('ADMIN')).toBe(false);   // case-sensitive, like the enum
  });
});

describe('agentRoleMeta', () => {
  it('describes the two known roles', () => {
    expect(agentRoleMeta('manager').label).toBe('Sales Manager');
    expect(agentRoleMeta('agent').known).toBe(true);
  });

  it('keeps an unknown role rather than dropping it', () => {
    const meta = agentRoleMeta('regional_lead');
    expect(meta.known).toBe(false);
    expect(meta.label).toBe('Regional Lead');
  });

  it('falls back to Sales Agent when the row says nothing', () => {
    expect(agentRoleMeta(null).label).toBe('Sales Agent');
    expect(isManager({})).toBe(false);
    expect(isManager({ agent_role: 'manager' })).toBe(true);
  });
});

describe('explainAssignmentProblem', () => {
  it('accepts an ordinary primary assignment', () => {
    expect(explainAssignmentProblem({ agent: A1, manager: M1 })).toBeNull();
  });

  it('refuses an agent reporting to themselves', () => {
    expect(explainAssignmentProblem({ agent: A1, manager: { ...A1, agent_role: 'manager' } }))
      .toMatch(/report to themselves/i);
  });

  it('refuses a manager who is not a manager', () => {
    expect(explainAssignmentProblem({ agent: A1, manager: A2 })).toMatch(/not a sales manager/i);
  });

  it('refuses a manager under another manager', () => {
    expect(explainAssignmentProblem({ agent: M2, manager: M1 }))
      .toMatch(/cannot be assigned under another manager/i);
  });

  it('refuses a line across tenants', () => {
    const foreign = { ...M1, admin_id: 'tenant-b' };
    expect(explainAssignmentProblem({ agent: A1, manager: foreign }))
      .toMatch(/your own organisation/i);
  });

  it('refuses a second manager with no written authorisation', () => {
    expect(explainAssignmentProblem({ agent: A1, manager: M2, isPrimary: false, note: '   ' }))
      .toMatch(/written authorisation/i);
  });

  it('accepts a second manager once a reason is given', () => {
    expect(explainAssignmentProblem({
      agent: A1, manager: M2, isPrimary: false, note: 'Covering the coast region for Q4',
    })).toBeNull();
  });

  it('refuses a duplicate of a line that is already live', () => {
    expect(explainAssignmentProblem({
      agent: A1, manager: M1, existingLinks: [link('a1', 'm1')],
    })).toMatch(/already reports to/i);
  });

  it('refuses demoting the primary manager into an additional one', () => {
    // The database would close the primary line to reopen it as a secondary,
    // leaving the agent reporting to nobody in particular.
    expect(explainAssignmentProblem({
      agent: A1, manager: M1, isPrimary: false, note: 'shared',
      existingLinks: [link('a1', 'm1')],
    })).toMatch(/already manages/i);
  });

  it('allows reassignment to a different manager', () => {
    expect(explainAssignmentProblem({
      agent: A1, manager: M2, existingLinks: [link('a1', 'm1')],
    })).toBeNull();
  });

  it('ignores lines that are no longer live', () => {
    expect(explainAssignmentProblem({
      agent: A1, manager: M1, existingLinks: [link('a1', 'm1', { is_active: false })],
    })).toBeNull();
  });

  it('asks for the missing half rather than guessing', () => {
    expect(explainAssignmentProblem({ manager: M1 })).toMatch(/choose a sales agent/i);
    expect(explainAssignmentProblem({ agent: A1 })).toMatch(/choose a sales manager/i);
    expect(explainAssignmentProblem()).toMatch(/choose a sales agent/i);
  });
});

describe('describeAssignment', () => {
  it('names a reassignment as a move, not an addition', () => {
    expect(describeAssignment({ agent: A1, manager: M2, current: M1 }))
      .toBe('Jane Wanjiru will move from Grace Mwangi to David Otieno.');
  });

  it('says plainly when there is no previous manager', () => {
    expect(describeAssignment({ agent: A1, manager: M1 }))
      .toBe('Jane Wanjiru will report to Grace Mwangi.');
  });

  it('flags an additional manager as authorised', () => {
    expect(describeAssignment({ agent: A1, manager: M2, isPrimary: false }))
      .toMatch(/also report to David Otieno, on your authorisation/);
  });
});

describe('buildOrgChart', () => {
  const agents = [M1, M2, A1, A2, A3];
  const links = [
    link('a1', 'm1'),
    link('a2', 'm1'),
    link('a1', 'm2', { id: 'extra', is_primary: false }),
  ];

  it('groups each agent under the manager they report to', () => {
    const { teams } = buildOrgChart(agents, links);
    const grace = teams.find(t => t.manager.id === 'm1');
    expect(grace.agents.map(e => e.agent.id)).toEqual(['a1', 'a2']);
  });

  it('keeps an authorised second line out of the headcount', () => {
    const { teams } = buildOrgChart(agents, links);
    const david = teams.find(t => t.manager.id === 'm2');
    expect(david.agents).toHaveLength(0);
    expect(david.additional.map(e => e.agent.id)).toEqual(['a1']);
  });

  it('surfaces the agents nobody manages instead of hiding them', () => {
    const { unassigned } = buildOrgChart(agents, links);
    expect(unassigned.map(a => a.id)).toEqual(['a3']);
  });

  it('does not count a manager as unassigned', () => {
    const { unassigned } = buildOrgChart([M1, M2], []);
    expect(unassigned).toHaveLength(0);
  });

  it('ignores lines that are no longer live', () => {
    const { teams, unassigned } = buildOrgChart(agents, [link('a1', 'm1', { is_active: false })]);
    expect(teams.find(t => t.manager.id === 'm1').agents).toHaveLength(0);
    expect(unassigned.map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('drops a line whose agent is not in the roster rather than rendering a hole', () => {
    const { teams } = buildOrgChart([M1], [link('ghost', 'm1')]);
    expect(teams[0].agents).toHaveLength(0);
  });

  it('survives being handed nothing', () => {
    expect(buildOrgChart()).toEqual({ teams: [], managers: [], unassigned: [] });
  });
});

describe('managersOf', () => {
  it('lists every live manager, primary first', () => {
    const links = [
      link('a1', 'm2', { id: 'x', is_primary: false }),
      link('a1', 'm1'),
    ];
    expect(managersOf('a1', links, [M1, M2]).map(e => e.manager.id)).toEqual(['m1', 'm2']);
  });

  it('returns nothing for an agent with no live line', () => {
    expect(managersOf('a3', [link('a1', 'm1')], [M1])).toEqual([]);
  });
});

describe('summariseTeam', () => {
  const rows = [
    {
      full_name: 'Jane', agent_status: 'active',
      leads_total: 10, leads_open: 4, leads_won: 5, leads_lost: 1,
      pipeline_value: 300000, clients_total: 3,
      sales_total: 800000, commission_total: 40000, target_amount: 1000000,
    },
    {
      full_name: 'Peter', agent_status: 'on_leave',
      leads_total: 6, leads_open: 2, leads_won: 1, leads_lost: 3,
      pipeline_value: 150000, clients_total: 1,
      sales_total: 200000, commission_total: 10000, target_amount: 500000,
    },
  ];

  it('adds up the team', () => {
    const t = summariseTeam(rows);
    expect(t.headcount).toBe(2);
    expect(t.leads).toBe(16);
    expect(t.sales).toBe(1000000);
    expect(t.pipeline).toBe(450000);
    expect(t.clients).toBe(4);
  });

  it('counts only the agents actually working', () => {
    expect(summariseTeam(rows).active).toBe(1);
  });

  it('rates conversion on settled deals only', () => {
    // 6 won, 4 lost — the 6 still open are not evidence either way.
    expect(summariseTeam(rows).conversionRate).toBe(60);
  });

  it('reports attainment against the combined target', () => {
    // 1,000,000 sold against 1,500,000 of target. Attainment is the TEAM
    // number, not the average of two personal ones -- an agent on 10%% of a
    // tiny target must not drag a team that is otherwise on plan.
    expect(summariseTeam(rows).attainment).toBe(67);
  });

  it('says null, not zero, when nobody set a target', () => {
    // Zero reads as "achieved nothing"; null reads as "no target was set", and
    // those are different conversations.
    const t = summariseTeam([{ ...rows[0], target_amount: 0 }, { ...rows[1], target_amount: 0 }]);
    expect(t.attainment).toBeNull();
  });

  it('says null, not zero, when no deal has settled', () => {
    const t = summariseTeam([{ leads_total: 3, leads_open: 3, leads_won: 0, leads_lost: 0 }]);
    expect(t.conversionRate).toBeNull();
  });

  it('treats missing and unparseable figures as zero rather than NaN', () => {
    const t = summariseTeam([{ full_name: 'Ghost' }, { sales_total: 'abc' }]);
    expect(t.sales).toBe(0);
    expect(t.leads).toBe(0);
    expect(t.headcount).toBe(2);
  });

  it('survives being handed nothing', () => {
    const t = summariseTeam();
    expect(t.headcount).toBe(0);
    expect(t.sales).toBe(0);
    expect(t.attainment).toBeNull();
  });
});

describe('buildTeamExport', () => {
  it('spells out which reporting line each row is', () => {
    const rows = buildTeamExport([
      { full_name: 'Jane', is_primary: true,  assigned_at: '2026-09-01T08:00:00.000Z' },
      { full_name: 'Peter', is_primary: false, assigned_at: '2026-09-02T08:00:00.000Z' },
    ], 'Grace Mwangi');

    expect(rows[0]['Reporting line']).toBe('Primary');
    expect(rows[1]['Reporting line']).toBe('Additional (authorised)');
    expect(rows[0].Manager).toBe('Grace Mwangi');
    expect(rows[0].Since).toBe('2026-09-01');
  });

  it('writes empty cells rather than undefined for missing fields', () => {
    const [row] = buildTeamExport([{ full_name: 'Jane' }]);
    expect(row.Region).toBe('');
    expect(row.Since).toBe('');
    expect(row.Leads).toBe(0);
  });
});
