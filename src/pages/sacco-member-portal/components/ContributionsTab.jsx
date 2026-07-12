import React from 'react';
import { Card, StatCard, Badge, Table, EmptyState, GhostButton, KES, fmtDate } from '../../sacco-dashboard/components/_shared';

const ContributionsTab = ({ ctx }) => {
  const { contributions, exportCSV } = ctx;

  const paid    = contributions.filter((c) => c.status === 'paid');
  const pending = contributions.filter((c) => c.status === 'pending');
  const overdue = contributions.filter((c) => c.status === 'overdue');
  const totalPenalties = contributions.reduce((s, c) => s + parseFloat(c.penalty_amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Saved" value={KES(paid.reduce((s, c) => s + parseFloat(c.amount || 0), 0))} icon="PiggyBank" tone="success" />
        <StatCard label="Pending" value={pending.length} icon="Clock" tone="warning" />
        <StatCard label="Overdue" value={overdue.length} icon="AlertTriangle" tone={overdue.length ? 'warning' : 'muted'} />
        <StatCard label="Penalties" value={KES(totalPenalties)} icon="Receipt" tone="muted" />
      </div>

      <Card
        title="My contributions"
        subtitle="Your full contribution history"
        actions={<GhostButton icon="Download" onClick={() => exportCSV(contributions, 'my_contributions')}>Export</GhostButton>}
      >
        {contributions.length === 0 ? (
          <EmptyState icon="PiggyBank" title="No contributions recorded yet" />
        ) : (
          <Table columns={['Due date', 'Paid date', 'Type', 'Amount', 'Penalty', 'Reference', 'Status']}>
            {contributions.map((c) => (
              <tr key={c.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(c.due_date)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(c.paid_date)}</td>
                <td className="py-2.5 pr-4 capitalize text-foreground">{c.contribution_type}</td>
                <td className="py-2.5 pr-4 font-medium text-foreground">{KES(c.amount)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{parseFloat(c.penalty_amount) > 0 ? KES(c.penalty_amount) : '—'}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{c.reference || '—'}</td>
                <td className="py-2.5 pr-4"><Badge status={c.status} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
};

export default ContributionsTab;
