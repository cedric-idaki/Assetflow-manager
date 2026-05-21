import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import useAdminDashboard from '../../hooks/useAdminDashboard';
import Icon from '../../components/AppIcon';

import OverviewTab    from './components/OverviewTab';
import ClientsTab     from './components/ClientsTab';
import AgentsTab      from './components/AgentsTab';
import StaffTab       from './components/StaffTab';
import ContractsTab        from './components/ContractsTab';
import SettlementsTab      from './components/SettlementsTab';
import PaymentRemindersTab from './components/PaymentRemindersTab';
import SalesReportTab from './components/SalesReportTab';

import KYCReviewTab   from './components/KYCReviewTab';

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
      {status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'}
    </span>
  </div>
);

const AdminDashboard = () => {
  const { userProfile } = useAuth();
  const {
    stats, clients, assets, agents, staff,
    contracts, payments, auditLogs, subscription, companyProfile,
    salesAnalytics, loading, connectionStatus,
    refetch, inviteClient, createAgent, inviteStaff, toggleStaffActive,
    uploadContract, exportCSV,
  } = useAdminDashboard();

  const [activeTab, setActiveTab] = useState('overview');
  const navigate = useNavigate();

  // Max users from either subscription.plan.max_users or subscription.max_users
  const maxUsers = subscription?.plan?.max_users || subscription?.max_users || null;
  const activeStaff = (staff || []).filter(s => s.is_active !== false).length;
  const staffSlotsLeft = maxUsers ? maxUsers - activeStaff : null;

  const tabs = [
    { id: 'overview',  label: 'Overview',      icon: 'LayoutDashboard' },
    { id: 'clients',   label: 'Clients',        icon: 'Users',     badge: stats.pendingKYC },
    { id: 'agents',    label: 'Sales Agents',   icon: 'UserCheck' },
    { id: 'staff',     label: 'Staff',          icon: 'UserCog',   badge: staffSlotsLeft !== null && staffSlotsLeft <= 0 ? '!' : 0 },
    { id: 'contracts', label: 'Contracts',      icon: 'FileText' },
    { id: 'kyc',       label: 'KYC Review',     icon: 'Shield',    badge: stats.pendingKYC },
    { id: 'reports',      label: 'Sales Reports',  icon: 'BarChart3' },
    { id: 'settlements',  label: 'Settlements',     icon: 'Award' },
    { id: 'reminders',    label: 'Reminders',       icon: 'Bell' },
    
  ];

  return (
    <MainLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
            >
              <Icon name="Building2" size={20} color="#fff" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {companyProfile?.company_name || 'Admin Dashboard'}
              </h1>
              <p className="text-sm text-muted-foreground">
                Welcome, {userProfile?.full_name || 'Admin'} · Company management
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/finance-hub')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
              title="Open Finance Hub"
            >
              <Icon name="TrendingUp" size={15} color="currentColor" />
              <span className="hidden sm:inline text-xs">Finance Hub</span>
            </button>
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

        {/* Subscription pending warning */}
        {subscription?.status === 'pending' && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-yellow-50 border border-yellow-200">
            <div className="flex items-center gap-3">
              <Icon name="AlertTriangle" size={20} color="#ca8a04" />
              <div>
                <p className="text-sm font-semibold text-foreground">Subscription payment pending</p>
                <p className="text-xs text-muted-foreground">Complete your Mpesa payment to activate full access</p>
              </div>
            </div>
            <button className="px-3 py-1.5 rounded-lg bg-yellow-500 text-white text-xs font-semibold hover:bg-yellow-600 transition-all">
              Pay Now
            </button>
          </div>
        )}

        {/* Staff quota warning banner */}
        {staffSlotsLeft !== null && staffSlotsLeft <= 0 && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-red-50 border border-red-200">
            <div className="flex items-center gap-3">
              <Icon name="Users" size={20} color="#dc2626" />
              <div>
                <p className="text-sm font-semibold text-foreground">Staff limit reached</p>
                <p className="text-xs text-muted-foreground">
                  Your plan allows {maxUsers} staff users. Upgrade to add more.
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveTab('staff')}
              className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-all"
            >
              Manage Staff
            </button>
          </div>
        )}

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

        {/* Tab content */}
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
                  <Sk className="h-4 w-28" />
                  <Sk className="h-8 w-36" />
                  <Sk className="h-3 w-20" />
                </div>
              ))}
            </div>
            <Sk className="h-64" />
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewTab
                stats={stats}
                payments={payments}
                subscription={subscription}
                exportCSV={exportCSV}
              />
            )}

            {activeTab === 'clients' && (
              <ClientsTab
                clients={clients}
                agents={agents}
                onInvite={inviteClient}
                onExport={exportCSV}
              />
            )}

            {activeTab === 'agents' && (
              <AgentsTab
                agents={agents}
                salesAnalytics={salesAnalytics}
                onCreateAgent={createAgent}
                onExport={exportCSV}
              />
            )}

            {activeTab === 'staff' && (
              <StaffTab
                staff={staff}
                subscription={subscription}
                onInvite={inviteStaff}
                onToggleActive={toggleStaffActive}
                onExport={exportCSV}
              />
            )}

            {activeTab === 'contracts' && (
              <ContractsTab
                contracts={contracts}
                clients={clients}
                onUpload={uploadContract}
                onExport={exportCSV}
              />
            )}

            {activeTab === 'kyc' && (
              <KYCReviewTab adminId={userProfile?.id} />
            )}

            {activeTab === 'reminders' && (
              <PaymentRemindersTab adminId={userProfile?.id} />
            )}

            {activeTab === 'settlements' && (
              <SettlementsTab adminId={userProfile?.id} clients={clients} />
            )}
            {activeTab === 'reports' && (
              <SalesReportTab
                assets={assets}
                payments={payments}
                agents={agents}
                clients={clients}
                onExport={exportCSV}
              />
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default AdminDashboard;
