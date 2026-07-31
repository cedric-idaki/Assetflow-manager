import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { openStoredFile } from '../../../lib/storageUrl';
import { useAuth } from '../../../contexts/AuthContext';
import { useAdminDashboardContext } from '../../../contexts/AdminDashboardContext';
import { generateSchedule, AMORTIZATION_METHODS } from '../../../utils/saccoAmortization';
import { generateSaccoLoanContractPDF } from '../../../utils/generateSaccoLoanContractPDF';
import SendForSignatureModal from '../../../components/contracts/SendForSignatureModal';
import UploadContractModal from '../../../components/contracts/UploadContractModal';
import TemplatesSection, {
  SACCO_TEMPLATE_TYPES, SACCO_DEFAULT_CLAUSES,
} from '../../../components/contracts/TemplatesSection';
import { KES } from './_shared';

// ─────────────────────────────────────────────────────────────────────────────
// Sacco Contracts tab — the sacco counterpart of the company Contracts tab
// (pages/admin-dashboard/components/ContractsTab.jsx), with the same three
// sections and the same signing pipeline:
//
//   Loan Agreements  ← auto-generated per sacco_loans row (company's "From POS
//                      Sales"). The company tab records these in
//                      generated_contracts, whose sale_id is NOT NULL and FKs
//                      to sales; a sacco has no sales, so loan agreements are
//                      written to company_contracts.loan_id instead — which is
//                      also the table the member portal's Contracts tab reads.
//   Uploaded         ← manual PDF uploads linked to a member.
//   Templates        ← contract_templates clause sets (+ uploaded template PDFs).
//
// "Sign" pushes the row into the shared e-signature flow with source 'company',
// exactly like an uploaded company contract.
// ─────────────────────────────────────────────────────────────────────────────

const SACCO_UPLOAD_TYPES = [
  { value: 'loan_agreement', label: 'Loan Agreement' },
  { value: 'membership',     label: 'Membership Agreement' },
  { value: 'guarantor',      label: 'Guarantor Form' },
  { value: 'share_transfer', label: 'Share Transfer Form' },
  { value: 'general',        label: 'General Contract' },
];

const methodLabel = (id) => AMORTIZATION_METHODS.find((m) => m.id === id)?.label || id;

const STATUS_TONES = {
  active:   'bg-emerald-100 text-emerald-700',
  closed:   'bg-slate-100 text-slate-600',
  pending:  'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700',
};

