import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { processPayment, getWalletBalance } from '../../../utils/paymentAllocationEngine';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => `KES ${(parseFloat(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const ic = (err) =>
  `w-full px-3 py-2.5 text-sm bg-background border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground transition-colors ${
    err ? 'border-red-400 bg-red-50' : 'border-border'
  }`;

// ── Scenario badge ────────────────────────────────────────────────────────────
const ScenarioBadge = ({ scenario }) => {
  const map = {
    exact:       { label: 'Exact Payment',  color: 'bg-emerald-100 text-emerald-700', icon: 'CheckCircle' },
    overpayment: { label: 'Overpayment',    color: 'bg-blue-100 text-blue-700',       icon: 'TrendingUp'  },
    underpayment:{ label: 'Underpayment',   color: 'bg-amber-100 text-amber-700',     icon: 'AlertTriangle'},
    duplicate:   { label: 'Duplicate ⚠️',   color: 'bg-red-100 text-red-700',         icon: 'AlertCircle' },
  };
  const cfg = map[scenario] || map.exact;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
      <Icon name={cfg.icon} size={12} color="currentColor" />
      {cfg.label}
    </span>
  );
};

// ── Payment result popup ──────────────────────────────────────────────────────
const PaymentResultModal = ({ result, onClose }) => {
  const colors = {
    exact:       'from-emerald-600 to-emerald-700',
    overpayment: 'from-blue-600 to-blue-700',
    underpayment:'from-amber-500 to-amber-600',
    duplicate:   'from-red-500 to-red-600',
  };
  const icons = {
    exact: 'CheckCircle', overpayment: 'TrendingUp',
    underpayment: 'AlertTriangle', duplicate: 'AlertCircle',
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className={`bg-gradient-to-r ${colors[result.scenario] || colors.exact} px-6 py-5 text-center`}>
          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
            <Icon name={icons[result.scenario] || 'CheckCircle'} size={28} color="white" />
          </div>
          <h3 className="text-2xl font-bold text-white">
            {result.scenario === 'exact'        ? 'Payment Received!' :
             result.scenario === 'overpayment'  ? 'Overpayment Processed!' :
             result.scenario === 'underpayment' ? 'Partial Payment Recorded' :
             'Duplicate Payment Flagged'}
          </h3>
          <p className="text-sm text-white/80 mt-1">{result.receiptNumber}</p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-3">
          <p className="text-sm text-foreground">{result.message}</p>

          <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-sm">
            {[
              { label: 'Amount Paid',     value: fmt(result.amountPaid),        show: true },
              { label: 'Penalty Paid',    value: fmt(result.penaltyPaid),       show: result.penaltyPaid > 0 },
              { label: 'Interest Paid',   value: fmt(result.interestPaid),      show: result.interestPaid > 0 },
              { label: 'Principal Paid',  value: fmt(result.principalPaid),     show: result.principalPaid > 0 },
              { label: 'Overpayment → Wallet', value: fmt(result.overpaymentAmount), show: result.overpaymentAmount > 0, highlight: true },
              { label: 'Underpayment Remaining', value: fmt(result.underpaymentAmount), show: result.underpaymentAmount > 0, warn: true },
              { label: 'Wallet Balance',  value: fmt(result.walletBalance),     show: result.walletBalance > 0 },
            ].filter(r => r.show).map(r => (
              <div key={r.label} className={`flex justify-between ${r.highlight ? 'font-bold text-blue-600' : r.warn ? 'font-semibold text-amber-600' : ''}`}>
                <span className="text-muted-foreground">{r.label}</span>
                <span>{r.value}</span>
              </div>
            ))}
          </div>

          {/* Overpayment notice */}
          {result.overpaymentAmount > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
              ℹ️ Excess of {fmt(result.overpaymentAmount)} has been credited to the client's wallet and will be automatically applied to the next installment.
            </div>
          )}

          {/* Underpayment notice */}
          {result.underpaymentAmount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              ⚠️ Installment marked as PARTIAL. Remaining {fmt(result.underpaymentAmount)} must be paid before the grace period expires to avoid penalty.
            </div>
          )}

          {/* Duplicate notice */}
          {result.isDuplicate && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800">
              ❌ This payment reference has been used before. The transaction has been flagged for manual review. Please contact the client within 24 hours.
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <button onClick={() => window.print()}
            className="flex-1 py-2.5 border border-border text-sm font-medium rounded-xl hover:bg-muted transition-colors text-foreground">
            Print Receipt
          </button>
          <button onClick={onClose}
            className="flex-1 py-2.5 text-sm font-semibold text-white rounded-xl transition-all"
            style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const PaymentEntryForm = ({ onSubmit, linkedAssets }) => {
  const [adminId, setAdminId]               = useState(null);
  const [clients, setClients]               = useState([]);
  const [sales, setSales]                   = useState([]);
  const [installments, setInstallments]     = useState([]);
  const [walletInfo, setWalletInfo]         = useState(null);
  const [loading, setLoading]               = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [paymentResult, setPaymentResult]   = useState(null);
  const [errors, setErrors]                 = useState({});

  const [form, setForm] = useState({
    clientId:       '',
    saleId:         '',
    installmentId:  '',
    amount:         '',
    paymentMethod:  'mpesa',
    reference:      '',
    notes:          '',
  });

  // Selected data
  const [selectedClient, setSelectedClient]   = useState(null);
  const [selectedSale, setSelectedSale]       = useState(null);
  const [selectedInstallment, setSelectedInstallment] = useState(null);

  // Live preview
  const [preview, setPreview] = useState(null);

  const PAYMENT_METHODS = [
    { value: 'mpesa',         label: 'M-Pesa' },
    { value: 'cash',          label: 'Cash' },
    { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'card',          label: 'Card' },
    { value: 'cheque',        label: 'Cheque' },
  ];

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const boot = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('user_profiles').select('role, admin_id').eq('id', user.id).single();
      const aId = profile?.role === 'admin' ? user.id : (profile?.admin_id || user.id);
      setAdminId(aId);

      // Fetch clients
      const { data: clientData } = await supabase
        .from('clients')
        .select('id, full_name, account_number, phone')
        .eq('admin_id', aId)
        .eq('kyc_status', 'verified')
        .order('full_name');
      setClients(clientData || []);
    };
    boot();
  }, []);

  // ── When client selected → fetch their active sales ───────────────────────
  const handleClientChange = async (clientId) => {
    setForm(p => ({ ...p, clientId, saleId: '', installmentId: '' }));
    setSelectedClient(clients.find(c => c.id === clientId) || null);
    setSelectedSale(null);
    setSelectedInstallment(null);
    setSales([]);
    setInstallments([]);
    setPreview(null);

    if (!clientId) return;

    // Fetch wallet balance
    const wallet = await getWalletBalance(clientId);
    setWalletInfo(wallet);

    // Fetch active sales for this client
    const { data: salesData } = await supabase
      .from('sales')
      .select('id, invoice_number, pricing_model, total_amount, finance_balance, tenure_months, status')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .order('sale_date', { ascending: false });
    setSales(salesData || []);
  };

  // ── When sale selected → fetch installments ───────────────────────────────
  const handleSaleChange = async (saleId) => {
    setForm(p => ({ ...p, saleId, installmentId: '' }));
    setSelectedSale(sales.find(s => s.id === saleId) || null);
    setSelectedInstallment(null);
    setInstallments([]);
    setPreview(null);

    if (!saleId) return;

    const { data } = await supabase
      .from('installment_schedules')
      .select('*')
      .eq('sale_id', saleId)
      .in('status', ['pending', 'partial', 'overdue'])
      .order('installment_no', { ascending: true });
    setInstallments(data || []);

    // Auto-select first due installment
    if (data?.length > 0) {
      handleInstallmentChange(data[0].id, data[0]);
    }
  };

  // ── When installment selected → build live preview ────────────────────────
  const handleInstallmentChange = (installmentId, inst) => {
    const installment = inst || installments.find(i => i.id === installmentId);
    setForm(p => ({ ...p, installmentId }));
    setSelectedInstallment(installment || null);

    if (installment) {
      // Calculate penalty if overdue
      const daysLate = Math.max(0,
        Math.floor((new Date() - new Date(installment.due_date)) / 86400000) - 7
      );
      const penaltyDue = daysLate > 0
        ? Math.round(installment.installment_amount * 0.02 * (daysLate / 30) * 100) / 100
        : 0;
      const alreadyPaid = parseFloat(installment.amount_paid || 0);
      const remaining = installment.installment_amount - alreadyPaid;
      const totalDue = remaining + penaltyDue;

      setPreview({ installment, daysLate, penaltyDue, alreadyPaid, remaining, totalDue });
      // Pre-fill amount with total due
      setForm(p => ({ ...p, amount: String(Math.round(totalDue)) }));
    }
  };

  // ── Live scenario preview as amount is typed ──────────────────────────────
  const getScenario = () => {
    if (!preview || !form.amount) return null;
    const amount = parseFloat(form.amount) || 0;
    const diff   = amount - preview.totalDue;
    if (Math.abs(diff) < 1)  return { type: 'exact',        color: 'emerald', msg: 'Exact payment — installment will be marked PAID' };
    if (diff > 0)             return { type: 'overpayment',  color: 'blue',    msg: `${fmt(diff)} will be credited to client wallet` };
    if (diff < 0 && amount > 0) return { type: 'underpayment', color: 'amber', msg: `${fmt(Math.abs(diff))} short — installment will be marked PARTIAL` };
    return null;
  };

  const scenario = getScenario();

  // ── Validation ────────────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!form.clientId)       e.clientId     = 'Select a client';
    if (!form.saleId)         e.saleId       = 'Select a sale / account';
    if (!form.installmentId)  e.installmentId= 'Select an installment';
    if (!form.amount || parseFloat(form.amount) <= 0) e.amount = 'Enter a valid amount';
    if (!form.paymentMethod)  e.paymentMethod= 'Select payment method';
    if (form.paymentMethod === 'mpesa' && !form.reference) e.reference = 'M-Pesa reference is required';
    if (form.paymentMethod === 'bank_transfer' && !form.reference) e.reference = 'Bank reference is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const result = await processPayment({
        clientId:          form.clientId,
        saleId:            form.saleId,
        installmentId:     form.installmentId,
        paymentAmount:     parseFloat(form.amount),
        paymentMethod:     form.paymentMethod,
        reference:         form.reference.trim() || null,
        receivedBy:        user?.id,
        notes:             form.notes.trim() || null,
        adminId,
        gracePeriodDays:   7,
        penaltyRateMonthly: 2,
      });

      setPaymentResult(result);

      // Notify parent
      if (onSubmit) onSubmit(result);

    } catch (err) {
      setErrors({ submit: err.message || 'Payment processing failed. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setForm({ clientId: '', saleId: '', installmentId: '', amount: '', paymentMethod: 'mpesa', reference: '', notes: '' });
    setSelectedClient(null); setSelectedSale(null); setSelectedInstallment(null);
    setSales([]); setInstallments([]); setPreview(null); setWalletInfo(null);
    setErrors({}); setPaymentResult(null);
  };

  return (
    <>
      {paymentResult && (
        <PaymentResultModal result={paymentResult} onClose={resetForm} />
      )}

      <div className="bg-card border border-border rounded-xl p-5 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon name="CreditCard" size={18} color="#1A56DB" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Record Installment Payment</h3>
            <p className="text-xs text-muted-foreground"> Auto-allocation: Penalty → Interest → Principal</p>
          </div>
        </div>

        {errors.submit && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <Icon name="AlertCircle" size={15} color="currentColor" /> {errors.submit}
          </div>
        )}

        {/* Step 1: Client */}
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">
            Client Account <span className="text-red-500">*</span>
          </label>
          <select value={form.clientId}
            onChange={e => handleClientChange(e.target.value)}
            className={ic(errors.clientId)}>
            <option value="">Search and select client...</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.full_name} — {c.account_number} ({c.phone})
              </option>
            ))}
          </select>
          {errors.clientId && <p className="text-xs text-red-500 mt-0.5">{errors.clientId}</p>}

          {/* Wallet balance */}
          {walletInfo && walletInfo.balance > 0 && (
            <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
              <Icon name="Wallet" size={13} color="#1A56DB" />
              Client wallet balance: <span className="font-bold ml-1">{fmt(walletInfo.balance)}</span>
              <span className="text-blue-600 ml-1">(will be applied to next installment)</span>
            </div>
          )}
        </div>

        {/* Step 2: Sale */}
        {sales.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Active Sale / Account <span className="text-red-500">*</span>
            </label>
            <select value={form.saleId}
              onChange={e => handleSaleChange(e.target.value)}
              className={ic(errors.saleId)}>
              <option value="">Select sale...</option>
              {sales.map(s => (
                <option key={s.id} value={s.id}>
                  {s.invoice_number} — {s.pricing_model?.replace(/_/g,' ')} — {fmt(s.total_amount)}
                </option>
              ))}
            </select>
            {errors.saleId && <p className="text-xs text-red-500 mt-0.5">{errors.saleId}</p>}
          </div>
        )}

        {/* Step 3: Installment */}
        {installments.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Installment <span className="text-red-500">*</span>
              <span className="text-muted-foreground font-normal ml-1">(auto-selects earliest due)</span>
            </label>
            <select value={form.installmentId}
              onChange={e => handleInstallmentChange(e.target.value)}
              className={ic(errors.installmentId)}>
              {installments.map(inst => (
                <option key={inst.id} value={inst.id}>
                  #{inst.installment_no} — Due: {fmtDate(inst.due_date)} — {fmt(inst.installment_amount)}
                  {inst.status === 'partial' ? ' (PARTIAL)' : ''}
                  {inst.status === 'overdue'  ? ' ⚠️ OVERDUE' : ''}
                </option>
              ))}
            </select>
            {errors.installmentId && <p className="text-xs text-red-500 mt-0.5">{errors.installmentId}</p>}
          </div>
        )}

        {/* Installment breakdown */}
        {preview && (
          <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-2 text-sm">
            <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-2">
              Installment #{preview.installment.installment_no} Breakdown
            </p>
            {[
              { label: 'Installment Amount', value: fmt(preview.installment.installment_amount) },
              preview.alreadyPaid > 0 && { label: 'Already Paid', value: `-${fmt(preview.alreadyPaid)}`, color: 'text-emerald-600' },
              { label: 'Remaining Due', value: fmt(preview.remaining) },
              preview.penaltyDue > 0 && { label: `Penalty (${preview.daysLate} days overdue)`, value: fmt(preview.penaltyDue), color: 'text-red-500' },
              { label: 'Total Due Now', value: fmt(preview.totalDue), bold: true },
            ].filter(Boolean).map(r => (
              <div key={r.label} className={`flex justify-between ${r.bold ? 'font-bold border-t border-border pt-1 mt-1' : ''}`}>
                <span className="text-muted-foreground">{r.label}</span>
                <span className={r.color || 'text-foreground'}>{r.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Step 4: Amount */}
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">
            Payment Amount (KES) <span className="text-red-500">*</span>
          </label>
          <input type="number" value={form.amount}
            onChange={e => {
              setForm(p => ({ ...p, amount: e.target.value }));
              setErrors(p => ({ ...p, amount: '' }));
            }}
            placeholder="Enter amount received"
            className={ic(errors.amount)} />
          {errors.amount && <p className="text-xs text-red-500 mt-0.5">{errors.amount}</p>}

          {/* Live scenario indicator */}
          {scenario && (
            <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium
              ${scenario.type === 'exact'        ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' :
                scenario.type === 'overpayment'  ? 'bg-blue-50 border border-blue-200 text-blue-800' :
                'bg-amber-50 border border-amber-200 text-amber-800'}`}>
              <Icon name={
                scenario.type === 'exact' ? 'CheckCircle' :
                scenario.type === 'overpayment' ? 'TrendingUp' : 'AlertTriangle'
              } size={13} color="currentColor" />
              <span><strong>{scenario.type === 'exact' ? '✓ Exact' : scenario.type === 'overpayment' ? '↑ Overpayment' : '↓ Underpayment'}:</strong> {scenario.msg}</span>
            </div>
          )}
        </div>

        {/* Step 5: Payment Method */}
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">
            Payment Method <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {PAYMENT_METHODS.map(m => (
              <button key={m.value} type="button"
                onClick={() => { setForm(p => ({ ...p, paymentMethod: m.value })); setErrors(p => ({ ...p, paymentMethod: '' })); }}
                className={`px-3 py-2 rounded-xl border-2 text-xs font-medium transition-all ${
                  form.paymentMethod === m.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40'
                }`}>
                {m.label}
              </button>
            ))}
          </div>
          {errors.paymentMethod && <p className="text-xs text-red-500 mt-0.5">{errors.paymentMethod}</p>}
        </div>

        {/* Reference */}
        {(form.paymentMethod === 'mpesa' || form.paymentMethod === 'bank_transfer') && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              {form.paymentMethod === 'mpesa' ? 'M-Pesa Transaction Code' : 'Bank Reference'} <span className="text-red-500">*</span>
            </label>
            <input type="text" value={form.reference}
              onChange={e => { setForm(p => ({ ...p, reference: e.target.value.toUpperCase() })); setErrors(p => ({ ...p, reference: '' })); }}
              placeholder={form.paymentMethod === 'mpesa' ? 'e.g. QHX2B3K4L5' : 'e.g. BNK-2026-001234'}
              className={ic(errors.reference)} />
            {errors.reference && <p className="text-xs text-red-500 mt-0.5">{errors.reference}</p>}
            <p className="text-xs text-muted-foreground mt-0.5">Duplicate references are automatically detected and flagged</p>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1">Notes (optional)</label>
          <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            rows={2} placeholder="Any special circumstances..."
            className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground resize-none" />
        </div>

        {/* Submit */}
        <button onClick={handleSubmit} disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white rounded-xl disabled:opacity-60 transition-all"
          style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
          {submitting ? (
            <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg> Processing Payment...</>
          ) : (
            <><Icon name="CreditCard" size={15} color="white" /> Process Payment</>
          )}
        </button>
      </div>
    </>
  );
};

export default PaymentEntryForm;
