import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import Icon from '../../components/AppIcon';
import { tierById } from '../../config/saccoTiers';

// ── Formatting helpers ───────────────────────────────────────────────────────
const fmtKES  = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtWhen = (d) => {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return fmtDate(d);
};

const TIER_META = {
  bronze: { label: 'Bronze', color: '#b45309', bg: '#fef3c7' },
  silver: { label: 'Silver', color: '#64748b', bg: '#f1f5f9' },
  gold:   { label: 'Gold',   color: '#a16207', bg: '#fef9c3' },
};
const tierBadge = (id) => TIER_META[id] || { label: id || '—', color: '#1A56DB', bg: '#e8f0fe' };

const KYC_META = {
  pending:  { label: 'Pending',  color: '#b45309', bg: '#fef3c7' },
  approved: { label: 'Approved', color: '#15803d', bg: '#dcfce7' },
  verified: { label: 'Verified', color: '#15803d', bg: '#dcfce7' },
  rejected: { label: 'Rejected', color: '#b91c1c', bg: '#fee2e2' },
};
const kycBadge = (s) => KYC_META[s] || { label: s || '—', color: '#64748b', bg: '#f1f5f9' };

const Sk = ({ className = '' }) => <div className={`animate-pulse bg-muted rounded-lg ${className}`} />;

