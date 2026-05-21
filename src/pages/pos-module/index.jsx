import React, { useState, useEffect, useMemo } from 'react';
import MainLayout from '../../layouts/MainLayout';
import Icon from '../../components/AppIcon';
import { usePOS, buildInstallmentSchedule, VAT_RATE } from '../../hooks/usePOS';
import { generateReceiptPDF } from '../../utils/generateReceiptPDF';
import { supabase } from '../../lib/supabase';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt  = (n) => `KES ${(parseFloat(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const ic   = (err) => `w-full px-3 py-2.5 text-sm bg-background border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground transition-colors ${err ? 'border-red-400 bg-red-50' : 'border-border'}`;

const PRICING_MODELS = [
  { value: 'cash',          label: 'Cash Sale (Full Payment)',         icon: 'Banknote',   desc: 'Client pays full amount upfront' },
  { value: 'installment',   label: 'Deposit + Monthly Installments',   icon: 'Calendar',   desc: 'Most common — deposit then monthly payments' },
  { value: 'balloon',       label: 'Deposit + Balloon Payment',        icon: 'TrendingUp', desc: 'Small/zero monthly payments, large final payment' },
  { value: 'zero_deposit',  label: 'Zero-Deposit Installment',         icon: 'Zap',        desc: 'Pre-approved clients only — full value financed' },
  { value: 'lease_to_own',  label: 'Lease-to-Own',                     icon: 'Key',        desc: 'Periodic payments, ownership at end of term' },
];

const PAYMENT_METHODS = [
  { value: 'mpesa',         label: 'M-Pesa' },
  { value: 'cash',          label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card',          label: 'Card' },
  { value: 'cheque',        label: 'Cheque' },
];

const TENURE_OPTIONS = [3, 6, 12, 18, 24, 36, 48, 60].map(m => ({ value: m, label: `${m} months` }));

const LARGE_TXN_THRESHOLD = 50000;
const DISCOUNT_APPROVAL_THRESHOLD = 10;

// ── Step indicator ────────────────────────────────────────────────────────────
const StepDot = ({ n, active, done, label }) => (
  <div className="flex items-center gap-2">
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${done ? 'bg-emerald-600 text-white' : active ? 'text-white' : 'bg-muted text-muted-foreground'}`}
      style={active ? { background: 'linear-gradient(135deg,#1A56DB,#1E429F)' } : {}}>
      {done ? '✓' : n}
    </div>
    <span className={`text-xs font-medium hidden sm:block ${active ? 'text-primary' : done ? 'text-emerald-600' : 'text-muted-foreground'}`}>{label}</span>
  </div>
);

const StepBar = ({ step }) => (
  <div className="flex items-center gap-1 px-6 py-3 bg-muted/20 border-b border-border overflow-x-auto">
    {[
      [1, 'Client'],
      [2, 'Asset'],
      [3, 'Pricing'],
      [4, 'Payment'],
      [5, 'Review'],
    ].map(([n, label], i, arr) => (
      <React.Fragment key={n}>
        <StepDot n={n} active={step === n} done={step > n} label={label} />
        {i < arr.length - 1 && <div className={`flex-1 h-0.5 min-w-4 ${step > n ? 'bg-emerald-600' : 'bg-border'}`} />}
      </React.Fragment>
    ))}
  </div>
);

// ── Skeleton ──────────────────────────────────────────────────────────────────
const Sk = ({ className = '' }) => <div className={`animate-pulse bg-muted rounded-lg ${className}`} />;