// ── Loan row — generates the agreement PDF, then offers it for signature ──────
// `member` is the full sacco_members row (the loans join carries only id /
// name / member_no, and the signature invite needs the email).
const LoanContractRow = ({ loan, member, contract, onGenerate, onSendForSignature }) => {
  const [generating, setGenerating] = useState(false);
  const [error, setError]           = useState('');

  const done      = !!contract;
  const savingPdf = !!contract && !contract.file_url;

  const handleClick = async () => {
    setGenerating(true); setError('');
    try { await onGenerate(loan); }
    catch (err) { setError(err.message || 'Generation failed'); }
    finally { setGenerating(false); }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(52,193,221,0.12)' }}>
          <Icon name="FileText" size={20} color="#1da8c5" />
        </div>
        <div className="flex items-center gap-1">
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: 'rgba(52,193,221,0.12)', color: '#0e7f97' }}>
            Auto-Generated
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_TONES[loan.status] || 'bg-gray-100 text-gray-600'}`}>
            {loan.status}
          </span>
        </div>
      </div>

      <h3 className="font-semibold text-foreground text-sm mb-0.5">{member?.full_name || 'Member'}</h3>
      <p className="text-xs text-muted-foreground mb-0.5">
        {loan.product?.name || 'Custom facility'} · {methodLabel(loan.method)}
      </p>
      <p className="text-xs text-primary mb-0.5">Member No: {member?.member_no || '—'}</p>
      <p className="text-xs text-foreground font-semibold mb-0.5">{KES(loan.principal)}</p>
      <p className="text-xs text-muted-foreground">
        {loan.term_months} months @ {loan.annual_interest_rate}% p.a.
      </p>

      {savingPdf && (
        <p className="text-xs text-primary mt-0.5 flex items-center gap-1">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg> Saving copy for e-signature…
        </p>
      )}
      {done && contract.created_at && (
        <p className="text-xs text-emerald-600 mt-0.5">
          ✓ Generated: {new Date(contract.created_at).toLocaleDateString('en-GB')}
        </p>
      )}
      {done && contract.esign_status === 'pending' && (
        <p className="text-xs text-amber-600 mt-0.5">Awaiting signature</p>
      )}
      {done && contract.esign_status === 'signed' && (
        <p className="text-xs text-emerald-600 mt-0.5">Signed</p>
      )}
      {loan.status === 'pending' && (
        <p className="text-xs text-amber-600 mt-0.5">Projected schedule — loan not yet approved</p>
      )}

      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <button
          onClick={handleClick}
          disabled={generating}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-60"
          style={{ background: done ? 'linear-gradient(135deg,#059669,#047857)' : 'linear-gradient(135deg,#34c1dd,#1da8c5)' }}>
          {generating ? (
            <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg> Generating...</>
          ) : done ? (
            <><Icon name="RefreshCw" size={13} color="white" /> Download Again</>
          ) : (
            <><Icon name="FileDown" size={13} color="white" /> Generate Agreement</>
          )}
        </button>
        {done && (
          <button
            onClick={() => onSendForSignature({
              source: 'company',
              contractId: contract.id,
              documentLabel: contract.contract_name,
              defaultClient: { name: member?.full_name, email: member?.email },
            })}
            disabled={!contract.file_url}
            title={contract.file_url ? 'Send for e-signature' : 'Waiting for the PDF copy to finish saving'}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border text-foreground hover:bg-muted transition-all disabled:opacity-50">
            <Icon name="PenTool" size={13} color="currentColor" /> Sign
          </button>
        )}
      </div>
    </div>
  );
};

// ── Uploaded / template contract card ─────────────────────────────────────────
const ContractCard = ({ contract, onSendForSignature }) => (
  <div className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all">
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
    {contract.member && (
      <p className="text-xs text-primary mb-1">
        Member: {contract.member.full_name}{contract.member.member_no ? ` · ${contract.member.member_no}` : ''}
      </p>
    )}
    <p className="text-xs text-muted-foreground">
      {contract.created_at ? new Date(contract.created_at).toLocaleDateString('en-GB') : '—'}
    </p>
    <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
      <button onClick={() => contract.file_url && openStoredFile(contract.file_url)}
        disabled={!contract.file_url}
        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
        style={{ background: 'rgba(52,193,221,0.12)', color: '#0e7f97' }}>
        <Icon name="Download" size={13} color="currentColor" /> Download
      </button>
      {onSendForSignature && (
        <button
          onClick={() => onSendForSignature({
            source: 'company',
            contractId: contract.id,
            documentLabel: contract.contract_name,
            defaultClient: { name: contract.member?.full_name, email: contract.member?.email },
          })}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-foreground hover:bg-muted transition-all">
          <Icon name="PenTool" size={13} color="currentColor" /> Sign
        </button>
      )}
    </div>
  </div>
);

// ── Main tab ──────────────────────────────────────────────────────────────────
const SaccoContractsTab = ({ ctx }) => {
  const { user } = useAuth();
  const { modals, openModal, closeModal } = useAdminDashboardContext();
  const { sacco, members, loans, loanProducts, schedules, exportCSV } = ctx;

  const adminId = user?.id;
  const [filter, setFilter]       = useState('loans');
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loanTemplate, setLoanTemplate] = useState(null);
  const [clauseTemplateCount, setClauseTemplateCount] = useState(0);
  const [sendCtx, setSendCtx]     = useState(null);

  // ── Fetchers ───────────────────────────────────────────────────────────────
  // Only the very first fetch shows skeletons — the refetches after generating
  // or signing must not blank out the grid the user is looking at.
  const hasLoaded = useRef(false);

  const fetchContracts = useCallback(async () => {
    if (!adminId) return;
    if (!hasLoaded.current) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('company_contracts')
        .select('*, member:sacco_members(id, full_name, member_no, email)')
        .eq('admin_id', adminId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setContracts(data || []);
    } catch (err) {
      console.error('fetchContracts error:', err.message);
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [adminId]);

  // The clause set the generated PDF uses: the tenant's default loan template,
  // else any active loan template, else the built-in sacco defaults.
  const fetchLoanTemplate = useCallback(async () => {
    if (!adminId) return;
    const { data } = await supabase
      .from('contract_templates')
      .select('*')
      .eq('admin_id', adminId)
      .eq('is_active', true)
      .eq('contract_type', 'loan_agreement')
      .order('is_default', { ascending: false })
      .limit(1);
    setLoanTemplate(data?.[0] || null);
  }, [adminId]);

  useEffect(() => { fetchContracts(); fetchLoanTemplate(); }, [fetchContracts, fetchLoanTemplate]);

  const handleTemplatesChanged = useCallback((rows) => {
    setClauseTemplateCount(rows.length);
    setLoanTemplate(
      rows.filter((r) => r.contract_type === 'loan_agreement')
        .sort((a, b) => Number(b.is_default) - Number(a.is_default))[0] || null
    );
  }, []);

  // ── Generate a loan agreement ──────────────────────────────────────────────
  const generateAgreement = useCallback(async (loan) => {
    const member  = members.find((m) => m.id === loan.member_id) || loan.member || null;
    const product = loanProducts.find((p) => p.id === loan.product_id) || null;

    // Approved loans have a persisted schedule; a pending application does not,
    // so project one the same way the Loans tab preview does.
    let rows = schedules
      .filter((s) => s.loan_id === loan.id)
      .sort((a, b) => a.period_no - b.period_no);

    if (rows.length === 0) {
      const { schedule } = generateSchedule(loan.method, {
        principal:     loan.principal,
        annualRate:    loan.annual_interest_rate,
        termMonths:    loan.term_months,
        balloonAmount: loan.balloon_amount,
        startDate:     new Date().toISOString().slice(0, 10),
      });
      rows = schedule.map((r) => ({
        period_no:       r.periodNo,
        due_date:        r.dueDate,
        opening_balance: r.openingBalance,
        interest:        r.interest,
        principal:       r.principal,
        payment:         r.payment,
        closing_balance: r.closingBalance,
      }));
    }

    // Builds + downloads the PDF locally and returns the blob for storage.
    const { blob } = await generateSaccoLoanContractPDF({
      loan, member, sacco, product, schedule: rows, template: loanTemplate,
    });

    // Record the agreement immediately (no file_url yet) so the UI confirms
    // straight away — the PDF is uploaded to storage in the background below.
    const contractName = `Loan Agreement — ${member?.full_name || 'Member'} — ${KES(loan.principal)}`;
    const { data: saved, error } = await supabase
      .from('company_contracts')
      .upsert({
        admin_id:      adminId,
        loan_id:       loan.id,
        member_id:     loan.member_id,
        client_id:     null,
        contract_name: contractName,
        contract_type: 'loan_agreement',
        is_template:   false,
        status:        'active',
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'loan_id' })
      .select('id')
      .single();
    if (error) throw error;

    await fetchContracts();

    // Background: persist the PDF so e-signature can display/sign it, then
    // patch file_url. Non-fatal — the local download already happened.
    (async () => {
      try {
        const path = `${adminId}/loan_${loan.id}.pdf`;
        const { error: upErr } = await supabase.storage
          .from('contracts')
          .upload(path, blob, { upsert: true, contentType: 'application/pdf' });
        if (upErr) throw upErr;
        const url = supabase.storage.from('contracts').getPublicUrl(path).data?.publicUrl;
        if (url && saved?.id) {
          await supabase.from('company_contracts').update({ file_url: url }).eq('id', saved.id);
          await fetchContracts();
        }
      } catch (e) { console.warn('loan agreement PDF upload skipped:', e.message); }
    })();
  }, [adminId, members, loanProducts, schedules, sacco, loanTemplate, fetchContracts]);

  // ── Upload a contract PDF ──────────────────────────────────────────────────
  const uploadContract = useCallback(async (formData, file, onProgress) => {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath  = `${adminId}/${Date.now()}_${cleanName}`;

    const { error: upErr } = await supabase.storage.from('contracts').upload(filePath, file, {
      upsert: true, cacheControl: '3600', contentType: file.type || 'application/pdf',
    });
    if (upErr) throw upErr;
    if (onProgress) onProgress(100);

    const { data: { publicUrl } } = supabase.storage.from('contracts').getPublicUrl(filePath);

    // The selector lists MEMBERS, so the chosen id is a sacco_members.id — it
    // goes in member_id (client_id stays null), which is what the member
    // portal's Contracts tab reads.
    const { error } = await supabase.from('company_contracts').insert({
      admin_id:      adminId,
      contract_name: formData.name,
      contract_type: formData.type,
      client_id:     null,
      member_id:     formData.clientId || null,
      file_url:      publicUrl,
      is_template:   formData.isTemplate || false,
    });
    if (error) throw error;

    await fetchContracts();
  }, [adminId, fetchContracts]);

  // ── Derived ────────────────────────────────────────────────────────────────
  // Loan agreements live in company_contracts too, so keep them out of the
  // "Uploaded" list to avoid showing each one twice.
  const contractByLoan = useMemo(() => {
    const map = {};
    contracts.forEach((c) => { if (c.loan_id) map[c.loan_id] = c; });
    return map;
  }, [contracts]);

  const uploaded          = contracts.filter((c) => !c.is_template && !c.loan_id);
  const uploadedTemplates = contracts.filter((c) => c.is_template);
  const generatedCount    = Object.keys(contractByLoan).length;

  const memberById = useMemo(() => {
    const map = {};
    members.forEach((m) => { map[m.id] = m; });
    return map;
  }, [members]);

  // Members masquerade as "clients" for the shared upload modal (member_no ≈
  // account no).
  const memberOptions = useMemo(
    () => members.map((m) => ({ id: m.id, full_name: m.full_name, account_number: m.member_no })),
    [members],
  );

  const handleExport = () => exportCSV(
    contracts.map((c) => ({
      name:    c.contract_name,
      type:    c.contract_type,
      member:  c.member?.full_name || (c.is_template ? 'Template' : '—'),
      source:  c.loan_id ? 'loan agreement' : 'uploaded',
      status:  c.status,
      esign:   c.esign_status || '—',
      created: c.created_at,
    })),
    'sacco_contracts',
  );

  const skeletons = (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
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
  );

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card border border-border rounded-xl px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Contracts</h2>
          <p className="text-xs text-muted-foreground">
            {generatedCount} of {loans.length} loan agreement{loans.length !== 1 ? 's' : ''} generated ·{' '}
            {uploaded.length} uploaded · {clauseTemplateCount + uploadedTemplates.length} templates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
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
      <div className="flex gap-1 flex-wrap">
        {[
          { value: 'loans',     label: `Loan Agreements (${loans.length})` },
          { value: 'uploaded',  label: `Uploaded (${uploaded.length})` },
          { value: 'templates', label: `Templates (${clauseTemplateCount + uploadedTemplates.length})` },
        ].map((f) => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f.value ? 'text-white' : 'bg-card border border-border text-muted-foreground hover:text-foreground'
            }`}
            style={filter === f.value ? { background: 'linear-gradient(135deg,#34c1dd,#1da8c5)' } : {}}>
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Loan agreements (auto-generated from the loan book) ── */}
      {filter === 'loans' && (
        loading ? skeletons : loans.length === 0 ? (
          <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Icon name="Banknote" size={32} color="currentColor" />
            <p className="text-sm font-medium text-foreground mt-3">No loans yet</p>
            <p className="text-xs mt-1">Create a loan in the Loans tab — its agreement can then be generated and signed here</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {loans.map((loan) => (
              <LoanContractRow
                key={loan.id}
                loan={loan}
                member={memberById[loan.member_id] || loan.member}
                contract={contractByLoan[loan.id]}
                onGenerate={generateAgreement}
                onSendForSignature={setSendCtx}
              />
            ))}
          </div>
        )
      )}

      {/* ── Uploaded contracts ── */}
      {filter === 'uploaded' && (
        loading ? skeletons : uploaded.length === 0 ? (
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
            {uploaded.map((contract) => (
              <ContractCard key={contract.id} contract={contract} onSendForSignature={setSendCtx} />
            ))}
          </div>
        )
      )}

      {/* ── Templates: clause sets + any uploaded template PDFs ── */}
      {filter === 'templates' && (
        <div className="space-y-6">
          <TemplatesSection
            adminId={adminId}
            types={SACCO_TEMPLATE_TYPES}
            defaultClauses={SACCO_DEFAULT_CLAUSES}
            onChanged={handleTemplatesChanged}
          />
          {uploadedTemplates.length > 0 && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{uploadedTemplates.length} uploaded template PDF{uploadedTemplates.length !== 1 ? 's' : ''}</p>
                <p className="text-xs text-muted-foreground">Blank documents you uploaded and marked as reusable</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {uploadedTemplates.map((contract) => (
                  <ContractCard key={contract.id} contract={contract} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {modals.uploadContract && (
        <UploadContractModal
          onClose={() => closeModal('uploadContract')}
          onUpload={uploadContract}
          clients={memberOptions}
          types={SACCO_UPLOAD_TYPES}
          defaultType="loan_agreement"
          linkLabel="Link to Member (optional)"
          linkEmptyLabel="No member — save as template"
        />
      )}

      {sendCtx && (
        <SendForSignatureModal
          context={sendCtx}
          adminId={adminId}
          onClose={() => setSendCtx(null)}
          onSent={fetchContracts}
        />
      )}
    </div>
  );
};

export default SaccoContractsTab;
