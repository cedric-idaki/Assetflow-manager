import React, { useState, useRef } from 'react';
import Icon from '../AppIcon';

// Contract types offered by the company dashboard's upload modal.
export const COMPANY_CONTRACT_TYPES = [
  { value: 'general',       label: 'General Contract' },
  { value: 'sale',          label: 'Sale Agreement' },
  { value: 'hire_purchase', label: 'Hire Purchase Agreement' },
  { value: 'lease',         label: 'Lease Agreement' },
  { value: 'service',       label: 'Service Agreement' },
];

// ── Upload modal (manual PDF uploads) ─────────────────────────────────────────
// Shared by the company and sacco Contracts tabs. The "link to" selector is fed
// with clients on the company dashboard and with sacco members on the sacco
// dashboard, so its labels are props.
const UploadContractModal = ({
  onClose,
  onUpload,
  clients = [],
  types = COMPANY_CONTRACT_TYPES,
  defaultType = 'general',
  linkLabel = 'Link to Client (optional)',
  linkEmptyLabel = 'No client — save as template',
}) => {
  const [form, setForm]     = useState({ name: '', type: defaultType, clientId: '', isTemplate: false });
  const [file, setFile]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError]   = useState('');
  const fileInputRef        = useRef(null);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name) return setError('Contract name is required.');
    if (!file) return setError('Please select a PDF file to upload.');
    setLoading(true); setError(''); setProgress(0);
    try { await onUpload(form, file, setProgress); onClose(); }
    catch (err) { setError(err.message || 'Upload failed.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center">
              <Icon name="Upload" size={18} color="#ea580c" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Upload Contract</h3>
              <p className="text-xs text-muted-foreground">Upload a PDF contract or template</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <Icon name="AlertCircle" size={15} color="currentColor" /> {error}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Contract Name *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Vehicle Sale Agreement"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Contract Type</label>
            <select value={form.type} onChange={e => set('type', e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground">
              {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{linkLabel}</label>
            <select value={form.clientId} onChange={e => set('clientId', e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground">
              <option value="">{linkEmptyLabel}</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.full_name} — {c.account_number}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">PDF File *</label>
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}>
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <Icon name="FileText" size={20} color="#ea580c" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setFile(null); }} className="ml-2 p-1 rounded hover:bg-muted">
                    <Icon name="X" size={14} color="var(--color-muted-foreground)" />
                  </button>
                </div>
              ) : (
                <>
                  <Icon name="Upload" size={24} color="var(--color-muted-foreground)" />
                  <p className="text-sm text-muted-foreground mt-2">Click to upload PDF</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF files only, max 10MB</p>
                </>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
              onChange={e => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is-template" checked={form.isTemplate}
              onChange={e => set('isTemplate', e.target.checked)} className="w-4 h-4 rounded border-border" />
            <label htmlFor="is-template" className="text-sm text-foreground cursor-pointer">
              Save as reusable template
            </label>
          </div>
        </div>

        {loading && (
          <div className="px-6 pb-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">Uploading{file ? ` ${(file.size / 1024 / 1024).toFixed(1)} MB` : ''}…</span>
              <span className="text-xs font-semibold text-foreground">{progress}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-200" style={{ width: `${progress}%`, background: 'linear-gradient(135deg, #ea580c, #c2410c)' }} />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #ea580c, #c2410c)' }}>
            {loading ? (
              <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg> {progress < 100 ? `Uploading ${progress}%` : 'Finishing…'}</>
            ) : <><Icon name="Upload" size={15} color="currentColor" /> Upload</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UploadContractModal;
