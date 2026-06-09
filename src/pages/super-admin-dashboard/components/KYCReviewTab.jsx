import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { useAdminDashboardContext } from '../../../contexts/AdminDashboardContext';

const DOC_LABELS = {
  national_id_front:     'National ID Front',
  national_id_back:      'National ID Back',
  passport_photo:        'Passport Photo',
  kra_pin:               'KRA PIN Certificate',
  proof_of_residence:    'Proof of Residence',
  business_registration: 'Business Registration',
};

const STATUS_META = {
  pending:  { label: 'Pending',  className: 'bg-yellow-100 text-yellow-700',  icon: 'Clock' },
  approved: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700', icon: 'CheckCircle' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700',        icon: 'XCircle' },
  active:   { label: 'Uploaded', className: 'bg-blue-100 text-blue-700',      icon: 'Upload' },
};

const KYC_STATUS_META = {
  verified:     { label: 'Verified',     className: 'bg-emerald-100 text-emerald-700' },
  under_review: { label: 'Under Review', className: 'bg-blue-100 text-blue-700' },
  unverified:   { label: 'Unverified',   className: 'bg-red-100 text-red-700' },
  pending:      { label: 'Pending',      className: 'bg-yellow-100 text-yellow-700' },
};

const RejectModal = ({ clientName, onClose, onReject }) => {
  var [reason, setReason] = React.useState('');
  var [loading, setLoading] = React.useState(false);

  var handleReject = async function() {
    if (!reason.trim()) return;
    setLoading(true);
    try {
      await onReject(reason);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center">
              <Icon name="XCircle" size={18} color="#dc2626" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Reject KYC</h3>
              <p className="text-xs text-muted-foreground">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Reason for rejection *
            </label>
            <textarea
              value={reason}
              onChange={function(e) { setReason(e.target.value); }}
              placeholder="e.g. National ID image is blurry. Please re-upload a clear photo..."
              rows={4}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground resize-none"
            />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium border border-border text-muted-foreground rounded-xl hover:bg-muted transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleReject}
            disabled={loading || !reason.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}
          >
            {loading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
            ) : (
              <Icon name="XCircle" size={15} color="currentColor" />
            )}
            {loading ? 'Rejecting...' : 'Reject KYC'}
          </button>
        </div>
      </div>
    </div>
  );
};

