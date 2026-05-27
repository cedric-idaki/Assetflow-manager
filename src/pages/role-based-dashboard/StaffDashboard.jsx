import React from 'react';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../../components/AppIcon';
import { useStaffDashboardContext } from '../../contexts/StaffDashboardContext';

const Sk = ({ className = '' }) => (
  <div className={`animate-pulse bg-muted rounded-xl ${className}`} />
);

const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// ── Role meta — label, icon, color per role ───────────────────────────────────
const ROLE_META = {
  hr: {
    label:    'HR Manager',
    icon:     'Users',
    color:    'text-violet-600',
    bg:       'bg-violet-100',
    gradient: 'from-violet-600 to-violet-800',
    links: [
      { label: 'Asset & Client Management', path: '/asset-client-management', icon: 'Package' },
      { label: 'Reports & Analytics',       path: '/reports-analytics-center',  icon: 'BarChart2' },
      { label: 'KYC Management',            path: '/kyc-management-screen',     icon: 'ShieldCheck' },
    ],
  },
  it_support: {
    label:    'IT / Support',
    icon:     'Monitor',
    color:    'text-sky-600',
    bg:       'bg-sky-100',
    gradient: 'from-sky-600 to-sky-800',
    links: [
      { label: 'System Administration',    path: '/system-administration',     icon: 'Settings' },
      { label: 'Reports & Analytics',      path: '/reports-analytics-center',  icon: 'BarChart2' },
      { label: 'Asset & Client Mgmt',      path: '/asset-client-management',   icon: 'Package' },
    ],
  },
  staff: {
    label:    'Staff',
    icon:     'User',
    color:    'text-emerald-600',
    bg:       'bg-emerald-100',
    gradient: 'from-emerald-600 to-emerald-800',
    links: [
      { label: 'Asset & Client Management', path: '/asset-client-management',  icon: 'Package' },
      { label: 'Payment Collections',       path: '/payment-collections-hub',  icon: 'CreditCard' },
      { label: 'Reports & Analytics',       path: '/reports-analytics-center', icon: 'BarChart2' },
    ],
  },
};

// ── KPI Card ──────────────────────────────────────────────────────────────────
const KPICard = ({ title, value, icon, iconBg, iconColor, subtitle, loading }) => (
  <div className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-shadow">
    {loading ? (
      <div className="space-y-3 animate-pulse">
        <div className="flex justify-between">
          <Sk className="h-4 w-28" /><Sk className="h-10 w-10 rounded-lg" />
        </div>
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
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </>
    )}
  </div>
);

// ── Quick Link Card ───────────────────────────────────────────────────────────
const QuickLink = ({ label, icon, path }) => (
  <a
    href={path}
    className="flex items-center gap-3 p-4 bg-card border border-border rounded-xl hover:border-primary/40 hover:bg-muted/40 transition-all group"
  >
    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
      <Icon name={icon} size={17} color="#1A56DB" />
    </div>
    <span className="text-sm font-medium text-foreground">{label}</span>
    <Icon name="ChevronRight" size={15} color="var(--color-muted-foreground)" className="ml-auto" />
  </a>
);

// ── Activity Row ──────────────────────────────────────────────────────────────
const ActivityRow = ({ item }) => (
  <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
      <Icon name="Activity" size={13} color="var(--color-muted-foreground)" />
    </div>
    <div className="min-w-0">
      <p className="text-sm text-foreground leading-snug">{item.description || item.action}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(item.created_at)}</p>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
const StaffDashboard = () => {
  const { userProfile } = useAuth();
  const role    = userProfile?.role || 'staff';
  const meta    = ROLE_META[role] || ROLE_META.staff;

  const {
    loading,
    kpis,
    activity,
    adminName,
    lastUpdated,
    refetch,
  } = useStaffDashboardContext();

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-5 ">

        {/* ── Welcome banner ── */}
        <div className={`rounded-xl bg-gradient-to-r ${meta.gradient} p-5 text-white`}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Icon name={meta.icon} size={24} color="white" />
            </div>
            <div>
              <p className="text-sm text-white/75">{greeting()}</p>
              <h1 className="text-xl font-bold">{userProfile?.full_name || 'Staff Member'}</h1>
              <p className="text-sm text-white/75 mt-0.5">
                {meta.label}
                {adminName ? ` · ${adminName}` : ''}
                {userProfile?.department ? ` · ${userProfile.department}` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* ── KPI cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Total Clients"
            value={loading ? '—' : kpis.clients.toLocaleString()}
            icon="Users" iconBg="bg-blue-100" iconColor="#1A56DB"
            subtitle="In your organisation"
            loading={loading}
          />
          <KPICard
            title="Total Assets"
            value={loading ? '—' : kpis.assets.toLocaleString()}
            icon="Package" iconBg="bg-emerald-100" iconColor="#059669"
            subtitle="Registered assets"
            loading={loading}
          />
          <KPICard
            title="Payments"
            value={loading ? '—' : kpis.payments.toLocaleString()}
            icon="CreditCard" iconBg="bg-violet-100" iconColor="#7c3aed"
            subtitle="Completed transactions"
            loading={loading}
          />
          <KPICard
            title="Total Revenue"
            value={loading ? '—' : fmt(kpis.revenue)}
            icon="TrendingUp" iconBg="bg-amber-100" iconColor="#d97706"
            subtitle="Across all payments"
            loading={loading}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Quick links ── */}
          <div className="lg:col-span-1 bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Icon name="Zap" size={15} color="#1A56DB" />
              Quick Access
            </h2>
            <div className="space-y-2">
              {meta.links.map(link => (
                <QuickLink key={link.path} {...link} />
              ))}
            </div>
          </div>

          {/* ── Recent activity ── */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Icon name="Activity" size={15} color="#1A56DB" />
              Recent Activity
            </h2>
            {loading ? (
              <div className="space-y-3">
                {[1,2,3,4].map(i => (
                  <div key={i} className="flex gap-3 animate-pulse">
                    <Sk className="w-7 h-7 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Sk className="h-3.5 w-3/4" />
                      <Sk className="h-3 w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Icon name="Activity" size={28} color="currentColor" />
                <p className="text-sm mt-2">No activity yet</p>
                <p className="text-xs">Actions you take will appear here</p>
              </div>
            ) : (
              <div>
                {activity.map((item, i) => (
                  <ActivityRow key={item.id || i} item={item} />
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </MainLayout>
  );
};

export default StaffDashboard;
