// src/components/CreateAgentModal.jsx
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import Icon from './AppIcon';
import { formatKEPhone } from '../../utils/phoneUtils';

const CreateAgentModal = ({ onClose, onSuccess, companies }) => {
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', password: '',
    company_id: '', commission_rate: 5, agent_code: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Create auth user
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: form.email,
        password: form.password,
        email_confirm: true,
      });
      if (authErr) throw authErr;

      // 2. Create user profile
      const { data: profile, error: profileErr } = await supabase
        .from('user_profiles')
        .insert({
          id: authData.user.id,
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          role: 'sales_agent',
          company_id: form.company_id || null,
          is_active: true,
        })
        .select()
        .single();
      if (profileErr) throw profileErr;

      // 3. Create agent record
      const { error: agentErr } = await supabase.from('agents').insert({
        user_id: authData.user.id,
        company_id: form.company_id || null,
        agent_code: form.agent_code || `AGT-${Date.now()}`,
        agent_status: 'active',
        commission_rate: form.commission_rate,
      });
      if (agentErr) throw agentErr;

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-gray-900">Create Sales Agent</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon name="X" size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {error && <p className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">{error}</p>}
          
          {[
            { key: 'full_name', label: 'Full Name', type: 'text' },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'phone', label: 'Phone', type: 'tel' },
            { key: 'password', label: 'Temporary Password', type: 'password' },
            { key: 'agent_code', label: 'Agent Code (optional)', type: 'text' },
            { key: 'commission_rate', label: 'Commission Rate (%)', type: 'number' },
          ].map(({ key, label, type }) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
              <input
                type={type}
                value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: key === 'phone' ? formatKEPhone(e.target.value) : e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Assign to Company</label>
            <select
              value={form.company_id}
              onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- No company (global agent) --</option>
              {(companies || []).map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold disabled:opacity-50">
            {loading ? 'Creating...' : 'Create Agent'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateAgentModal;