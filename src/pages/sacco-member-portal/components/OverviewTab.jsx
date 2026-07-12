import React from 'react';
import Icon from '../../../components/AppIcon';
import { Card, StatCard, Badge, Table, EmptyState, KES, fmtDate } from '../../sacco-dashboard/components/_shared';

// Quick-action tile (BRS 5.1 — three taps to core actions).
const Action = ({ icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-muted transition-all text-left"
  >
    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,193,221,0.12)' }}>
      <Icon name={icon} size={17} color="#1da8c5" />
    </div>
    <span className="text-sm font-semibold text-foreground">{label}</span>
  </button>
);

const OverviewTab = ({ ctx, onNavigate }) => {
  const { stats, contributions, loans, motions } = ctx;

  const recentContributions = contributions.slice(0, 5);
  const activeLoans = loans.filter((l) => l.status === 'active');

  return (
    <div className="space-y-6">
      {/* Mini-cards (BRS 5.1) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Savings" value={KES(stats.totalSavings)} icon="PiggyBank" tone="success" />
        <StatCard label="Loan Balance" value={KES(stats.loanBalance)} icon="Banknote" tone="warning"
          hint={activeLoans.length ? `${activeLoans.length} active loan${activeLoans.length > 1 ? 's' : ''}` : 'No active loans'} />
        <StatCard label="Next Due Date" value={stats.nextDue ? fmtDate(stats.nextDue) : '—'} icon="Calendar" tone="primary" />
        <StatCard label="Share Value" value={KES(stats.shareValue)} icon="PieChart" tone="muted" />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Action icon="Banknote" label="Apply for a Loan" onClick={() => onNavigate('loans')} />
        <Action icon="Vote" label={stats.openMotions > 0 ? `Vote Now (${stats.openMotions} open)` : 'Vote Now'} onClick={() => onNavigate('voting')} />
        <Action icon="FileSpreadsheet" label="View Statement" onClick={() => onNavigate('statement')} />
        <Action icon="PieChart" label="My Shares" onClick={() => onNavigate('shares')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Recent contributions">
          {recentContributions.length === 0 ? (
            <EmptyState icon="PiggyBank" title="No contributions yet" />
          ) : (
            <Table columns={['Due', 'Type', 'Amount', 'Status']}>
              {recentContributions.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(c.due_date || c.paid_date)}</td>
                  <td className="py-2.5 pr-4 capitalize text-foreground">{c.contribution_type}</td>
                  <td className="py-2.5 pr-4 font-medium text-foreground">{KES(c.amount)}</td>
                  <td className="py-2.5 pr-4"><Badge status={c.status} /></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Open votes">
          {motions.filter((m) => m.status === 'open').length === 0 ? (
            <EmptyState icon="Vote" title="No open votes" hint="You'll be notified here when a motion opens for voting." />
          ) : (
            <div className="space-y-3">
              {motions.filter((m) => m.status === 'open').map((m) => (
                <button key={m.id} onClick={() => onNavigate('voting')}
                  className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-border hover:bg-muted transition-all text-left">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.ballot_type === 'secret' ? 'Secret ballot' : 'Open ballot'}
                      {m.voting_end ? ` · closes ${fmtDate(m.voting_end)}` : ''}
                    </p>
                  </div>
                  <Icon name="ChevronRight" size={16} color="currentColor" />
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default OverviewTab;
