import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import Icon from '../../components/AppIcon';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const Sk = ({ className = '' }) => <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;

const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtPct = (n) => `${(n || 0).toFixed(1)}%`;

const KPICard = ({ title, value, subtitle, icon, iconBg, iconColor, trend, loading }) => (
  <div className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-shadow">
    {loading ? (
      <div className="space-y-3 animate-pulse">
        <div className="flex justify-between"><Sk className="h-4 w-28" /><Sk className="h-10 w-10 rounded-lg" /></div>
        <Sk className="h-8 w-32" /><Sk className="h-3 w-20" />
      </div>
    ) : (
      <>
        <div className="flex items-start justify-between mb-3">
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${iconBg}`}>
            <Icon name={icon} size={20} color={iconColor} />
          </div>
        </div>
        <h3 className="text-2xl font-bold text-foreground leading-none mb-1">{value}</h3>
        <div className="flex items-center gap-2">
          {trend && (
            <span className={`flex items-center gap-0.5 text-xs font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              <Icon name={trend >= 0 ? 'TrendingUp' : 'TrendingDown'} size={12} color="currentColor" />
              {Math.abs(trend)}%
            </span>
          )}
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </>
    )}
  </div>
);

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DirectorDashboard = () => {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState({});
  const [collectionTrend, setCollectionTrend] = useState([]);
  const [topAssets, setTopAssets] = useState([]);
  const [agentPerformance, setAgentPerformance] = useState([]);
  const [portfolioHealth, setPortfolioHealth] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const year = new Date().getFullYear();

      const [
        clientsRes, assetsRes, paymentsRes, plansRes, agentsRes, pendingRes
      ] = await Promise.allSettled([
        supabase.from('clients').select('id, outstanding_balance, client_status'),
        supabase.from('assets').select('id, selling_price, asset_status, asset_type, asset_name'),
        supabase.from('payments').select('amount, payment_date, payment_status').gte('payment_date', `${year}-01-01`),
        supabase.from('installment_plans').select('total_amount, installments_paid, installment_amount, plan_status'),
        supabase.from('agents').select('id, full_name, total_sales, total_commission, commission_rate'),
        supabase.from('maker_checker_queue').select('id').eq('status', 'pending'),
      ]);

      const clients = clientsRes.status === 'fulfilled' ? clientsRes.value.data || [] : [];
      const assets = assetsRes.status === 'fulfilled' ? assetsRes.value.data || [] : [];
      const payments = paymentsRes.status === 'fulfilled' ? paymentsRes.value.data || [] : [];
      const plans = plansRes.status === 'fulfilled' ? plansRes.value.data || [] : [];
      const agents = agentsRes.status === 'fulfilled' ? agentsRes.value.data || [] : [];
      const pending = pendingRes.status === 'fulfilled' ? pendingRes.value.data || [] : [];

      // KPIs
      const totalAssetValue = assets.reduce((s, a) => s + parseFloat(a.selling_price || 0), 0);
      const totalCollected = payments.filter(p => p.payment_status === 'completed').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const totalOutstanding = clients.reduce((s, c) => s + parseFloat(c.outstanding_balance || 0), 0) ||
        plans.filter(p => p.plan_status === 'active').reduce((s, p) => s + (parseFloat(p.total_amount || 0) - parseFloat(p.installments_paid || 0) * parseFloat(p.installment_amount || 0)), 0);
      const activeClients = clients.filter(c => c.client_status === 'active').length;
      const soldAssets = assets.filter(a => a.asset_status === 'sold').length;
      const efficiency = totalAssetValue > 0 ? (totalCollected / totalAssetValue) * 100 : 0;

      setKpis({
        totalAssetValue,
        totalCollected,
        totalOutstanding,
        activeClients,
        soldAssets,
        totalAssets: assets.length,
        efficiency,
        pendingApprovals: pending.length,
        totalAgents: agents.length,
      });

      // Monthly collection trend (last 6 months)
      const currentMonth = new Date().getMonth();
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const mIdx = (currentMonth - i + 12) % 12;
        const mPayments = payments.filter(p => {
          const d = new Date(p.payment_date);
          return d.getMonth() === mIdx && p.payment_status === 'completed';
        });
        trend.push({
          month: MONTHS[mIdx],
          collected: Math.round(mPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0)),
          count: mPayments.length,
        });
      }
      setCollectionTrend(trend);

      // Top 5 assets by selling price
      const top = [...assets]
        .sort((a, b) => parseFloat(b.selling_price || 0) - parseFloat(a.selling_price || 0))
        .slice(0, 5)
        .map(a => ({
          name: (a.asset_name || 'Unknown').slice(0, 20),
          value: Math.round(parseFloat(a.selling_price || 0) / 1000),
          status: a.asset_status,
        }));
      setTopAssets(top);

      // Agent performance
      const agentData = agents.slice(0, 5).map(a => ({
        name: (a.full_name || 'Agent').split(' ')[0],
        sales: Math.round(parseFloat(a.total_sales || 0) / 1000),
        commission: Math.round(parseFloat(a.total_commission || 0) / 1000),
      }));
      setAgentPerformance(agentData);

      // Portfolio health
      const activeCount = assets.filter(a => a.asset_status === 'active').length;
      const soldCount = assets.filter(a => a.asset_status === 'sold').length;
      const reservedCount = assets.filter(a => a.asset_status === 'reserved').length;
      setPortfolioHealth({ activeCount, soldCount, reservedCount, total: assets.length });

      setLastUpdated(new Date());
    } catch (err) {
      console.error('Director dashboard error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const kpiCards = [
    { title: 'Total Portfolio Value', value: fmt(kpis.totalAssetValue), subtitle: 'All assets', icon: 'Package', iconBg: 'bg-blue-100', iconColor: '#2563eb' },
    { title: 'Total Collected (YTD)', value: fmt(kpis.totalCollected), subtitle: `${new Date().getFullYear()} year to date`, icon: 'TrendingUp', iconBg: 'bg-emerald-100', iconColor: '#059669' },
    { title: 'Outstanding Balance', value: fmt(kpis.totalOutstanding), subtitle: 'Active plans', icon: 'AlertCircle', iconBg: 'bg-orange-100', iconColor: '#ea580c' },
    { title: 'Collection Efficiency', value: fmtPct(kpis.efficiency), subtitle: 'Collected ÷ portfolio value', icon: 'BarChart2', iconBg: kpis.efficiency >= 60 ? 'bg-emerald-100' : 'bg-yellow-100', iconColor: kpis.efficiency >= 60 ? '#059669' : '#ca8a04' },
    { title: 'Active Clients', value: (kpis.activeClients || 0).toString(), subtitle: `of ${kpis.activeClients || 0} total`, icon: 'Users', iconBg: 'bg-purple-100', iconColor: '#7c3aed' },
    { title: 'Assets Sold', value: (kpis.soldAssets || 0).toString(), subtitle: `of ${kpis.totalAssets || 0} total`, icon: 'CheckSquare', iconBg: 'bg-teal-100', iconColor: '#0d9488' },
  ];

  return (
    <MainLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Director Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Welcome, {userProfile?.full_name || 'Director'} · Strategic overview
              {lastUpdated && <span className="ml-2 text-xs text-emerald-600">● Updated {lastUpdated.toLocaleTimeString()}</span>}
            </p>
          </div>
          <button onClick={fetchAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-all self-start">
            <Icon name="RefreshCw" size={12} color="currentColor" /> Refresh
          </button>
        </div>

        {/* Pending Approvals Alert */}
        {!loading && kpis.pendingApprovals > 0 && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-orange-50 border border-orange-200">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500" />
              </span>
              <p className="text-sm font-semibold text-orange-800">
                {kpis.pendingApprovals} pending approval{kpis.pendingApprovals !== 1 ? 's' : ''} require your review
              </p>
            </div>
            <button onClick={() => navigate('/system-administration')}
              className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 transition-colors">
              Review Now →
            </button>
          </div>
        )}

        {/* KPI Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {kpiCards.map((card, i) => <KPICard key={i} {...card} loading={loading} />)}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Collection Trend */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-4">Collection Trend (Last 6 Months)</h3>
            {loading ? <Sk className="h-48" /> : collectionTrend.every(d => d.collected === 0) ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                <Icon name="BarChart2" size={32} color="currentColor" />
                <p className="text-sm mt-2">No payment data yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={collectionTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" style={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis style={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => [`KES ${v.toLocaleString()}`, 'Collected']} />
                  <Bar dataKey="collected" fill="#10b981" radius={[4,4,0,0]} name="Collected" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Agent Performance */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground">Agent Performance (KES '000)</h3>
              <button onClick={() => navigate('/reports-analytics-center')} className="text-xs text-primary hover:underline">Full report →</button>
            </div>
            {loading ? <Sk className="h-48" /> : agentPerformance.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                <Icon name="Users" size={32} color="currentColor" />
                <p className="text-sm mt-2">No agent data yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={agentPerformance} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" style={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis style={{ fontSize: 11 }} stroke="#9ca3af" />
                  <Tooltip formatter={(v) => [`KES ${v}k`, '']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="sales" fill="#3b82f6" radius={[4,4,0,0]} name="Sales" />
                  <Bar dataKey="commission" fill="#f59e0b" radius={[4,4,0,0]} name="Commission" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Top Assets */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">Top Assets by Value</h3>
              <button onClick={() => navigate('/asset-client-management')} className="text-xs text-primary hover:underline">View all →</button>
            </div>
            {loading ? (
              <div className="p-5 space-y-3">{[...Array(5)].map((_, i) => <Sk key={i} className="h-10" />)}</div>
            ) : topAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <Icon name="Package" size={32} color="currentColor" />
                <p className="text-sm mt-2">No assets recorded yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {topAssets.map((asset, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-foreground">{asset.name}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          asset.status === 'sold' ? 'bg-emerald-100 text-emerald-700' :
                          asset.status === 'reserved' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        }`}>{asset.status}</span>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-foreground">KES {asset.value}k</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Portfolio Health */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-4">Portfolio Health</h3>
            {loading ? (
              <div className="space-y-3">{[...Array(4)].map((_, i) => <Sk key={i} className="h-12" />)}</div>
            ) : (
              <div className="space-y-4">
                {[
                  { label: 'Active Assets', count: portfolioHealth.activeCount, total: portfolioHealth.total, color: 'bg-blue-500' },
                  { label: 'Sold Assets', count: portfolioHealth.soldCount, total: portfolioHealth.total, color: 'bg-emerald-500' },
                  { label: 'Reserved', count: portfolioHealth.reservedCount, total: portfolioHealth.total, color: 'bg-amber-500' },
                ].map(item => (
                  <div key={item.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-bold text-foreground">{item.count || 0}</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${item.color} rounded-full transition-all`}
                        style={{ width: item.total > 0 ? `${((item.count || 0) / item.total) * 100}%` : '0%' }} />
                    </div>
                  </div>
                ))}

                <div className="pt-3 border-t border-border space-y-2">
                  {[
                    { label: 'Reports', icon: 'BarChart3', path: '/reports-analytics-center' },
                    { label: 'KYC Renewals', icon: 'ShieldCheck', path: '/kyc-renewal-management-screen' },
                    { label: 'Audit Trail', icon: 'FileText', path: '/system-administration' },
                  ].map(action => (
                    <button key={action.label} onClick={() => navigate(action.path)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors text-foreground">
                      <Icon name={action.icon} size={13} color="var(--color-primary)" />
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default DirectorDashboard;
