import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useSaccoMemberContext } from '../../contexts/SaccoMemberContext';
import { supabase } from '../../lib/supabase';
import Icon from '../../components/AppIcon';
import { Modal, Field, TextInput, PrimaryButton } from '../sacco-dashboard/components/_shared';

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

// First-login gate. Logins provisioned by the sacco admin carry
// user_metadata.must_change_password = true (set by create-staff-user on both
// creation and password reset); the member cannot use the portal until they
// replace the emailed temporary password with their own.
const ForcePasswordChange = () => {
  const { user } = useAuth();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!user?.user_metadata?.must_change_password || done) return null;

  const submit = async () => {
    if (pw.length < 8) { setError('Use at least 8 characters.'); return; }
    if (pw !== confirm) { setError('The passwords do not match.'); return; }
    setSaving(true);
    setError('');
    const { error: err } = await supabase.auth.updateUser({
      password: pw,
      data: { must_change_password: false },
    });
    setSaving(false);
    if (err) { setError(err.message || 'Could not update the password.'); return; }
    setDone(true);
  };

  return (
    <Modal
      open
      onClose={() => {}} /* deliberately not dismissable — the temp password must be replaced */
      title="Set your own password"
      footer={
        <PrimaryButton icon="KeyRound" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Save password & continue'}
        </PrimaryButton>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <Icon name="ShieldAlert" size={20} color="#ca8a04" />
          <p className="text-sm text-foreground">
            You signed in with a <strong>temporary password</strong>. Choose your own password to
            secure your account and continue to the portal.
          </p>
        </div>
        <Field label="New password (min. 8 characters)">
          <TextInput type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password">
          <TextInput type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show passwords
        </label>
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      </div>
    </Modal>
  );
};

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
      <ForcePasswordChange />
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
