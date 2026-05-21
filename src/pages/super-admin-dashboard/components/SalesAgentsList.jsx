import React from 'react';
import Icon from '../../../components/AppIcon';

const SalesAgentsList = ({ agents, onCreateNew, onExport }) => {
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const [exportRange, setExportRange] = React.useState('all');
  const [customFrom, setCustomFrom]   = React.useState('');
  const [customTo, setCustomTo]       = React.useState('');

  const handleExport = () => {
    const now = new Date();
    const startOfDay   = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const startOfWeek  = (d) => { const s = startOfDay(d); s.setDate(s.getDate() - s.getDay()); return s; };
    const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
    const startOfYear  = (d) => new Date(d.getFullYear(), 0, 1);

    let from = null, to = null;
    if (exportRange === 'today')   { from = startOfDay(now);   to = now; }
    if (exportRange === 'weekly')  { from = startOfWeek(now);  to = now; }
    if (exportRange === 'monthly') { from = startOfMonth(now); to = now; }
    if (exportRange === 'yearly')  { from = startOfYear(now);  to = now; }
    if (exportRange === 'custom' && customFrom && customTo) {
      from = new Date(customFrom);
      to   = new Date(customTo);
      to.setHours(23, 59, 59, 999);
    }

    const filtered = from
      ? agents.filter(a => {
          const d = new Date(a.created_at || a.date_joined || 0);
          return d >= from && d <= to;
        })
      : agents;

    onExport(filtered.map(a => ({
      name: a.full_name, email: a.email, phone: a.phone,
      region: a.region, code: a.agent_code,
      commission_rate: a.commission_rate, total_sales: a.total_sales,
      total_commission: a.total_commission, target: a.target_amount,
      status: a.agent_status,
    })), 'sales_agents');
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-foreground">Sales Agents</h2>
          <p className="text-xs text-muted-foreground">{agents.length} agent{agents.length !== 1 ? 's' : ''} registered</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <select
              value={exportRange}
              onChange={e => setExportRange(e.target.value)}
              className="px-2 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="weekly">This week</option>
              <option value="monthly">This month</option>
              <option value="yearly">This year</option>
              <option value="custom">Custom range</option>
            </select>

            {exportRange === 'custom' && (
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none"
                />
              </div>
            )}

            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="Download" size={13} color="currentColor" />
              Export
            </button>
          </div>
          <button
            onClick={onCreateNew}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            <Icon name="Plus" size={13} color="currentColor" />
            New Agent
          </button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Icon name="Users" size={32} color="currentColor" />
          <p className="text-sm mt-2">No sales agents yet</p>
          <button
            onClick={onCreateNew}
            className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            Create First Agent
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                {['Agent', 'Code', 'Region', 'Commission', 'Total Sales', 'Commission Earned', 'Target', 'Status'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {agents.map(agent => {
                const pct = agent.target_amount > 0
                  ? Math.min(100, Math.round((agent.total_sales / agent.target_amount) * 100))
                  : 0;
                return (
                  <tr key={agent.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                          {(agent.full_name || 'A')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{agent.full_name}</p>
                          <p className="text-xs text-muted-foreground">{agent.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-foreground">{agent.agent_code}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{agent.region || '—'}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{agent.commission_rate}%</td>
                    <td className="px-4 py-3 font-semibold text-emerald-600">{fmt(agent.total_sales)}</td>
                    <td className="px-4 py-3 font-medium text-blue-600">{fmt(agent.total_commission)}</td>
                    <td className="px-4 py-3">
                      <div>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground">{pct}%</span>
                          <span className="text-muted-foreground">{fmt(agent.target_amount)}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden w-24">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                        agent.agent_status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        agent.agent_status === 'on_leave' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {(agent.agent_status || 'active').replace(/_/g, ' ')}
                      </span>
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

export default SalesAgentsList;