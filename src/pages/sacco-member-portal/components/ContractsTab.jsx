import React from 'react';
import { Card, Badge, Table, EmptyState, fmtDate } from '../../sacco-dashboard/components/_shared';

// Read-only list of contracts the administrator has assigned to this member
// (loan agreements, membership agreements, …).
const ContractsTab = ({ ctx }) => {
  const { contracts } = ctx;

  return (
    <Card title="My contracts" subtitle="Agreements assigned to you by your sacco administrator">
      {contracts.length === 0 ? (
        <EmptyState icon="FileText" title="No contracts yet" hint="Contracts your administrator assigns to you (e.g. signed loan agreements) appear here." />
      ) : (
        <Table columns={['Contract', 'Type', 'Added', 'Status', '']}>
          {contracts.map((c) => (
            <tr key={c.id} className="border-b border-border/60">
              <td className="py-2.5 pr-4 font-medium text-foreground">{c.contract_name}</td>
              <td className="py-2.5 pr-4 capitalize text-muted-foreground">{(c.contract_type || '—').replace(/_/g, ' ')}</td>
              <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(c.created_at)}</td>
              <td className="py-2.5 pr-4"><Badge status={c.status || (c.is_template ? 'draft' : 'active')} /></td>
              <td className="py-2.5 pr-0 text-right">
                {c.file_url && (
                  <a href={c.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-semibold hover:underline">
                    View / download
                  </a>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
};

export default ContractsTab;
