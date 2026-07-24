import React from 'react';
import { Card, StatCard, Badge, Table, EmptyState, GhostButton, KES, fmtDate } from '../../sacco-dashboard/components/_shared';

const ContributionsTab = ({ ctx }) => {
  const { contributions, contributionTypes, exportCSV } = ctx;

  const paid    = contributions.filter((c) => c.status === 'paid');
  const pending = contributions.filter((c) => c.status === 'pending');
  const overdue = contributions.filter((c) => c.status === 'overdue');
  const totalPenalties = contributions.reduce((s, c) => s + parseFloat(c.penalty_amount || 0), 0);

  // The admin's active types are the contributions members are expected to
  // make. My status per type comes from my own ledger rows of that type.
  const expected = (contributionTypes || []).map((t) => {
    const mine = contributions.filter(
      (c) => (c.contribution_type || '').toLowerCase() === t.name.toLowerCase()
    );
    const paidTotal = mine.filter((c) => c.status === 'paid')
      .reduce((s, c) => s + parseFloat(c.amount || 0), 0);
    const status = paidTotal > 0 ? 'paid'
      : mine.some((c) => c.status === 'overdue') ? 'overdue'
      : mine.some((c) => c.status === 'pending') ? 'pending'
      : 'due';
    return { ...t, paidTotal, status };
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Saved" value={KES(paid.reduce((s, c) => s + parseFloat(c.amount || 0), 0))} icon="PiggyBank" tone="success" />
        <StatCard label="Pending" value={pending.length} icon="Clock" tone="warning" />
        <StatCard label="Overdue" value={overdue.length} icon="AlertTriangle" tone={overdue.length ? 'warning' : 'muted'} />
        <StatCard label="Penalties" value={KES(totalPenalties)} icon="Receipt" tone="muted" />
      </div>

      <Card
        title="Expected contributions"
        subtitle="Contributions your sacco has set up for members"
      >
        {expected.length === 0 ? (
          <EmptyState icon="ListChecks" title="No contributions set up yet" hint="When your sacco creates a contribution — a building fund, holiday savings — it will appear here." />
        ) : (
          <Table columns={['Contribution', 'Frequency', 'Suggested amount', 'Due date', 'I have paid', 'My status']}>
            {expected.map((t) => (
              <tr key={t.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 font-medium text-foreground">
                  {t.name}
                  {t.description ? <span className="block text-xs text-muted-foreground font-normal">{t.description}</span> : null}
                </td>
                <td className="py-2.5 pr-4 capitalize text-muted-foreground">{t.frequency}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{parseFloat(t.suggested_amount) > 0 ? KES(t.suggested_amount) : '—'}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(t.due_date)}</td>
                <td className="py-2.5 pr-4 font-medium text-foreground">{t.paidTotal > 0 ? KES(t.paidTotal) : '—'}</td>
                <td className="py-2.5 pr-4"><Badge status={t.status} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

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
