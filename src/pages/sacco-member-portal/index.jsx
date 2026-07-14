import React from 'react';
import { useSearchParams } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useSaccoMemberContext } from '../../contexts/SaccoMemberContext';
import Icon from '../../components/AppIcon';

import OverviewTab      from './components/OverviewTab';
import ContributionsTab from './components/ContributionsTab';
import LoansTab         from './components/LoansTab';
import SharesTab        from './components/SharesTab';
import VotingTab        from './components/VotingTab';
import ContractsTab     from './components/ContractsTab';
import DocumentsTab     from './components/DocumentsTab';
import StatementTab     from './components/StatementTab';

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

// NOTE: the first-login "set your own password" gate now lives in MainLayout
// (src/components/ForcePasswordChange.jsx) so it covers every portal, not just
// sacco members.
const SaccoMemberPortal = () => {
  const { userProfile } = useAuth();
  const ctx = useSaccoMemberContext();
  const { me, sacco, stats, loading, refetch } = ctx;

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const setActiveTab = (tab) => setSearchParams({ tab }, { replace: true });

  const tabs = [
    { id: 'overview',      label: 'Overview',      icon: 'LayoutDashboard' },
    { id: 'contributions', label: 'Contributions', icon: 'PiggyBank' },
    { id: 'loans',         label: 'Loans',         icon: 'Banknote' },
    { id: 'shares',        label: 'Shares',        icon: 'PieChart' },
    { id: 'voting',        label: 'Voting',        icon: 'Vote',      badge: stats.openMotions },
    { id: 'contracts',     label: 'Contracts',     icon: 'FileText' },
    { id: 'documents',     label: 'Documents',     icon: 'ScrollText' },
    { id: 'statement',     label: 'Statement',     icon: 'FileSpreadsheet' },
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
              <h1 className="text-2xl font-bold text-foreground">{sacco?.name || 'Member Portal'}</h1>
              <p className="text-sm text-muted-foreground">
                Welcome, {me?.full_name || userProfile?.full_name || 'Member'}
                {me?.member_no ? ` · ${me.member_no}` : ''}
                {me?.member_role ? ` · ${me.member_role}` : ''}
              </p>
            </div>
          </div>
          <button onClick={refetch} className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
            <Icon name="RefreshCw" size={12} color="currentColor" /> Refresh
          </button>
        </div>

        {/* Missing-member warning (login exists but no linked member row) */}
        {!loading && !me && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <Icon name="AlertTriangle" size={20} color="#ca8a04" />
            <div>
              <p className="text-sm font-semibold text-foreground">Your membership record is not linked yet</p>
              <p className="text-xs text-muted-foreground">Ask your sacco administrator to link this login to your member record.</p>
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
            {activeTab === 'contributions' && <ContributionsTab ctx={ctx} />}
            {activeTab === 'loans'         && <LoansTab ctx={ctx} />}
            {activeTab === 'shares'        && <SharesTab ctx={ctx} />}
            {activeTab === 'voting'        && <VotingTab ctx={ctx} />}
            {activeTab === 'contracts'     && <ContractsTab ctx={ctx} />}
            {activeTab === 'documents'     && <DocumentsTab ctx={ctx} />}
            {activeTab === 'statement'     && <StatementTab ctx={ctx} />}
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default SaccoMemberPortal;
