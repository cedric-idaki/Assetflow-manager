import React from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useRealtimeDashboard } from '../../hooks/useRealtimeDashboard';
import Icon from '../../components/AppIcon';

// ─── Skeleton ────────────────────────────────────────────────────────────────
const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse bg-muted rounded-lg ${className}`} />
);

const KPISkeletons = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
    {[1, 2, 3, 4, 5]?.map(i => (
      <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-start justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-10 rounded-lg" />
        </div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-3 w-16" />
      </div>
    ))}
  </div>
);

// ─── Connection Status ────────────────────────────────────────────────────────
const ConnectionStatus = ({ status, lastUpdated, syncing }) => {
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          {isConnected && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
              isConnected ? 'bg-emerald-500' : isConnecting ? 'bg-yellow-500' : 'bg-red-500'
            }`}
          />
        </span>
        <span
          className={`text-xs font-semibold ${
            isConnected ? 'text-emerald-600' : isConnecting ? 'text-yellow-600' : 'text-red-600'
          }`}
        >
          {isConnected ? 'Connected' : isConnecting ? 'Connecting…' : 'Disconnected'}
        </span>
      </div>
      {syncing && (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Syncing
        </span>
      )}
      {lastUpdated && !syncing && (
        <span className="text-xs text-muted-foreground">
          Updated {lastUpdated?.toLocaleTimeString()}
        </span>
      )}
    </div>
  );
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────
const KPICard = ({ title, value, subtitle, icon, iconBg, iconColor, badge }) => (
  <div className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between mb-3">
      <p className="text-sm text-muted-foreground font-medium">{title}</p>
      <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${iconBg}`}>
        <Icon name={icon} size={20} color={iconColor} />
      </div>
    </div>
    <div className="flex items-end gap-2">
      <h3 className="text-2xl font-bold text-foreground leading-none">{value}</h3>
      {badge && (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold mb-0.5 ${badge?.className}`}>
          {badge?.label}
        </span>
      )}
    </div>
    {subtitle && <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>}
  </div>
);

