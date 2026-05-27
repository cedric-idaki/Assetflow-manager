import React, { useState, useMemo, useEffect, useCallback } from 'react';
import MainLayout from '../../layouts/MainLayout';
import Icon from '../../components/AppIcon';
import RenewalQueue from './components/RenewalQueue';
import DocumentReUpload from './components/DocumentReUpload';
import MessagingPanel from './components/MessagingPanel';
import ApprovalQueue from './components/ApprovalQueue';
import NotificationPanel from './components/NotificationPanel';
import ReminderLogsPanel from './components/ReminderLogsPanel';
import DocumentQualityScoring from './components/DocumentQualityScoring';
import AutoApprovalRules from './components/AutoApprovalRules';
import FlaggedDocumentsQueue from './components/FlaggedDocumentsQueue';
import { RenewalStatusBadge, UrgencyBadge } from './components/RenewalStatusBadge';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { auditLogsService } from '../../services/supabaseService';

let _kycRenewalChannelSeq = 0;

const getDaysLeft = (expiryDate) => {
  const today = new Date();
  const expiry = new Date(expiryDate);
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
};

const getUrgency = (daysLeft) => {
  if (daysLeft <= 0) return 'critical';
  if (daysLeft <= 7) return 'critical';
  if (daysLeft <= 30) return 'high';
  if (daysLeft <= 60) return 'medium';
  return 'low';
};

// ── Skeleton ──────────────────────────────────────────────────────────────────
const Sk = ({ className = '' }) => <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;

