import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../AppIcon';
import { supabase } from '../../lib/supabase';
import { useAdminDashboardContext } from '../../contexts/AdminDashboardContext';

// ── DEFAULT CLAUSE TEXT — company (asset finance) ─────────────────────────────
export const COMPANY_DEFAULT_CLAUSES = {
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

export const COMPANY_TEMPLATE_TYPES = [
  { value: 'hire_purchase',     label: 'Hire Purchase Agreement',    icon: 'Calendar' },
  { value: 'cash_sale',         label: 'Cash Sale Agreement',        icon: 'Banknote' },
  { value: 'lease_to_own',      label: 'Lease-to-Own Agreement',     icon: 'Key' },
  { value: 'balloon_payment',   label: 'Balloon Payment Agreement',  icon: 'TrendingUp' },
  { value: 'zero_deposit',      label: 'Zero-Deposit Agreement',     icon: 'Zap' },
  { value: 'service_agreement', label: 'Service Agreement',          icon: 'Wrench' },
];

// ── DEFAULT CLAUSE TEXT — sacco (member lending & membership) ──────────────────
// Wording follows the Co-operative Societies Act (Cap. 490) / SASRA practice:
// the security is the member's deposits, shares and guarantors — not an asset.
export const SACCO_DEFAULT_CLAUSES = {
  loan_agreement: {
    ownership:    'The loan is advanced from the Sacco\'s members\' funds and remains a debt owed by the Borrower to the Sacco until repaid in full. The Borrower\'s deposits, share capital and any guarantor commitments stand as security for the outstanding balance.',
    default:      'Where three (3) consecutive instalments fall into arrears, the whole outstanding balance becomes immediately due and payable. The Sacco may offset the Borrower\'s deposits and shares, and thereafter call upon the guarantors, in accordance with the Sacco\'s by-laws and the Co-operative Societies Act (Cap. 490).',
    insurance:    'The Borrower shall maintain any loan protection or credit life cover required by the Sacco\'s credit policy for the full term of this facility. Proceeds of any such cover shall first be applied to the outstanding balance.',
    penalty:      'Instalments not received by the due date shall attract the penalty rate set out in the Sacco\'s credit policy, charged monthly on the amount in arrears until the account is regularised.',
    settlement:   'The Borrower may repay the outstanding balance in full at any time. Interest is charged only up to the date of settlement. A settlement statement valid for 7 days will be issued on request.',
    governing_law:'This Agreement is governed by the laws of Kenya, the Co-operative Societies Act (Cap. 490) and the by-laws of the Sacco. Disputes shall first be referred to the Sacco\'s dispute resolution process, then to the Commissioner for Co-operative Development or arbitration.',
  },
  membership: {
    ownership:    'Membership confers a share in the Sacco in proportion to the share capital held. Shares are not withdrawable but may be transferred to another member in accordance with the by-laws.',
    default:      'A member whose monthly contributions fall into arrears for three (3) consecutive months may have their membership rights suspended until the arrears are cleared.',
    insurance:    'The Sacco may require members to participate in a group welfare or benevolent fund as provided in the by-laws.',
    penalty:      'Late or missed contributions attract the penalty set out in the Sacco\'s by-laws.',
    settlement:   'On withdrawal from membership, deposits are refunded after settlement of all liabilities and guarantor obligations, within the notice period set out in the by-laws.',
    governing_law:'This Agreement is governed by the laws of Kenya, the Co-operative Societies Act (Cap. 490) and the by-laws of the Sacco.',
  },
  guarantor: {
    ownership:    'The Guarantor guarantees repayment of the Borrower\'s facility to the extent of the amount guaranteed, and consents to their deposits and shares being attached to that extent.',
    default:      'On default by the Borrower, the Sacco may recover the guaranteed amount from the Guarantor\'s deposits, shares and future contributions without further notice.',
    insurance:    'The Guarantor shall be notified of any loan protection cover applying to the guaranteed facility.',
    penalty:      'Amounts recovered from the Guarantor attract the same penalty terms as the underlying facility.',
    settlement:   'The guarantee is released once the underlying facility is repaid in full or the Sacco accepts a substitute guarantor.',
    governing_law:'This Agreement is governed by the laws of Kenya, the Co-operative Societies Act (Cap. 490) and the by-laws of the Sacco.',
  },
  share_transfer: {
    ownership:    'Shares transfer to the Transferee upon approval of the transfer by the Sacco and entry in the register of members.',
    default:      'A transfer is void if the Transferor has outstanding liabilities or subsisting guarantor obligations secured on the shares.',
    insurance:    'N/A — share transfer.',
    penalty:      'N/A — share transfer.',
    settlement:   'Consideration passes between the parties; the Sacco records the transfer only.',
    governing_law:'This Agreement is governed by the laws of Kenya, the Co-operative Societies Act (Cap. 490) and the by-laws of the Sacco.',
  },
};

export const SACCO_TEMPLATE_TYPES = [
  { value: 'loan_agreement', label: 'Loan Agreement',          icon: 'Banknote' },
  { value: 'membership',     label: 'Membership Agreement',    icon: 'Users' },
  { value: 'guarantor',      label: 'Guarantor Form',          icon: 'ShieldCheck' },
  { value: 'share_transfer', label: 'Share Transfer Form',     icon: 'PieChart' },
];

// The six clause fields a template carries, in display order.
const CLAUSE_FIELDS = [
  { key: 'ownership_clause',     defaultKey: 'ownership',     label: 'Ownership / Security' },
  { key: 'default_clause',       defaultKey: 'default',       label: 'Default & Recovery' },
  { key: 'insurance_clause',     defaultKey: 'insurance',     label: 'Insurance / Protection' },
  { key: 'penalty_clause',       defaultKey: 'penalty',       label: 'Late Payment Penalty' },
  { key: 'settlement_clause',    defaultKey: 'settlement',    label: 'Early Settlement' },
  { key: 'governing_law_clause', defaultKey: 'governing_law', label: 'Governing Law & Disputes' },
];

// ── Template Editor Modal ─────────────────────────────────────────────────────
const TemplateEditorModal = ({ template, adminId, types, defaultClauses, onClose, onSave }) => {
  const isNew = !template?.id;
  const fallbackType = types[0]?.value;
  const defaults = defaultClauses[template?.contract_type || fallbackType] || defaultClauses[fallbackType];

  const [form, setForm] = useState({
    template_name:          template?.template_name          || '',
    contract_type:          template?.contract_type          || fallbackType,
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
    const d = defaultClauses[type] || defaultClauses[fallbackType];
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
                {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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

          {/* Clauses — what actually lands in the generated PDF */}
          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clauses</p>
            {CLAUSE_FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">{f.label}</label>
                <textarea value={form[f.key]} onChange={e => set(f.key, e.target.value)} rows={3}
                  className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground resize-y" />
              </div>
            ))}
          </div>

          {/* Default toggle */}
          <div className="flex items-center gap-3 border-t border-border pt-4">
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
// Shared by the company and sacco Contracts tabs. `types`/`defaultClauses` decide
// which contract kinds the tenant can template; rows are scoped by admin_id.
const TemplatesSection = ({
  adminId,
  types = COMPANY_TEMPLATE_TYPES,
  defaultClauses = COMPANY_DEFAULT_CLAUSES,
  onChanged,
}) => {
  const { modals, openModal, closeModal } = useAdminDashboardContext();
  const [templates, setTemplates]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [editingTemplate, setEditing] = useState(null);
  const [deleting, setDeleting]       = useState(null);

  // Held in a ref so an inline callback from the parent can't retrigger the
  // fetch effect on every render.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

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
      if (onChangedRef.current) onChangedRef.current(data || []);
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

  const typeLabel = (type) => types.find(t => t.value === type)?.label || type;
  const typeIcon  = (type) => types.find(t => t.value === type)?.icon || 'FileText';

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
          types={types}
          defaultClauses={defaultClauses}
          onClose={() => { closeModal('templateEditor'); setEditing(null); }}
          onSave={fetchTemplates}
        />
      )}
    </div>
  );
};

export default TemplatesSection;
