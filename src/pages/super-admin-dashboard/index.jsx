import React, { useState } from 'react';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import useSuperAdminDashboard from '../../hooks/useSuperAdminDashboard';
import Icon from '../../components/AppIcon';

import StatCard from './components/StatCard';
import SalesTargetCard from './components/SalesTargetCard';
import AssetBreakdown from './components/AssetBreakdown';
import CompanyAnalytics from './components/CompanyAnalytics';
import AuditTrail from './components/AuditTrail';
import SalesAgentsList from './components/SalesAgentsList';
import CreateAgentModal from './components/CreateAgentModal';
import CreateStaffUserModal from './components/CreateStaffUserModal';

const Sk = ({ className = '' }) => (
  <div className={`animate-pulse bg-muted rounded-lg ${className}`} />
);

const Tab = ({ active, label, icon, badge, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
      active
        ? 'border-primary/40 text-primary'
        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
    }`}
    style={active ? { background: 'rgba(26,86,219,0.08)' } : {}}
  >
    <Icon name={icon} size={15} color="currentColor" />
    {label}
    {badge > 0 && (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold">
        {badge}
      </span>
    )}
  </button>
);

const ConnDot = ({ status }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card text-xs">
    <span className="relative flex h-2 w-2">
      {status === 'connected' && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${
        status === 'connected' ? 'bg-emerald-500' :
        status === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
      }`} />
    </span>
    <span className={
      status === 'connected' ? 'text-emerald-600 font-semibold' :
      status === 'connecting' ? 'text-yellow-600 font-semibold' : 'text-red-600 font-semibold'
    }>
      {status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'}
    </span>
  </div>
);