// ── Receipt popup ─────────────────────────────────────────────────────────────
const ReceiptModal = ({ result, client, asset, saleData, companyProfile, onClose, onNewSale, schedule }) => {
  const [downloading, setDownloading] = React.useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await generateReceiptPDF({
        saleData,
        client,
        asset,
        companyProfile,
        schedule,
        invoiceNo: result.invoiceNo,
        receiptNo: result.receiptNo,
      });
    } catch (err) {
      alert('PDF generation failed: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
  <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-y-auto max-h-[90vh]">
      <div className="px-6 pt-6 pb-4 text-center" style={{ background: 'linear-gradient(135deg,#059669,#047857)' }}>
        <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
          <Icon name="CheckCircle" size={32} color="white" />
        </div>
        <h2 className="text-2xl font-bold text-white">Sale Completed!</h2>
        <p className="text-sm text-emerald-100 mt-1">{result.invoiceNo}</p>
      </div>

      <div className="px-6 py-5 space-y-4">
        <div className="text-center pb-3 border-b border-border">
          <p className="font-bold text-foreground">{companyProfile?.company_name || 'Your Company'}</p>
          <p className="text-xs text-muted-foreground">{companyProfile?.address || ''}</p>
        </div>

        <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-sm">
          {[
            { label: 'Client',        value: client?.full_name },
            { label: 'Account No.',   value: client?.account_number },
            { label: 'Asset',         value: asset?.description },
            { label: 'Pricing Model', value: PRICING_MODELS.find(m => m.value === saleData.pricingModel)?.label },
            { label: 'Date',          value: fmtD(new Date().toISOString()) },
          ].map(r => (
            <div key={r.label} className="flex justify-between">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="font-medium text-foreground text-right max-w-[60%]">{r.value}</span>
            </div>
          ))}
        </div>

        <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-sm">
          {saleData.pricingModel === 'cash' ? (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmt(saleData.sellingPrice - (saleData.discountAmount || 0))}</span></div>
              {saleData.discountAmount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="text-red-500">-{fmt(saleData.discountAmount)}</span></div>}
              {saleData.vatAmount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">VAT (16%)</span><span>{fmt(saleData.vatAmount)}</span></div>}
              <div className="flex justify-between font-bold text-base pt-1 border-t border-border">
                <span className="text-foreground">Total Paid</span>
                <span className="text-emerald-600">{fmt(saleData.totalAmount)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">Selling Price</span><span>{fmt(saleData.sellingPrice)}</span></div>
              <div className="flex justify-between font-bold"><span className="text-muted-foreground">Deposit Paid</span><span className="text-emerald-600">{fmt(saleData.depositAmount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Balance to Finance</span><span>{fmt(saleData.financeBalance)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Monthly Installment</span><span className="font-semibold">{fmt(saleData.scheduleSummary?.monthlyInstallment)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tenure</span><span>{saleData.tenureMonths} months</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">First Due</span><span>{fmtD(saleData.startDate)}</span></div>
              <div className="flex justify-between font-bold text-sm pt-1 border-t border-border">
                <span className="text-muted-foreground">Total Payable</span>
                <span>{fmt(saleData.scheduleSummary?.totalPayable)}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Receipt: {result.receiptNo}</span>
          <span>Method: {PAYMENT_METHODS.find(m => m.value === saleData.paymentMethod)?.label}</span>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
          ⚠️ A contract will be generated and sent to the client for e-signature.
        </div>
      </div>

      <div className="flex gap-2 px-6 pb-6">
        <button onClick={onNewSale}
          className="flex-1 py-2.5 border border-border text-sm font-medium text-muted-foreground rounded-xl hover:bg-muted transition-colors">
          New Sale
        </button>
        <button onClick={() => window.print()}
          className="py-2.5 px-4 text-sm font-medium border border-border text-foreground rounded-xl hover:bg-muted transition-colors">
          Print
        </button>
        <button onClick={handleDownload} disabled={downloading}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-60 transition-all"
          style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
          {downloading ? (
            <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg> Generating...</>
          ) : (
            <><Icon name="Download" size={14} color="white" /> Download PDF</>
          )}
        </button>
      </div>
    </div>
  </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN POS COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const POSModule = () => {
  const {
    clients, assets, companyProfile, loading, submitting, error: hookError,
    submitSale,
  } = usePOS();

  const [step, setStep]               = useState(1);
  const [errors, setErrors]           = useState({});
  const [globalError, setGlobalError] = useState('');
  const [receipt, setReceipt]         = useState(null);

  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);

  const [assetSearch, setAssetSearch]   = useState('');
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [quantity, setQuantity]           = useState(1);

  const [pricingModel, setPricingModel]   = useState('installment');
  const [sellingPrice, setSellingPrice]   = useState('');
  const [discountPct, setDiscountPct]     = useState('');
  const [pendingApproval, setPendingApproval] = useState(false);
  const [approvalRef, setApprovalRef]         = useState(null);
  const [txnApprovalRef, setTxnApprovalRef]   = useState(null);
  const [pendingTxnApproval, setPendingTxnApproval] = useState(false);
  const [discountReason, setDiscountReason] = useState('');
  const [vatApplicable, setVatApplicable] = useState(true);
  const [depositAmount, setDepositAmount] = useState('');
  const [interestRate, setInterestRate]   = useState('');
  const [tenureMonths, setTenureMonths]   = useState(12);
  const [startDate, setStartDate]         = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });

  const [paymentMethod, setPaymentMethod] = useState('mpesa');
  const [mpesaRef, setMpesaRef]           = useState('');
  const [bankRef, setBankRef]             = useState('');
  const [notes, setNotes]                 = useState('');

  useEffect(() => {
    if (selectedAsset) {
      setSellingPrice(String(selectedAsset.selling_price || ''));
      setInterestRate(String(selectedAsset.installment_interest_rate || '12'));
      setVatApplicable(selectedAsset.vat_applicable !== false);
      const minDep = selectedAsset.min_deposit_pct
        ? Math.ceil((selectedAsset.selling_price * selectedAsset.min_deposit_pct) / 100)
        : Math.ceil(selectedAsset.selling_price * 0.2);
      setDepositAmount(String(minDep));
    }
  }, [selectedAsset]);

  const discountAmount = useMemo(() => {
    const price = parseFloat(sellingPrice) || 0;
    const pct   = parseFloat(discountPct)  || 0;
    return Math.round(price * pct / 100);
  }, [sellingPrice, discountPct]);

  const priceAfterDiscount = useMemo(() =>
    (parseFloat(sellingPrice) || 0) - discountAmount,
    [sellingPrice, discountAmount]);

  const vatAmount = useMemo(() =>
    vatApplicable ? Math.round(priceAfterDiscount * VAT_RATE) : 0,
    [priceAfterDiscount, vatApplicable]);

  const totalAmount = useMemo(() =>
    priceAfterDiscount + vatAmount,
    [priceAfterDiscount, vatAmount]);

  const financeBalance = useMemo(() =>
    Math.max(0, totalAmount - (parseFloat(depositAmount) || 0)),
    [totalAmount, depositAmount]);

  const schedule = useMemo(() => {
    if (pricingModel === 'cash') return null;
    const dep = parseFloat(depositAmount) || 0;
    const rate = parseFloat(interestRate) || 0;
    if (!totalAmount || !tenureMonths || dep > totalAmount) return null;
    try {
      return buildInstallmentSchedule({
        sellingPrice:       totalAmount,
        deposit:            dep,
        annualInterestRate: rate,
        tenureMonths,
        startDate,
      });
    } catch { return null; }
  }, [pricingModel, totalAmount, depositAmount, interestRate, tenureMonths, startDate]);

  const filteredClients = useMemo(() => {
    if (!clientSearch) return clients.slice(0, 10);
    const q = clientSearch.toLowerCase();
    return clients.filter(c =>
      c.full_name?.toLowerCase().includes(q) ||
      c.account_number?.toLowerCase().includes(q) ||
      c.phone?.includes(q)
    ).slice(0, 10);
  }, [clients, clientSearch]);

  const filteredAssets = useMemo(() => {
    if (!assetSearch) return assets.slice(0, 12);
    const q = assetSearch.toLowerCase();
    return assets.filter(a =>
      a.description?.toLowerCase().includes(q) ||
      a.asset_code?.toLowerCase().includes(q) ||
      a.asset_type?.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [assets, assetSearch]);

  const validateStep = (s) => {
    const e = {};
    if (s === 1) {
      if (!selectedClient) e.client = 'Please select a client';
      else if (selectedClient.kyc_status !== 'verified') e.client = 'Client KYC must be verified before a sale';
    }
    if (s === 2) {
      if (!selectedAsset) e.asset = 'Please select an asset';
    }
    if (s === 3) {
      if (!sellingPrice || parseFloat(sellingPrice) <= 0) e.sellingPrice = 'Selling price is required';
      const minPrice = selectedAsset?.min_selling_price;
      if (minPrice && parseFloat(sellingPrice) < minPrice) e.sellingPrice = `Minimum selling price is ${fmt(minPrice)}`;
      const maxDisc = selectedAsset?.max_discount_pct;
      if (maxDisc && parseFloat(discountPct) > maxDisc) e.discountPct = `Maximum discount is ${maxDisc}%`;
      if (discountPct && !discountReason) e.discountReason = 'Reason required when discount is applied';
      if (pricingModel !== 'cash') {
        const dep = parseFloat(depositAmount) || 0;
        const minDep = selectedAsset?.min_deposit_pct
          ? (parseFloat(sellingPrice) * selectedAsset.min_deposit_pct / 100) : 0;
        if (dep < minDep) e.depositAmount = `Minimum deposit is ${fmt(minDep)} (${selectedAsset?.min_deposit_pct}%)`;
        if (!interestRate) e.interestRate = 'Interest rate is required';
        if (!startDate) e.startDate = 'Payment start date is required';
      }
    }
    if (s === 4) {
      if (!paymentMethod) e.paymentMethod = 'Select a payment method';
      if (paymentMethod === 'mpesa' && !mpesaRef) e.mpesaRef = 'M-Pesa reference is required';
      if (paymentMethod === 'bank_transfer' && !bankRef) e.bankRef = 'Bank reference is required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goNext = () => { if (validateStep(step)) setStep(s => s + 1); };
  const goBack = () => { setErrors({}); setGlobalError(''); setStep(s => s - 1); };

  const handleSubmit = async () => {
    setGlobalError('');
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data: currentProfile } = await supabase.from('user_profiles').select('full_name, role, admin_id').eq('id', currentUser.id).single();
      const isManagerRole = ['admin', 'manager', 'director'].includes(currentProfile?.role);

      if (totalAmount > LARGE_TXN_THRESHOLD && !isManagerRole) {
        const ref = `TXN-${Date.now().toString(36).toUpperCase()}`;
        await supabase.from('maker_checker_queue').insert({
          action_type:     'large_transaction',
          title:           `Large Transaction — ${fmt(totalAmount)} for ${selectedClient?.full_name}`,
          description:     `Sales agent requesting approval for ${pricingModel === 'cash' ? 'cash sale' : 'hire purchase'} of ${selectedAsset?.description} valued at ${fmt(totalAmount)}. Exceeds KES 50,000 threshold.`,
          initiator_name:  currentProfile?.full_name || currentUser.email,
          initiator_email: currentUser.email,
          status:          'pending',
          priority:        totalAmount > 200000 ? 'high' : 'medium',
          affected_entity: selectedAsset?.id,
          admin_id:        currentProfile?.admin_id || currentUser.id,
          metadata: {
            ref,
            client_id:     selectedClient?.id,
            asset_id:      selectedAsset?.id,
            total_amount:  totalAmount,
            pricing_model: pricingModel,
            deposit_amount: parseFloat(depositAmount) || 0,
          },
        });
        setTxnApprovalRef(ref);
        setPendingTxnApproval(true);
        return;
      }

      const discPct = parseFloat(discountPct) || 0;
      const needsApproval = discPct > DISCOUNT_APPROVAL_THRESHOLD;

      if (needsApproval) {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: profile } = await supabase.from('user_profiles').select('full_name, role, admin_id').eq('id', user.id).single();
        const isManager = ['admin', 'manager', 'director'].includes(profile?.role);

        if (!isManager) {
          const ref = `DISC-${Date.now().toString(36).toUpperCase()}`;
          const { error: qErr } = await supabase.from('maker_checker_queue').insert({
            action_type:      'discount_approval',
            title:            `Discount Approval — ${discPct}% on ${selectedAsset?.description}`,
            description:      `Sales agent requesting ${discPct}% discount (${fmt(discountAmount)}) on ${selectedAsset?.description} for client ${selectedClient?.full_name}. Reason: ${discountReason || 'Not provided'}`,
            initiator_name:   profile?.full_name || user.email,
            initiator_email:  user.email,
            status:           'pending',
            priority:         discPct > 15 ? 'high' : 'medium',
            affected_entity:  selectedAsset?.id,
            admin_id:         profile?.admin_id || user.id,
            metadata: {
              ref,
              client_id:      selectedClient?.id,
              asset_id:       selectedAsset?.id,
              selling_price:  parseFloat(sellingPrice),
              discount_pct:   discPct,
              discount_amount: discountAmount,
              discount_reason: discountReason,
              pricing_model:  pricingModel,
            },
          });
          if (qErr) throw qErr;
          setApprovalRef(ref);
          setPendingApproval(true);
          return;
        }
      }

      const result = await submitSale({
        clientId:        selectedClient.id,
        asset:           selectedAsset,
        pricingModel,
        sellingPrice:    parseFloat(sellingPrice),
        discountAmount,
        discountReason,
        vatAmount,
        totalAmount,
        depositAmount:   parseFloat(depositAmount) || 0,
        financeBalance,
        interestRate:    parseFloat(interestRate) || 0,
        tenureMonths,
        startDate,
        paymentMethod,
        mpesaRef,
        bankRef,
        notes,
        schedule:        schedule?.schedule,
        scheduleSummary: schedule?.summary,
      });
      setReceipt(result);
    } catch (err) {
      setGlobalError(err.message || 'Sale failed. Please try again.');
    }
  };

  const resetForm = () => {
    setStep(1); setReceipt(null);
    setSelectedClient(null); setClientSearch('');
    setSelectedAsset(null); setAssetSearch('');
    setQuantity(1); setPricingModel('installment');
    setSellingPrice(''); setDiscountPct(''); setDiscountReason('');
    setDepositAmount(''); setInterestRate(''); setTenureMonths(12);
    setPaymentMethod('mpesa'); setMpesaRef(''); setBankRef(''); setNotes('');
    setErrors({}); setGlobalError('');
  };

  if (loading) return (
    <MainLayout>
      <div className="p-5 space-y-4">
        <Sk className="h-10 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Sk key={i} className="h-24" />)}
        </div>
        <Sk className="h-96" />
      </div>
    </MainLayout>
  );

  return (
    <MainLayout>
      {receipt && (
        <ReceiptModal
          result={receipt}
          client={selectedClient}
          asset={selectedAsset}
          saleData={{
            pricingModel, sellingPrice: parseFloat(sellingPrice),
            discountAmount, discountPct, discountReason,
            vatAmount, totalAmount,
            depositAmount:      parseFloat(depositAmount) || 0,
            financeBalance,
            interestRate:       parseFloat(interestRate) || 0,
            tenureMonths,
            startDate,
            paymentMethod,
            mpesaRef,
            bankRef,
            monthlyInstallment: schedule?.summary?.monthlyInstallment,
            totalPayable:       schedule?.summary?.totalPayable,
          }}
          schedule={schedule?.schedule}
          companyProfile={companyProfile}
          onClose={() => setReceipt(null)}
          onNewSale={resetForm}
        />
      )}

      <div className="p-5 space-y-6">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
              <Icon name="ShoppingCart" size={20} color="white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Point of Sale</h1>
              <p className="text-xs text-muted-foreground">New asset sale transaction</p>
            </div>
          </div>
          {step > 1 && (
            <button onClick={resetForm} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg hover:bg-muted transition-colors">
              <Icon name="RotateCcw" size={13} color="currentColor" /> Reset
            </button>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <StepBar step={step} />

          <div className="p-5 min-h-[400px]">

            {step === 1 && (
              <div className="space-y-4 max-w-2xl mx-auto">
                <div>
                  <h2 className="text-base font-semibold text-foreground mb-1">Select Client</h2>
                  <p className="text-xs text-muted-foreground">Only KYC-verified clients can proceed to a sale</p>
                </div>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Icon name="Search" size={15} color="var(--color-muted-foreground)" />
                  </div>
                  <input type="text" value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                    placeholder="Search by name, account number or phone..."
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground" />
                </div>
                {errors.client && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <Icon name="AlertCircle" size={12} color="#ef4444" /> {errors.client}
                  </p>
                )}
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {filteredClients.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Icon name="Users" size={28} color="currentColor" />
                      <p className="text-sm mt-2">No clients found</p>
                    </div>
                  ) : filteredClients.map(c => {
                    const isVerified = c.kyc_status === 'verified';
                    const isSelected = selectedClient?.id === c.id;
                    return (
                      <button key={c.id} onClick={() => isVerified && setSelectedClient(c)} disabled={!isVerified}
                        className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all ${
                          isSelected ? 'border-primary bg-primary/5' :
                          isVerified ? 'border-border hover:border-primary/40 hover:bg-muted/50' :
                          'border-border opacity-50 cursor-not-allowed'
                        }`}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm ${isSelected ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>
                          {c.full_name?.[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm text-foreground">{c.full_name}</p>
                          <p className="text-xs text-muted-foreground">{c.account_number} · {c.phone}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${isVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {isVerified ? '✓ KYC Verified' : c.kyc_status}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {selectedClient && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
                    <Icon name="CheckCircle" size={18} color="#059669" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-800">Selected: {selectedClient.full_name}</p>
                      <p className="text-xs text-emerald-600">{selectedClient.account_number}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4 max-w-3xl mx-auto">
                <div>
                  <h2 className="text-base font-semibold text-foreground mb-1">Select Asset</h2>
                  <p className="text-xs text-muted-foreground">Only available assets with stock are shown</p>
                </div>
                <div className="relative max-w-md">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Icon name="Search" size={15} color="var(--color-muted-foreground)" />
                  </div>
                  <input type="text" value={assetSearch} onChange={e => setAssetSearch(e.target.value)}
                    placeholder="Search assets..."
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground" />
                </div>
                {errors.asset && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <Icon name="AlertCircle" size={12} color="#ef4444" /> {errors.asset}
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                  {filteredAssets.length === 0 ? (
                    <div className="col-span-3 text-center py-10 text-muted-foreground">
                      <Icon name="Package" size={28} color="currentColor" />
                      <p className="text-sm mt-2">No available assets</p>
                    </div>
                  ) : filteredAssets.map(a => {
                    const isSelected = selectedAsset?.id === a.id;
                    return (
                      <button key={a.id} onClick={() => setSelectedAsset(a)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-mono text-muted-foreground">{a.asset_code}</span>
                          {isSelected && <Icon name="CheckCircle" size={16} color="#1A56DB" />}
                        </div>
                        <p className="font-semibold text-sm text-foreground leading-snug">{a.description}</p>
                        <p className="text-xs text-muted-foreground capitalize mt-0.5">{a.asset_type}</p>
                        <p className="text-base font-bold text-foreground mt-2">{fmt(a.selling_price)}</p>
                        <p className="text-xs text-muted-foreground">Qty: {a.quantity_available || 1}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5 max-w-3xl mx-auto">
                <div>
                  <h2 className="text-base font-semibold text-foreground mb-1">Pricing & Installment Setup</h2>
                  <p className="text-xs text-muted-foreground">Configure pricing model and payment terms</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pricing Model *</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PRICING_MODELS.map(m => (
                      <button key={m.value} onClick={() => setPricingModel(m.value)}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${pricingModel === m.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-muted/30'}`}>
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${pricingModel === m.value ? 'bg-primary' : 'bg-muted'}`}>
                          <Icon name={m.icon} size={15} color={pricingModel === m.value ? 'white' : 'var(--color-muted-foreground)'} />
                        </div>
                        <div>
                          <p className={`text-xs font-semibold ${pricingModel === m.value ? 'text-primary' : 'text-foreground'}`}>{m.label}</p>
                          <p className="text-xs text-muted-foreground">{m.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Selling Price (KES) *</label>
                    <input type="number" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} placeholder="0.00" className={ic(errors.sellingPrice)} />
                    {selectedAsset?.min_selling_price && <p className="text-xs text-muted-foreground mt-0.5">Min: {fmt(selectedAsset.min_selling_price)}</p>}
                    {errors.sellingPrice && <p className="text-xs text-red-500 mt-0.5">{errors.sellingPrice}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Discount (%) {selectedAsset?.max_discount_pct ? `— max ${selectedAsset.max_discount_pct}%` : ''}</label>
                    <input type="number" value={discountPct} onChange={e => setDiscountPct(e.target.value)} placeholder="0" className={ic(errors.discountPct)} />
                    {errors.discountPct && <p className="text-xs text-red-500 mt-0.5">{errors.discountPct}</p>}
                  </div>
                  {parseFloat(discountPct) > 0 && (
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">Discount Reason *</label>
                      <input type="text" value={discountReason} onChange={e => setDiscountReason(e.target.value)} placeholder="e.g. Loyal customer, bulk purchase..." className={ic(errors.discountReason)} />
                      {errors.discountReason && <p className="text-xs text-red-500 mt-0.5">{errors.discountReason}</p>}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <button onClick={() => setVatApplicable(v => !v)}
                      className={`w-10 h-6 rounded-full transition-colors flex items-center ${vatApplicable ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}>
                      <span className="w-5 h-5 bg-white rounded-full shadow mx-0.5" />
                    </button>
                    <label className="text-sm text-foreground">VAT (16%) applicable</label>
                  </div>
                </div>
                {pricingModel !== 'cash' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">Deposit Amount (KES) *</label>
                      <input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="0.00" className={ic(errors.depositAmount)} />
                      {selectedAsset?.min_deposit_pct && <p className="text-xs text-muted-foreground mt-0.5">Min {selectedAsset.min_deposit_pct}% = {fmt(parseFloat(sellingPrice || 0) * selectedAsset.min_deposit_pct / 100)}</p>}
                      {errors.depositAmount && <p className="text-xs text-red-500 mt-0.5">{errors.depositAmount}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">Annual Interest Rate (% p.a.) *</label>
                      <input type="number" value={interestRate} onChange={e => setInterestRate(e.target.value)} placeholder="e.g. 12" className={ic(errors.interestRate)} />
                      {errors.interestRate && <p className="text-xs text-red-500 mt-0.5">{errors.interestRate}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">Installment Tenure *</label>
                      <select value={tenureMonths} onChange={e => setTenureMonths(Number(e.target.value))} className={ic(false)}>
                        {TENURE_OPTIONS.filter(t => !selectedAsset?.max_installment_tenure || t.value <= selectedAsset.max_installment_tenure).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">First Installment Due Date *</label>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={ic(errors.startDate)} />
                      {errors.startDate && <p className="text-xs text-red-500 mt-0.5">{errors.startDate}</p>}
                    </div>
                  </div>
                )}
                <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-2 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Transaction Summary</p>
                  {[
                    { label: 'Selling Price', value: fmt(sellingPrice || 0) },
                    discountAmount > 0 && { label: 'Discount', value: `-${fmt(discountAmount)}` },
                    vatApplicable && { label: 'VAT (16%)', value: fmt(vatAmount) },
                    { label: 'Total Amount', value: fmt(totalAmount), bold: true },
                    pricingModel !== 'cash' && { label: 'Deposit', value: fmt(depositAmount || 0) },
                    pricingModel !== 'cash' && { label: 'Finance Balance', value: fmt(financeBalance) },
                    pricingModel !== 'cash' && schedule && { label: 'Monthly Installment', value: fmt(schedule.summary.monthlyInstallment), bold: true },
                    pricingModel !== 'cash' && schedule && { label: 'Total Payable', value: fmt(schedule.summary.totalPayable) },
                  ].filter(Boolean).map(r => (
                    <div key={r.label} className={`flex justify-between ${r.bold ? 'font-bold text-base border-t border-border pt-2 mt-1' : ''}`}>
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="text-foreground">{r.value}</span>
                    </div>
                  ))}
                </div>
                {pricingModel !== 'cash' && schedule && (
                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
                      <p className="text-xs font-semibold text-foreground">Installment Schedule ({schedule.schedule.length} payments)</p>
                      <p className="text-xs text-muted-foreground">Auto-generated</p>
                    </div>
                    <div className="overflow-x-auto max-h-48">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/20">
                            {['#', 'Due Date', 'Opening Bal.', 'Installment', 'Principal', 'Interest', 'Closing Bal.'].map(h => (
                              <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {schedule.schedule.slice(0, 6).map(row => (
                            <tr key={row.installmentNo} className="hover:bg-muted/20">
                              <td className="px-3 py-1.5 text-muted-foreground">{row.installmentNo}</td>
                              <td className="px-3 py-1.5">{fmtD(row.dueDate)}</td>
                              <td className="px-3 py-1.5">{fmt(row.openingBalance)}</td>
                              <td className="px-3 py-1.5 font-semibold">{fmt(row.installmentAmount)}</td>
                              <td className="px-3 py-1.5 text-blue-600">{fmt(row.principalPortion)}</td>
                              <td className="px-3 py-1.5 text-amber-600">{fmt(row.interestPortion)}</td>
                              <td className="px-3 py-1.5">{fmt(row.closingBalance)}</td>
                            </tr>
                          ))}
                          {schedule.schedule.length > 6 && (
                            <tr><td colSpan={7} className="px-3 py-1.5 text-center text-muted-foreground">+ {schedule.schedule.length - 6} more payments...</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5 max-w-lg mx-auto">
                <div>
                  <h2 className="text-base font-semibold text-foreground mb-1">Payment Details</h2>
                  <p className="text-xs text-muted-foreground">
                    {pricingModel === 'cash' ? `Collecting full payment of ${fmt(totalAmount)}` : `Collecting deposit of ${fmt(parseFloat(depositAmount) || 0)}`}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-2">Payment Method *</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {PAYMENT_METHODS.map(m => (
                      <button key={m.value} onClick={() => setPaymentMethod(m.value)}
                        className={`px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${paymentMethod === m.value ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {errors.paymentMethod && <p className="text-xs text-red-500 mt-1">{errors.paymentMethod}</p>}
                </div>
                {paymentMethod === 'mpesa' && (
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">M-Pesa Transaction Code *</label>
                    <input type="text" value={mpesaRef} onChange={e => setMpesaRef(e.target.value.toUpperCase())} placeholder="e.g. QHX2B3K4L5" className={ic(errors.mpesaRef)} />
                    {errors.mpesaRef && <p className="text-xs text-red-500 mt-0.5">{errors.mpesaRef}</p>}
                    <p className="text-xs text-muted-foreground mt-1">Enter the M-Pesa confirmation code received by the client</p>
                  </div>
                )}
                {paymentMethod === 'bank_transfer' && (
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">Bank Reference / Slip Number *</label>
                    <input type="text" value={bankRef} onChange={e => setBankRef(e.target.value)} placeholder="e.g. BNK-2024-00123" className={ic(errors.bankRef)} />
                    {errors.bankRef && <p className="text-xs text-red-500 mt-0.5">{errors.bankRef}</p>}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Notes (optional)</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                    placeholder="Any additional notes about this transaction..."
                    className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground resize-none" />
                </div>
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Amount to Collect Now</p>
                  <p className="text-2xl font-bold text-foreground">
                    {pricingModel === 'cash' ? fmt(totalAmount) : fmt(parseFloat(depositAmount) || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {pricingModel === 'cash' ? 'Full payment' : 'Deposit only — balance to be paid in installments'}
                  </p>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4 max-w-2xl mx-auto">
                <div>
                  <h2 className="text-base font-semibold text-foreground mb-1">Review & Confirm Sale</h2>
                  <p className="text-xs text-muted-foreground">Verify all details before completing the transaction</p>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Client</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">{selectedClient?.full_name?.[0]}</div>
                    <div>
                      <p className="font-semibold text-foreground">{selectedClient?.full_name}</p>
                      <p className="text-xs text-muted-foreground">{selectedClient?.account_number} · {selectedClient?.phone}</p>
                    </div>
                    <span className="ml-auto text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">✓ KYC Verified</span>
                  </div>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Asset</p>
                  <p className="font-semibold text-foreground">{selectedAsset?.description}</p>
                  <p className="text-xs text-muted-foreground">{selectedAsset?.asset_code} · {selectedAsset?.asset_type}</p>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-2 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Financial Terms</p>
                  {[
                    { label: 'Pricing Model', value: PRICING_MODELS.find(m => m.value === pricingModel)?.label },
                    { label: 'Selling Price', value: fmt(sellingPrice || 0) },
                    discountAmount > 0 && { label: 'Discount Applied', value: `${discountPct}% = -${fmt(discountAmount)}` },
                    vatApplicable && { label: 'VAT (16%)', value: fmt(vatAmount) },
                    { label: 'Total Amount', value: fmt(totalAmount), bold: true },
                    pricingModel !== 'cash' && { label: 'Deposit (Now)', value: fmt(depositAmount || 0), bold: true },
                    pricingModel !== 'cash' && { label: 'Finance Balance', value: fmt(financeBalance) },
                    pricingModel !== 'cash' && schedule && { label: 'Monthly Installment', value: fmt(schedule.summary.monthlyInstallment) },
                    pricingModel !== 'cash' && { label: 'Tenure', value: `${tenureMonths} months` },
                    pricingModel !== 'cash' && { label: 'Interest Rate', value: `${interestRate}% p.a.` },
                    pricingModel !== 'cash' && { label: 'First Due Date', value: fmtD(startDate) },
                    { label: 'Payment Method', value: PAYMENT_METHODS.find(m => m.value === paymentMethod)?.label },
                    (mpesaRef || bankRef) && { label: 'Reference', value: mpesaRef || bankRef },
                  ].filter(Boolean).map(r => (
                    <div key={r.label} className={`flex justify-between ${r.bold ? 'font-bold border-t border-border pt-1 mt-1' : ''}`}>
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="text-foreground text-right">{r.value}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                  ⚠️ By confirming, you acknowledge this transaction will be recorded, the asset status will be updated, and a contract will be generated for the client's e-signature.
                </div>
                {globalError && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                    <Icon name="AlertCircle" size={15} color="currentColor" />
                    {globalError}
                  </div>
                )}
              </div>
            )}

          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/10">
            {step > 1 ? (
              <button onClick={goBack} className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-xl hover:bg-muted transition-all">
                <Icon name="ArrowLeft" size={14} color="currentColor" /> Back
              </button>
            ) : <div />}
            {step < 5 ? (
              <button onClick={goNext}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white rounded-xl transition-all"
                style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
                Next <Icon name="ArrowRight" size={14} color="currentColor" />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-60 transition-all"
                style={{ background: 'linear-gradient(135deg,#059669,#047857)' }}>
                {submitting ? (
                  <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                  </svg> Processing...</>
                ) : <><Icon name="CheckCircle" size={15} color="white" /> Confirm Sale</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default POSModule;
