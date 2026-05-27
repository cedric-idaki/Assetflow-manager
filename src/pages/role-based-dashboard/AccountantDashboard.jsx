import React from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../../components/AppIcon';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useAccountantDashboardContext } from '../../contexts/AccountantDashboardContext';

const Sk = ({ className = '' }) => <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;
const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

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
        <div className="flex items-center gap-2">
          {badge && <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${badge.className}`}>{badge.label}</span>}
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </>
    )}
  </div>
);

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

const AccountantDashboard = () => {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const {
    loading,
    kpis,
    monthlyBreakdown,
    paymentMethods,
    recentPayments,
    overdueAccounts,
    lastUpdated,
    refetch,
  } = useAccountantDashboardContext();

  const statusColor = { completed: 'bg-emerald-100 text-emerald-700', pending: 'bg-yellow-100 text-yellow-700', failed: 'bg-red-100 text-red-700', reversed: 'bg-gray-100 text-gray-600' };

  return (
    <MainLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Accountant Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Welcome, {userProfile?.full_name || 'Accountant'} · Financial overview
              {lastUpdated && <span className="ml-2 text-xs text-emerald-600">● {lastUpdated.toLocaleTimeString()}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/reports-analytics-center')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors">
              <Icon name="BarChart3" size={13} color="white" /> Reports
            </button>
            <button onClick={refetch}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-all">
              <Icon name="RefreshCw" size={12} color="currentColor" /> Refresh
            </button>
          </div>
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
                {kpis.pendingApprovals} payment approval{kpis.pendingApprovals !== 1 ? 's' : ''} awaiting your action
              </p>
            </div>
            <button onClick={() => navigate('/system-administration')}
              className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 transition-colors">
              Review →
            </button>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title="Collected (YTD)" value={fmt(kpis.totalCollectedYTD)} subtitle={`${new Date().getFullYear()} year to date`} icon="TrendingUp" iconBg="bg-emerald-100" iconColor="#059669" loading={loading} />
          <KPICard title="Collected (This Month)" value={fmt(kpis.totalCollectedThisMonth)}
            badge={kpis.momChange !== undefined ? {
              label: `${kpis.momChange >= 0 ? '+' : ''}${kpis.momChange.toFixed(1)}% vs last month`,
              className: kpis.momChange >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            } : undefined}
            icon="Calendar" iconBg="bg-blue-100" iconColor="#2563eb" loading={loading} />
          <KPICard title="Total Outstanding" value={fmt(kpis.totalOutstanding)} subtitle={`${kpis.activePlans || 0} active plans`} icon="AlertCircle" iconBg="bg-orange-100" iconColor="#ea580c" loading={loading} />
          <KPICard title="Pending Payments" value={(kpis.pendingCount || 0).toString()} subtitle={fmt(kpis.pendingAmount) + ' total'}
            badge={kpis.pendingCount > 0 ? { label: 'Needs action', className: 'bg-yellow-100 text-yellow-700' } : { label: 'All clear', className: 'bg-emerald-100 text-emerald-700' }}
            icon="Clock" iconBg="bg-yellow-100" iconColor="#ca8a04" loading={loading} />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Monthly Breakdown */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-4">Monthly Collection (Last 6 Months)</h3>
            {loading ? <Sk className="h-52" /> : monthlyBreakdown.every(d => d.collected === 0 && d.pending === 0) ? (
              <div className="flex flex-col items-center justify-center h-52 text-gray-400">
                <Icon name="BarChart2" size={32} color="currentColor" />
                <p className="text-sm mt-2">No payment data yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={monthlyBreakdown} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" style={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis style={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v, n) => [fmt(v), n === 'collected' ? 'Collected' : 'Pending']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="collected" fill="#10b981" radius={[4,4,0,0]} name="Collected" />
                  <Bar dataKey="pending" fill="#f59e0b" radius={[4,4,0,0]} name="Pending" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Payment Methods */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-4">Payment Methods (YTD)</h3>
            {loading ? <Sk className="h-52" /> : paymentMethods.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-52 text-gray-400">
                <Icon name="CreditCard" size={32} color="currentColor" />
                <p className="text-sm mt-2">No data yet</p>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={paymentMethods} dataKey="value" cx="50%" cy="50%" outerRadius={60} labelLine={false}>
                      {paymentMethods.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [fmt(v), 'Amount']} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {paymentMethods.map((m, i) => (
                    <div key={m.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-muted-foreground truncate max-w-[100px]">{m.name}</span>
                      </div>
                      <span className="font-semibold text-foreground">{fmt(m.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Recent Payments */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">Recent Payments</h3>
              <button onClick={() => navigate('/payment-collections-hub')} className="text-xs text-primary hover:underline">View all →</button>
            </div>
            {loading ? (
              <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Sk key={i} className="h-10" />)}</div>
            ) : recentPayments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <Icon name="CreditCard" size={28} color="currentColor" />
                <p className="text-sm mt-2">No payments yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border max-h-72 overflow-y-auto">
                {recentPayments.map(p => (
                  <div key={p.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-foreground">{p.client?.full_name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">{p.client?.account_number} · {new Date(p.payment_date).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-foreground">{fmt(p.amount)}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColor[p.payment_status] || 'bg-gray-100 text-gray-600'}`}>
                        {p.payment_status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Outstanding Accounts */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">Top Outstanding Accounts</h3>
              <button onClick={() => navigate('/asset-client-management')} className="text-xs text-primary hover:underline">View all →</button>
            </div>
            {loading ? (
              <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Sk key={i} className="h-10" />)}</div>
            ) : overdueAccounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <Icon name="CheckCircle" size={28} color="#10b981" />
                <p className="text-sm mt-2 text-emerald-600 font-medium">No outstanding balances!</p>
              </div>
            ) : (
              <div className="divide-y divide-border max-h-72 overflow-y-auto">
                {overdueAccounts.map((acc, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-foreground">{acc.clientName}</p>
                        <p className="text-xs text-muted-foreground">{acc.accountNumber}</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-orange-600">{fmt(acc.outstanding)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-base font-semibold text-foreground mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Record Payment', icon: 'CreditCard', path: '/payment-collections-hub', color: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700' },
              { label: 'View Reports', icon: 'BarChart3', path: '/reports-analytics-center', color: 'bg-blue-50 hover:bg-blue-100 text-blue-700' },
              { label: 'Payment Approval', icon: 'CheckSquare', path: '/system-administration', color: 'bg-orange-50 hover:bg-orange-100 text-orange-700' },
              { label: 'Client Accounts', icon: 'Users', path: '/asset-client-management', color: 'bg-purple-50 hover:bg-purple-100 text-purple-700' },
            ].map(action => (
              <button key={action.label} onClick={() => navigate(action.path)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl text-sm font-medium transition-colors ${action.color}`}>
                <Icon name={action.icon} size={22} color="currentColor" />
                <span className="text-xs text-center leading-tight">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

      </div>
    </MainLayout>
  );
};

export default AccountantDashboard;
