import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { formatKEPhone } from '../../../utils/phoneUtils';
import { getPasswordError } from '../../../utils/validation';
import { KENYA_COUNTIES } from '../../../config/kenyaCounties';

// Agent tiers — the plan sets the commission earned per SACCO the agent
// registers (same amounts as the company-side agent plans).
const AGENT_PLANS = [
  { id: 'bronze', name: 'Bronze', fee: 500,  blurb: 'Registers saccos and uses the sales agent portal.' },
  { id: 'gold',   name: 'Gold',   fee: 1500, blurb: 'Registers saccos and onboards/trains them on the system.' },
];

// ── Create modal ─────────────────────────────────────────────────────────────
const CreateSaccoAgentModal = ({ onClose, onCreate }) => {
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', password: '',
    region: '', commissionRate: 5, targetAmount: '', plan: 'bronze',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.fullName || !form.email || !form.password) {
      setError('Full name, email, and password are required.');
      return;
    }
    const pwErr = getPasswordError(form.password);
    if (pwErr) { setError(pwErr); return; }
    setLoading(true);
    setError('');
    try {
      await onCreate({ ...form, targetAmount: parseFloat(form.targetAmount) || 0 });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create agent. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-100 flex items-center justify-center">
              <Icon name="UserPlus" size={18} color="#0891b2" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Create Sacco Sales Agent</h3>
              <p className="text-xs text-muted-foreground">This agent registers saccos, not companies</p>
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
              { label: 'Full Name *',          key: 'fullName',       type: 'text',     placeholder: 'John Kamau' },
              { label: 'Email *',              key: 'email',          type: 'email',    placeholder: 'john@example.com' },
              { label: 'Password *',           key: 'password',       type: 'password', placeholder: '••••••••' },
              { label: 'Phone',                key: 'phone',          type: 'tel',      placeholder: '+254 7XX XXX XXX' },
              { label: 'Region',               key: 'region',         type: 'select',   placeholder: 'Select region', options: KENYA_COUNTIES },
              { label: 'Commission Rate (%)',  key: 'commissionRate', type: 'number',   placeholder: '5' },
            ].map(field => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{field.label}</label>
                {field.type === 'select' ? (
                  <select
                    value={form[field.key]}
                    onChange={e => set(field.key, e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                    style={{ color: form[field.key] ? undefined : 'var(--color-muted-foreground)' }}
                  >
                    <option value="" disabled>{field.placeholder}</option>
                    {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : (
                  <input
                    type={field.type}
                    value={form[field.key]}
                    onChange={e => set(field.key, field.key === 'phone' ? formatKEPhone(e.target.value) : e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
                  />
                )}
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

          {/* Agent plan — sets the commission earned per sacco registered */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Agent Plan *</label>
            <select
              value={form.plan}
              onChange={e => set('plan', e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            >
              {AGENT_PLANS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — KES {p.fee.toLocaleString()} per sacco
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {AGENT_PLANS.find(p => p.id === form.plan)?.blurb}
            </p>
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
            style={{ background: 'linear-gradient(135deg, #0891b2, #0e7490)' }}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Creating…
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

// ── Tab: sacco sales agents list ─────────────────────────────────────────────
const SaccoAgentsTab = ({ agents, onCreateAgent, onExport }) => {
  const [showCreate, setShowCreate] = useState(false);
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const handleExport = () => {
    onExport(agents.map(a => ({
      name: a.full_name, email: a.email, phone: a.phone,
      code: a.agent_code, region: a.region, plan: a.agent_plan || 'bronze',
      commission_rate: a.commission_rate,
      total_sales: a.total_sales,
      total_commission: a.total_commission,
      target: a.target_amount,
      status: a.agent_status,
    })), 'sacco_sales_agents');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Sacco Sales Agents</h2>
          <p className="text-xs text-muted-foreground">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} registering saccos on your behalf
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Icon name="Download" size={13} color="currentColor" />
            Export
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #0891b2, #0e7490)' }}
          >
            <Icon name="Plus" size={13} color="currentColor" />
            New Agent
          </button>
        </div>
      </div>

      {/* Agents table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Icon name="Users" size={32} color="currentColor" />
            <p className="text-sm mt-2">No sacco sales agents yet</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #0891b2, #0e7490)' }}
            >
              Create First Agent
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  {['Agent', 'Code', 'Region', 'Plan', 'Commission', 'Total Sales', 'Target', 'Status'].map(h => (
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
                          <div className="w-8 h-8 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-700 font-bold text-sm flex-shrink-0">
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
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                          (agent.agent_plan || 'bronze') === 'gold'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {agent.agent_plan || 'bronze'}
                        </span>
                      </td>
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
        <CreateSaccoAgentModal
          onClose={() => setShowCreate(false)}
          onCreate={onCreateAgent}
        />
      )}
    </div>
  );
};

export default SaccoAgentsTab;
