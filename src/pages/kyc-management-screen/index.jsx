import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import MainLayout from '../../layouts/MainLayout';
import { auditLogsService } from '../../services/supabaseService';
import { supabase } from '../../lib/supabase';

const DOC_LABELS = {
  national_id_front:     'National ID Front',
  national_id_back:      'National ID Back',
  passport_photo:        'Passport Photo',
  kra_pin:               'KRA PIN Certificate',
  proof_of_residence:    'Proof of Residence',
  business_registration: 'Business Registration',
};

const REQUIRED_DOCS = ['national_id_front','national_id_back','passport_photo','kra_pin','proof_of_residence'];

const KYC_STATUS_STYLES = {
  verified:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  under_review: 'bg-blue-50 text-blue-700 border-blue-200',
  pending:      'bg-amber-50 text-amber-700 border-amber-200',
  incomplete:   'bg-gray-100 text-gray-600 border-gray-200',
  rejected:     'bg-red-50 text-red-700 border-red-200',
};

const DOC_STATUS_STYLES = {
  approved: 'bg-emerald-100 text-emerald-700',
  pending:  'bg-amber-100 text-amber-700',
  active:   'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
};

// ── Client KYC card shown in the list ───────────────────────────────────────
const ClientKycRow = ({ client, docCounts, onReview }) => {
  const style = KYC_STATUS_STYLES[client.kyc_status] || KYC_STATUS_STYLES.incomplete;
  const uploaded = docCounts[client._id] || 0;
  const progress = Math.min(100, Math.round((uploaded / REQUIRED_DOCS.length) * 100));
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:shadow-sm transition-all">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon name="User" size={20} color="var(--color-primary)" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm text-foreground truncate">{client.fullName}</p>
          <p className="text-xs text-muted-foreground">{client.id} · {client.email}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="w-28 hidden sm:block">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">{uploaded}/{REQUIRED_DOCS.length} docs</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: progress + '%' }} />
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border capitalize flex-shrink-0 ${style}`}>
          {(client.kyc_status || 'incomplete').replace(/_/g, ' ')}
        </span>
        <Button size="sm" variant="outline" onClick={() => onReview(client)}>
          <Icon name="Eye" size={13} color="currentColor" />
          Review
        </Button>
      </div>
    </div>
  );
};

// ── Document viewer / approval panel ────────────────────────────────────────
const KycReviewPanel = ({ client, onClose, onStatusChange }) => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('kyc_documents')
      .select('*')
      .eq('client_id', client._id)
      .order('created_at', { ascending: false });
    setDocs(data || []);
    setLoading(false);
  }, [client._id]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const getDoc = (type) => docs.find(d => d.document_type === type);

  const approveDoc = async (doc) => {
    setProcessing(true);
    await supabase.from('kyc_documents').update({ status: 'approved', reviewer_notes: '' }).eq('id', doc.id);
    await fetchDocs();
    setProcessing(false);
  };

  const rejectDoc = async (doc, reason) => {
    setProcessing(true);
    await supabase.from('kyc_documents').update({ status: 'rejected', reviewer_notes: reason }).eq('id', doc.id);
    await fetchDocs();
    setProcessing(false);
  };

  // Check if all required docs are approved → auto-approve client
  const checkAndAutoApprove = useCallback(async (freshDocs) => {
    const allApproved = REQUIRED_DOCS.every(type => {
      const doc = freshDocs.find(d => d.document_type === type);
      return doc && doc.status === 'approved';
    });
    if (allApproved) {
      await supabase.from('clients')
        .update({ kyc_status: 'verified', kyc_rejection_reason: null })
        .eq('id', client._id);
      showToast('All required documents approved — client KYC verified automatically! ✓');
      onStatusChange('verified');
    }
    return allApproved;
  }, [client._id, onStatusChange]);

  const handleApproveDoc = async (doc) => {
    await approveDoc(doc);
    const { data: freshDocs } = await supabase.from('kyc_documents').select('*').eq('client_id', client._id);
    await checkAndAutoApprove(freshDocs || []);
    setDocs(freshDocs || []);
  };

  const handleApproveAll = async () => {
    setProcessing(true);
    const uploadedDocs = REQUIRED_DOCS.map(getDoc).filter(Boolean);
    for (const doc of uploadedDocs) {
      await supabase.from('kyc_documents').update({ status: 'approved', reviewer_notes: '' }).eq('id', doc.id);
    }
    await supabase.from('clients')
      .update({ kyc_status: 'verified', kyc_rejection_reason: null })
      .eq('id', client._id);
    showToast('Client KYC fully verified! ✓');
    onStatusChange('verified');
    await fetchDocs();
    setProcessing(false);
  };

  const handleRejectClient = async () => {
    if (!rejectReason.trim()) { showToast('Please enter a rejection reason.', 'error'); return; }
    setProcessing(true);
    await supabase.from('clients')
      .update({ kyc_status: 'rejected', kyc_rejection_reason: rejectReason })
      .eq('id', client._id);
    await auditLogsService?.log('update', 'clients', `KYC rejected for ${client.fullName}: ${rejectReason}`);
    showToast('Client KYC rejected.');
    onStatusChange('rejected');
    setShowRejectInput(false);
    setRejectReason('');
    setProcessing(false);
  };

  const uploadedRequired = REQUIRED_DOCS.filter(t => getDoc(t)).length;
  const approvedRequired = REQUIRED_DOCS.filter(t => { const d = getDoc(t); return d && d.status === 'approved'; }).length;
  const kycStyle = KYC_STATUS_STYLES[client.kyc_status] || KYC_STATUS_STYLES.incomplete;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background w-full max-w-2xl h-full overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-background z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Icon name="Shield" size={20} color="var(--color-primary)" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">{client.fullName}</h2>
              <p className="text-xs text-muted-foreground">{client.id} · KYC Review</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="currentColor" />
          </button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {/* KYC Status + progress */}
          <div className="bg-muted/40 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">KYC Status</span>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border capitalize ${kycStyle}`}>
                {(client.kyc_status || 'incomplete').replace(/_/g, ' ')}
              </span>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">{approvedRequired} of {REQUIRED_DOCS.length} required docs approved</span>
                <span className="font-medium">{uploadedRequired}/{REQUIRED_DOCS.length} uploaded</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: Math.round((approvedRequired / REQUIRED_DOCS.length) * 100) + '%' }} />
              </div>
            </div>
          </div>

          {/* Action buttons */}
          {client.kyc_status !== 'verified' && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary" size="sm"
                disabled={processing || uploadedRequired < REQUIRED_DOCS.length}
                onClick={handleApproveAll}
              >
                <Icon name="ShieldCheck" size={14} color="white" />
                Approve All & Verify
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => setShowRejectInput(v => !v)}
              >
                <Icon name="ShieldX" size={14} color="currentColor" />
                Reject KYC
              </Button>
            </div>
          )}

          {showRejectInput && (
            <div className="space-y-2">
              <Input
                placeholder="Reason for rejection (sent to client)..."
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
              <Button size="sm" variant="destructive" disabled={processing} onClick={handleRejectClient}>
                Confirm Rejection
              </Button>
            </div>
          )}

          {/* Document list */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-foreground">Documents</h3>
            {loading ? (
              [1,2,3,4,5].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)
            ) : (
              REQUIRED_DOCS.concat(['business_registration']).map(type => {
                const doc = getDoc(type);
                const isRequired = REQUIRED_DOCS.includes(type);
                const docStyle = doc ? (DOC_STATUS_STYLES[doc.status] || DOC_STATUS_STYLES.pending) : '';
                return (
                  <div key={type} className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${doc ? (doc.status === 'approved' ? 'bg-emerald-100' : doc.status === 'rejected' ? 'bg-red-100' : 'bg-blue-100') : 'bg-muted'}`}>
                          <Icon
                            name={doc ? (doc.status === 'approved' ? 'CheckCircle' : doc.status === 'rejected' ? 'XCircle' : 'FileText') : 'Upload'}
                            size={16}
                            color={doc ? (doc.status === 'approved' ? '#059669' : doc.status === 'rejected' ? '#dc2626' : '#1A56DB') : 'var(--color-muted-foreground)'}
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {DOC_LABELS[type] || type}
                            {isRequired && <span className="text-red-500 ml-1">*</span>}
                          </p>
                          {doc ? (
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${docStyle}`}>
                                {doc.status === 'active' ? 'Uploaded' : doc.status}
                              </span>
                              {doc.file_name && <span className="text-xs text-muted-foreground truncate">{doc.file_name}</span>}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">{isRequired ? 'Not yet uploaded' : 'Optional — not uploaded'}</p>
                          )}
                          {doc?.status === 'rejected' && doc.reviewer_notes && (
                            <p className="text-xs text-red-600 mt-1">Reason: {doc.reviewer_notes}</p>
                          )}
                        </div>
                      </div>

                      {doc && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {doc.file_url && (
                            <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-all"
                              title="View document">
                              <Icon name="Eye" size={14} color="currentColor" />
                            </a>
                          )}
                          {doc.status !== 'approved' && (
                            <button
                              disabled={processing}
                              onClick={() => handleApproveDoc(doc)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 border border-emerald-200 transition-colors disabled:opacity-50">
                              ✓ Approve
                            </button>
                          )}
                          {doc.status !== 'rejected' && (
                            <button
                              disabled={processing}
                              onClick={() => {
                                const reason = prompt('Reason for rejecting this document:');
                                if (reason) rejectDoc(doc, reason);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-50">
                              ✗ Reject
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {toast && (
          <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
            <Icon name={toast.type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={16} color="white" />
            {toast.message}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main KYC Management Screen ───────────────────────────────────────────────
let _kycSeq = 0;

const KycManagementScreen = () => {
  const [clients, setClients] = useState([]);
  const [docCounts, setDocCounts] = useState({});
  const [adminId, setAdminId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [reviewingClient, setReviewingClient] = useState(null);

  const resolveAdminId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase.from('user_profiles').select('id, role, admin_id').eq('id', user.id).maybeSingle();
    return profile?.role === 'admin' ? user.id : (profile?.admin_id || user.id);
  };

  const loadClients = useCallback(async (aId) => {
    const id = aId || adminId;
    if (!id) return;
    const { data } = await supabase
      .from('clients')
      .select('id, account_number, full_name, email, phone, kyc_status, kyc_rejection_reason, national_id, admin_id')
      .eq('admin_id', id)
      .order('created_at', { ascending: false });

    const mapped = (data || []).map(c => ({
      _id: c.id,
      id: c.account_number,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone,
      nationalId: c.national_id,
      kyc_status: c.kyc_status,
      kyc_rejection_reason: c.kyc_rejection_reason,
      admin_id: c.admin_id,
    }));
    setClients(mapped);

    // Load doc counts for all clients in one query
    if (mapped.length > 0) {
      const clientIds = mapped.map(c => c._id);
      const { data: docs } = await supabase
        .from('kyc_documents')
        .select('client_id, status')
        .in('client_id', clientIds);

      const counts = {};
      (docs || []).forEach(d => {
        counts[d.client_id] = (counts[d.client_id] || 0) + 1;
      });
      setDocCounts(counts);
    }
  }, [adminId]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const aId = await resolveAdminId();
      setAdminId(aId);
      await loadClients(aId);
      setLoading(false);

      // Realtime — refresh when docs or clients change
      const ch = supabase
        .channel(`kyc_mgmt_${++_kycSeq}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'kyc_documents' }, () => loadClients(aId))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => loadClients(aId))
        .subscribe();
      return () => supabase.removeChannel(ch);
    };
    init();
  }, []);

  const filtered = clients.filter(c => {
    const matchSearch = !searchQuery ||
      c.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchStatus = filterStatus === 'all' || c.kyc_status === filterStatus;
    return matchSearch && matchStatus;
  });

  const counts = {
    all:          clients.length,
    under_review: clients.filter(c => c.kyc_status === 'under_review').length,
    verified:     clients.filter(c => c.kyc_status === 'verified').length,
    rejected:     clients.filter(c => c.kyc_status === 'rejected').length,
    incomplete:   clients.filter(c => !c.kyc_status || c.kyc_status === 'incomplete' || c.kyc_status === 'pending').length,
  };

  const FILTERS = [
    { value: 'all',          label: 'All',          count: counts.all },
    { value: 'under_review', label: 'Under Review', count: counts.under_review },
    { value: 'incomplete',   label: 'Incomplete',   count: counts.incomplete },
    { value: 'verified',     label: 'Verified',     count: counts.verified },
    { value: 'rejected',     label: 'Rejected',     count: counts.rejected },
  ];

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">KYC Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Review and approve client identity documents · {counts.under_review} pending review
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending Review', count: counts.under_review, color: 'text-blue-600',    bg: 'bg-blue-50',    icon: 'Clock' },
            { label: 'Verified',       count: counts.verified,     color: 'text-emerald-600', bg: 'bg-emerald-50', icon: 'ShieldCheck' },
            { label: 'Incomplete',     count: counts.incomplete,   color: 'text-amber-600',   bg: 'bg-amber-50',   icon: 'AlertTriangle' },
            { label: 'Rejected',       count: counts.rejected,     color: 'text-red-600',     bg: 'bg-red-50',     icon: 'ShieldX' },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
                <Icon name={s.icon} size={18} color="currentColor" className={s.color} />
              </div>
              <div>
                <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filter tabs + search */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto">
            {FILTERS.map(f => (
              <button key={f.value}
                onClick={() => setFilterStatus(f.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${filterStatus === f.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {f.label}
                {f.count > 0 && <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${filterStatus === f.value ? 'bg-primary text-white' : 'bg-muted-foreground/20'}`}>{f.count}</span>}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-48">
            <Input placeholder="Search by name, account, email..."
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              prefix={<Icon name="Search" size={14} color="currentColor" />} />
          </div>
        </div>

        {/* Client list */}
        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Icon name="ShieldCheck" size={48} color="currentColor" />
            <p className="mt-3 font-semibold text-foreground">No clients found</p>
            <p className="text-sm mt-1">
              {filterStatus === 'under_review' ? 'No documents pending review' : 'No clients match your filter'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(client => (
              <ClientKycRow
                key={client._id}
                client={client}
                docCounts={docCounts}
                onReview={c => setReviewingClient(c)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Review panel */}
      {reviewingClient && (
        <KycReviewPanel
          client={reviewingClient}
          onClose={() => setReviewingClient(null)}
          onStatusChange={(newStatus) => {
            setClients(prev => prev.map(c =>
              c._id === reviewingClient._id ? { ...c, kyc_status: newStatus } : c
            ));
            setReviewingClient(prev => prev ? { ...prev, kyc_status: newStatus } : null);
          }}
        />
      )}
    </MainLayout>
  );
};

export default KycManagementScreen;
