import React from 'react';
import { useSearchParams } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useSaccoDashboardContext } from '../../contexts/SaccoDashboardContext';
import Icon from '../../components/AppIcon';

import OverviewTab      from './components/OverviewTab';
import MembersTab       from './components/MembersTab';
import ContributionsTab from './components/ContributionsTab';
import LoansTab         from './components/LoansTab';
import SharesTab        from './components/SharesTab';
import VotingTab        from './components/VotingTab';
import ElectionsTab     from './components/ElectionsTab';
import GovernanceTab    from './components/GovernanceTab';
import SaccoContractsTab from './components/SaccoContractsTab';
import BillingTab       from './components/BillingTab';

const Sk = ({ className = '' }) => <div className={`animate-pulse bg-muted rounded-lg ${className}`} />;

const Tab = ({ active, label, icon, badge, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
      active ? 'border-primary/40 text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
    }`}
    style={active ? { background: 'rgba(52,193,221,0.10)' } : {}}
  >
    <Icon name={icon} size={15} color="currentColor" />
    {label}
    {badge > 0 && (
      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold">{badge}</span>
    )}
  </button>
);

const ConnDot = ({ status }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card text-xs">
    <span className="relative flex h-2 w-2">
      {status === 'connected' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${status === 'connected' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'}`} />
    </span>
    <span className={status === 'connected' ? 'text-emerald-600 font-semibold' : status === 'connecting' ? 'text-yellow-600 font-semibold' : 'text-red-600 font-semibold'}>
      {status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'}
    </span>
  </div>
);

const SaccoDashboard = () => {
  const { userProfile } = useAuth();
  const ctx = useSaccoDashboardContext();
  const { sacco, stats, loading, connectionStatus, refetch } = ctx;

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const setActiveTab = (tab) => setSearchParams({ tab }, { replace: true });

  const tabs = [
    { id: 'overview',      label: 'Overview',      icon: 'LayoutDashboard' },
    { id: 'members',       label: 'Members',       icon: 'Users' },
    { id: 'contributions', label: 'Contributions', icon: 'PiggyBank' },
    { id: 'loans',         label: 'Loans',         icon: 'Banknote' },
    { id: 'shares',        label: 'Shares',        icon: 'PieChart' },
    { id: 'voting',        label: 'Voting',        icon: 'Vote',       badge: stats.openMotions },
    { id: 'elections',     label: 'Elections',     icon: 'Award',      badge: (stats.activeElections || 0) + (stats.pendingCandidates || 0) },
    { id: 'governance',    label: 'Governance',    icon: 'ScrollText' },
    { id: 'contracts',     label: 'Contracts',     icon: 'FileText' },
    { id: 'billing',       label: 'Billing',       icon: 'CreditCard' },
  ];

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #34c1dd, #1da8c5)' }}>
              <Icon name="Landmark" size={20} color="#fff" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{sacco?.name || 'Sacco Dashboard'}</h1>
              <p className="text-sm text-muted-foreground">
                Welcome, {userProfile?.full_name || 'Admin'} · {stats.tier?.name} tier · {stats.totalMembers} members
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ConnDot status={connectionStatus} />
            <button onClick={refetch} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
              <Icon name="RefreshCw" size={12} color="currentColor" /> Refresh
            </button>
          </div>
        </div>

        {/* Missing-sacco warning (e.g. migrations not yet applied, or fresh account) */}
        {!loading && !sacco && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <Icon name="AlertTriangle" size={20} color="#ca8a04" />
            <div>
              <p className="text-sm font-semibold text-foreground">No sacco record found yet</p>
              <p className="text-xs text-muted-foreground">Your sacco profile will appear once the sacco schema migration is applied and your registration record exists.</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 flex-wrap">
          {tabs.map((t) => (
            <Tab key={t.id} active={activeTab === t.id} label={t.label} icon={t.icon} badge={t.badge} onClick={() => setActiveTab(t.id)} />
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
                  <Sk className="h-4 w-24" /><Sk className="h-8 w-32" /><Sk className="h-3 w-20" />
                </div>
              ))}
            </div>
            <Sk className="h-64" />
          </div>
        ) : (
          <>
            {activeTab === 'overview'      && <OverviewTab ctx={ctx} onNavigate={setActiveTab} />}
            {activeTab === 'members'       && <MembersTab ctx={ctx} />}
            {activeTab === 'contributions' && <ContributionsTab ctx={ctx} />}
            {activeTab === 'loans'         && <LoansTab ctx={ctx} />}
            {activeTab === 'shares'        && <SharesTab ctx={ctx} />}
            {activeTab === 'voting'        && <VotingTab ctx={ctx} />}
            {activeTab === 'elections'     && <ElectionsTab ctx={ctx} />}
            {activeTab === 'governance'    && <GovernanceTab ctx={ctx} />}
            {activeTab === 'contracts'     && <SaccoContractsTab />}
            {activeTab === 'billing'       && <BillingTab ctx={ctx} />}
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default SaccoDashboard;
