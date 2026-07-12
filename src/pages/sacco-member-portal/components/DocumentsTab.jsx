import React from 'react';
import Icon from '../../../components/AppIcon';
import { Card, Table, EmptyState, fmtDate } from '../../sacco-dashboard/components/_shared';

const TYPE_LABELS = {
  constitution: 'Constitution', bylaws: 'Bylaws', policy: 'Policies',
  minutes: 'Meeting minutes', resolution: 'Resolutions', other: 'Other documents',
};
const TYPE_ORDER = ['constitution', 'bylaws', 'policy', 'resolution', 'minutes', 'other'];

// BRS 5.5 — read-only Bylaws & Constitution portal.
const DocumentsTab = ({ ctx }) => {
  const { documents } = ctx;

  const groups = TYPE_ORDER
    .map((t) => ({ type: t, docs: documents.filter((d) => (d.doc_type || 'other') === t) }))
    .filter((g) => g.docs.length > 0);

  return (
    <Card title="Governance documents" subtitle="Your sacco's constitution, bylaws, policies, minutes and resolutions">
      {documents.length === 0 ? (
        <EmptyState icon="ScrollText" title="No documents published yet" hint="Your chairman/secretary publishes governing documents here." />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.type}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{TYPE_LABELS[g.type]}</p>
              <Table columns={['Document', 'Version', 'Effective', '']}>
                {g.docs.map((d) => (
                  <tr key={d.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center gap-2 font-medium text-foreground">
                        <Icon name="FileText" size={14} color="#1da8c5" />
                        {d.title}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{d.version || '—'}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(d.effective_date)}</td>
                    <td className="py-2.5 pr-0 text-right">
                      {d.file_url && (
                        <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-semibold hover:underline">
                          View / download
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default DocumentsTab;
