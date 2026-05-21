import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import Icon from '../../components/AppIcon';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const Sk = ({ className = '' }) => <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;
const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const KPICard = ({ title, value, subtitle, icon, iconBg, iconColor, badge, loading }) => (
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
        <div className="flex items-center gap-2 flex-wrap">
          {badge && <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${badge.className}`}>{badge.label}</span>}
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </>
    )}
  </div>
);

const SEVERITY = {
  '1-30': { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-800', bar: 'bg-yellow-400', icon: 'Clock', iconColor: '#ca8a04' },
  '31-60': { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-800', bar: 'bg-orange-500', icon: 'AlertTriangle', iconColor: '#ea580c' },
  '60+':   { bg: 'bg-red-50 border-red-200',    text: 'text-red-800',    bar: 'bg-red-500',    icon: 'XCircle',       iconColor: '#dc2626' },
};

const CollectionsDashboard = () => {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState({});
  const [agingBuckets, setAgingBuckets] = useState([]);
  const [overdueAccounts, setOverdueAccounts] = useState([]);
  const [weeklyTrend, setWeeklyTrend] = useState([]);
  const [recentPayments, setRecentPayments] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [chargesRes, plansRes, paymentsRes] = await Promise.allSettled([
        supabase.from('installment_charges')
          .select('id, amount, scheduled_date, charge_status, client_id, plan:installment_plans(plan_name, client:clients(full_name, account_number, phone))')
          .order('scheduled_date', { ascending: true }),
        supabase.from('installment_plans')
          .select('id, total_amount, installments_paid, installment_amount, plan_status, client:clients(full_name, account_number)')
          .eq('plan_status', 'active'),
        supabase.from('payments')
          .select('id, amount, payment_date, payment_status, client:clients(full_name, account_number)')
          .order('payment_date', { ascending: false })
          .limit(10),
      ]);

      const charges = chargesRes.status === 'fulfilled' ? chargesRes.value.data || [] : [];
      const plans = plansRes.status === 'fulfilled' ? plansRes.value.data || [] : [];
      const payments = paymentsRes.status === 'fulfilled' ? paymentsRes.value.data || [] : [];

      // Overdue = scheduled before today AND not paid
      const overdue = charges.filter(c =>
        c.charge_status === 'scheduled' && new Date(c.scheduled_date) < today
      );

      // Due today / this week
      const weekEnd = new Date(today);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const dueThisWeek = charges.filter(c =>
        c.charge_status === 'scheduled' &&
        new Date(c.scheduled_date) >= today &&
        new Date(c.scheduled_date) <= weekEnd
      );
      const dueToday = dueThisWeek.filter(c => {
        const d = new Date(c.scheduled_date);
        return d.toDateString() === today.toDateString();
      });

      const totalOverdue = overdue.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
      const totalDueThisWeek = dueThisWeek.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
      const completedThisMonth = payments.filter(p => {
        const d = new Date(p.payment_date);
        return p.payment_status === 'completed' && d.getMonth() === today.getMonth();
      });
      const collectedThisMonth = completedThisMonth.reduce((s, p) => s + parseFloat(p.amount || 0), 0);

      setKpis({
        overdueCount: overdue.length,
        totalOverdue,
        dueTodayCount: dueToday.length,
        dueTodayAmount: dueToday.reduce((s, c) => s + parseFloat(c.amount || 0), 0),
        dueThisWeekCount: dueThisWeek.length,
        totalDueThisWeek,
        collectedThisMonth,
        activePlans: plans.length,
      });

      // Aging buckets
      const bucket1 = overdue.filter(c => {
        const days = Math.floor((today - new Date(c.scheduled_date)) / 86400000);
        return days >= 1 && days <= 30;
      });
      const bucket2 = overdue.filter(c => {
        const days = Math.floor((today - new Date(c.scheduled_date)) / 86400000);
        return days >= 31 && days <= 60;
      });
      const bucket3 = overdue.filter(c => {
        const days = Math.floor((today - new Date(c.scheduled_date)) / 86400000);
        return days > 60;
      });

      setAgingBuckets([
        { label: '1–30 Days', key: '1-30', count: bucket1.length, amount: bucket1.reduce((s, c) => s + parseFloat(c.amount || 0), 0) },
        { label: '31–60 Days', key: '31-60', count: bucket2.length, amount: bucket2.reduce((s, c) => s + parseFloat(c.amount || 0), 0) },
        { label: '60+ Days', key: '60+', count: bucket3.length, amount: bucket3.reduce((s, c) => s + parseFloat(c.amount || 0), 0) },
      ]);

      // Top overdue accounts (group by client)
      const clientOverdue = {};
      overdue.forEach(c => {
        const name = c.plan?.client?.full_name || 'Unknown';
        const acct = c.plan?.client?.account_number || '—';
        const phone = c.plan?.client?.phone || '—';
        const key = name + acct;
        const days = Math.floor((today - new Date(c.scheduled_date)) / 86400000);
        if (!clientOverdue[key]) clientOverdue[key] = { name, acct, phone, amount: 0, count: 0, maxDays: 0 };
        clientOverdue[key].amount += parseFloat(c.amount || 0);
        clientOverdue[key].count++;
        clientOverdue[key].maxDays = Math.max(clientOverdue[key].maxDays, days);
      });
      setOverdueAccounts(
        Object.values(clientOverdue).sort((a, b) => b.amount - a.amount).slice(0, 8)
      );

      // Weekly collection trend (last 7 days)
      const weekly = [];
      for (let i = 6; i >= 0; i--) {
        const day = new Date(today);
        day.setDate(day.getDate() - i);
        const dayPayments = payments.filter(p => {
          const d = new Date(p.payment_date);
          return p.payment_status === 'completed' && d.toDateString() === day.toDateString();
        });
        weekly.push({
          day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.getDay()],
          collected: Math.round(dayPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0)),
        });
      }
      setWeeklyTrend(weekly);
      setRecentPayments(payments.slice(0, 6));
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Collections dashboard error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <MainLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Collections Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Welcome, {userProfile?.full_name || 'Collections Officer'} · Follow-ups &amp; overdue tracking
              {lastUpdated && <span className="ml-2 text-xs text-emerald-600">● {lastUpdated.toLocaleTimeString()}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/payment-collections-hub')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors">
              <Icon name="CreditCard" size={13} color="white" /> Record Payment
            </button>
            <button onClick={fetchAll}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-all">
              <Icon name="RefreshCw" size={12} color="currentColor" /> Refresh
            </button>
          </div>
        </div>

        {/* Due Today Alert */}
        {!loading && kpis.dueTodayCount > 0 && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-blue-50 border border-blue-200">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
              </span>
              <div>
                <p className="text-sm font-semibold text-blue-900">
                  {kpis.dueTodayCount} payment{kpis.dueTodayCount !== 1 ? 's' : ''} due today — {fmt(kpis.dueTodayAmount)}
                </p>
                <p className="text-xs text-blue-600">Follow up with clients now</p>
              </div>
            </div>
            <button onClick={() => navigate('/payment-collections-hub')}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors">
              View →
            </button>
          </div>
        )}

        {/* Overdue Alert */}
        {!loading && kpis.overdueCount > 0 && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-red-50 border border-red-200">
            <div className="flex items-center gap-3">
              <Icon name="AlertTriangle" size={20} color="#dc2626" />
              <p className="text-sm font-semibold text-red-800">
                {kpis.overdueCount} overdue charge{kpis.overdueCount !== 1 ? 's' : ''} totalling {fmt(kpis.totalOverdue)} require immediate follow-up
              </p>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title="Total Overdue" value={fmt(kpis.totalOverdue)}
            subtitle={`${kpis.overdueCount || 0} charge${kpis.overdueCount !== 1 ? 's' : ''}`}
            badge={kpis.overdueCount > 0 ? { label: 'Action required', className: 'bg-red-100 text-red-700' } : { label: 'All clear', className: 'bg-emerald-100 text-emerald-700' }}
            icon="AlertTriangle" iconBg="bg-red-100" iconColor="#dc2626" loading={loading} />
          <KPICard title="Due This Week" value={fmt(kpis.totalDueThisWeek)}
            subtitle={`${kpis.dueThisWeekCount || 0} upcoming charge${kpis.dueThisWeekCount !== 1 ? 's' : ''}`}
            icon="Calendar" iconBg="bg-blue-100" iconColor="#2563eb" loading={loading} />
          <KPICard title="Collected (This Month)" value={fmt(kpis.collectedThisMonth)}
            subtitle={MONTHS[new Date().getMonth()]}
            icon="TrendingUp" iconBg="bg-emerald-100" iconColor="#059669" loading={loading} />
          <KPICard title="Active Plans" value={(kpis.activePlans || 0).toString()}
            subtitle="Installment plans in progress"
            icon="FileText" iconBg="bg-purple-100" iconColor="#7c3aed" loading={loading} />
        </div>

        {/* Aging Buckets */}
        <div>
          <h3 className="text-base font-semibold text-foreground mb-3">Aging Analysis</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {loading
              ? [...Array(3)].map((_, i) => <Sk key={i} className="h-28" />)
              : agingBuckets.map(bucket => {
                  const s = SEVERITY[bucket.key];
                  return (
                    <div key={bucket.key} className={`rounded-xl border-2 p-5 ${s.bg}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <Icon name={s.icon} size={18} color={s.iconColor} />
                        <span className={`text-sm font-semibold ${s.text}`}>{bucket.label} Overdue</span>
                      </div>
                      <p className={`text-2xl font-bold ${s.text}`}>{fmt(bucket.amount)}</p>
                      <p className={`text-xs mt-1 ${s.text} opacity-70`}>{bucket.count} charge{bucket.count !== 1 ? 's' : ''}</p>
                    </div>
                  );
                })
            }
          </div>
        </div>

        {/* Charts + Recent */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Weekly Trend */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-4">Daily Collections (Last 7 Days)</h3>
            {loading ? <Sk className="h-48" /> : weeklyTrend.every(d => d.collected === 0) ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                <Icon name="BarChart2" size={32} color="currentColor" />
                <p className="text-sm mt-2">No collections this week yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" style={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis style={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => [fmt(v), 'Collected']} />
                  <Bar dataKey="collected" fill="#3b82f6" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Recent Payments */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Recent Payments</h3>
              <button onClick={() => navigate('/payment-collections-hub')} className="text-xs text-primary hover:underline">All →</button>
            </div>
            {loading ? (
              <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Sk key={i} className="h-10" />)}</div>
            ) : recentPayments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <Icon name="CreditCard" size={24} color="currentColor" />
                <p className="text-xs mt-2">No payments yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentPayments.map(p => (
                  <div key={p.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex justify-between items-start">
                      <p className="text-xs font-medium text-foreground truncate max-w-[120px]">{p.client?.full_name || 'Unknown'}</p>
                      <span className="text-xs font-bold text-emerald-600">{fmt(p.amount)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(p.payment_date).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Overdue Accounts Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Overdue Accounts — Priority Follow-up</h3>
              {!loading && overdueAccounts.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">{overdueAccounts.length}</span>
              )}
            </div>
            <button onClick={() => navigate('/payment-collections-hub')} className="text-xs text-primary hover:underline">Full list →</button>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">{[...Array(5)].map((_, i) => <Sk key={i} className="h-10" />)}</div>
          ) : overdueAccounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Icon name="CheckCircle" size={32} color="#10b981" />
              <p className="text-sm mt-2 text-emerald-600 font-medium">No overdue accounts — great work!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">#</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Client</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Account</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phone</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Overdue Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Days Overdue</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {overdueAccounts.map((acc, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{acc.name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{acc.acct}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{acc.phone}</td>
                      <td className="px-4 py-3 font-bold text-red-600">{fmt(acc.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          acc.maxDays > 60 ? 'bg-red-100 text-red-700' :
                          acc.maxDays > 30 ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {acc.maxDays}d
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => navigate('/payment-collections-hub')}
                          className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors">
                          <Icon name="CreditCard" size={12} color="currentColor" /> Collect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </MainLayout>
  );
};

export default CollectionsDashboard;
