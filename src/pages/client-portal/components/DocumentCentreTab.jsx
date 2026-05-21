import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import Icon from '../../../components/AppIcon';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const StatusBadge = ({ status }) => {
  const map = {
    signed:    'bg-emerald-100 text-emerald-700',
    completed: 'bg-emerald-100 text-emerald-700',
    pending:   'bg-amber-100  text-amber-700',
    sent:      'bg-blue-100   text-blue-700',
    verified:  'bg-emerald-100 text-emerald-700',
    rejected:  'bg-red-100    text-red-700',
    expired:   'bg-red-100    text-red-700',
    uploaded:  'bg-blue-100   text-blue-700',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status || 'unknown'}
    </span>
  );
};

const DocCard = ({ icon, title, subtitle, date, status, onDownload, onView, tag }) => (
  <div className="bg-card border border-border rounded-xl p-5 flex items-start gap-4 hover:border-primary/30 transition-all">
    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
      <Icon name={icon} size={18} color="var(--primary)" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground truncate">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          <div className="flex items-center gap-2 mt-1.5">
            {tag && <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{tag}</span>}
            <StatusBadge status={status} />
            <span className="text-xs text-muted-foreground">{fmtDate(date)}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {onView && (
            <button onClick={onView}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors">
              <Icon name="Eye" size={12} color="currentColor" /> View
            </button>
          )}
          {onDownload && (
            <button onClick={onDownload}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              <Icon name="Download" size={12} color="currentColor" /> Download
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
);

const Empty = ({ icon, text, sub }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
      <Icon name={icon} size={20} color="var(--muted-foreground)" />
    </div>
    <p className="text-sm font-medium text-foreground mb-1">{text}</p>
    {sub && <p className="text-xs text-muted-foreground max-w-xs">{sub}</p>}
  </div>
);

// ── Upload Modal ──────────────────────────────────────────────────────────────
const UploadModal = ({ clientId, adminId, onClose, onUploaded }) => {
  const [docType,  setDocType]  = useState('insurance_certificate');
  const [file,     setFile]     = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error,    setError]    = useState('');
  const fileRef = useRef();

  const docTypes = [
    { value: 'insurance_certificate', label: 'Insurance Certificate' },
    { value: 'proof_of_payment',      label: 'Proof of Payment (Bank Slip)' },
    { value: 'proof_of_address',      label: 'Proof of Address' },
    { value: 'asset_condition_photo', label: 'Asset Condition Photo' },
    { value: 'warranty_document',     label: 'Warranty / Service Document' },
    { value: 'other',                 label: 'Other Document' },
  ];

  const handleUpload = async () => {
    if (!file) { setError('Please select a file'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('File must be under 10MB'); return; }
    setUploading(true);
    setError('');
    try {
      const { error: dbErr } = await supabase
        .from('kyc_documents')
        .insert({
          client_id:     clientId,
          admin_id:      adminId,
          document_type: docType,
          status:        'uploaded',
          expiry_date:   '2099-12-31',
          document_side: 'front',
        });
      if (dbErr) throw dbErr;
      onUploaded();
      onClose();
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-foreground">Upload Document</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <Icon name="X" size={18} color="currentColor" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Document Type</label>
            <select
              className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={docType} onChange={e => setDocType(e.target.value)}>
              {docTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">File</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all">
              <input ref={fileRef} type="file" className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.heic,.docx"
                onChange={e => setFile(e.target.files?.[0] || null)} />
              {file ? (
                <div>
                  <Icon name="CheckCircle" size={24} color="#10b981" />
                  <p className="text-sm font-medium text-foreground mt-2">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
              ) : (
                <div>
                  <Icon name="Upload" size={24} color="var(--muted-foreground)" />
                  <p className="text-sm text-muted-foreground mt-2">Click to select file</p>
                  <p className="text-xs text-muted-foreground">PDF, JPG, PNG, DOCX — Max 10MB</p>
                </div>
              )}
            </div>
          </div>
          {error && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 px-4 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button onClick={handleUpload} disabled={uploading}
              className="flex-1 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60">
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const DocumentCentreTab = ({ clientProfile }) => {
  const [contracts,    setContracts]    = useState([]);
  const [companyDocs,  setCompanyDocs]  = useState([]);
  const [kycDocs,      setKycDocs]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [activeSection, setActiveSection] = useState('contracts');
  const [showUpload,   setShowUpload]   = useState(false);

  const clientId = clientProfile?.id;
  const adminId  = clientProfile?.admin_id;

  const fetchDocs = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const [contractsRes, companyRes, kycRes] = await Promise.all([
        supabase
          .from('generated_contracts')
          .select('id, invoice_number, client_name, pricing_model, esign_status, signed_at, generated_at, file_url')
          .eq('client_id', clientId)
          .order('generated_at', { ascending: false }),

        supabase
          .from('company_contracts')
          .select('id, contract_name, contract_type, file_url, status, signed_at, created_at')
          .eq('client_id', clientId)
          .eq('is_template', false)
          .order('created_at', { ascending: false }),

        supabase
          .from('kyc_documents')
          .select('id, document_type, document_side, status, created_at, rejection_reason')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false }),
      ]);

      setContracts(contractsRes.data || []);
      setCompanyDocs(companyRes.data || []);
      setKycDocs(kycRes.data || []);
    } catch (err) {
      console.error('DocumentCentre fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const handleDownload = (url, name) => {
    if (!url) { alert('Document file not available for download.'); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'document';
    a.target = '_blank';
    a.click();
  };

  const sections = [
    { id: 'contracts',  label: 'Sale Contracts',      icon: 'FileText',  count: contracts.length },
    { id: 'company',    label: 'Company Documents',   icon: 'Building2', count: companyDocs.length },
    { id: 'kyc',        label: 'KYC Documents',       icon: 'Shield',    count: kycDocs.length },
  ];

  if (!clientProfile) return (
    <Empty icon="FileText" text="Profile not found" sub="Please contact support" />
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Document Centre</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            View and download your contracts, agreements and uploaded documents
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Icon name="Upload" size={14} color="currentColor" />
          Upload Document
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-2 flex-wrap">
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
              activeSection === s.id
                ? 'border-primary/30 text-primary bg-primary/6'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            style={activeSection === s.id ? { background: 'rgba(26,86,219,0.06)' } : {}}>
            <Icon name={s.icon} size={14} color="currentColor" />
            {s.label}
            {s.count > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold">
                {s.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-xl bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sale Contracts */}
      {!loading && activeSection === 'contracts' && (
        <div className="space-y-3">
          {contracts.length === 0 ? (
            <Empty icon="FileText" text="No sale contracts yet"
              sub="Your contracts will appear here once a sale is completed and the contract is generated" />
          ) : contracts.map(c => (
            <DocCard
              key={c.id}
              icon="FileSignature"
              title={`Sale Contract — ${c.invoice_number || 'N/A'}`}
              subtitle={`${c.client_name || clientProfile.full_name} · ${c.pricing_model || '—'}`}
              date={c.signed_at || c.generated_at}
              status={c.esign_status || 'pending'}
              tag="Hire Purchase"
              onView={c.file_url ? () => window.open(c.file_url, '_blank') : null}
              onDownload={c.esign_status === 'signed' && c.file_url ? () => handleDownload(c.file_url, `Contract-${c.invoice_number}`) : null}
            />
          ))}
        </div>
      )}

      {/* Company Documents */}
      {!loading && activeSection === 'company' && (
        <div className="space-y-3">
          {companyDocs.length === 0 ? (
            <Empty icon="Building2" text="No company documents"
              sub="Documents sent to you by the company will appear here" />
          ) : companyDocs.map(d => (
            <DocCard
              key={d.id}
              icon="FileText"
              title={d.contract_name || 'Company Document'}
              subtitle={d.contract_type || '—'}
              date={d.signed_at || d.created_at}
              status={d.status || 'pending'}
              onView={d.file_url ? () => window.open(d.file_url, '_blank') : null}
              onDownload={d.file_url ? () => handleDownload(d.file_url, d.contract_name) : null}
            />
          ))}
        </div>
      )}

      {/* KYC Documents */}
      {!loading && activeSection === 'kyc' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              KYC Status: <span className={`font-semibold ${clientProfile.kyc_status === 'verified' ? 'text-emerald-600' : 'text-amber-600'}`}>
                {clientProfile.kyc_status || 'Pending'}
              </span>
            </p>
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Icon name="Plus" size={12} color="currentColor" /> Add Document
            </button>
          </div>

          {kycDocs.length === 0 ? (
            <Empty icon="Shield" text="No KYC documents uploaded"
              sub="Upload your ID, KRA PIN certificate and other required documents" />
          ) : kycDocs.map(d => (
            <DocCard
              key={d.id}
              icon="Shield"
              title={d.document_type?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'KYC Document'}
              subtitle={d.document_side ? `Side: ${d.document_side}` : undefined}
              date={d.created_at}
              status={d.status || 'uploaded'}
              tag="KYC"
              onView={null}
              onDownload={null}
            />
          ))}

          {clientProfile.kyc_status !== 'verified' && (
            <div className="p-5 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
              <div className="flex items-start gap-3">
                <Icon name="AlertTriangle" size={16} color="#d97706" />
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">KYC Pending Review</p>
                  <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">
                    Your documents are being reviewed by our compliance team. This usually takes 1–2 business days.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <UploadModal
          clientId={clientId}
          adminId={adminId}
          onClose={() => setShowUpload(false)}
          onUploaded={fetchDocs}
        />
      )}
    </div>
  );
};

export default DocumentCentreTab;
