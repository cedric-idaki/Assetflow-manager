import React from 'react';
import Icon from '../../../components/AppIcon';

const StatCard = ({ title, value, subtitle, icon, iconBg, iconColor, badge }) => (
  <div className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-all">
    <div className="flex items-start justify-between mb-3">
      <p className="text-sm text-muted-foreground font-medium leading-snug">{title}</p>
      <div className={`flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0 ${iconBg}`}>
        <Icon name={icon} size={20} color={iconColor} />
      </div>
    </div>
    <div className="flex items-end gap-2">
      <h3 className="text-2xl font-bold text-foreground leading-none">{value}</h3>
      {badge && (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold mb-0.5 ${badge.className}`}>
          {badge.label}
        </span>
      )}
    </div>
    {subtitle && <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>}
  </div>
);

const OverviewTab = ({ stats, payments, subscription, exportCSV }) => {
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const kpiCards = [
    {
      title: 'Total Clients',
      value: stats.totalClients,
      subtitle: `${stats.activeClients} active clients`,
      icon: 'Users',
      iconBg: 'bg-blue-100',
      iconColor: '#1A56DB',
      badge: { label: `${stats.activeClients} active`, className: 'bg-blue-100 text-blue-700' },
    },
    {
      title: 'Total Assets',
      value: stats.totalAssets,
      subtitle: 'Registered assets',
      icon: 'Package',
      iconBg: 'bg-purple-100',
      iconColor: '#7c3aed',
    },
    {
      title: 'Total Revenue',
      value: fmt(stats.totalRevenue),
      subtitle: 'Completed payments',
      icon: 'TrendingUp',
      iconBg: 'bg-emerald-100',
      iconColor: '#059669',
    },
    {
      title: 'Outstanding',
      value: fmt(stats.outstandingBalance),
      subtitle: 'Pending collections',
      icon: 'AlertCircle',
      iconBg: 'bg-orange-100',
      iconColor: '#ea580c',
    },
    {
      title: 'Sales Agents',
      value: stats.totalAgents,
      subtitle: 'Active agents',
      icon: 'UserCheck',
      iconBg: 'bg-teal-100',
      iconColor: '#0d9488',
    },
    {
      title: 'Pending KYC',
      value: stats.pendingKYC,
      subtitle: 'Clients awaiting KYC',
      icon: 'ShieldAlert',
      iconBg: stats.pendingKYC > 0 ? 'bg-red-100' : 'bg-gray-100',
      iconColor: stats.pendingKYC > 0 ? '#dc2626' : '#6b7280',
      badge: stats.pendingKYC > 0
        ? { label: 'Action needed', className: 'bg-red-100 text-red-700' }
        : { label: 'All clear', className: 'bg-emerald-100 text-emerald-700' },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Subscription Banner */}
      {subscription && (
        <div className="flex items-center justify-between p-4 rounded-xl border"
          style={{
            background: subscription.plan_name === 'gold'
              ? 'linear-gradient(135deg, rgba(201,168,76,0.1), rgba(212,175,55,0.05))'
              : subscription.plan_name === 'silver'
              ? 'linear-gradient(135deg, rgba(192,192,192,0.1), rgba(180,180,180,0.05))'
              : 'linear-gradient(135deg, rgba(205,127,50,0.1), rgba(190,120,40,0.05))',
            borderColor: subscription.plan_name === 'gold' ? 'rgba(201,168,76,0.4)'
              : subscription.plan_name === 'silver' ? 'rgba(192,192,192,0.4)'
              : 'rgba(205,127,50,0.4)',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm"
              style={{
                background: subscription.plan_name === 'gold' ? '#C9A84C'
                  : subscription.plan_name === 'silver' ? '#A0A0A0' : '#CD7F32'
              }}
            >
              {(subscription.plan_name || 'B')[0].toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-bold text-foreground capitalize">
                {subscription.plan_name} Plan
              </p>
              <p className="text-xs text-muted-foreground">
                {subscription.max_users ? `Up to ${subscription.max_users} users` : 'Unlimited users'} ·{' '}
                Expires {subscription.end_date ? new Date(subscription.end_date).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${
            subscription.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
            subscription.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'
          }`}>
            {(subscription.status || 'pending').toUpperCase()}
          </span>
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpiCards.map((card, i) => (
          <StatCard key={i} {...card} />
        ))}
      </div>

      {/* Recent Payments */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Recent Payments</h2>
          <button
            onClick={() => exportCSV(payments.map(p => ({
              client: p.client?.full_name,
              amount: p.amount,
              method: p.payment_method,
              status: p.payment_status,
              date: p.payment_date,
            })), 'payments')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Icon name="Download" size={13} color="currentColor" />
            Export
          </button>
        </div>

        {payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Icon name="CreditCard" size={28} color="currentColor" />
            <p className="text-sm mt-2">No payments yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  {['Client', 'Amount', 'Method', 'Status', 'Date'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map(p => (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{p.client?.full_name || '—'}</p>
                      <p className="text-xs text-muted-foreground">{p.client?.account_number || '—'}</p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {fmt(p.amount)}
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">
                      {(p.payment_method || '').replace('_', ' ')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                        p.payment_status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                        p.payment_status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {p.payment_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default OverviewTab;