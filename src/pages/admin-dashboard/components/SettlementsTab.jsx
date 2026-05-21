import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import SettlementLetterModal from './SettlementLetterModal';
import Icon from '../../../components/AppIcon';

const fmt     = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const SettlementsTab = ({ adminId, clients }) => {
  const [plans,           setPlans]           = useState([]);
  const [assets,          setAssets]          = useState({});
  const [companyProfile,  setCompanyProfile]  = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [selectedPlan,    setSelectedPlan]    = useState(null);
  const [filter,          setFilter]          = useState('completed');

  const clientMap = Object.fromEntries((clients || []).map(c => [c.id, c]));

  const fetchData = useCallback(async () => {
    if (!adminId) return;
    setLoading(true);
    try {
      // Fetch all installment plans
      const { data: plansData } = await supabase
        .from('installment_plans')
        .select('*')
        .order('created_at', { ascending: false });

      setPlans(plansData || []);

      // Fetch related assets
      const assetIds = [...new Set((plansData || []).map(p => p.asset_id).filter(Boolean))];
      if (assetIds.length > 0) {
        const { data: assetsData } = await supabase
          .from('assets')
          .select('id, description, asset_code, make, model, year, color, serial_number, chassis_number, plate_number, asset_status')
          .in('id', assetIds);
        const map = {};
        (assetsData || []).forEach(a => { map[a.id] = a; });
        setAssets(map);
      }

      // Fetch company profile
      const { data: co } = await supabase
        .from('company_profiles')
        .select('*')
        .eq('admin_id', adminId)
        .single();
      setCompanyProfile(co);
    } catch (err) {
      console.error('SettlementsTab error:', err);
    } finally {
      setLoading(false);
    }
  }, [adminId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = plans.filter(p => {
    if (filter === 'completed') return p.plan_status === 'completed' || p.installments_paid >= p.total_installments;
    if (filter === 'active')    return p.plan_status === 'active' && p.installments_paid < p.total_installments;
    if (filter === 'overdue')   return p.plan_status === 'overdue';
    return true;
  });

  const completedCount = plans.filter(p => p.plan_status === 'completed' || p.installments_paid >= p.total_installments).length;
  const activeCount    = plans.filter(p => p.plan_status === 'active').length;
  const overdueCount   = plans.filter(p => p.plan_status === 'overdue').length;
  const totalSettled   = plans.filter(p => p.plan_status === 'completed').reduce((s, p) => s + parseFloat(p.total_amount || 0), 0);

  const selectedClient = selectedPlan ? clientMap[selectedPlan.client_id] : null;
  const selectedAsset  = selectedPlan ? assets[selectedPlan.asset_id] : null;

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Completed Plans',  value: completedCount,   icon: 'CheckCircle', color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
          { label: 'Active Plans',     value: activeCount,      icon: 'Clock',       color: 'text-blue-600',    bg: 'bg-blue-100 dark:bg-blue-900/30' },
          { label: 'Overdue Plans',    value: overdueCount,     icon: 'AlertCircle', color: 'text-red-600',     bg: 'bg-red-100 dark:bg-red-900/30' },
          { label: 'Total Settled',    value: fmt(totalSettled), icon: 'Award',      color: 'text-primary',     bg: 'bg-primary/10' },
        ].map(({ label, value, icon, color, bg }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bg}`}>
                <Icon name={icon} size={15} color="currentColor" className={color} />
              </div>
            </div>
            <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { id: 'completed', label: `Completed (${completedCount})` },
          { id: 'active',    label: `Active (${activeCount})` },
          { id: 'overdue',   label: `Overdue (${overdueCount})` },
          { id: 'all',       label: `All (${plans.length})` },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
              filter === f.id
                ? 'border-primary/30 text-primary bg-primary/8'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            style={filter === f.id ? { background: 'rgba(26,86,219,0.08)' } : {}}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40">
                {['Client', 'Asset', 'Plan', 'Progress', 'Total Amount', 'Status', 'Action'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i}>
                    {Array(7).fill(0).map((_, j) => (
                      <td key={j} className="px-4 py-3 border-t border-border">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Icon name="Award" size={28} color="var(--muted-foreground)" />
                      <p className="text-sm font-medium text-foreground">No {filter} plans found</p>
                    </div>
                  </td>
                </tr>
              ) : filtered.map(plan => {
                const client  = clientMap[plan.client_id];
                const asset   = assets[plan.asset_id];
                const pct     = Math.min(Math.round(((plan.installments_paid || 0) / (plan.total_installments || 1)) * 100), 100);
                const isDone  = plan.plan_status === 'completed' || plan.installments_paid >= plan.total_installments;

                return (
                  <tr key={plan.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">{client?.full_name || '—'}</p>
                      <p className="text-xs text-muted-foreground">{client?.account_number || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground">{asset?.description || '—'}</p>
                      <p className="text-xs text-muted-foreground">{asset?.asset_code || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground">{plan.plan_name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{plan.frequency}</p>
                    </td>
                    <td className="px-4 py-3 min-w-32">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${isDone ? 'bg-emerald-500' : 'bg-primary'}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                          {plan.installments_paid}/{plan.total_installments}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-foreground">
                      {fmt(plan.total_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${
                        isDone                        ? 'bg-emerald-100 text-emerald-700' :
                        plan.plan_status === 'overdue' ? 'bg-red-100 text-red-700' :
                        plan.plan_status === 'active'  ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {isDone ? 'Completed' : plan.plan_status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isDone ? (
                        <button
                          onClick={() => setSelectedPlan(plan)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
                          <Icon name="FileText" size={12} color="currentColor" />
                          Settlement Letter
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {plan.total_installments - (plan.installments_paid || 0)} remaining
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Settlement Letter Modal */}
      {selectedPlan && (
        <SettlementLetterModal
          plan={selectedPlan}
          client={selectedClient}
          asset={selectedAsset}
          companyProfile={companyProfile}
          onClose={() => setSelectedPlan(null)}
        />
      )}
    </div>
  );
};

export default SettlementsTab;
