import React from 'react';
import Icon from '../../../components/AppIcon';

const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

const WithdrawalRequestsTab = ({ requests = [], onExport, onApprove, onReject }) => {
  const pendingCount = requests.filter(r => (r.status || 'pending') === 'pending').length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-foreground">Withdrawal Requests</h2>
          <p className="text-xs text-muted-foreground">{requests.length} total request{requests.length !== 1 ? 's' : ''} · {pendingCount} pending</p>
        </div>
        <button
          onClick={() => onExport?.(requests.map(r => ({
            agent: r.agent?.full_name || 'Unknown',
            agent_code: r.agent?.agent_code || '—',
            email: r.agent?.email || '—',
            amount: r.total_withdrawn || 0,
            description: r.description || 'Withdrawal request',
            status: r.status || 'pending',
            created_at: r.created_at,
          })), 'withdrawal_requests')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <Icon name="Download" size={13} color="currentColor" />
          Export
        </button>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Icon name="Wallet" size={28} color="currentColor" />
          <p className="text-sm mt-2">No withdrawal requests yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                {['Agent', 'Code', 'Amount', 'Narration', 'Submitted', 'Status', 'Action'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {requests.map(req => {
                const status = (req.status || 'pending').toLowerCase();
                const badgeClass = status === 'approved'
                  ? 'bg-emerald-100 text-emerald-700'
                  : status === 'rejected'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700';

                return (
                  <tr key={req.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-foreground">{req.agent?.full_name || 'Unknown agent'}</p>
                        <p className="text-xs text-muted-foreground">{req.agent?.email || 'No email'}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-foreground">{req.agent?.agent_code || '—'}</span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">{fmt(req.total_withdrawn)}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs">{req.description || 'Withdrawal request'}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(req.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${badgeClass}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onApprove?.(req.id)}
                          disabled={status === 'approved'}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => onReject?.(req.id)}
                          disabled={status === 'rejected'}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default WithdrawalRequestsTab;
