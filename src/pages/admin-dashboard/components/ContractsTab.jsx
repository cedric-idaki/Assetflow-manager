import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { openStoredFile } from '../../../lib/storageUrl';
import { generateContractPDF } from '../../../utils/generateContractPDF';
import { useAdminDashboardContext } from '../../../contexts/AdminDashboardContext';
import SendForSignatureModal from '../../../components/contracts/SendForSignatureModal';
import UploadContractModal, { COMPANY_CONTRACT_TYPES } from '../../../components/contracts/UploadContractModal';
import TemplatesSection, {
  COMPANY_TEMPLATE_TYPES, COMPANY_DEFAULT_CLAUSES,
} from '../../../components/contracts/TemplatesSection';

// The Send-for-Signature, Upload and Templates pieces live in
// src/components/contracts/ because the sacco dashboard's Contracts tab
// (pages/sacco-dashboard/components/SaccoContractsTab.jsx) drives the same
// flows against sacco members and loans.

// ── Sale row — for generating contracts from POS sales ───────────────────────
const SaleContractRow = ({ sale, companyProfile, onSendForSignature }) => {
  const [generating, setGenerating] = useState(false);
  // Check if contract was already generated (persisted in supabase audit_logs)
  const [done, setDone]             = useState(sale.contract_generated || false);
  const [generatedAt, setGeneratedAt] = useState(sale.contract_generated_at || null);
  const [contractId, setContractId] = useState(sale.generated_contract_id || null);
  const [savingPdf, setSavingPdf]   = useState(false);
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

      // Builds + downloads the PDF locally and returns the blob for storage.
      const { blob } = await generateContractPDF({
        sale:     fullSale,
        client:   fullSale.client,
        asset:    fullSale.asset,
        company:  companyProfile,
        schedule: schedule || [],
      });

      const adminId = (await supabase.auth.getUser()).data.user?.id;

      // Record the contract immediately (no file_url yet) so the UI confirms
      // straight away — the PDF is uploaded to storage in the background below.
      const now = new Date().toISOString();
      const { data: gc } = await supabase.from('generated_contracts').upsert({
        sale_id:        sale.id,
        invoice_number: sale.invoice_number,
        client_id:      fullSale.client?.id,
        asset_id:       fullSale.asset?.id,
        admin_id:       adminId,
        generated_at:   now,
        pricing_model:  sale.pricing_model,
        client_name:    fullSale.client?.full_name,
      }, { onConflict: 'sale_id' }).select('id').single();
      if (gc?.id) setContractId(gc.id);

      // Also audit log
      await supabase.from('audit_logs').insert({
        action:      'create',
        table_name:  'generated_contracts',
        description: `Contract generated for sale ${sale.invoice_number} — ${fullSale.client?.full_name}`,
        user_id:     adminId,
        new_values:  { invoice_number: sale.invoice_number, client: fullSale.client?.full_name },
      }).catch(() => {});

      setDone(true);
      setGeneratedAt(now);
      setGenerating(false);

      // Background: upload the PDF to storage so e-signature can display/sign it,
      // then patch file_url onto the row. Non-fatal — the local download already
      // happened, so a slow/failed upload never blocks the user.
      setSavingPdf(true);
      (async () => {
        try {
          const safeInv = (sale.invoice_number || 'DRAFT').replace(/[^a-zA-Z0-9._-]/g, '_');
          const path    = `${adminId}/contract_${safeInv}.pdf`;
          const { error: upErr } = await supabase.storage
            .from('contracts')
            .upload(path, blob, { upsert: true, contentType: 'application/pdf' });
          if (!upErr && gc?.id) {
            const url = supabase.storage.from('contracts').getPublicUrl(path).data?.publicUrl;
            if (url) await supabase.from('generated_contracts').update({ file_url: url }).eq('id', gc.id);
          }
        } catch (e) { console.warn('contract PDF upload skipped:', e.message); }
        finally { setSavingPdf(false); }
      })();
    } catch (err) {
      setError(err.message || 'Generation failed');
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
      {savingPdf && (
        <p className="text-xs text-blue-500 mt-0.5 flex items-center gap-1">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg> Saving copy for e-signature…
        </p>
      )}
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
        {(done || contractId) && (
          <button
            onClick={() => onSendForSignature?.({
              source: 'generated',
              contractId,
              documentLabel: `${pricingLabel} — ${sale.invoice_number}`,
              defaultClient: { name: sale.client_name, email: sale.client_email },
            })}
            disabled={!contractId}
            title={contractId ? 'Send for e-signature' : 'Generate the contract first'}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border text-foreground hover:bg-muted transition-all disabled:opacity-50">
            <Icon name="PenTool" size={13} color="currentColor" /> Sign
          </button>
        )}
      </div>
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
  const [sendCtx, setSendCtx]             = useState(null); // Send-for-Signature modal context

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
          client:clients(full_name, account_number, email),
          generated_contract:generated_contracts(id, generated_at)
        `)
        .eq('admin_id', user.id)
        .order('sale_date', { ascending: false });

      setSales((data || []).map(s => ({
        ...s,
        client_name:            s.client?.full_name,
        client_email:           s.client?.email,
        account_number:         s.client?.account_number,
        contract_generated:     !!(s.generated_contract?.[0] || s.generated_contract),
        contract_generated_at:  s.generated_contract?.[0]?.generated_at || s.generated_contract?.generated_at || null,
        generated_contract_id:  s.generated_contract?.[0]?.id || s.generated_contract?.id || null,
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
                  onSendForSignature={setSendCtx}
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
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                  <button onClick={() => contract.file_url && openStoredFile(contract.file_url)}
                    disabled={!contract.file_url}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
                    style={{ background: 'rgba(26,86,219,0.1)', color: '#1A56DB' }}>
                    <Icon name="Download" size={13} color="currentColor" /> Download
                  </button>
                  <button
                    onClick={() => setSendCtx({
                      source: 'company',
                      contractId: contract.id,
                      documentLabel: contract.contract_name,
                      defaultClient: { name: contract.client?.full_name, email: contract.client?.email },
                    })}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-foreground hover:bg-muted transition-all">
                    <Icon name="PenTool" size={13} color="currentColor" /> Sign
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── TEMPLATES TAB ── */}
      {filter === 'templates' && (
        <TemplatesSection
          adminId={adminId}
          types={COMPANY_TEMPLATE_TYPES}
          defaultClauses={COMPANY_DEFAULT_CLAUSES}
        />
      )}

      {modals.uploadContract && (
        <UploadContractModal
          onClose={() => closeModal('uploadContract')}
          onUpload={onUpload}
          clients={clients}
          types={COMPANY_CONTRACT_TYPES}
        />
      )}

      {sendCtx && (
        <SendForSignatureModal
          context={sendCtx}
          adminId={adminId}
          onClose={() => setSendCtx(null)}
          onSent={fetchSales}
        />
      )}
    </div>
  );
};

export default ContractsTab;
