import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';

const KYC_DOCUMENTS = [
  { type: 'national_id_front',     label: 'National ID Front',     required: true },
  { type: 'national_id_back',      label: 'National ID Back',      required: true },
  { type: 'passport_photo',        label: 'Passport Photo',        required: true },
  { type: 'kra_pin',               label: 'KRA PIN Certificate',   required: true },
  { type: 'proof_of_residence',    label: 'Proof of Residence',    required: true },
  { type: 'business_registration', label: 'Business Registration', required: false },
];

const STATUS_META = {
  pending:  { label: 'Pending Review', className: 'bg-yellow-100 text-yellow-700' },
  active:   { label: 'Uploaded',       className: 'bg-blue-100 text-blue-700' },
  approved: { label: 'Approved',       className: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected',       className: 'bg-red-100 text-red-700' },
};

const KYCTab = ({ clientProfile }) => {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = (message, type) => {
    var t = type || 'success';
    setToast({ message: message, type: t });
    setTimeout(function() { setToast(null); }, 4000);
  };

  const fetchDocuments = useCallback(async () => {
    if (!clientProfile || !clientProfile.id) return;
    try {
      var result = await supabase
        .from('kyc_documents')
        .select('*')
        .eq('client_id', clientProfile.id)
        .order('created_at', { ascending: false });
      setDocuments(result.data || []);
    } catch (err) {
      console.error('[KYC] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [clientProfile]);

  useEffect(function() {
    fetchDocuments();
  }, [fetchDocuments]);

  const getDocStatus = function(type) {
    return documents.find(function(d) { return d.document_type === type; });
  };

  const handleUpload = async function(docType, file) {
    if (!file) return;
    if (!clientProfile || !clientProfile.id) {
      showToast('Your client profile could not be loaded. Please refresh the page or contact your company admin.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('File too large. Maximum size is 5MB.', 'error');
      return;
    }
    setUploading(function(prev) {
      var next = Object.assign({}, prev);
      next[docType] = true;
      return next;
    });
    try {
      var authResult = await supabase.auth.getUser();
      var user = authResult.data && authResult.data.user;
      if (!user) throw new Error('Your session has expired. Please sign in again.');

      var cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var filePath = clientProfile.id + '/' + docType + '_' + Date.now() + '_' + cleanName;

      var uploadResult = await supabase.storage
        .from('kyc-documents')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (uploadResult.error) throw uploadResult.error;

      var urlResult = supabase.storage
        .from('kyc-documents')
        .getPublicUrl(filePath);
      var fileUrl = urlResult.data.publicUrl;

      var existing = getDocStatus(docType);

      var writeResult;
      if (existing) {
        writeResult = await supabase
          .from('kyc_documents')
          .update({
            file_url: fileUrl,
            file_name: file.name,
            status: 'pending',
            uploaded_by: user.id,
            admin_id: clientProfile.admin_id,
          })
          .eq('id', existing.id);
      } else {
        writeResult = await supabase
          .from('kyc_documents')
          .insert({
            client_id: clientProfile.id,
            document_type: docType,
            file_url: fileUrl,
            file_name: file.name,
            status: 'pending',
            uploaded_by: user.id,
            admin_id: clientProfile.admin_id,
          });
      }
      if (writeResult && writeResult.error) throw writeResult.error;

      // Best-effort: a DB trigger also sets this server-side, so ignore RLS errors here.
      await supabase
        .from('clients')
        .update({ kyc_status: 'under_review' })
        .eq('id', clientProfile.id);

      var docLabel = KYC_DOCUMENTS.find(function(d) { return d.type === docType; });
      showToast((docLabel ? docLabel.label : docType) + ' uploaded successfully!');
      await fetchDocuments();
    } catch (err) {
      showToast(err.message || 'Upload failed. Please try again.', 'error');
    } finally {
      setUploading(function(prev) {
        var next = Object.assign({}, prev);
        next[docType] = false;
        return next;
      });
    }
  };

  var totalUploaded = KYC_DOCUMENTS.filter(function(d) { return getDocStatus(d.type); }).length;
  var totalRequired = KYC_DOCUMENTS.filter(function(d) { return d.required; }).length;
  var progress = Math.round((totalUploaded / totalRequired) * 100);
  var status = (clientProfile && clientProfile.kyc_status) ? clientProfile.kyc_status : 'unverified';

  var bannerBg = 'bg-yellow-50 border-yellow-200';
  if (status === 'verified') bannerBg = 'bg-emerald-50 border-emerald-200';
  else if (status === 'under_review') bannerBg = 'bg-blue-50 border-blue-200';
  else if (status === 'rejected') bannerBg = 'bg-red-50 border-red-200';

  var statusIcon = 'Shield';
  if (status === 'verified') statusIcon = 'ShieldCheck';
  else if (status === 'under_review') statusIcon = 'Clock';
  else if (status === 'rejected') statusIcon = 'ShieldX';

  var statusIconColor = '#ca8a04';
  if (status === 'verified') statusIconColor = '#059669';
  else if (status === 'under_review') statusIconColor = '#1A56DB';
  else if (status === 'rejected') statusIconColor = '#dc2626';

  var statusMsg = 'Please upload all required documents below to complete verification.';
  if (status === 'verified') statusMsg = 'Your identity has been verified successfully.';
  else if (status === 'under_review') statusMsg = 'Your documents are being reviewed by your admin.';
  else if (status === 'rejected') statusMsg = (clientProfile && clientProfile.kyc_rejection_reason) ? clientProfile.kyc_rejection_reason : 'Your KYC was rejected. Please re-upload your documents.';

  return (
    <div className="space-y-4">

      <div className={'rounded-xl p-5 border ' + bannerBg}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/60 flex items-center justify-center flex-shrink-0">
            <Icon name={statusIcon} size={20} color={statusIconColor} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-foreground text-sm">
              KYC Status: <span className="capitalize">{status.replace(/_/g, ' ')}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{statusMsg}</p>
          </div>
        </div>

        {status !== 'verified' && (
          <div className="mt-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">
                {totalUploaded} of {totalRequired} required documents uploaded
              </span>
              <span className="font-medium text-foreground">{progress}%</span>
            </div>
            <div className="h-2 bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: progress + '%', background: progress === 100 ? '#059669' : '#1A56DB' }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {KYC_DOCUMENTS.map(function(doc) {
          var existing = getDocStatus(doc.type);
          var isUploading = uploading[doc.type];
          var statusMeta = existing ? (STATUS_META[existing.status] || STATUS_META.pending) : null;

          var iconBg = 'bg-muted';
          if (existing && existing.status === 'approved') iconBg = 'bg-emerald-100';
          else if (existing && existing.status === 'rejected') iconBg = 'bg-red-100';
          else if (existing) iconBg = 'bg-blue-100';

          var iconN = 'Upload';
          if (existing && existing.status === 'approved') iconN = 'CheckCircle';
          else if (existing && existing.status === 'rejected') iconN = 'XCircle';
          else if (existing) iconN = 'FileText';

          var iconC = 'var(--color-muted-foreground)';
          if (existing && existing.status === 'approved') iconC = '#059669';
          else if (existing && existing.status === 'rejected') iconC = '#dc2626';
          else if (existing) iconC = '#1A56DB';

          return (
            <div key={doc.type} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ' + iconBg}>
                    <Icon name={iconN} size={18} color={iconC} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {doc.label}
                      {doc.required && <span className="text-red-500 ml-1">*</span>}
                    </p>
                    {existing ? (
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + (statusMeta ? statusMeta.className : '')}>
                          {statusMeta ? statusMeta.label : ''}
                        </span>
                        {existing.file_name && (
                          <span className="text-xs text-muted-foreground truncate max-w-xs">
                            {existing.file_name}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {doc.required ? 'Required' : 'Optional'} - Max 5MB - PDF, JPG, PNG
                      </p>
                    )}
                    {existing && existing.status === 'rejected' && existing.reviewer_notes && (
                      <p className="text-xs text-red-600 mt-1">
                        Reason: {existing.reviewer_notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {existing && existing.file_url && existing.status !== 'rejected' && (
                    <a
                      href={existing.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                    >
                      <Icon name="Eye" size={13} color="currentColor" />
                      View
                    </a>
                  )}

                  {existing && existing.status !== 'approved' || !existing ? (
                    <label
                      className={'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer transition-all ' + (isUploading ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90')}
                      style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
                    >
                      <span className="flex items-center gap-1.5">
                        {isUploading ? (
                          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                          </svg>
                        ) : (
                          <Icon name="Upload" size={13} color="currentColor" />
                        )}
                        {isUploading ? 'Uploading...' : (existing ? 'Re-upload' : 'Upload')}
                      </span>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        disabled={isUploading ? true : false}
                        onChange={function(e) {
                          if (e.target.files && e.target.files[0]) {
                            handleUpload(doc.type, e.target.files[0]);
                          }
                        }}
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Required documents are marked with * - Securely stored and only visible to your company admin
      </p>

      {toast && (
        <div className={'fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ' + (toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white')}>
          <Icon name={toast.type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={16} color="white" />
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default KYCTab;
