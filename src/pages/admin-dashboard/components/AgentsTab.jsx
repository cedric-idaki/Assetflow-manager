import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { formatKEPhone } from '../../../utils/phoneUtils';

const CreateAgentModal = ({ onClose, onCreate }) => {
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', password: '',
    region: '', commissionRate: 5, targetAmount: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.fullName || !form.email || !form.password) {
      setError('Full name, email and password are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onCreate({ ...form, targetAmount: parseFloat(form.targetAmount) || 0 });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create agent.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-100 flex items-center justify-center">
              <Icon name="UserPlus" size={18} color="#0d9488" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Create Sales Agent</h3>
              <p className="text-xs text-muted-foreground">Agent will work under your company</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <Icon name="AlertCircle" size={15} color="currentColor" />
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Full Name *', key: 'fullName', type: 'text', placeholder: 'Jane Wanjiru' },
              { label: 'Email *', key: 'email', type: 'email', placeholder: 'jane@example.com' },
              { label: 'Password *', key: 'password', type: 'password', placeholder: '••••••••' },
              { label: 'Phone', key: 'phone', type: 'tel', placeholder: '+254 7XX XXX XXX' },
              { label: 'Region', key: 'region', type: 'text', placeholder: 'Nairobi' },
              { label: 'Commission Rate (%)', key: 'commissionRate', type: 'number', placeholder: '5' },
            ].map(field => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{field.label}</label>
                <input
                  type={field.type}
                  value={form[field.key]}
                  onChange={e => set(field.key, field.key === 'phone' ? formatKEPhone(e.target.value) : e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Sales Target (KES)</label>
            <input
              type="number"
              value={form.targetAmount}
              onChange={e => set('targetAmount', e.target.value)}
              placeholder="e.g. 500000"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="p-3 rounded-lg bg-teal-50 border border-teal-200">
            <div className="flex items-start gap-2">
              <Icon name="Info" size={14} color="#0d9488" />
              <p className="text-xs text-teal-700">
                This agent will only be able to manage clients and assets under your company.
                Commission rate determines their earnings per successful sale.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Creating...
              </>
            ) : (
              <>
                <Icon name="UserPlus" size={15} color="currentColor" />
                Create Agent
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const AgentsTab = ({ agents, salesAnalytics, onCreateAgent, onExport }) => {
  const [showCreate, setShowCreate] = useState(false);
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Sales Agents</h2>
          <p className="text-xs text-muted-foreground">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} under your company
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onExport(agents.map(a => ({
              name: a.full_name, email: a.email, phone: a.phone,
              code: a.agent_code, region: a.region,
              commission_rate: a.commission_rate,
              total_sales: a.total_sales,
              total_commission: a.total_commission,
              target: a.target_amount,
              status: a.agent_status,
            })), 'agents')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Icon name="Download" size={13} color="currentColor" />
            Export
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}
          >
            <Icon name="Plus" size={13} color="currentColor" />
            New Agent
          </button>
        </div>
      </div>

      {/* Sales Performance Cards */}
      {salesAnalytics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {salesAnalytics.map(agent => {
            const pct = agent.target_amount > 0
              ? Math.min(100, Math.round((agent.total_sales / agent.target_amount) * 100))
              : 0;
            return (
              <div key={agent.id} className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-sm flex-shrink-0">
                    {(agent.full_name || 'A')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">{agent.full_name}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      agent.agent_status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {agent.agent_status || 'active'}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Sales</span>
                    <span className="font-semibold text-emerald-600">{fmt(agent.total_sales)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Commission</span>
                    <span className="font-medium text-blue-600">{fmt(agent.total_commission)}</span>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Target progress</span>
                      <span className="font-medium text-foreground">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${pct}%`,
                          background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Agents Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Icon name="Users" size={32} color="currentColor" />
            <p className="text-sm mt-2">No sales agents yet</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}
            >
              Create First Agent
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  {['Agent', 'Code', 'Region', 'Commission', 'Total Sales', 'Target', 'Status'].map(h => (
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
                          <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-sm flex-shrink-0">
                            {(agent.full_name || 'A')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{agent.full_name}</p>
                            <p className="text-xs text-muted-foreground">{agent.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-foreground">
                          {agent.agent_code}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{agent.region || '—'}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{agent.commission_rate}%</td>
                      <td className="px-4 py-3 font-semibold text-emerald-600">{fmt(agent.total_sales)}</td>
                      <td className="px-4 py-3">
                        <div>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">{pct}%</span>
                            <span className="text-muted-foreground">{fmt(agent.target_amount)}</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden w-20">
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
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
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

      {showCreate && (
        <CreateAgentModal
          onClose={() => setShowCreate(false)}
          onCreate={onCreateAgent}
        />
      )}
    </div>
  );
};

export default AgentsTab;