const KYCRenewalManagementScreen = () => {
  const { userProfile } = useAuth();
  const [renewals, setRenewals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activePanel, setActivePanel] = useState('upload');
  const [successMsg, setSuccessMsg] = useState('');
  const [docScores, setDocScores] = useState({});
  const [rightTab, setRightTab] = useState('summary');

  const currentUser = {
    id: userProfile?.id || '',
    name: userProfile?.full_name || 'Compliance Officer',
    role: userProfile?.role || 'admin',
    email: userProfile?.email || '',
  };

  // ── Fetch KYC documents needing renewal from Supabase ──
  const fetchRenewals = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('kyc_documents')
        .select(`
  id,
  document_type,
  document_side,
  expiry_date,
  status,
  rejection_reason,
  created_at,
  client:clients(
    id,
    full_name,
    account_number,
    email,
    phone
  )
`)
        .not('expiry_date', 'is', null)
        .order('expiry_date', { ascending: true });

      if (error) throw error;

      const mapped = (data || []).map(doc => ({
        id: doc.id,
        clientId: doc.client?.id || '',
        clientName: doc.client?.full_name || 'Unknown Client',
        clientEmail: doc.client?.email || '',
        clientPhone: doc.client?.phone || '',
        accountNumber: doc.client?.account_number || '',
        documentType: (doc.document_type || '')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase()),
        documentTypeKey: doc.document_type || '',
        expiryDate: doc.expiry_date,
        status: doc.status || 'pending',
        submittedAt: doc.submitted_at,
        createdAt: doc.created_at,
       existingDocUrl: null,
newDocUrl: null,
notes: doc.rejection_reason || '',
      }));

      setRenewals(mapped);
      if (mapped.length > 0 && !selectedId) {
        setSelectedId(mapped[0].id);
      }
    } catch (err) {
      console.error('KYC Renewal fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    fetchRenewals();

    // Realtime updates
    const channel = supabase
      .channel(`kyc_renewals_${++_kycRenewalChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kyc_documents' }, fetchRenewals)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [fetchRenewals]);

  const selectedRenewal = useMemo(
    () => renewals.find(r => r.id === selectedId),
    [renewals, selectedId]
  );

  const stats = useMemo(() => ({
    total: renewals.length,
    pending: renewals.filter(r => r.status === 'pending').length,
    submitted: renewals.filter(r => r.status === 'submitted').length,
    underReview: renewals.filter(r => r.status === 'under_review').length,
    approved: renewals.filter(r => r.status === 'approved').length,
    rejected: renewals.filter(r => r.status === 'rejected').length,
  }), [renewals]);

  const showSuccess = (msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3500);
  };

  // ── Update status in Supabase ──
  const updateStatus = async (id, status, extraFields = {}) => {
    const { error } = await supabase
      .from('kyc_documents')
      .update({ status, updated_at: new Date().toISOString(), ...extraFields })
      .eq('id', id);
    if (error) throw error;
  };

  const handleDocumentUpload = async (file, previewUrl) => {
    try {
      await updateStatus(selectedId, 'submitted', {
        renewal_document_url: previewUrl || null,
        submitted_at: new Date().toISOString(),
      });
      setRenewals(prev => prev.map(r =>
        r.id === selectedId
          ? { ...r, status: 'submitted', newDocUrl: previewUrl || r.newDocUrl, submittedAt: new Date().toISOString() }
          : r
      ));
      showSuccess('Document submitted successfully. Pending compliance review.');
      try {
        await auditLogsService?.logKYCAction?.(
          selectedRenewal?.clientId,
          selectedRenewal?.clientName,
          'renewal_document_upload',
          { renewalId: selectedId, documentType: selectedRenewal?.documentType, fileName: file?.name }
        );
      } catch (e) { /* silent */ }
    } catch (err) {
      showSuccess('Upload failed: ' + err.message);
    }
  };

  const handleApprove = async (renewalId, comment) => {
    const renewal = renewals.find(r => r.id === renewalId);
    try {
      await updateStatus(renewalId, 'approved', { notes: comment || renewal?.notes });
      setRenewals(prev => prev.map(r => r.id === renewalId ? { ...r, status: 'approved' } : r));
      showSuccess(`Renewal approved for ${renewal?.clientName}`);
      try {
        await auditLogsService?.logKYCAction?.(
          renewal?.clientId, renewal?.clientName, 'renewal_approved',
          { renewalId, approverComment: comment, approvedBy: currentUser.name }
        );
      } catch (e) { /* silent */ }
    } catch (err) {
      showSuccess('Approval failed: ' + err.message);
    }
  };

  const handleReject = async (renewalId, comment) => {
    const renewal = renewals.find(r => r.id === renewalId);
    try {
      await updateStatus(renewalId, 'rejected', { notes: comment || renewal?.notes });
      setRenewals(prev => prev.map(r => r.id === renewalId ? { ...r, status: 'rejected' } : r));
      showSuccess(`Renewal rejected for ${renewal?.clientName}`);
      try {
        await auditLogsService?.logKYCAction?.(
          renewal?.clientId, renewal?.clientName, 'renewal_rejected',
          { renewalId, rejectionReason: comment, rejectedBy: currentUser.name }
        );
      } catch (e) { /* silent */ }
    } catch (err) {
      showSuccess('Rejection failed: ' + err.message);
    }
  };

  const handleRequestInfo = async (renewalId, comment) => {
    const renewal = renewals.find(r => r.id === renewalId);
    try {
      await updateStatus(renewalId, 'pending', { notes: comment || renewal?.notes });
      setRenewals(prev => prev.map(r => r.id === renewalId ? { ...r, status: 'pending' } : r));
      showSuccess(`Info requested from ${renewal?.clientName}`);
    } catch (err) {
      showSuccess('Request failed: ' + err.message);
    }
  };

  const handleScoreUpdate = (renewalId, scoreData) => {
    setDocScores(prev => ({ ...prev, [renewalId]: scoreData?.overallScore }));
    if (scoreData?.recommendation === 'approve') {
      showSuccess(`Document quality score: ${scoreData?.overallScore}/100 — Eligible for auto-approval`);
    } else if (scoreData?.recommendation === 'flag') {
      showSuccess(`Document flagged: Quality score ${scoreData?.overallScore}/100 requires manual review`);
    }
  };

  const handleAutoApprove = (clientId) => {
    const renewal = renewals.find(r => r.clientId === clientId);
    if (renewal) handleApprove(renewal.id, 'Auto-approved by rules engine');
  };

  const panelTabs = [
    { id: 'upload',        label: 'Re-Upload',      icon: 'Upload' },
    { id: 'messages',      label: 'Messages',       icon: 'MessageSquare' },
    { id: 'approval',      label: 'Approval Queue', icon: 'ClipboardCheck' },
    { id: 'notifications', label: 'Notifications',  icon: 'Bell' },
    { id: 'reminders',     label: 'Reminders',      icon: 'Send' },
    { id: 'scoring',       label: 'AI Scoring',     icon: 'Sparkles' },
  ];

  const daysLeft = selectedRenewal ? getDaysLeft(selectedRenewal.expiryDate) : 0;
  const urgency = getUrgency(daysLeft);

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" >
              KYC Renewal Management
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage document renewals, approvals, and client communications
              {!loading && <span className="ml-2 text-xs text-emerald-600 font-semibold">● Live data</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!loading && stats.pending + stats.submitted > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg">
                <Icon name="AlertTriangle" size={14} color="#f97316" />
                <span className="text-xs font-medium text-orange-700">
                  {stats.pending + stats.submitted} Require Action
                </span>
              </div>
            )}
            <button onClick={fetchRenewals}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              <Icon name="RefreshCw" size={13} color="currentColor" />
              Refresh
            </button>
          </div>
        </div>

        {/* Success Toast */}
        {successMsg && (
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
            <Icon name="CheckCircle2" size={16} color="#22c55e" />
            <span className="text-sm text-green-700">{successMsg}</span>
          </div>
        )}

        {/* Stats Row */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[...Array(6)].map((_, i) => <Sk key={i} className="h-16" />)}
          </div>
        ) : renewals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 bg-white border border-gray-100 rounded-2xl">
            <Icon name="ShieldCheck" size={40} color="currentColor" />
            <p className="mt-3 text-sm font-semibold">No KYC renewals found</p>
            <p className="text-xs mt-1">Documents with expiry dates will appear here</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: 'Total',        value: stats.total,       color: 'text-foreground',  bg: 'bg-card' },
                { label: 'Pending',      value: stats.pending,     color: 'text-yellow-600',  bg: 'bg-yellow-50' },
                { label: 'Submitted',    value: stats.submitted,   color: 'text-blue-600',    bg: 'bg-blue-50' },
                { label: 'Under Review', value: stats.underReview, color: 'text-orange-600',  bg: 'bg-orange-50' },
                { label: 'Approved',     value: stats.approved,    color: 'text-green-600',   bg: 'bg-green-50' },
                { label: 'Rejected',     value: stats.rejected,    color: 'text-red-600',     bg: 'bg-red-50' },
              ].map(stat => (
                <div key={stat.label} className={`${stat.bg} border border-border rounded-xl p-3 text-center`}>
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Main 3-Panel Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-4 min-h-[600px]">
              {/* Left: Renewal Queue */}
              <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-border flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Icon name="ListOrdered" size={16} color="var(--color-primary)" />
                    <h2 className="text-sm font-semibold text-foreground">Renewal Queue</h2>
                    <span className="ml-auto text-xs text-muted-foreground">{renewals.length}</span>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden">
                  <RenewalQueue
                    renewals={renewals}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                  />
                </div>
              </div>

              {/* Center: Detail Panel */}
              <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
                {selectedRenewal ? (
                  <>
                    <div className="px-5 py-4 border-b border-border flex-shrink-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold text-foreground">{selectedRenewal.clientName}</h2>
                          <p className="text-xs text-muted-foreground">
                            {selectedRenewal.accountNumber} · {selectedRenewal.documentType}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <UrgencyBadge urgency={urgency} />
                          <RenewalStatusBadge status={selectedRenewal.status} />
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-3">
                        <div className="flex items-center gap-1.5">
                          <Icon name="Calendar" size={13} color="var(--color-muted-foreground)" />
                          <span className="text-xs text-muted-foreground">
                            Expires: <span className={`font-medium ${
                              daysLeft <= 0 ? 'text-red-600' : daysLeft <= 30 ? 'text-orange-500' : 'text-foreground'
                            }`}>{new Date(selectedRenewal.expiryDate).toLocaleDateString('en-KE')}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Icon name="Clock" size={13} color="var(--color-muted-foreground)" />
                          <span className={`text-xs font-medium ${
                            daysLeft <= 0 ? 'text-red-600' : daysLeft <= 7 ? 'text-red-500' : daysLeft <= 30 ? 'text-orange-500' : 'text-muted-foreground'
                          }`}>
                            {daysLeft <= 0 ? 'Expired' : `${daysLeft} days remaining`}
                          </span>
                        </div>
                      </div>
                      {selectedRenewal.notes && (
                        <p className="text-xs text-muted-foreground mt-2 italic">{selectedRenewal.notes}</p>
                      )}
                    </div>

                    {/* Panel Tabs */}
                    <div className="flex border-b border-border flex-shrink-0 overflow-x-auto">
                      {panelTabs.map(tab => (
                        <button key={tab.id} onClick={() => setActivePanel(tab.id)}
                          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium whitespace-nowrap transition-smooth border-b-2 ${
                            activePanel === tab.id
                              ? 'border-primary text-primary'
                              : 'border-transparent text-muted-foreground hover:text-foreground'
                          }`}>
                          <Icon name={tab.icon} size={13} color="currentColor" />
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Panel Content */}
                    <div className="flex-1 overflow-y-auto p-5">
                      {activePanel === 'upload' && (
                        <DocumentReUpload renewal={selectedRenewal} onUpload={handleDocumentUpload} />
                      )}
                      {activePanel === 'messages' && (
                        <div className="h-full -m-5">
                          <div className="h-[500px] flex flex-col">
                            <MessagingPanel renewal={selectedRenewal} currentUser={currentUser} />
                          </div>
                        </div>
                      )}
                      {activePanel === 'approval' && (
                        <ApprovalQueue
                          renewals={renewals}
                          onApprove={handleApprove}
                          onReject={handleReject}
                          onRequestInfo={handleRequestInfo}
                          currentUser={currentUser}
                        />
                      )}
                      {activePanel === 'notifications' && <NotificationPanel />}
                      {activePanel === 'reminders' && <ReminderLogsPanel />}
                      {activePanel === 'scoring' && (
                        <DocumentQualityScoring
                          renewal={selectedRenewal}
                          onScoreUpdate={handleScoreUpdate}
                          flagThreshold={60}
                          autoApproveThreshold={75}
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                    <Icon name="FileSearch" size={40} color="currentColor" />
                    <p className="mt-3 text-sm font-medium">Select a renewal request</p>
                    <p className="text-xs mt-1">Choose from the queue to view details</p>
                  </div>
                )}
              </div>

              {/* Right Panel */}
              <div className="space-y-4">
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  <div className="flex border-b border-border overflow-x-auto">
                    {[
                      { id: 'summary', label: 'Summary',    icon: 'LayoutDashboard' },
                      { id: 'rules',   label: 'Auto-Rules', icon: 'Cpu' },
                      { id: 'flagged', label: 'Flagged',    icon: 'Flag' },
                    ].map(tab => (
                      <button key={tab.id} onClick={() => setRightTab(tab.id)}
                        className={`flex items-center gap-1 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-smooth ${
                          rightTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}>
                        <Icon name={tab.icon} size={12} color="currentColor" />
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="p-4">
                    {rightTab === 'summary' && (
                      <div className="space-y-4">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Icon name="AlertTriangle" size={15} color="#f97316" />
                            <h3 className="text-sm font-semibold text-foreground">Expiry Summary</h3>
                          </div>
                          {[
                            { label: '≤ 7 days',  count: renewals.filter(r => { const d = getDaysLeft(r.expiryDate); return d > 0 && d <= 7; }).length,  color: 'text-red-600',    bg: 'bg-red-100' },
                            { label: '8–30 days', count: renewals.filter(r => { const d = getDaysLeft(r.expiryDate); return d > 7 && d <= 30; }).length,  color: 'text-orange-600', bg: 'bg-orange-100' },
                            { label: '31–60 days',count: renewals.filter(r => { const d = getDaysLeft(r.expiryDate); return d > 30 && d <= 60; }).length, color: 'text-yellow-600', bg: 'bg-yellow-100' },
                            { label: 'Expired',   count: renewals.filter(r => getDaysLeft(r.expiryDate) <= 0).length,                                     color: 'text-red-700',   bg: 'bg-red-200' },
                          ].map(item => (
                            <div key={item.label} className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">{item.label}</span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${item.bg} ${item.color}`}>{item.count}</span>
                            </div>
                          ))}
                        </div>

                        {Object.keys(docScores).length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Icon name="Sparkles" size={14} color="#9333ea" />
                              <h3 className="text-sm font-semibold text-foreground">Quality Scores</h3>
                            </div>
                            {Object.entries(docScores).map(([renewalId, score]) => {
                              const renewal = renewals.find(r => r.id === renewalId);
                              return renewal ? (
                                <div key={renewalId} className="flex items-center justify-between">
                                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">{renewal.clientName}</span>
                                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                    score >= 75 ? 'bg-green-100 text-green-700' : score >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                                  }`}>{score}/100</span>
                                </div>
                              ) : null;
                            })}
                          </div>
                        )}

                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Icon name="FileText" size={15} color="var(--color-primary)" />
                            <h3 className="text-sm font-semibold text-foreground">By Document Type</h3>
                          </div>
                          {[
                            { key: 'national_id', label: 'National ID',      icon: 'CreditCard' },
                            { key: 'passport',    label: 'Passport',          icon: 'BookOpen' },
                            { key: 'kra_pin',     label: 'KRA PIN',           icon: 'Hash' },
                          ].map(docType => {
                            const count = renewals.filter(r => r.documentTypeKey === docType.key).length;
                            return (
                              <div key={docType.key} className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                                  <Icon name={docType.icon} size={13} color="var(--color-muted-foreground)" />
                                </div>
                                <span className="text-xs text-foreground flex-1">{docType.label}</span>
                                <span className="text-xs font-semibold text-foreground">{count}</span>
                              </div>
                            );
                          })}
                        </div>

                        <div className="space-y-2">
                          <h3 className="text-sm font-semibold text-foreground">Quick Actions</h3>
                          <a href="/kyc-management-screen"
                            className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-smooth text-foreground">
                            <Icon name="ShieldCheck" size={13} color="var(--color-primary)" />
                            KYC Management
                          </a>
                          <a href="/system-administration"
                            className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-smooth text-foreground">
                            <Icon name="ClipboardList" size={13} color="var(--color-muted-foreground)" />
                            View Audit Trail
                          </a>
                        </div>
                      </div>
                    )}
                    {rightTab === 'rules' && (
                      <AutoApprovalRules onAutoApprove={handleAutoApprove} externalScores={docScores} />
                    )}
                    {rightTab === 'flagged' && (
                      <FlaggedDocumentsQueue
                        renewals={renewals}
                        externalScores={docScores}
                        flagThreshold={60}
                        onResolve={(flagId) => showSuccess(`Flag ${flagId} resolved`)}
                        onEscalate={(flagId) => showSuccess(`Flag ${flagId} escalated to senior compliance`)}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default KYCRenewalManagementScreen;
