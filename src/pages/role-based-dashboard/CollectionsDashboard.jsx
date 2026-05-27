import React from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../../components/AppIcon';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useCollectionsDashboardContext } from '../../contexts/CollectionsDashboardContext';

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
  const {
    loading,
    kpis,
    agingBuckets,
    overdueAccounts,
    weeklyTrend,
    recentPayments,
    lastUpdated,
    refetch,
  } = useCollectionsDashboardContext();

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
            <button onClick={refetch}
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