// ─── Aging Bucket Card ────────────────────────────────────────────────────────
const AgingBucketCard = ({ label, days, amount, count, severity }) => {
  const styles = {
    low: { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700', icon: 'AlertCircle', iconColor: '#ca8a04' },
    medium: { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-700', icon: 'AlertTriangle', iconColor: '#ea580c' },
    high: { bg: 'bg-red-50 border-red-200', text: 'text-red-700', icon: 'XCircle', iconColor: '#dc2626' },
  };
  const s = styles?.[severity] || styles?.low;

  return (
    <div className={`rounded-xl border-2 p-5 ${s?.bg}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon name={s?.icon} size={18} color={s?.iconColor} />
        <span className={`text-sm font-semibold ${s?.text}`}>{label}</span>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Overdue Amount</p>
          <p className={`text-xl font-bold ${s?.text}`}>
            KES {amount?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Accounts</p>
          <p className={`text-lg font-semibold ${s?.text}`}>{count}</p>
        </div>
      </div>
    </div>
  );
};

// ─── Payment Status Badge ─────────────────────────────────────────────────────
const PaymentStatusBadge = ({ status }) => {
  const map = {
    completed: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-yellow-100 text-yellow-700',
    failed: 'bg-red-100 text-red-700',
    reversed: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${map?.[status] || 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
};

// ─── Action Icon Map ──────────────────────────────────────────────────────────
const ACTION_ICON_MAP = {
  create: { icon: 'PlusCircle', color: 'text-emerald-600 bg-emerald-50' },
  update: { icon: 'Edit', color: 'text-blue-600 bg-blue-50' },
  delete: { icon: 'Trash2', color: 'text-red-600 bg-red-50' },
  login: { icon: 'LogIn', color: 'text-blue-600 bg-blue-50' },
  logout: { icon: 'LogOut', color: 'text-slate-600 bg-slate-50' },
  approve: { icon: 'CheckCircle', color: 'text-emerald-600 bg-emerald-50' },
  reject: { icon: 'XCircle', color: 'text-red-600 bg-red-50' },
  view: { icon: 'Eye', color: 'text-gray-600 bg-gray-50' },
  kyc_document_upload: { icon: 'Upload', color: 'text-blue-600 bg-blue-50' },
  kyc_status_change: { icon: 'Shield', color: 'text-orange-600 bg-orange-50' },
  kyc_renewal: { icon: 'RefreshCw', color: 'text-teal-600 bg-teal-50' },
  kyc_verification: { icon: 'CheckSquare', color: 'text-green-600 bg-green-50' },
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────
const DefaultDashboard = () => {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const {
    kpis,
    agingBuckets,
    recentPayments,
    activityFeed,
    connectionStatus,
    loading,
    syncing,
    lastUpdated,
    refetch,
  } = useRealtimeDashboard();

  const fmt = (n) => `KES ${(n || 0)?.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const kpiCards = [
    {
      title: 'Total Asset Value Sold',
      value: fmt(kpis?.totalAssetValueSold),
      subtitle: 'Sum of all asset selling prices',
      icon: 'Package',
      iconBg: 'bg-blue-100',
      iconColor: '#2563eb',
    },
    {
      title: 'Total Collected',
      value: fmt(kpis?.totalCollected),
      subtitle: 'Completed payments only',
      icon: 'TrendingUp',
      iconBg: 'bg-emerald-100',
      iconColor: '#059669',
    },
    {
      title: 'Outstanding Balance',
      value: fmt(kpis?.outstandingBalance),
      subtitle: 'Active installment plans',
      icon: 'AlertCircle',
      iconBg: 'bg-orange-100',
      iconColor: '#ea580c',
    },
    {
      title: 'Collection Efficiency',
      value: `${kpis?.collectionEfficiency || 0}%`,
      subtitle: 'Collected ÷ Total Asset Value',
      icon: 'BarChart2',
      iconBg: kpis?.collectionEfficiency >= 80 ? 'bg-emerald-100' : 'bg-yellow-100',
      iconColor: kpis?.collectionEfficiency >= 80 ? '#059669' : '#ca8a04',
      badge: kpis?.collectionEfficiency >= 80
        ? { label: 'On Track', className: 'bg-emerald-100 text-emerald-700' }
        : kpis?.collectionEfficiency >= 50
        ? { label: 'Moderate', className: 'bg-yellow-100 text-yellow-700' }
        : { label: 'Low', className: 'bg-red-100 text-red-700' },
    },
    {
      title: 'Pending Approvals',
      value: (kpis?.pendingApprovals || 0)?.toString(),
      subtitle: 'Maker-Checker queue',
      icon: 'Clock',
      iconBg: kpis?.pendingApprovals > 0 ? 'bg-red-100' : 'bg-gray-100',
      iconColor: kpis?.pendingApprovals > 0 ? '#dc2626' : '#6b7280',
      badge: kpis?.pendingApprovals > 0
        ? { label: 'Needs Review', className: 'bg-red-100 text-red-700' }
        : { label: 'All Clear', className: 'bg-emerald-100 text-emerald-700' },
    },
  ];

  const quickActions = [
    { label: 'New Client', icon: 'UserPlus', bg: 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-700', path: '/asset-client-management' },
    { label: 'Register Asset', icon: 'PlusSquare', bg: 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-700', path: '/asset-client-management' },
    { label: 'Record Payment', icon: 'CreditCard', bg: 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700', path: '/payment-collections-hub' },
    { label: 'View Reports', icon: 'BarChart3', bg: 'bg-orange-500/10 hover:bg-orange-500/20 text-orange-700', path: '/reports-analytics-center' },
  ];

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Welcome back, {userProfile?.full_name || 'Admin'} · Live data
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ConnectionStatus
              status={connectionStatus}
              lastUpdated={lastUpdated}
              syncing={syncing}
            />
            <button
              onClick={refetch}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon
                name="RefreshCw"
                size={12}
                color="currentColor"
                className={syncing ? 'animate-spin' : ''}
              />
              Refresh
            </button>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        {loading ? (
          <KPISkeletons />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {kpiCards?.map((card, i) => (
              <KPICard key={i} {...card} />
            ))}
          </div>
        )}

        {/* ── Pending Approvals Alert ── */}
        {!loading && kpis?.pendingApprovals > 0 && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-orange-50 border border-orange-200">
            <div className="flex items-center gap-3">
              <div className="relative">
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500" />
                </span>
                <Icon name="Clock" size={20} color="#ea580c" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {kpis?.pendingApprovals} pending approval{kpis?.pendingApprovals !== 1 ? 's' : ''} require attention
                </p>
                <p className="text-xs text-muted-foreground">Maker-Checker Queue · Updated live</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/system-administration')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 transition-all"
            >
              Review Now
              <Icon name="ArrowRight" size={12} color="currentColor" />
            </button>
          </div>
        )}

        {/* ── Aging Analysis ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-foreground">Aging Analysis</h2>
            <span className="text-xs text-muted-foreground">Overdue installment charges</span>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[1, 2, 3]?.map(i => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {agingBuckets?.map((bucket, i) => (
                <AgingBucketCard key={i} {...bucket} />
              ))}
            </div>
          )}
        </div>

        {/* ── Recent Payments + Quick Actions ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Recent Payments Table */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">Recent Payments</h2>
              <button
                onClick={() => navigate('/payment-collections-hub')}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                View all <Icon name="ArrowRight" size={12} color="currentColor" />
              </button>
            </div>
            {loading ? (
              <div className="p-5 space-y-3">
                {[1, 2, 3, 4, 5]?.map(i => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : recentPayments?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Icon name="CreditCard" size={32} color="currentColor" />
                <p className="text-sm mt-2">No payments recorded yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Client</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Method</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentPayments?.map(payment => (
                      <tr key={payment?.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3">
                          <div>
                            <p className="font-medium text-foreground">{payment?.client?.full_name || 'Unknown'}</p>
                            <p className="text-xs text-muted-foreground">{payment?.client?.account_number || '—'}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground">
                          KES {parseFloat(payment?.amount || 0)?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-3">
                          <span className="capitalize text-muted-foreground">
                            {(payment?.payment_method || '')?.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <PaymentStatusBadge status={payment?.payment_status} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {payment?.payment_date
                            ? new Date(payment.payment_date)?.toLocaleDateString()
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-base font-semibold text-foreground mb-4">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-3">
              {quickActions?.map((action, i) => (
                <button
                  key={i}
                  onClick={() => navigate(action?.path)}
                  className={`flex flex-col items-center gap-2.5 p-4 rounded-xl font-medium text-sm transition-all ${action?.bg}`}
                >
                  <Icon name={action?.icon} size={22} color="currentColor" />
                  <span className="text-xs text-center leading-tight">{action?.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Activity Feed ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">Recent Activity</h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </div>
            <button
              onClick={() => navigate('/system-administration')}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              View audit trail <Icon name="ArrowRight" size={12} color="currentColor" />
            </button>
          </div>
          {loading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4, 5]?.map(i => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : activityFeed?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Icon name="Activity" size={32} color="currentColor" />
              <p className="text-sm mt-2">No activity recorded yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {activityFeed?.map(log => {
                const actionStyle = ACTION_ICON_MAP?.[log?.action] || { icon: 'Activity', color: 'text-gray-600 bg-gray-50' };
                return (
                  <div key={log?.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${actionStyle?.color?.split(' ')?.slice(1)?.join(' ')}`}>
                      <Icon name={actionStyle?.icon} size={14} color="currentColor" className={actionStyle?.color?.split(' ')?.[0]} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{log?.user?.full_name || 'System'}</span>
                        {' · '}
                        <span className="text-muted-foreground">{log?.description || log?.action}</span>
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {new Date(log?.created_at)?.toLocaleString()}
                        </span>
                        {log?.table_name && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                            {log?.table_name?.replace(/_/g, ' ')}
                          </span>
                        )}
                        {log?.severity && log?.severity !== 'info' && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium capitalize ${
                            log?.severity === 'critical' ? 'bg-red-100 text-red-700' :
                            log?.severity === 'warning'? 'bg-yellow-100 text-yellow-700' : 'bg-muted text-muted-foreground'
                          }`}>
                            {log?.severity}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

export default DefaultDashboard;