const SuperAdminDashboard = () => {
  const { userProfile } = useAuth();
  const {
    stats, assetBreakdown, companyAnalytics,
    auditTrail, salesAgents, salesTarget,
    loading, connectionStatus, refetch, createSalesAgent, exportCSV,
  } = useSuperAdminDashboard();

  const [activeTab, setActiveTab] = useState('overview');
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showCreateStaff, setShowCreateStaff] = useState(false);

  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const exportActiveAccounts = () => exportCSV(
    companyAnalytics.filter(c => c.isActive).map(c => ({
      name: c.name, email: c.email, clients: c.totalClients,
      active_clients: c.activeClients, revenue: c.totalRevenue, outstanding: c.outstanding,
    })),
    'active_accounts'
  );

  const exportInactiveAccounts = () => exportCSV(
    companyAnalytics.filter(c => !c.isActive).map(c => ({
      name: c.name, email: c.email, clients: c.totalClients,
      active_clients: c.activeClients, revenue: c.totalRevenue,
    })),
    'inactive_accounts'
  );

  const kpiCards = [
    {
      title: 'Active Accounts',
      value: stats.activeAccounts,
      subtitle: 'Client accounts in good standing',
      icon: 'UserCheck',
      iconBg: 'bg-emerald-100',
      iconColor: '#059669',
      badge: { label: 'Active', className: 'bg-emerald-100 text-emerald-700' },
      downloadable: true,
      onDownload: exportActiveAccounts,
    },
    {
      title: 'Inactive Accounts',
      value: stats.inactiveAccounts,
      subtitle: 'Suspended or inactive clients',
      icon: 'UserX',
      iconBg: 'bg-red-100',
      iconColor: '#dc2626',
      downloadable: true,
      onDownload: exportInactiveAccounts,
    },
    {
      title: 'Total Portfolio Value',
      value: fmt(stats.totalValue),
      subtitle: 'Sum of all registered asset values',
      icon: 'Landmark',
      iconBg: 'bg-blue-100',
      iconColor: '#1A56DB',
    },
    {
      title: 'Total Sales',
      value: fmt(stats.totalSales),
      subtitle: `${stats.totalSalesUsers} unique paying clients`,
      icon: 'TrendingUp',
      iconBg: 'bg-purple-100',
      iconColor: '#7c3aed',
      badge: { label: `${stats.totalSalesUsers} users`, className: 'bg-purple-100 text-purple-700' },
    },
    {
      title: 'Pending Registrations',
      value: stats.pendingRegistrations,
      subtitle: 'Admin accounts awaiting approval',
      icon: 'Clock',
      iconBg: stats.pendingRegistrations > 0 ? 'bg-orange-100' : 'bg-gray-100',
      iconColor: stats.pendingRegistrations > 0 ? '#ea580c' : '#6b7280',
      badge: stats.pendingRegistrations > 0
        ? { label: 'Needs Review', className: 'bg-orange-100 text-orange-700' }
        : { label: 'All Clear', className: 'bg-emerald-100 text-emerald-700' },
    },
    {
      title: 'Total Transactions',
      value: fmt(stats.totalTransactions),
      subtitle: 'Cumulative transaction volume',
      icon: 'Receipt',
      iconBg: 'bg-teal-100',
      iconColor: '#0d9488',
    },
  ];

  const tabs = [
    { id: 'overview',  label: 'Overview',     icon: 'LayoutDashboard' },
    { id: 'companies', label: 'Companies',     icon: 'Building2' },
    { id: 'audit',     label: 'Audit Trail',   icon: 'Shield', badge: auditTrail.filter(a => a.action === 'delete').length },
    { id: 'agents',    label: 'Sales Agents',  icon: 'Users' },
    { id: 'staff',     label: 'Staff Users',   icon: 'UserCog' },
  ];

  return (
    <MainLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #FF6B35, #E85D2F)' }}
            >
              <Icon name="Crown" size={20} color="#fff" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Super Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                Welcome, {userProfile?.full_name || 'Super Admin'} · System-wide overview
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ConnDot status={connectionStatus} />
            <button
              onClick={refetch}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="RefreshCw" size={12} color="currentColor" />
              Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 flex-wrap">
          {tabs.map(t => (
            <Tab
              key={t.id}
              active={activeTab === t.id}
              label={t.label}
              icon={t.icon}
              badge={t.badge}
              onClick={() => setActiveTab(t.id)}
            />
          ))}
        </div>

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1,2,3,4,5,6].map(i => (
                  <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
                    <Sk className="h-4 w-28" />
                    <Sk className="h-8 w-36" />
                    <Sk className="h-3 w-20" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {kpiCards.map((card, i) => (
                  <StatCard key={i} {...card} />
                ))}
              </div>
            )}

            {!loading && stats.pendingRegistrations > 0 && (
              <div className="flex items-center justify-between p-4 rounded-xl bg-orange-50 border border-orange-200">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500" />
                    </span>
                    <Icon name="AlertTriangle" size={20} color="#ea580c" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {stats.pendingRegistrations} company registration{stats.pendingRegistrations !== 1 ? 's' : ''} pending approval
                    </p>
                    <p className="text-xs text-muted-foreground">Admin accounts awaiting activation</p>
                  </div>
                </div>
                <button onClick={() => setActiveTab('companies')} className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 transition-all">
                  Review Now
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {loading ? (
                <>
                  <Sk className="h-52" />
                  <Sk className="h-52" />
                </>
              ) : (
                <>
                  <SalesTargetCard salesTarget={salesTarget} />
                  <AssetBreakdown data={assetBreakdown} />
                </>
              )}
            </div>
          </div>
        )}

        {/* COMPANIES TAB */}
        {activeTab === 'companies' && (
          <div className="space-y-4">
            {loading ? <Sk className="h-64" /> : (
              <CompanyAnalytics data={companyAnalytics} onExport={exportCSV} />
            )}
          </div>
        )}

        {/* AUDIT TRAIL TAB */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            {loading ? <Sk className="h-80" /> : (
              <AuditTrail data={auditTrail} onExport={exportCSV} />
            )}
          </div>
        )}

        {/* SALES AGENTS TAB */}
        {activeTab === 'agents' && (
          <div className="space-y-4">
            {loading ? <Sk className="h-64" /> : (
              <SalesAgentsList
                agents={salesAgents}
                onCreateNew={() => setShowCreateAgent(true)}
                onExport={exportCSV}
              />
            )}
          </div>
        )}

        {/* STAFF USERS TAB */}
        {activeTab === 'staff' && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Staff Users</h2>
                  <p className="text-xs text-muted-foreground">Accountants, HR, Managers and other internal staff</p>
                </div>
                <button
                  onClick={() => setShowCreateStaff(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
                  style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
                >
                  <Icon name="Plus" size={13} color="currentColor" />
                  New Staff User
                </button>
              </div>
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-3">
                  <Icon name="UserCog" size={24} color="#1A56DB" />
                </div>
                <p className="text-sm font-medium text-foreground">Create your first staff account</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">Add accountants, HR managers, and other internal users</p>
                <button
                  onClick={() => setShowCreateStaff(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
                >
                  <Icon name="Plus" size={14} color="currentColor" />
                  Create Staff User
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {showCreateAgent && (
        <CreateAgentModal
          onClose={() => setShowCreateAgent(false)}
          onCreate={createSalesAgent}
        />
      )}

      {showCreateStaff && (
        <CreateStaffUserModal
          isOpen={showCreateStaff}
          onClose={() => setShowCreateStaff(false)}
          onSuccess={(staff) => {
            refetch();
          }}
        />
      )}
    </MainLayout>
  );
};

export default SuperAdminDashboard;