// ── Data hook — super_admin reads all sacco_* tables via is_global_viewer() ──
const useSaccoOversight = () => {
  const [data, setData]       = useState({ saccos: [], members: [], contributions: [], loans: [], motions: [], invoices: [], admins: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [saccosR, membersR, contribR, loansR, motionsR, invoicesR] = await Promise.all([
        supabase.from('saccos').select('*').order('created_at', { ascending: false }),
        supabase.from('sacco_members').select('id, sacco_id, full_name, status, kyc_status, created_at').order('created_at', { ascending: false }),
        supabase.from('sacco_contributions').select('id, sacco_id, amount, status, created_at').order('created_at', { ascending: false }).limit(400),
        supabase.from('sacco_loans').select('id, sacco_id, principal, status, created_at').order('created_at', { ascending: false }).limit(200),
        supabase.from('sacco_motions').select('id, sacco_id, title, status, created_at').order('created_at', { ascending: false }).limit(100),
        supabase.from('sacco_invoices').select('id, sacco_id, period, total, status, created_at').order('created_at', { ascending: false }).limit(100),
      ]);

      const firstError = [saccosR, membersR, contribR, loansR, motionsR, invoicesR].find((r) => r.error)?.error;
      if (firstError) throw firstError;

      // Resolve the admin account behind each sacco for the registration card.
      const adminIds = [...new Set((saccosR.data || []).map((s) => s.admin_id).filter(Boolean))];
      let admins = {};
      if (adminIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, full_name, email, phone, created_at')
          .in('id', adminIds);
        admins = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
      }

      setData({
        saccos: saccosR.data || [],
        members: membersR.data || [],
        contributions: contribR.data || [],
        loans: loansR.data || [],
        motions: motionsR.data || [],
        invoices: invoicesR.data || [],
        admins,
      });
    } catch (e) {
      setError(e.message || 'Failed to load sacco data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);
  return { ...data, loading, error, refetch: fetchAll };
};

// ── KPI card ─────────────────────────────────────────────────────────────────
const StatCard = ({ title, value, subtitle, icon, iconBg, iconColor }) => (
  <div className="bg-card border border-border rounded-xl p-5">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
        <p className="text-2xl font-bold text-foreground mt-1.5">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon name={icon} size={19} color={iconColor} />
      </div>
    </div>
  </div>
);

// ── Registration details modal — the sacco's first-time registration record ──
const Row = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
    <span className="text-xs text-muted-foreground flex-shrink-0">{label}</span>
    <span className="text-sm font-medium text-foreground text-right break-words">{value || '—'}</span>
  </div>
);

const SaccoDetailsModal = ({ sacco, admin, memberCount, onClose }) => {
  const tier = tierBadge(sacco.tier);
  const kyc  = kycBadge(sacco.kyc_status);
  const tierInfo = tierById(sacco.tier);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(52,193,221,0.12)' }}>
              <Icon name="PiggyBank" size={19} color="#0891b2" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">{sacco.name}</h3>
              <p className="text-xs text-muted-foreground">Registered {fmtDate(sacco.created_at)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={16} color="currentColor" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Registration details</p>
            <Row label="Sacco / Chama name"  value={sacco.name} />
            <Row label="Registration no."     value={sacco.registration_no} />
            <Row label="SASRA licence no."    value={sacco.sasra_licence_no} />
            <Row label="Business type"        value={sacco.business_type} />
            <Row label="Location"             value={sacco.location} />
            <Row label="County"               value={sacco.city} />
            <Row label="Registered on"        value={fmtDate(sacco.created_at)} />
            <Row label="KYC status" value={
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: kyc.color, background: kyc.bg }}>{kyc.label}</span>
            } />
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Admin account</p>
            <Row label="Full name" value={admin?.full_name} />
            <Row label="Email"     value={admin?.email || sacco.email} />
            <Row label="Phone"     value={admin?.phone || sacco.phone} />
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Plan &amp; usage</p>
            <Row label="Tier" value={
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize" style={{ color: tier.color, background: tier.bg }}>{tier.label}</span>
            } />
            <Row label="Member cap"      value={sacco.member_cap != null ? `${sacco.member_cap} members` : '—'} />
            <Row label="Members onboarded" value={`${memberCount} member(s)`} />
            <Row label="Storage used"    value={`${Number(sacco.storage_used_gb || 0).toFixed(2)} GB${tierInfo?.storageGb ? ` of ${tierInfo.storageGb} GB` : ''}`} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Activity feed — recent events across all saccos ─────────────────────────
const ACTIVITY_META = {
  registration: { icon: 'Building2',   color: '#0891b2', bg: 'rgba(8,145,178,0.1)' },
  member:       { icon: 'UserPlus',    color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
  contribution: { icon: 'Wallet',      color: '#0b7a4e', bg: 'rgba(11,122,78,0.1)' },
  loan:         { icon: 'Banknote',    color: '#b45309', bg: 'rgba(180,83,9,0.1)' },
  motion:       { icon: 'Vote',        color: '#1A56DB', bg: 'rgba(26,86,219,0.1)' },
  invoice:      { icon: 'ReceiptText', color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
};

const ActivityFeed = ({ events }) => (
  <div className="bg-card border border-border rounded-xl overflow-hidden">
    <div className="px-5 py-4 border-b border-border flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(26,86,219,0.1)' }}>
        <Icon name="Activity" size={17} color="#1A56DB" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">Sacco activity</h3>
        <p className="text-xs text-muted-foreground">Latest events across all saccos</p>
      </div>
    </div>
    <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
      {events.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          <Icon name="Inbox" size={26} color="#9ca3af" className="mx-auto mb-2" />
          No activity recorded yet.
        </div>
      ) : events.map((ev) => {
        const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.registration;
        return (
          <div key={`${ev.type}-${ev.id}`} className="px-5 py-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: meta.bg }}>
              <Icon name={meta.icon} size={15} color={meta.color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground">{ev.text}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ev.saccoName} · {fmtWhen(ev.created_at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

// ── Page ─────────────────────────────────────────────────────────────────────
const SaccoOversight = () => {
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const { saccos, members, contributions, loans, motions, invoices, admins, loading, error, refetch } = useSaccoOversight();

  const [selectedSacco, setSelectedSacco] = useState(null);
  const [saccoFilter, setSaccoFilter]     = useState('all');
  const [search, setSearch]               = useState('');

  const saccoName = useMemo(() => Object.fromEntries(saccos.map((s) => [s.id, s.name])), [saccos]);

  const memberCountBySacco = useMemo(() => {
    const map = {};
    members.forEach((m) => { map[m.sacco_id] = (map[m.sacco_id] || 0) + 1; });
    return map;
  }, [members]);

  const stats = useMemo(() => ({
    totalSaccos:   saccos.length,
    pendingKyc:    saccos.filter((s) => s.kyc_status === 'pending').length,
    totalMembers:  members.length,
    collected:     contributions.filter((c) => c.status === 'paid').reduce((a, c) => a + Number(c.amount || 0), 0),
    loansIssued:   loans.filter((l) => l.status === 'approved' || l.status === 'active').length,
    loanPrincipal: loans.filter((l) => l.status === 'approved' || l.status === 'active').reduce((a, l) => a + Number(l.principal || 0), 0),
  }), [saccos, members, contributions, loans]);

  const events = useMemo(() => {
    const all = [
      ...saccos.map((s)        => ({ type: 'registration', id: s.id, sacco_id: s.id, created_at: s.created_at, text: `New sacco registered — ${s.name}` })),
      ...members.map((m)       => ({ type: 'member',       id: m.id, sacco_id: m.sacco_id, created_at: m.created_at, text: `New member registered — ${m.full_name}` })),
      ...contributions.map((c) => ({ type: 'contribution', id: c.id, sacco_id: c.sacco_id, created_at: c.created_at, text: `Contribution of ${fmtKES(c.amount)} recorded (${c.status})` })),
      ...loans.map((l)         => ({ type: 'loan',         id: l.id, sacco_id: l.sacco_id, created_at: l.created_at, text: `Loan of ${fmtKES(l.principal)} — ${l.status}` })),
      ...motions.map((m)       => ({ type: 'motion',       id: m.id, sacco_id: m.sacco_id, created_at: m.created_at, text: `Motion: "${m.title}" (${m.status})` })),
      ...invoices.map((i)      => ({ type: 'invoice',      id: i.id, sacco_id: i.sacco_id, created_at: i.created_at, text: `Invoice of ${fmtKES(i.total)} issued (${i.status})` })),
    ];
    return all
      .map((ev) => ({ ...ev, saccoName: saccoName[ev.sacco_id] || 'Unknown sacco' }))
      .filter((ev) => saccoFilter === 'all' || ev.sacco_id === saccoFilter)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50);
  }, [saccos, members, contributions, loans, motions, invoices, saccoName, saccoFilter]);

  const filteredSaccos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return saccos;
    return saccos.filter((s) =>
      [s.name, s.registration_no, s.email, s.city, s.location].some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [saccos, search]);

  return (
    <MainLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #0891b2, #34c1dd)' }}>
              <Icon name="PiggyBank" size={20} color="#fff" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Sacco Oversight</h1>
              <p className="text-sm text-muted-foreground">
                Welcome, {userProfile?.full_name || 'Super Admin'} · All registered saccos &amp; chamas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/super-admin-dashboard')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="ArrowLeftRight" size={12} color="currentColor" />
              Switch to Company Portal
            </button>
            <button
              onClick={refetch}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="RefreshCw" size={12} color="currentColor" />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium" style={{ background: '#fee2e2', color: '#b91c1c' }}>
            <Icon name="AlertTriangle" size={15} color="#b91c1c" />
            {error}
          </div>
        )}

        {/* KPIs */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Sk key={i} className="h-24" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Registered Saccos" value={stats.totalSaccos}
              subtitle={stats.pendingKyc > 0 ? `${stats.pendingKyc} pending KYC review` : 'All KYC reviewed'}
              icon="Building2" iconBg="bg-cyan-100" iconColor="#0891b2" />
            <StatCard title="Total Members" value={stats.totalMembers}
              subtitle="Across all saccos" icon="Users" iconBg="bg-purple-100" iconColor="#7c3aed" />
            <StatCard title="Contributions Collected" value={fmtKES(stats.collected)}
              subtitle="Paid contributions to date" icon="Wallet" iconBg="bg-emerald-100" iconColor="#059669" />
            <StatCard title="Active Loans" value={stats.loansIssued}
              subtitle={`${fmtKES(stats.loanPrincipal)} principal out`} icon="Banknote" iconBg="bg-amber-100" iconColor="#b45309" />
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">

          {/* Registered saccos table */}
          <div className="xl:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(8,145,178,0.1)' }}>
                  <Icon name="ClipboardList" size={17} color="#0891b2" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Registered Saccos</h3>
                  <p className="text-xs text-muted-foreground">First-time registration details — click a row to view the full record</p>
                </div>
              </div>
              <div className="relative">
                <Icon name="Search" size={14} color="#9ca3af" className="absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  className="bg-background border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 w-full sm:w-56"
                  placeholder="Search saccos…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {loading ? (
              <div className="p-5"><Sk className="h-64" /></div>
            ) : filteredSaccos.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">
                <Icon name="PackageOpen" size={28} color="#9ca3af" className="mx-auto mb-2" />
                {saccos.length === 0 ? 'No saccos registered yet.' : 'No saccos match your search.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Sacco</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Reg. No</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">County</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Tier</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Members</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">KYC</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Registered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSaccos.map((s) => {
                      const tier = tierBadge(s.tier);
                      const kyc  = kycBadge(s.kyc_status);
                      return (
                        <tr key={s.id}
                          className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => setSelectedSacco(s)}>
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">{s.name}</div>
                            <div className="text-xs text-muted-foreground">{s.email || admins[s.admin_id]?.email || '—'}</div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{s.registration_no || '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground">{s.city || s.location || '—'}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize" style={{ color: tier.color, background: tier.bg }}>{tier.label}</span>
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground">
                            {memberCountBySacco[s.id] || 0}{s.member_cap != null ? ` / ${s.member_cap}` : ''}
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: kyc.color, background: kyc.bg }}>{kyc.label}</span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(s.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Activity feed */}
          <div className="space-y-3">
            <select
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={saccoFilter}
              onChange={(e) => setSaccoFilter(e.target.value)}
            >
              <option value="all">All saccos</option>
              {saccos.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {loading ? <Sk className="h-80" /> : <ActivityFeed events={events} />}
          </div>
        </div>
      </div>

      {selectedSacco && (
        <SaccoDetailsModal
          sacco={selectedSacco}
          admin={admins[selectedSacco.admin_id]}
          memberCount={memberCountBySacco[selectedSacco.id] || 0}
          onClose={() => setSelectedSacco(null)}
        />
      )}
    </MainLayout>
  );
};

export default SaccoOversight;
