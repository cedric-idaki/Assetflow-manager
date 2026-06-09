import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { generateContractPDF } from '../../../utils/generateContractPDF';
import { useAdminDashboardContext } from '../../../contexts/AdminDashboardContext';

// ── Upload modal (kept for manual uploads) ────────────────────────────────────
const UploadContractModal = ({ onClose, onUpload, clients }) => {
  const [form, setForm]     = useState({ name: '', type: 'general', clientId: '', isTemplate: false });
  const [file, setFile]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const fileInputRef        = useRef(null);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name) return setError('Contract name is required.');
    if (!file) return setError('Please select a PDF file to upload.');
    setLoading(true); setError('');
    try { await onUpload(form, file); onClose(); }
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
              <option value="general">General Contract</option>
              <option value="sale">Sale Agreement</option>
              <option value="hire_purchase">Hire Purchase Agreement</option>
              <option value="lease">Lease Agreement</option>
              <option value="service">Service Agreement</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Link to Client (optional)</label>
            <select value={form.clientId} onChange={e => set('clientId', e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground">
              <option value="">No client — save as template</option>
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
              </svg> Uploading...</>
            ) : <><Icon name="Upload" size={15} color="currentColor" /> Upload</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Sale row — for generating contracts from POS sales ───────────────────────
const SaleContractRow = ({ sale, companyProfile }) => {
  const [generating, setGenerating] = useState(false);
  // Check if contract was already generated (persisted in supabase audit_logs)
  const [done, setDone]             = useState(sale.contract_generated || false);
  const [generatedAt, setGeneratedAt] = useState(sale.contract_generated_at || null);
  const [error, setError]           = useState('');

  const handleGenerate = async () => {
    setGenerating(true); setError('');
    try {
      // Fetch full sale with client, asset, and schedule
      const { data: fullSale } = await supabase
        .from('sales')
        .select(`
          *,
          client:clients(*),
          asset:assets(*)
        `)
        .eq('id', sale.id)
        .single();

      const { data: schedule } = await supabase
        .from('installment_schedules')
        .select('*')
        .eq('sale_id', sale.id)
        .order('installment_no');

      await generateContractPDF({
        sale:     fullSale,
        client:   fullSale.client,
        asset:    fullSale.asset,
        company:  companyProfile,
        schedule: schedule || [],
      });

      // Mark contract as generated — upsert so re-generation doesn't duplicate
      const now = new Date().toISOString();
      await supabase.from('generated_contracts').upsert({
        sale_id:        sale.id,
        invoice_number: sale.invoice_number,
        client_id:      fullSale.client?.id,
        asset_id:       fullSale.asset?.id,
        admin_id:       (await supabase.auth.getUser()).data.user?.id,
        generated_at:   now,
        pricing_model:  sale.pricing_model,
        client_name:    fullSale.client?.full_name,
      }, { onConflict: 'sale_id' });

      // Also audit log
      await supabase.from('audit_logs').insert({
        action:      'create',
        table_name:  'generated_contracts',
        description: `Contract generated for sale ${sale.invoice_number} — ${fullSale.client?.full_name}`,
        user_id:     (await supabase.auth.getUser()).data.user?.id,
        new_values:  { invoice_number: sale.invoice_number, client: fullSale.client?.full_name },
      }).catch(() => {});

      setDone(true);
      setGeneratedAt(now);
    } catch (err) {
      setError(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const pricingLabel = {
    cash:         'Cash Sale',
    installment:  'Hire Purchase',
    balloon:      'Balloon Payment',
    zero_deposit: 'Zero Deposit',
    lease_to_own: 'Lease-to-Own',
  }[sale.pricing_model] || sale.pricing_model;

  const fmtAmt = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all">
      {/* Contract type icon */}
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(26,86,219,0.1)' }}>
          <Icon name="FileText" size={20} color="#1A56DB" />
        </div>
        <div className="flex items-center gap-1">
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
            Auto-Generated
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
            sale.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {sale.status}
          </span>
        </div>
      </div>

      <h3 className="font-semibold text-foreground text-sm mb-0.5">{sale.invoice_number}</h3>
      <p className="text-xs text-muted-foreground capitalize mb-0.5">{pricingLabel}</p>
      <p className="text-xs text-blue-600 mb-0.5">
        Client: {sale.client_name || '—'}
      </p>
      <p className="text-xs text-foreground font-semibold mb-0.5">{fmtAmt(sale.total_amount)}</p>
      <p className="text-xs text-muted-foreground">
        Sale: {sale.sale_date ? new Date(sale.sale_date).toLocaleDateString('en-GB') : '—'}
      </p>
      {generatedAt && (
        <p className="text-xs text-emerald-600 mt-0.5">
          ✓ Generated: {new Date(generatedAt).toLocaleDateString('en-GB')}
        </p>
      )}

      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-60"
          style={{ background: done ? 'linear-gradient(135deg,#059669,#047857)' : 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
          {generating ? (
            <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg> Generating...</>
          ) : done ? (
            <><Icon name="RefreshCw" size={13} color="white" /> Download Again</>
          ) : (
            <><Icon name="FileDown" size={13} color="white" /> Generate Contract</>
          )}
        </button>
      </div>
    </div>
  );
};


// ── DEFAULT CLAUSE TEXT ────────────────────────────────────────────────────────
const DEFAULT_CLAUSES = {
  hire_purchase: {
    ownership:    'Ownership of the asset transfers to the Buyer only upon receipt of the final installment payment in full. Until such time, the Vendor retains full legal title to the asset.',
    default:      'In the event of three (3) consecutive missed installment payments, the Vendor reserves the right to repossess the asset without further notice. The Buyer shall bear all costs of repossession.',
    insurance:    'The Buyer is responsible for maintaining comprehensive insurance cover on the asset at all times. Proof of insurance must be provided within 14 days of this agreement.',
    penalty:      'Payments not received within the grace period shall attract a penalty per month on the overdue amount, compounded monthly until full settlement.',
    settlement:   'The Buyer may settle the outstanding balance in full at any time. An early settlement discount may apply. A settlement statement valid for 7 days will be issued upon request.',
    governing_law:'This Agreement shall be governed by and construed in accordance with the laws of Kenya. Any dispute shall first be referred to mediation, then arbitration under the Arbitration Act (Cap. 49).',
  },
  cash_sale: {
    ownership:    'Ownership of the asset transfers to the Buyer immediately upon receipt of full payment and issuance of this receipt.',
    default:      'N/A — Cash sale. No installment obligations.',
    insurance:    'The Buyer is advised to insure the asset against loss, theft, or damage from the date of purchase.',
    penalty:      'N/A — Cash sale. No penalties applicable.',
    settlement:   'N/A — Cash sale. Full payment received.',
    governing_law:'This Agreement shall be governed by and construed in accordance with the laws of Kenya.',
  },
};

const TEMPLATE_TYPES = [
  { value: 'hire_purchase',   label: 'Hire Purchase Agreement',    icon: 'Calendar' },
  { value: 'cash_sale',       label: 'Cash Sale Agreement',        icon: 'Banknote' },
  { value: 'lease_to_own',    label: 'Lease-to-Own Agreement',     icon: 'Key' },
  { value: 'balloon_payment', label: 'Balloon Payment Agreement',  icon: 'TrendingUp' },
  { value: 'zero_deposit',    label: 'Zero-Deposit Agreement',     icon: 'Zap' },
  { value: 'service_agreement', label: 'Service Agreement',        icon: 'Wrench' },
];

// ── Template Editor Modal ─────────────────────────────────────────────────────
const TemplateEditorModal = ({ template, adminId, onClose, onSave }) => {
  const isNew = !template?.id;
  const defaults = DEFAULT_CLAUSES[template?.contract_type || 'hire_purchase'] || DEFAULT_CLAUSES.hire_purchase;

  const [form, setForm] = useState({
    template_name:          template?.template_name          || '',
    contract_type:          template?.contract_type          || 'hire_purchase',
    signatory_name:         template?.signatory_name         || '',
    signatory_title:        template?.signatory_title        || 'Managing Director',
    ownership_clause:       template?.ownership_clause       || defaults.ownership,
    default_clause:         template?.default_clause         || defaults.default,
    insurance_clause:       template?.insurance_clause       || defaults.insurance,
    penalty_clause:         template?.penalty_clause         || defaults.penalty,
    settlement_clause:      template?.settlement_clause      || defaults.settlement,
    governing_law_clause:   template?.governing_law_clause   || defaults.governing_law,
    is_default:             template?.is_default             || false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleTypeChange = (type) => {
    const d = DEFAULT_CLAUSES[type] || DEFAULT_CLAUSES.hire_purchase;
    set('contract_type', type);
    // Only reset clauses if they are still defaults
    if (!template?.id) {
      setForm(p => ({ ...p, contract_type: type,
        ownership_clause: d.ownership, default_clause: d.default,
        insurance_clause: d.insurance, penalty_clause: d.penalty,
        settlement_clause: d.settlement, governing_law_clause: d.governing_law,
      }));
    }
  };

  const handleSave = async () => {
    if (!form.template_name.trim()) { setError('Template name is required.'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, admin_id: adminId, updated_at: new Date().toISOString() };
      if (isNew) {
        const { error: err } = await supabase.from('contract_templates').insert(payload);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from('contract_templates').update(payload).eq('id', template.id);
        if (err) throw err;
      }
      onSave();
      onClose();
    } catch (err) {
      setError(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const TextArea = ({ label, field, rows = 3 }) => (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground mb-1">{label}</label>
      <textarea
        value={form[field]}
        onChange={e => set(field, e.target.value)}
        rows={rows}
        className="w-full px-3 py-2.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground resize-none"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <Icon name="FileEdit" size={18} color="#1A56DB" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {isNew ? 'Create Template' : 'Edit Template'}
              </h3>
              <p className="text-xs text-muted-foreground">Customise contract clauses for this template</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <Icon name="AlertCircle" size={15} color="currentColor" /> {error}
            </div>
          )}

          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Template Name *</label>
              <input type="text" value={form.template_name} onChange={e => set('template_name', e.target.value)}
                placeholder="e.g. Standard Hire Purchase - Vehicles"
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Contract Type *</label>
              <select value={form.contract_type} onChange={e => handleTypeChange(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground">
                {TEMPLATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Authorized Signatory Name</label>
              <input type="text" value={form.signatory_name} onChange={e => set('signatory_name', e.target.value)}
                placeholder="e.g. John Kamau"
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Signatory Title</label>
              <input type="text" value={form.signatory_title} onChange={e => set('signatory_title', e.target.value)}
                placeholder="e.g. Managing Director"
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground" />
            </div>
          </div>

          {/* Clauses */}
          <div className="border-t border-border pt-4">
            <p className="text-sm font-semibold text-foreground mb-1">Contract Clauses (BRS 6.2.4)</p>
            <p className="text-xs text-muted-foreground mb-4">
              These are pre-filled with legally compliant defaults. Edit to match your company's specific terms.
            </p>
            <div className="space-y-4">
              <TextArea label="1. Ownership Transfer Clause" field="ownership_clause" rows={3} />
              <TextArea label="2. Default & Repossession Clause" field="default_clause" rows={3} />
              <TextArea label="3. Insurance Obligation Clause" field="insurance_clause" rows={3} />
              <TextArea label="4. Late Payment Penalty Clause" field="penalty_clause" rows={3} />
              <TextArea label="5. Early Settlement Clause" field="settlement_clause" rows={3} />
              <TextArea label="6. Governing Law & Dispute Resolution" field="governing_law_clause" rows={3} />
            </div>
          </div>

          {/* Default toggle */}
          <div className="flex items-center gap-3 pt-2">
            <button onClick={() => set('is_default', !form.is_default)}
              className={`w-10 h-6 rounded-full transition-colors flex items-center ${form.is_default ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}>
              <span className="w-5 h-5 bg-white rounded-full shadow mx-0.5" />
            </button>
            <div>
              <p className="text-sm font-medium text-foreground">Set as default template</p>
              <p className="text-xs text-muted-foreground">Auto-selected when generating contracts of this type</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-all"
            style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
            {saving ? (
              <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg> Saving...</>
            ) : <><Icon name="Save" size={15} color="white" /> Save Template</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Templates Section ─────────────────────────────────────────────────────────
const TemplatesSection = ({ adminId }) => {
  const { modals, openModal, closeModal } = useAdminDashboardContext();
  const [templates, setTemplates]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [editingTemplate, setEditing] = useState(null);
  const [deleting, setDeleting]       = useState(null);

  const fetchTemplates = useCallback(async () => {
    if (!adminId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('admin_id', adminId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      setTemplates(data || []);
    } catch (err) {
      console.error('fetchTemplates error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [adminId]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    setDeleting(id);
    await supabase.from('contract_templates').update({ is_active: false }).eq('id', id);
    await fetchTemplates();
    setDeleting(null);
  };

  const typeLabel = (type) => TEMPLATE_TYPES.find(t => t.value === type)?.label || type;
  const typeIcon  = (type) => TEMPLATE_TYPES.find(t => t.value === type)?.icon || 'FileText';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">{templates.length} template{templates.length !== 1 ? 's' : ''}</p>
          <p className="text-xs text-muted-foreground">Reusable contract templates with your custom clauses</p>
        </div>
        <button
          onClick={() => { setEditing(null); openModal('templateEditor'); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
          style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
          <Icon name="Plus" size={14} color="white" /> New Template
        </button>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
        <Icon name="Info" size={16} color="#1A56DB" />
        <div>
          <p className="font-semibold">How templates work</p>
          <p className="text-xs mt-0.5">
            Create a template once with your custom clauses, signatory name and title.
            When generating a contract from a POS sale, the system uses your template's clauses
            instead of the default ones — giving every contract your company's specific terms.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse space-y-3">
              <div className="flex justify-between"><div className="w-10 h-10 bg-muted rounded-xl" /><div className="w-16 h-5 bg-muted rounded-full" /></div>
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-1/2" />
              <div className="h-8 bg-muted rounded-lg mt-3" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Icon name="FileEdit" size={32} color="currentColor" />
          <p className="text-sm font-medium text-foreground mt-3">No templates yet</p>
          <p className="text-xs mt-1 mb-4">Create your first template to customise contract clauses</p>
          <button
            onClick={() => { setEditing(null); openModal('templateEditor'); }}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
            Create First Template
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(t => (
            <div key={t.id} className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                  <Icon name={typeIcon(t.contract_type)} size={18} color="#1A56DB" />
                </div>
                <div className="flex items-center gap-1">
                  {t.is_default && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Default</span>
                  )}
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Active</span>
                </div>
              </div>

              <h3 className="font-semibold text-foreground text-sm mb-0.5 line-clamp-2">{t.template_name}</h3>
              <p className="text-xs text-blue-600 mb-0.5 capitalize">{typeLabel(t.contract_type)}</p>
              {t.signatory_name && (
                <p className="text-xs text-muted-foreground">Signatory: {t.signatory_name}</p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.created_at ? new Date(t.created_at).toLocaleDateString('en-GB') : '—'}
              </p>

              <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                <button
                  onClick={() => { setEditing(t); openModal('templateEditor'); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border border-border text-foreground hover:bg-muted transition-colors">
                  <Icon name="Edit" size={13} color="currentColor" /> Edit
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  disabled={deleting === t.id}
                  className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50">
                  <Icon name="Trash2" size={13} color="currentColor" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modals.templateEditor && (
        <TemplateEditorModal
          template={editingTemplate}
          adminId={adminId}
          onClose={() => { closeModal('templateEditor'); setEditing(null); }}
          onSave={fetchTemplates}
        />
      )}
    </div>
  );
};

// ── Main ContractsTab ─────────────────────────────────────────────────────────
const ContractsTab = ({ contracts, clients, onUpload, onExport }) => {
  const { modals, openModal, closeModal } = useAdminDashboardContext();
  const [filter, setFilter]               = useState('sales');
  const [sales, setSales]                 = useState([]);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [loadingSales, setLoadingSales]   = useState(true);
  const [adminId, setAdminId]             = useState(null);

  // Fetch sales for auto-generation
  const fetchSales = useCallback(async () => {
    setLoadingSales(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setAdminId(user.id);

      const { data } = await supabase
        .from('sales')
        .select(`
          id, invoice_number, pricing_model, total_amount,
          deposit_amount, finance_balance, tenure_months,
          sale_date, status,
          client:clients(full_name, account_number),
          generated_contract:generated_contracts(generated_at)
        `)
        .eq('admin_id', user.id)
        .order('sale_date', { ascending: false });

      setSales((data || []).map(s => ({
        ...s,
        client_name:            s.client?.full_name,
        account_number:         s.client?.account_number,
        contract_generated:     !!(s.generated_contract?.[0] || s.generated_contract),
        contract_generated_at:  s.generated_contract?.[0]?.generated_at || s.generated_contract?.generated_at || null,
      })));

      // Fetch company profile
      const { data: cp } = await supabase
        .from('company_profiles')
        .select('*')
        .eq('admin_id', user.id)
        .single();
      setCompanyProfile(cp);
    } catch (err) {
      console.error('fetchSales error:', err.message);
    } finally {
      setLoadingSales(false);
    }
  }, []);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  const filteredUploaded = contracts.filter(c => {
    if (filter === 'templates') return c.is_template;
    if (filter === 'uploaded')  return !c.is_template;
    return false;
  });

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Contracts</h2>
          <p className="text-xs text-muted-foreground">
            {sales.length} auto-generated · {contracts.length} uploaded ·{' '}
            {contracts.filter(c => c.is_template).length} templates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onExport(contracts.map(c => ({
              name: c.contract_name, type: c.contract_type,
              client: c.client?.full_name || 'Template',
              status: c.status, created: c.created_at,
            })), 'contracts')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
            <Icon name="Download" size={13} color="currentColor" /> Export List
          </button>
          <button
            onClick={() => openModal('uploadContract')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #ea580c, #c2410c)' }}>
            <Icon name="Plus" size={13} color="currentColor" /> Upload Contract
          </button>
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex gap-1">
        {[
          { value: 'sales',     label: `From POS Sales (${sales.length})` },
          { value: 'uploaded',  label: `Uploaded (${contracts.filter(c => !c.is_template).length})` },
          { value: 'templates', label: `Templates (${contracts.filter(c => c.is_template).length})` },
        ].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f.value
                ? 'text-white'
                : 'bg-card border border-border text-muted-foreground hover:text-foreground'
            }`}
            style={filter === f.value ? { background: 'linear-gradient(135deg,#1A56DB,#1E429F)' } : {}}>
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}

      {/* Sales contracts (auto-generated from POS) */}
      {filter === 'sales' && (
        <>
          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
            <Icon name="Info" size={16} color="#1A56DB" />
            <div>
              <p className="font-semibold">Compliant Auto-Generation</p>
              <p className="text-xs mt-0.5">
                 Click "Generate Contract" to download the PDF instantly.
              </p>
            </div>
          </div>

          {loadingSales ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3].map(i => (
                <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse space-y-3">
                  <div className="flex justify-between">
                    <div className="w-10 h-10 bg-muted rounded-xl" />
                    <div className="w-20 h-5 bg-muted rounded-full" />
                  </div>
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                  <div className="h-8 bg-muted rounded-lg mt-3" />
                </div>
              ))}
            </div>
          ) : sales.length === 0 ? (
            <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Icon name="FileText" size={32} color="currentColor" />
              <p className="text-sm font-medium text-foreground mt-3">No sales yet</p>
              <p className="text-xs mt-1">Complete a sale through the POS module to generate contracts</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sales.map(sale => (
                <SaleContractRow
                  key={sale.id}
                  sale={sale}
                  companyProfile={companyProfile}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Uploaded contracts and templates */}
      {filter === 'uploaded' && (
        filteredUploaded.length === 0 ? (
          <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Icon name="FileText" size={32} color="currentColor" />
            <p className="text-sm mt-2">No uploaded contracts yet</p>
            <button onClick={() => openModal('uploadContract')}
              className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #ea580c, #c2410c)' }}>
              Upload Contract
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUploaded.map(contract => (
              <div key={contract.id} className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                    <Icon name="FileText" size={20} color="#ea580c" />
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                    contract.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  }`}>{contract.status}</span>
                </div>
                <h3 className="font-semibold text-foreground text-sm mb-1 line-clamp-1">{contract.contract_name}</h3>
                <p className="text-xs text-muted-foreground capitalize mb-1">
                  {(contract.contract_type || 'general').replace(/_/g, ' ')}
                </p>
                {contract.client && <p className="text-xs text-blue-600 mb-1">Client: {contract.client.full_name}</p>}
                <p className="text-xs text-muted-foreground">
                  {contract.created_at ? new Date(contract.created_at).toLocaleDateString() : '—'}
                </p>
                <div className="mt-3 pt-3 border-t border-border">
                  <button onClick={() => contract.file_url && window.open(contract.file_url, '_blank')}
                    disabled={!contract.file_url}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
                    style={{ background: 'rgba(26,86,219,0.1)', color: '#1A56DB' }}>
                    <Icon name="Download" size={13} color="currentColor" /> Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── TEMPLATES TAB ── */}
      {filter === 'templates' && (
        <TemplatesSection adminId={adminId} />
      )}

      {modals.uploadContract && (
        <UploadContractModal
          onClose={() => closeModal('uploadContract')}
          onUpload={onUpload}
          clients={clients}
        />
      )}
    </div>
  );
};

export default ContractsTab;
