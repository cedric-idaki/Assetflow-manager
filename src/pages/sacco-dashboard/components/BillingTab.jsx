import React from 'react';
import { Card, StatCard, Table, Badge, KES, fmtDate } from './_shared';

const BillingTab = ({ ctx }) => {
  const { stats, invoices } = ctx;
  const bill = stats.billing;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Current tier" value={stats.tier?.name} hint={stats.tier?.memberRange} icon="Layers" />
        <StatCard label="Active members" value={stats.activeMembers} hint="Billed members" icon="Users" />
        <StatCard label="Estimated monthly bill" value={KES(bill.total)} icon="Receipt" tone="success" />
      </div>

      {/* Invoices */}
      <Card title="Invoices" subtitle={`${invoices.length} on record`}>
        {invoices.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No invoices generated yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Monthly invoices run on the 1st (automated billing is a Phase 2 enhancement).</p>
          </div>
        ) : (
          <Table columns={['Period', 'Tier', 'Members', 'Base', 'Per-member', 'Storage', 'Total', 'Status']}>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-foreground">{fmtDate(inv.period)}</td>
                <td className="py-2.5 pr-4 capitalize text-muted-foreground">{inv.tier}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{inv.active_members}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(inv.base_fee)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(inv.per_member_fee_total)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(inv.storage_fee)}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(inv.total)}</td>
                <td className="py-2.5 pr-4"><Badge status={inv.status} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
};

export default BillingTab;