const KYCReviewTab = ({ adminId }) => {
  const { modals, closeModal } = useAdminDashboardContext();
  var [clients, setClients] = React.useState([]);
  var [selectedClient, setSelectedClient] = React.useState(null);
  var [documents, setDocuments] = React.useState([]);
  var [loading, setLoading] = React.useState(true);
  var [docLoading, setDocLoading] = React.useState(false);
  var [filter, setFilter] = React.useState('all');
  var [toast, setToast] = React.useState(null);
  var [search, setSearch] = React.useState('');

  var showToast = function(message, type) {
    var t = type || 'success';
    setToast({ message: message, type: t });
    setTimeout(function() { setToast(null); }, 4000);
  };

  var fetchClients = useCallback(async function() {
    if (!adminId) return;
    setLoading(true);
    try {
      var result = await supabase
        .from('clients')
        .select('id, full_name, email, phone, account_number, kyc_status, kyc_verified_at, kyc_rejection_reason, created_at')
        .eq('admin_id', adminId)
        .order('created_at', { ascending: false });
      setClients(result.data || []);
    } catch (err) {
      console.error('[KYCReview] Clients error:', err);
    } finally {
      setLoading(false);
    }
  }, [adminId]);

  var fetchDocuments = useCallback(async function(clientId) {
    setDocLoading(true);
    try {
      var result = await supabase
        .from('kyc_documents')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      setDocuments(result.data || []);
    } catch (err) {
      console.error('[KYCReview] Documents error:', err);
    } finally {
      setDocLoading(false);
    }
  }, []);

  useEffect(function() { fetchClients(); }, [fetchClients]);

  var handleSelectClient = async function(client) {
    setSelectedClient(client);
    await fetchDocuments(client.id);
  };

  var handleApproveDoc = async function(docId) {
    try {
      await supabase
        .from('kyc_documents')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() })
        .eq('id', docId);
      await fetchDocuments(selectedClient.id);
      showToast('Document approved successfully');
    } catch (err) {
      showToast(err.message || 'Failed to approve document', 'error');
    }
  };

  var handleRejectDoc = async function(docId, reason) {
    try {
      await supabase
        .from('kyc_documents')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewer_notes: reason,
        })
        .eq('id', docId);
      await fetchDocuments(selectedClient.id);
      showToast('Document rejected');
    } catch (err) {
      showToast(err.message || 'Failed to reject document', 'error');
    }
  };

  var handleApproveKYC = async function() {
    try {
      await supabase
        .from('clients')
        .update({
          kyc_status: 'verified',
          kyc_verified_at: new Date().toISOString(),
          kyc_rejection_reason: null,
        })
        .eq('id', selectedClient.id);

      await supabase
        .from('audit_logs')
        .insert({
          action: 'kyc_verification',
          table_name: 'clients',
          description: 'KYC verified for client ' + selectedClient.full_name,
          severity: 'info',
        });

      setSelectedClient(Object.assign({}, selectedClient, { kyc_status: 'verified' }));
      await fetchClients();
      showToast('KYC approved for ' + selectedClient.full_name);
    } catch (err) {
      showToast(err.message || 'Failed to approve KYC', 'error');
    }
  };

  var handleRejectKYC = async function(reason) {
    try {
      await supabase
        .from('clients')
        .update({
          kyc_status: 'rejected',
          kyc_rejection_reason: reason,
        })
        .eq('id', selectedClient.id);

      await supabase
        .from('audit_logs')
        .insert({
          action: 'kyc_status_change',
          table_name: 'clients',
          description: 'KYC rejected for client ' + selectedClient.full_name,
          severity: 'warning',
        });

      setSelectedClient(Object.assign({}, selectedClient, { kyc_status: 'rejected', kyc_rejection_reason: reason }));
      await fetchClients();
      showToast('KYC rejected for ' + selectedClient.full_name);
    } catch (err) {
      showToast(err.message || 'Failed to reject KYC', 'error');
    }
  };

  var handleDownloadAll = async function(clientId, clientName) {
    var docs = documents.filter(function(d) { return d.file_url; });
    if (docs.length === 0) {
      showToast('No documents to download', 'error');
      return;
    }
    docs.forEach(function(doc) {
      var a = document.createElement('a');
      a.href = doc.file_url;
      a.target = '_blank';
      a.download = (clientName || 'client') + '_' + doc.document_type;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
    showToast('Opening all documents...');
  };

  var filteredClients = clients.filter(function(c) {
    var matchFilter = filter === 'all' || c.kyc_status === filter;
    var matchSearch = !search ||
      (c.full_name && c.full_name.toLowerCase().includes(search.toLowerCase())) ||
      (c.email && c.email.toLowerCase().includes(search.toLowerCase())) ||
      (c.account_number && c.account_number.toLowerCase().includes(search.toLowerCase()));
    return matchFilter && matchSearch;
  });

  var allDocsApproved = documents.length > 0 && documents.every(function(d) { return d.status === 'approved'; });
  var hasPendingDocs = documents.some(function(d) { return d.status === 'pending' || d.status === 'active'; });

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row gap-4">

        <div className="lg:w-80 flex-shrink-0 space-y-3">
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-base font-semibold text-foreground mb-3">Client KYC</h2>

            <div className="relative mb-3">
              <Icon name="Search" size={14} color="var(--color-muted-foreground)" className="absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={function(e) { setSearch(e.target.value); }}
                placeholder="Search clients..."
                className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="flex gap-1 flex-wrap mb-3">
              {[
                { value: 'all',          label: 'All' },
                { value: 'unverified',   label: 'Pending' },
                { value: 'under_review', label: 'Review' },
                { value: 'verified',     label: 'Verified' },
              ].map(function(f) {
                return (
                  <button
                    key={f.value}
                    onClick={function() { setFilter(f.value); }}
                    className={'px-2.5 py-1 rounded-full text-xs font-medium transition-all ' + (
                      filter === f.value
                        ? 'bg-primary text-white'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(function(i) {
                  return <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />;
                })}
              </div>
            ) : filteredClients.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Icon name="Users" size={24} color="currentColor" />
                <p className="text-xs mt-1">No clients found</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredClients.map(function(client) {
                  var kycMeta = KYC_STATUS_META[client.kyc_status] || KYC_STATUS_META.unverified;
                  var isSelected = selectedClient && selectedClient.id === client.id;
                  return (
                    <button
                      key={client.id}
                      onClick={function() { handleSelectClient(client); }}
                      className={'w-full text-left p-3 rounded-xl border transition-all ' + (
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40 hover:bg-muted/30'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs flex-shrink-0">
                            {(client.full_name || 'C')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{client.full_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{client.account_number}</p>
                          </div>
                        </div>
                        <span className={'text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-1 ' + kycMeta.className}>
                          {kycMeta.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1">
          {!selectedClient ? (
            <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground">
              <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center mb-4">
                <Icon name="Shield" size={28} color="currentColor" />
              </div>
              <p className="text-base font-medium text-foreground">Select a client</p>
              <p className="text-sm text-muted-foreground mt-1">
                Choose a client from the list to review their KYC documents
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-lg flex-shrink-0">
                      {(selectedClient.full_name || 'C')[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-foreground">{selectedClient.full_name}</p>
                      <p className="text-xs text-muted-foreground">{selectedClient.email}</p>
                      <p className="text-xs text-muted-foreground">{selectedClient.account_number}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(function() {
                      var kycMeta = KYC_STATUS_META[selectedClient.kyc_status] || KYC_STATUS_META.unverified;
                      return (
                        <span className={'px-3 py-1 rounded-full text-sm font-semibold ' + kycMeta.className}>
                          {kycMeta.label}
                        </span>
                      );
                    })()}
                    <button
                      onClick={function() { handleDownloadAll(selectedClient.id, selectedClient.full_name); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                    >
                      <Icon name="Download" size={13} color="currentColor" />
                      Download All
                    </button>
                    {selectedClient.kyc_status !== 'verified' && allDocsApproved && (
                      <button
                        onClick={handleApproveKYC}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
                        style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
                      >
                        <Icon name="ShieldCheck" size={13} color="currentColor" />
                        Approve KYC
                      </button>
                    )}
                    {selectedClient.kyc_status !== 'rejected' && selectedClient.kyc_status !== 'unverified' && (
                      <button
                        onClick={function() { modals.rejectKYC = selectedClient; }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
                        style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}
                      >
                        <Icon name="XCircle" size={13} color="currentColor" />
                        Reject KYC
                      </button>
                    )}
                  </div>
                </div>

                {selectedClient.kyc_rejection_reason && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200">
                    <p className="text-xs font-medium text-red-700">Rejection reason:</p>
                    <p className="text-xs text-red-600 mt-0.5">{selectedClient.kyc_rejection_reason}</p>
                  </div>
                )}
              </div>

              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="text-base font-semibold text-foreground">Submitted Documents</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {documents.length} document{documents.length !== 1 ? 's' : ''} submitted
                  </p>
                </div>

                {docLoading ? (
                  <div className="p-5 space-y-3">
                    {[1,2,3].map(function(i) {
                      return <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />;
                    })}
                  </div>
                ) : documents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                    <Icon name="FileText" size={28} color="currentColor" />
                    <p className="text-sm mt-2">No documents submitted yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {documents.map(function(doc) {
                      var statusMeta = STATUS_META[doc.status] || STATUS_META.pending;
                      return (
                        <div key={doc.id} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className={'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ' + (
                              doc.status === 'approved' ? 'bg-emerald-100' :
                              doc.status === 'rejected' ? 'bg-red-100' : 'bg-blue-100'
                            )}>
                              <Icon
                                name={statusMeta.icon}
                                size={18}
                                color={
                                  doc.status === 'approved' ? '#059669' :
                                  doc.status === 'rejected' ? '#dc2626' : '#1A56DB'
                                }
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">
                                {DOC_LABELS[doc.document_type] || doc.document_type}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + statusMeta.className}>
                                  {statusMeta.label}
                                </span>
                                {doc.file_name && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    {doc.file_name}
                                  </span>
                                )}
                              </div>
                              {doc.status === 'rejected' && doc.reviewer_notes && (
                                <p className="text-xs text-red-600 mt-1">
                                  Reason: {doc.reviewer_notes}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            {doc.file_url && (
                              <a
                                href={doc.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                              >
                                <Icon name="Download" size={13} color="currentColor" />
                                View
                              </a>
                            )}
                            {doc.status !== 'approved' && (
                              <button
                                onClick={function() { handleApproveDoc(doc.id); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
                                style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
                              >
                                <Icon name="Check" size={13} color="currentColor" />
                                Approve
                              </button>
                            )}
                            {doc.status !== 'rejected' && (
                              <button
                                onClick={function() { handleRejectDoc(doc.id, 'Document rejected by admin'); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
                                style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}
                              >
                                <Icon name="X" size={13} color="currentColor" />
                                Reject
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {hasPendingDocs && !allDocsApproved && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs">
                  <Icon name="AlertTriangle" size={14} color="currentColor" />
                  Review and approve all documents before approving the full KYC
                </div>
              )}

              {allDocsApproved && selectedClient.kyc_status !== 'verified' && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">
                  <Icon name="CheckCircle" size={14} color="currentColor" />
                  All documents approved. You can now approve the full KYC above.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {modals.rejectKYC && (
        <RejectModal
          clientName={modals.rejectKYC.full_name}
          onClose={function() { closeModal('rejectKYC'); }}
          onReject={handleRejectKYC}
        />
      )}

      {toast && (
        <div className={'fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ' + (
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        )}>
          <Icon name={toast.type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={16} color="white" />
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default KYCReviewTab;
