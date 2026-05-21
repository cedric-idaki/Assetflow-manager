import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabase';

const ApprovalThresholdConfig = () => {
  const [thresholds, setThresholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    fetchThresholds();
  }, []);

  const fetchThresholds = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase?.from('approval_thresholds')?.select('*')?.order('display_name');
      if (error) throw error;
      setThresholds(data || []);
    } catch (err) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (threshold) => {
    setEditingId(threshold?.id);
    setEditValues({
      requires_approval: threshold?.requires_approval,
      auto_approve_below: threshold?.auto_approve_below || '',
      escalate_above: threshold?.escalate_above || '',
      sla_hours: threshold?.sla_hours || 24,
      bulk_eligible: threshold?.bulk_eligible,
      required_checker_role: threshold?.required_checker_role || 'admin',
    });
  };

  const saveEdit = async (id) => {
    setSaving(id);
    try {
      const { error } = await supabase?.from('approval_thresholds')?.update({
          requires_approval: editValues?.requires_approval,
          auto_approve_below: editValues?.auto_approve_below !== '' ? Number(editValues?.auto_approve_below) : null,
          escalate_above: editValues?.escalate_above !== '' ? Number(editValues?.escalate_above) : null,
          sla_hours: Number(editValues?.sla_hours),
          bulk_eligible: editValues?.bulk_eligible,
          required_checker_role: editValues?.required_checker_role,
        })?.eq('id', id);
      if (error) throw error;
      await fetchThresholds();
      setEditingId(null);
    } catch (err) {
      setError(err?.message);
    } finally {
      setSaving(null);
    }
  };

  const ACTION_ICONS = {
    payment_split_change: 'GitBranch',
    debt_adjustment: 'TrendingDown',
    commission_override: 'DollarSign',
    role_change: 'Shield',
    high_value_transaction: 'AlertTriangle',
    kyc_approval: 'UserCheck',
    user_creation: 'UserPlus',
    asset_deletion: 'Trash2',
    payment_refund: 'RotateCcw',
    system_config: 'Settings',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Icon name="Loader2" size={24} className="animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading thresholds...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Approval Thresholds</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Configure approval rules and SLA per action type</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchThresholds}>
          <Icon name="RefreshCw" size={14} className="mr-1" /> Refresh
        </Button>
      </div>
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-500">{error}</div>
      )}
      <div className="space-y-2">
        {thresholds?.map((threshold) => (
          <div key={threshold?.id} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon name={ACTION_ICONS?.[threshold?.action_type] || 'Settings'} size={16} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm">{threshold?.display_name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{threshold?.action_type?.replace(/_/g, ' ')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {editingId === threshold?.id ? (
                  <>
                    <Button variant="default" size="sm" onClick={() => saveEdit(threshold?.id)} disabled={saving === threshold?.id}
                      className="bg-green-600 hover:bg-green-700 text-white border-0">
                      {saving === threshold?.id ? <Icon name="Loader2" size={12} className="animate-spin" /> : <Icon name="Check" size={12} />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      <Icon name="X" size={12} />
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => startEdit(threshold)}>
                    <Icon name="Pencil" size={14} className="text-muted-foreground" />
                  </Button>
                )}
              </div>
            </div>

            {editingId === threshold?.id ? (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                <label className="flex items-center gap-2 col-span-2 md:col-span-1">
                  <input type="checkbox" checked={editValues?.requires_approval}
                    onChange={(e) => setEditValues(v => ({ ...v, requires_approval: e?.target?.checked }))}
                    className="rounded border-border" />
                  <span className="text-xs text-foreground">Requires Approval</span>
                </label>
                <label className="flex items-center gap-2 col-span-2 md:col-span-1">
                  <input type="checkbox" checked={editValues?.bulk_eligible}
                    onChange={(e) => setEditValues(v => ({ ...v, bulk_eligible: e?.target?.checked }))}
                    className="rounded border-border" />
                  <span className="text-xs text-foreground">Bulk Eligible</span>
                </label>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Auto-Approve Below (KES)</label>
                  <input type="number" value={editValues?.auto_approve_below}
                    onChange={(e) => setEditValues(v => ({ ...v, auto_approve_below: e?.target?.value }))}
                    placeholder="None"
                    className="w-full px-2 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Escalate Above (KES)</label>
                  <input type="number" value={editValues?.escalate_above}
                    onChange={(e) => setEditValues(v => ({ ...v, escalate_above: e?.target?.value }))}
                    placeholder="None"
                    className="w-full px-2 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">SLA (hours)</label>
                  <input type="number" value={editValues?.sla_hours}
                    onChange={(e) => setEditValues(v => ({ ...v, sla_hours: e?.target?.value }))}
                    className="w-full px-2 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Required Role</label>
                  <select value={editValues?.required_checker_role}
                    onChange={(e) => setEditValues(v => ({ ...v, required_checker_role: e?.target?.value }))}
                    className="w-full px-2 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                    <option value="compliance_officer">Compliance Officer</option>
                    <option value="manager">Manager</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`text-xs px-2 py-1 rounded-full ${
                  threshold?.requires_approval ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                }`}>
                  {threshold?.requires_approval ? 'Approval Required' : 'Auto-Approved'}
                </span>
                {threshold?.auto_approve_below && (
                  <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-600">
                    Auto ≤ KES {threshold?.auto_approve_below?.toLocaleString()}
                  </span>
                )}
                {threshold?.escalate_above && (
                  <span className="text-xs px-2 py-1 rounded-full bg-red-500/10 text-red-500">
                    Escalate &gt; KES {threshold?.escalate_above?.toLocaleString()}
                  </span>
                )}
                <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                  SLA: {threshold?.sla_hours}h
                </span>
                {threshold?.bulk_eligible && (
                  <span className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-500">Bulk OK</span>
                )}
                <span className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-500 capitalize">
                  {threshold?.required_checker_role?.replace(/_/g, ' ')}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ApprovalThresholdConfig;
