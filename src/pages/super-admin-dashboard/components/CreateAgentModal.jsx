import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { formatKEPhone } from '../../../utils/phoneUtils';

// Agent tiers — the plan sets the commission earned per admin/company the agent registers.
const AGENT_PLANS = [
  { id: 'bronze', name: 'Bronze', fee: 500,  blurb: 'Registers admin accounts and uses the sales agent portal.' },
  { id: 'gold',   name: 'Gold',   fee: 1500, blurb: 'Registers admins and onboards/trains them on the system.' },
];

const CreateAgentModal = ({ onClose, onCreate }) => {
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
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <Icon name="UserPlus" size={18} color="#1A56DB" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Create Sales Agent</h3>
              <p className="text-xs text-muted-foreground">New agent account with credentials</p>
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
              { label: 'Region',               key: 'region',         type: 'text',     placeholder: 'Nairobi' },
              { label: 'Commission Rate (%)',  key: 'commissionRate', type: 'number',   placeholder: '5' },
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

          {/* Agent plan — sets the commission earned per admin/company registered */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Agent Plan *</label>
            <select
              value={form.plan}
              onChange={e => set('plan', e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            >
              {AGENT_PLANS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — KES {p.fee.toLocaleString()} per admin
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
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
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

export default CreateAgentModal;