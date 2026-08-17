import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthScopedLoader } from './useAuthScopedLoader';
import { monthlyInstallmentFor } from './usePOS';

// ─────────────────────────────────────────────────────────────────────────────
// KENYA TAX ENGINE (2025/26)
// ─────────────────────────────────────────────────────────────────────────────
export const calcKenyaTax = (gross) => {
  const bands = [
    { limit: 24000,    rate: 0.10 },
    { limit: 8333,     rate: 0.25 },
    { limit: 467667,   rate: 0.30 },
    { limit: 300000,   rate: 0.325 },
    { limit: Infinity, rate: 0.35 },
  ];
  let paye = 0, remaining = gross;
  for (const band of bands) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, band.limit);
    paye += taxable * band.rate;
    remaining -= taxable;
  }
  paye = Math.max(0, paye - 2400);

  const nssfTierI  = Math.min(gross, 7000) * 0.06;
  const nssfTierII = Math.min(Math.max(gross - 7000, 0), 29000) * 0.06;
  const nssf       = nssfTierI + nssfTierII;
  const shif       = Math.max(gross * 0.0275, 300);
  const housingLevy = gross * 0.015;
  const totalDeductions = paye + nssf + shif + housingLevy;

  return {
    gross,
    paye:            Math.round(paye),
    nssf:            Math.round(nssf),
    shif:            Math.round(shif),
    housingLevy:     Math.round(housingLevy),
    totalDeductions: Math.round(totalDeductions),
    net:             Math.round(gross - totalDeductions),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// JOURNAL HELPERS
//
// journal_entries stores one debit/credit pair per row. A multi-line entry is
// therefore written as the smallest set of pairs that reproduces it exactly:
// each debit is matched off against credits until both sides are exhausted.
// The rows share an entry_no — that is what the ledger groups on — and every
// downstream consumer (statements, auto feed, the summary maths) keeps reading
// plain debit_account / credit_account pairs, unchanged.
// ─────────────────────────────────────────────────────────────────────────────
export const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

export const pairJournalLines = (lines) => {
  const debits  = lines.filter(l => round2(l.debit)  > 0).map(l => ({ account: l.account, left: round2(l.debit)  }));
  const credits = lines.filter(l => round2(l.credit) > 0).map(l => ({ account: l.account, left: round2(l.credit) }));
  const pairs = [];
  let i = 0, j = 0;
  while (i < debits.length && j < credits.length) {
    const amount = round2(Math.min(debits[i].left, credits[j].left));
    if (amount <= 0) break;                       // never spin on a zero-value line
    pairs.push({ debit_account: debits[i].account, credit_account: credits[j].account, amount });
    debits[i].left  = round2(debits[i].left  - amount);
    credits[j].left = round2(credits[j].left - amount);
    if (debits[i].left  <= 0) i += 1;
    if (credits[j].left <= 0) j += 1;
  }
  return pairs;
};

const nextEntryNo = (date) =>
  `JE-${String(date).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER LABELS
// ─────────────────────────────────────────────────────────────────────────────
export const TRIGGER_LABELS = {
  cash_sale_completed:            { label: 'Cash Sale',           icon: '💵', color: 'emerald' },
  vat_on_cash_sale:               { label: 'VAT on Sale',         icon: '🏛️', color: 'blue'   },
  cogs_on_sale:                   { label: 'COGS',                icon: '📦', color: 'orange' },
  installment_deposit_received:   { label: 'HP Deposit',          icon: '🏦', color: 'blue'   },
  installment_receivable_created: { label: 'HP Receivable',       icon: '📋', color: 'violet' },
  installment_payment_received:   { label: 'Installment Payment', icon: '💳', color: 'emerald'},
  interest_income_recognised:     { label: 'Interest Income',     icon: '📈', color: 'green'  },
  late_payment_penalty:           { label: 'Penalty',             icon: '⚠️', color: 'red'    },
  payroll_processed:              { label: 'Payroll',             icon: '👥', color: 'blue'   },
  paye_payable:                   { label: 'PAYE',                icon: '🏛️', color: 'red'    },
  nssf_payable:                   { label: 'NSSF',                icon: '🏛️', color: 'orange' },
  shif_payable:                   { label: 'SHIF',                icon: '🏛️', color: 'orange' },
  overpayment_wallet_credit:      { label: 'Overpayment Credit',  icon: '💰', color: 'blue'   },
  refund_issued:                  { label: 'Refund',              icon: '↩️', color: 'amber'  },
  payment_received:               { label: 'Payment',             icon: '💳', color: 'emerald'},
  commission_earned:              { label: 'Commission',          icon: '🤝', color: 'purple' },
};

export const DEFAULT_COA = [];

// ─────────────────────────────────────────────────────────────────────────────
// POS PLAN TERMS
//
// The hire-purchase terms a POS sale carries, restated in the shape the invoice
// renders: what the client pays each month and over how long. `firstInstallment`
// is row 1 of the sale's amortised schedule when it exists — that row is what
// the collections hub actually bills against, so it wins over the formula.
// ─────────────────────────────────────────────────────────────────────────────
export const buildSalePlan = (sale, firstInstallment = null) => {
  if (!sale) return null;
  const tenure = parseInt(sale.tenure_months, 10) || 0;
  if (tenure <= 0 || sale.pricing_model === 'cash') return null;

  const financed = parseFloat(sale.finance_balance || 0);
  const deposit  = parseFloat(sale.deposit_amount  || 0);
  const monthly  = firstInstallment
    ? parseFloat(firstInstallment.installment_amount || 0)
    : monthlyInstallmentFor({
        financed,
        annualInterestRate: sale.interest_rate,
        tenureMonths:       tenure,
      });

  // The schedule's own first due date is the truth; `payment_start_date` is the
  // date the plan was set up against and only stands in when rows are missing.
  const startDate = firstInstallment?.due_date || sale.payment_start_date || null;
  let finalDue = null;
  if (startDate) {
    const d = new Date(startDate);
    if (!Number.isNaN(d.getTime())) {
      d.setMonth(d.getMonth() + (tenure - 1));
      finalDue = d.toISOString().split('T')[0];
    }
  }

  return {
    sale_id:             sale.id,
    sale_invoice_no:     sale.invoice_number || '',
    pricing_model:       sale.pricing_model,
    tenure_months:       tenure,
    monthly_installment: round2(monthly),
    deposit,
    financed,
    interest_rate:       parseFloat(sale.interest_rate || 0),
    start_date:          startDate,
    final_due_date:      finalDue,
    plan_total:          round2(deposit + monthly * tenure),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────
export const useFinanceHub = () => {
  const [adminId,          setAdminId]          = useState(null);
  const [companyProfile,   setCompanyProfile]   = useState(null);
  const [invoices,         setInvoices]         = useState([]);
  const [journalEntries,   setJournalEntries]   = useState([]);
  const [automatedEntries, setAutomatedEntries] = useState([]);
  const [payrollRecords,   setPayrollRecords]   = useState([]);
  const [employees,        setEmployees]        = useState([]);
  const [clients,          setClients]          = useState([]);
  const [assets,           setAssets]           = useState([]);
  const [chartOfAccounts,  setChartOfAccounts]  = useState([]);
  const [financialSummary, setFinancialSummary] = useState({
    totalRevenue: 0, totalExpenses: 0, netProfit: 0,
    totalAssets: 0, totalLiabilities: 0, equity: 0,
    totalInterestIncome: 0, totalPenaltyIncome: 0,
    totalCOGS: 0, grossProfit: 0, grossMargin: 0,
    totalSalaries: 0, pendingInvoices: 0, overdueInvoices: 0,
    outputVAT: 0, inputVAT: 0, netVAT: 0,
    cashFromOperations: 0, cashFromInvesting: 0, cashFromFinancing: 0,
    openingCash: 0, closingCash: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Keep adminId in a ref so all callbacks always have the latest value
  const adminIdRef = useRef(null);
  useEffect(() => { adminIdRef.current = adminId; }, [adminId]);

  // ── Resolve admin ID ─────────────────────────────────────────────────────────
  const resolveAdminId = useCallback(async () => {
    // getSession() reads the locally persisted session (refreshing it if
    // expired) instead of getUser()'s network round-trip, which returned
    // null on transient network failures or token-refresh races and made
    // the page show "Not authenticated" for logged-in users.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('Not authenticated');
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, role, admin_id')
      .eq('id', user.id)
      .maybeSingle();
    return profile?.role === 'admin' ? user.id : (profile?.admin_id || user.id);
  }, []);

  // ── Fetch helpers ────────────────────────────────────────────────────────────
  const fetchCompanyProfile = useCallback(async (aId) => {
    try {
      const { data } = await supabase.from('company_profiles').select('*').eq('admin_id', aId).maybeSingle();
      setCompanyProfile(data);
    } catch { setCompanyProfile(null); }
  }, []);

  const fetchCOA = useCallback(async (aId) => {
    const { data } = await supabase
      .from('chart_of_accounts').select('*').eq('admin_id', aId).order('account_code');
    setChartOfAccounts(data || []);
    return data || [];
  }, []);

  // Invoices raised by hand in the Finance Hub (company_invoices + line items).
  // These are real records — unlike the payment-derived ones below, which only
  // ever describe money already received.
  const fetchManualInvoices = useCallback(async (aId) => {
    const { data, error: iErr } = await supabase
      .from('company_invoices')
      .select('*, items:company_invoice_items(id, description, quantity, unit_price, line_total, sort_order)')
      .eq('admin_id', aId)
      .order('issue_date', { ascending: false })
      .order('created_at',  { ascending: false })
      .limit(300);
    if (iErr) throw iErr;

    const today = new Date().toISOString().split('T')[0];
    return (data || []).map(inv => {
      const items = [...(inv.items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      // Persisted status stays 'pending'; overdue is a function of the due date
      // so it flips on its own the morning after the invoice falls due.
      const status = inv.status === 'pending' && inv.due_date && inv.due_date < today
        ? 'overdue'
        : inv.status;
      return {
        id:           inv.id,
        source:       'manual',
        invoice_no:   inv.invoice_no,
        date:         inv.issue_date,
        due_date:     inv.due_date,
        client_id:    inv.client_id,
        client_name:  inv.client_name  || 'Unknown',
        client_email: inv.client_email || '',
        client_phone: inv.client_phone || '',
        account_no:   inv.account_no   || '',
        asset:        items[0]?.description || '—',
        asset_code:   '',
        asset_type:   '',
        plate_number: '',
        amount:       parseFloat(inv.subtotal   || 0),
        vat_amount:   parseFloat(inv.vat_amount || 0),
        vat_rate:     parseFloat(inv.vat_rate   || 0),
        total:        parseFloat(inv.total      || 0),
        status,
        method:       inv.payment_method || '—',
        reference:    inv.reference      || '—',
        notes:        inv.notes          || '',
        items,
        plan:         null,   // hand-raised invoices carry no POS plan
        seller:       null,   // …and are headed by the tenant raising them
      };
    });
  }, []);

  // ── POS hire-purchase terms ──────────────────────────────────────────────────
  // A payment on its own says nothing about the plan it belongs to. The POS
  // writes the terms to `sales` (tenure, deposit, rate) and the amortised
  // schedule to `installment_schedules`, so the invoice reads both back and can
  // state what the client pays each month and for how long.
  //
  // Payments link to their sale by invoice number (the POS puts the sale's
  // invoice_number on the deposit as transaction_id); later collections carry a
  // receipt number instead, so those fall back to the client's most recent sale
  // of that asset.
  const fetchSalePlans = useCallback(async (aId, payments) => {
    const clientIds = [...new Set((payments || []).map(p => p.client_id).filter(Boolean))];
    if (clientIds.length === 0) return {};

    const { data: sales, error: sErr } = await supabase
      .from('sales')
      .select('id, invoice_number, client_id, asset_id, pricing_model, selling_price, deposit_amount, finance_balance, interest_rate, tenure_months, payment_start_date, sale_date')
      .eq('admin_id', aId)
      .in('client_id', clientIds)
      .order('sale_date', { ascending: false })
      .limit(500);
    if (sErr) throw sErr;

    // Cash sales have nothing to schedule — only financed plans carry terms.
    const financed = (sales || []).filter(
      s => s.pricing_model !== 'cash' && parseInt(s.tenure_months, 10) > 0
    );
    if (financed.length === 0) return {};

    const byInvoiceNo = {};
    const byClientAsset = {};
    financed.forEach(s => {
      if (s.invoice_number && !byInvoiceNo[s.invoice_number]) byInvoiceNo[s.invoice_number] = s;
      const key = `${s.client_id}|${s.asset_id}`;
      if (!byClientAsset[key]) byClientAsset[key] = s;   // rows arrive newest-first
    });

    // Only the sales actually behind the payments on screen.
    const saleFor = {};
    (payments || []).forEach(p => {
      const sale = (p.transaction_id && byInvoiceNo[p.transaction_id])
        || byClientAsset[`${p.client_id}|${p.asset_id}`];
      if (sale) saleFor[p.id] = sale;
    });
    const saleIds = [...new Set(Object.values(saleFor).map(s => s.id))];
    if (saleIds.length === 0) return {};

    // The schedule is the authority on the monthly figure — it is what the
    // collections hub bills against. The formula below only covers plans whose
    // schedule rows never got written.
    const firstRow = {};
    try {
      const { data: rows } = await supabase
        .from('installment_schedules')
        .select('sale_id, installment_amount, due_date')
        .in('sale_id', saleIds)
        .eq('installment_no', 1);
      (rows || []).forEach(r => { firstRow[r.sale_id] = r; });
    } catch { /* fall through to the computed installment */ }

    const plans = {};
    Object.entries(saleFor).forEach(([paymentId, s]) => {
      const plan = buildSalePlan(s, firstRow[s.id] || null);
      if (plan) plans[paymentId] = plan;
    });
    return plans;
  }, []);

  const fetchInvoices = useCallback(async (aId) => {
    try {
      const { data: payments, error: pErr } = await supabase
        .from('payments')
        .select('id, amount, payment_date, payment_status, transaction_id, reference_number, payment_method, notes, created_at, client_id, asset_id')
        // The tenant's payments, not just the ones this admin keyed in
        // personally — M-Pesa settlements and staff-entered receipts count too.
        .eq('admin_id', aId)
        .order('payment_date', { ascending: false })
        .limit(200);
      if (pErr) throw pErr;

      const clientIds = [...new Set((payments || []).map(p => p.client_id).filter(Boolean))];
      let clientMap = {};
      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from('clients').select('id, full_name, email, account_number, phone').in('id', clientIds);
        (clients || []).forEach(c => { clientMap[c.id] = c; });
      }

      // Pull the linked asset for each payment so invoice line items describe the
      // real asset (make/model/plate/description) instead of a static placeholder.
      const assetIds = [...new Set((payments || []).map(p => p.asset_id).filter(Boolean))];
      let assetMap = {};
      if (assetIds.length > 0) {
        const { data: assets } = await supabase
          .from('assets')
          .select('id, asset_code, description, asset_type, make, model, year, plate_number, admin_id')
          .in('id', assetIds);
        (assets || []).forEach(a => { assetMap[a.id] = a; });
      }

      // The company an invoice is raised under is the one the ASSET belongs to —
      // that is who the client bought from, and whose name, PIN and address the
      // invoice has to be headed with. Assets are tenant-scoped by admin_id, so
      // that id resolves straight to a company profile. Selected with '*' because
      // the optional columns (kra_pin, physical_address) are not on every
      // deployment and naming a missing one would fail the whole read.
      const sellerIds = [...new Set(Object.values(assetMap).map(a => a.admin_id).filter(Boolean))];
      let sellerMap = {};
      if (sellerIds.length > 0) {
        try {
          const { data: sellers } = await supabase
            .from('company_profiles').select('*').in('admin_id', sellerIds);
          (sellers || []).forEach(c => { sellerMap[c.admin_id] = c; });
        } catch { sellerMap = {}; }   // falls back to the hub's own company profile
      }

      // Plan terms are additive: a failure to read them (missing table, RLS)
      // must still leave the invoice list intact, just without the plan block.
      let planMap = {};
      try { planMap = await fetchSalePlans(aId, payments || []); } catch { planMap = {}; }

      const now = new Date();
      const mapped = (payments || []).map((p, i) => {
        const client  = clientMap[p.client_id] || {};
        const asset   = assetMap[p.asset_id]   || null;
        const assetLabel = asset
          ? (asset.description
              || [asset.make, asset.model, asset.year].filter(Boolean).join(' ')
              || asset.asset_code
              || '—')
          : '—';
        const payDate = new Date(p.payment_date || p.created_at);
        const dueDate = new Date(payDate);
        dueDate.setDate(dueDate.getDate() + 30);
        const isOverdue = p.payment_status !== 'completed' && dueDate < now;
        return {
          id:           p.id,
          source:       'payment',
          invoice_no:   `INV-${String(2000 + i).padStart(4, '0')}`,
          date:         p.payment_date || p.created_at,
          due_date:     dueDate.toISOString().split('T')[0],
          client_name:  client.full_name      || 'Unknown',
          client_email: client.email          || '',
          client_phone: client.phone          || '',
          account_no:   client.account_number || '',
          asset:        assetLabel,
          asset_code:   asset?.asset_code || '',
          asset_type:   asset?.asset_type || '',
          plate_number: asset?.plate_number || '',
          amount:       parseFloat(p.amount   || 0),
          vat_amount:   parseFloat(p.amount   || 0) * 0.16,
          vat_rate:     16,
          total:        parseFloat(p.amount   || 0) * 1.16,
          status:       p.payment_status === 'completed' ? 'paid' : isOverdue ? 'overdue' : 'pending',
          method:       p.payment_method   || '—',
          reference:    p.reference_number || '—',
          notes:        p.notes            || '',
          items:        null,
          plan:         planMap[p.id] || null,
          seller:       (asset && sellerMap[asset.admin_id]) || null,
        };
      });

      // Manual invoices are additive: a failure to read them (e.g. the
      // migration not yet applied) must not blank out the payment-derived list.
      let manual = [];
      try { manual = await fetchManualInvoices(aId); } catch { manual = []; }

      const all = [...manual, ...mapped].sort(
        (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
      );
      setInvoices(all);
      return all;
    } catch { setInvoices([]); return []; }
  }, [fetchManualInvoices, fetchSalePlans]);

  const fetchJournalEntries = useCallback(async (aId) => {
    try {
      const { data } = await supabase
        .from('journal_entries').select('*').eq('admin_id', aId)
        .order('entry_date', { ascending: false })
        .order('created_at',  { ascending: false }).limit(500);
      const all = data || [];
      setJournalEntries(all.filter(j => !j.is_automated));
      setAutomatedEntries(all.filter(j =>  j.is_automated));
      return all;
    } catch { setJournalEntries([]); setAutomatedEntries([]); return []; }
  }, []);

  const fetchPayrollRecords = useCallback(async (aId) => {
    try {
      const { data } = await supabase
        .from('payroll_records')
        .select('*, employee:user_profiles(full_name, email, department)')
        .eq('admin_id', aId).order('pay_month', { ascending: false }).limit(200);
      setPayrollRecords(data || []);
    } catch { setPayrollRecords([]); }
  }, []);

  // Bill-to list + sellable assets for the "New Invoice" form.
  const fetchClients = useCallback(async (aId) => {
    try {
      const { data } = await supabase
        .from('clients')
        .select('id, full_name, email, phone, account_number')
        .eq('admin_id', aId)
        .order('full_name');
      setClients(data || []);
    } catch { setClients([]); }
  }, []);

  const fetchAssets = useCallback(async (aId) => {
    try {
      // assets.admin_id names the owning tenant directly, so the old
      // "registered by the admin or anyone under them" expansion is gone:
      // staff-registered assets carry the same admin_id as the admin's own.
      const { data } = await supabase
        .from('assets')
        .select('id, asset_code, description, asset_type, make, model, year, plate_number, selling_price, linked_client_id')
        .eq('admin_id', aId)
        .order('created_at', { ascending: false })
        .limit(500);
      setAssets(data || []);
    } catch { setAssets([]); }
  }, []);

  const fetchEmployees = useCallback(async (aId) => {
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('id, full_name, email, role, department, phone, is_active')
        .eq('admin_id', aId).eq('is_active', true)
        .not('role', 'in', '("client","admin","super_admin")');
      setEmployees(data || []);
    } catch { setEmployees([]); }
  }, []);

  const computeSummary = useCallback((journals, invoiceList) => {
    const posted = journals.filter(j => j.status === 'posted');

    const sum = (fn) => posted.filter(fn).reduce((s, j) => s + parseFloat(j.amount || 0), 0);

    const totalRevenue        = sum(j => (j.credit_account||'').match(/Sales Revenue|Interest Income|Penalty|Commission Income|Other Income|^6/));
    const totalInterestIncome = sum(j => (j.credit_account||'').includes('Interest Income'));
    const totalPenaltyIncome  = sum(j => (j.credit_account||'').includes('Penalty'));
    const totalCOGS           = sum(j => (j.debit_account||'').match(/Cost of Assets|COGS|^7/));
    const totalSalaries       = sum(j => (j.debit_account||'').match(/Salari|^8000/));
    const totalExpenses       = sum(j => (j.debit_account||'').match(/^7|^8|Expense|Cost/));
    const outputVAT           = sum(j => (j.credit_account||'').includes('VAT') || j.trigger_event === 'vat_on_cash_sale');

    const grossProfit  = totalRevenue - totalCOGS;
    const grossMargin  = totalRevenue > 0 ? parseFloat(((grossProfit / totalRevenue) * 100).toFixed(1)) : 0;
    const netProfit    = totalRevenue - totalExpenses;
    const inputVAT     = outputVAT * 0.4;
    const netVAT       = outputVAT - inputVAT;

    const cashDebits  = sum(j => (j.debit_account||'').match(/Cash|M-Pesa|Bank/));
    const cashCredits = sum(j => (j.credit_account||'').match(/Cash|M-Pesa|Bank/));
    const netCash     = Math.max(cashDebits - cashCredits, 0);

    const totalAssets      = Math.max(netCash + totalRevenue * 0.3, 0);
    const totalLiabilities = Math.max(totalExpenses * 0.25, 0);
    const equity           = totalAssets - totalLiabilities;
    const cashFromOperations = netProfit + totalCOGS * 0.05;
    const cashFromInvesting  = -(totalAssets * 0.1);
    const openingCash        = Math.max(netCash * 0.6, 0);
    const closingCash        = openingCash + cashFromOperations + cashFromInvesting;

    setFinancialSummary({
      totalRevenue, totalExpenses, netProfit,
      totalAssets, totalLiabilities, equity,
      totalInterestIncome, totalPenaltyIncome,
      totalCOGS, grossProfit, grossMargin, totalSalaries,
      pendingInvoices: (invoiceList||[]).filter(i => i.status === 'pending').length,
      overdueInvoices: (invoiceList||[]).filter(i => i.status === 'overdue').length,
      outputVAT, inputVAT, netVAT,
      cashFromOperations, cashFromInvesting, cashFromFinancing: 0,
      openingCash, closingCash,
    });
  }, []);

  // ── Load All ─────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const aId = await resolveAdminId();
      setAdminId(aId);
      adminIdRef.current = aId;

      const [invList, journals] = await Promise.all([
        fetchInvoices(aId),
        fetchJournalEntries(aId),
        fetchPayrollRecords(aId),
        fetchEmployees(aId),
        fetchCompanyProfile(aId),
        fetchCOA(aId),
        fetchClients(aId),
        fetchAssets(aId),
      ]);
      computeSummary(journals, invList);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [resolveAdminId, fetchInvoices, fetchJournalEntries, fetchPayrollRecords,
      fetchEmployees, fetchCompanyProfile, fetchCOA, fetchClients, fetchAssets,
      computeSummary]);

  // Finance Hub holds an entire company's books, so nothing may survive a
  // change of signed-in user — including adminId itself, which is the tenant
  // every fetch and every realtime channel here is keyed on.
  const resetState = useCallback(() => {
    setAdminId(null);
    setCompanyProfile(null);
    setInvoices([]);
    setJournalEntries([]);
    setAutomatedEntries([]);
    setPayrollRecords([]);
    setEmployees([]);
    setClients([]);
    setAssets([]);
    setChartOfAccounts([]);
    setFinancialSummary({
      totalRevenue: 0, totalExpenses: 0, netProfit: 0,
      totalAssets: 0, totalLiabilities: 0, equity: 0,
      totalInterestIncome: 0, totalPenaltyIncome: 0,
      totalCOGS: 0, grossProfit: 0, grossMargin: 0,
      totalSalaries: 0, pendingInvoices: 0, overdueInvoices: 0,
      outputVAT: 0, inputVAT: 0, netVAT: 0,
      cashFromOperations: 0, cashFromInvesting: 0, cashFromFinancing: 0,
      openingCash: 0, closingCash: 0,
    });
    setLoading(true);
    setError(null);
  }, []);

  useAuthScopedLoader(loadAll, resetState);

  // Real-time journal updates
  useEffect(() => {
    if (!adminId) return;
    const ch = supabase
      .channel(`fh_${adminId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'journal_entries', filter: `admin_id=eq.${adminId}` },
        async () => {
          const journals = await fetchJournalEntries(adminId);
          const invs     = await fetchInvoices(adminId);
          computeSummary(journals, invs);
        })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [adminId, fetchJournalEntries, fetchInvoices, computeSummary]);

  // ── Mutations — all use adminIdRef.current so they always have the live value ─
  const addAccountToCOA = useCallback(async (accountData) => {
    const aId = adminIdRef.current;
    if (!aId) throw new Error('Not ready');
    const { description: _desc, ...cleanData } = accountData;
const { data, error: err } = await supabase
  .from('chart_of_accounts')
  .insert({ ...cleanData, admin_id: aId })
  .select().maybeSingle();
    if (err) throw err;
    setChartOfAccounts(prev =>
      [...prev, data].sort((a, b) => a.account_code.localeCompare(b.account_code))
    );
    return data;
  }, []);

  const toggleAccountStatus = useCallback(async (accountId, isActive) => {
    const { error: err } = await supabase
      .from('chart_of_accounts').update({ is_active: isActive }).eq('id', accountId);
    if (err) throw err;
    setChartOfAccounts(prev => prev.map(a => a.id === accountId ? { ...a, is_active: isActive } : a));
  }, []);

  // ── Journal ──────────────────────────────────────────────────────────────────
  const refreshLedger = useCallback(async (aId) => {
    const journals = await fetchJournalEntries(aId);
    const invs     = await fetchInvoices(aId);
    computeSummary(journals, invs);
  }, [fetchJournalEntries, fetchInvoices, computeSummary]);

  const postJournalEntry = useCallback(async (entry) => {
    const aId = adminIdRef.current;
    if (!aId) throw new Error('Not ready');

    const date        = entry.date || new Date().toISOString().split('T')[0];
    const description = (entry.description || '').trim();
    if (!description) throw new Error('Describe what the entry is for');

    const lines = (entry.lines || [])
      .map(l => ({
        account: (l.account || '').trim(),
        debit:   round2(l.debit),
        credit:  round2(l.credit),
      }))
      .filter(l => l.account && (l.debit > 0 || l.credit > 0));

    const totalDr = round2(lines.reduce((s, l) => s + l.debit,  0));
    const totalCr = round2(lines.reduce((s, l) => s + l.credit, 0));
    if (totalDr <= 0 || totalCr <= 0) throw new Error('An entry needs at least one debit and one credit line');
    if (totalDr !== totalCr) {
      throw new Error(`Out of balance by ${Math.abs(totalDr - totalCr).toLocaleString('en-KE')} — debits must equal credits`);
    }

    const pairs = pairJournalLines(lines);
    if (pairs.length === 0) throw new Error('Nothing to post');

    const { data: { session } } = await supabase.auth.getSession();
    const entryNo = entry.entryNo || nextEntryNo(date);

    const { data, error: err } = await supabase
      .from('journal_entries')
      .insert(pairs.map(p => ({
        admin_id:       aId,
        entry_no:       entryNo,
        entry_date:     date,
        description,
        debit_account:  p.debit_account,
        credit_account: p.credit_account,
        amount:         p.amount,
        entry_type:     entry.entryType || 'general',
        reference:      (entry.reference || '').trim() || null,
        status:         'posted',
        is_automated:   false,
        period_month:   date.slice(0, 7),
        posted_by:      session?.user?.id || null,
      })))
      .select();
    if (err) throw err;
    await refreshLedger(aId);
    return data;
  }, [refreshLedger]);

  // Kept for the single debit/credit callers — one pair is just a two-line entry.
  const createJournalEntry = useCallback((entryData) => postJournalEntry({
    date:        entryData.date,
    description: entryData.description,
    entryType:   entryData.entryType,
    reference:   entryData.reference,
    lines: [
      { account: entryData.debitAccount,  debit:  entryData.amount },
      { account: entryData.creditAccount, credit: entryData.amount },
    ],
  }), [postJournalEntry]);

  // Corrections are reversals, never edits: the original stays in the ledger
  // marked 'reversed' and a mirrored entry is posted against it. Neither counts
  // towards the statements (which sum status = 'posted'), so the pair nets out.
  const reverseJournalEntry = useCallback(async (rows, reason) => {
    const aId = adminIdRef.current;
    if (!aId) throw new Error('Not ready');

    const live = (Array.isArray(rows) ? rows : [rows])
      .filter(r => r.status !== 'reversed' && r.status !== 'reversal');
    if (live.length === 0) throw new Error('This entry has already been reversed');

    const date = new Date().toISOString().split('T')[0];
    const { data: { session } } = await supabase.auth.getSession();
    const userId    = session?.user?.id || null;
    const originNo  = live[0].entry_no || `JE-${live[0].id.slice(0, 8).toUpperCase()}`;
    const reversalNo = `REV-${originNo.replace(/^JE-/, '')}`;

    const { error: insErr } = await supabase
      .from('journal_entries')
      .insert(live.map(r => ({
        admin_id:       aId,
        entry_no:       reversalNo,
        entry_date:     date,
        description:    `Reversal of ${originNo} — ${r.description}${reason ? ` (${reason})` : ''}`.slice(0, 500),
        debit_account:  r.credit_account,   // mirrored
        credit_account: r.debit_account,
        amount:         parseFloat(r.amount),
        entry_type:     r.entry_type || 'general',
        reference:      r.reference || null,
        status:         'reversal',
        is_automated:   false,
        period_month:   date.slice(0, 7),
        posted_by:      userId,
        reversal_of:    r.id,
      })));
    if (insErr) throw insErr;

    const { error: updErr } = await supabase
      .from('journal_entries')
      .update({ status: 'reversed', reversed_by: userId })
      .in('id', live.map(r => r.id));
    if (updErr) throw updErr;

    await refreshLedger(aId);
  }, [refreshLedger]);

  // ── Invoices ─────────────────────────────────────────────────────────────────
  // Next number in this tenant's manual series (INV-0001, INV-0002, …). The
  // payment-derived list starts at INV-2000, so the two never collide.
  const nextInvoiceNo = useCallback(async (aId) => {
    const { data } = await supabase
      .from('company_invoices')
      .select('invoice_no')
      .eq('admin_id', aId);
    const highest = (data || []).reduce((max, r) => {
      const n = parseInt(String(r.invoice_no).replace(/\D/g, ''), 10);
      return Number.isFinite(n) && n < 2000 && n > max ? n : max;
    }, 0);
    return `INV-${String(highest + 1).padStart(4, '0')}`;
  }, []);

  const createInvoice = useCallback(async (form) => {
    const aId = adminIdRef.current;
    if (!aId) throw new Error('Not ready');

    const items = (form.items || [])
      .filter(it => it.description?.trim())
      .map((it, idx) => {
        const qty  = parseFloat(it.quantity   || 0);
        const unit = parseFloat(it.unit_price || 0);
        return {
          description: it.description.trim(),
          quantity:    qty,
          unit_price:  unit,
          line_total:  Math.round(qty * unit * 100) / 100,
          sort_order:  idx,
        };
      });
    if (items.length === 0) throw new Error('Add at least one line item');

    const subtotal  = items.reduce((s, it) => s + it.line_total, 0);
    const vatRate   = parseFloat(form.vat_rate || 0);
    const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;

    const { data: { session } } = await supabase.auth.getSession();

    const header = {
      admin_id:       aId,
      client_id:      form.client_id || null,
      client_name:    form.client_name  || null,
      client_email:   form.client_email || null,
      client_phone:   form.client_phone || null,
      account_no:     form.account_no   || null,
      asset_id:       form.asset_id     || null,
      issue_date:     form.issue_date   || new Date().toISOString().split('T')[0],
      due_date:       form.due_date     || null,
      subtotal,
      vat_rate:       vatRate,
      vat_amount:     vatAmount,
      total:          Math.round((subtotal + vatAmount) * 100) / 100,
      status:         form.status         || 'pending',
      payment_method: form.payment_method || null,
      reference:      form.reference      || null,
      notes:          form.notes          || null,
      created_by:     session?.user?.id   || null,
    };

    // The invoice number is unique per tenant, so two staff saving at the same
    // moment can collide — take the next free number and retry.
    let invoice = null;
    for (let attempt = 0; attempt < 4 && !invoice; attempt++) {
      const invoice_no = await nextInvoiceNo(aId);
      const { data, error: err } = await supabase
        .from('company_invoices')
        .insert({ ...header, invoice_no })
        .select().maybeSingle();
      if (!err) { invoice = data; break; }
      if (err.code !== '23505') throw err;
    }
    if (!invoice) throw new Error('Could not allocate an invoice number — please try again');

    const { error: itemErr } = await supabase
      .from('company_invoice_items')
      .insert(items.map(it => ({ ...it, invoice_id: invoice.id, admin_id: aId })));
    if (itemErr) {
      // Never leave a header with no lines behind.
      await supabase.from('company_invoices').delete().eq('id', invoice.id);
      throw itemErr;
    }

    const invs = await fetchInvoices(aId);
    computeSummary(await fetchJournalEntries(aId), invs);
    return invoice;
  }, [nextInvoiceNo, fetchInvoices, fetchJournalEntries, computeSummary]);

  const updateInvoiceStatus = useCallback(async (invoiceId, status) => {
    const aId = adminIdRef.current;
    const { error: err } = await supabase
      .from('company_invoices')
      .update({ status, paid_at: status === 'paid' ? new Date().toISOString() : null })
      .eq('id', invoiceId);
    if (err) throw err;
    const invs = await fetchInvoices(aId);
    computeSummary(await fetchJournalEntries(aId), invs);
  }, [fetchInvoices, fetchJournalEntries, computeSummary]);

  const deleteInvoice = useCallback(async (invoiceId) => {
    const aId = adminIdRef.current;
    const { error: err } = await supabase.from('company_invoices').delete().eq('id', invoiceId);
    if (err) throw err;
    const invs = await fetchInvoices(aId);
    computeSummary(await fetchJournalEntries(aId), invs);
  }, [fetchInvoices, fetchJournalEntries, computeSummary]);

  const runPayroll = useCallback(async (employeeId, grossSalary, payMonth) => {
    const aId = adminIdRef.current;
    if (!aId) throw new Error('Not ready');
    const tax = calcKenyaTax(parseFloat(grossSalary));
    const { data, error: err } = await supabase
      .from('payroll_records')
      .insert({
        admin_id:         aId,
        employee_id:      employeeId,
        pay_month:        payMonth,
        gross_salary:     tax.gross,
        paye:             tax.paye,
        nssf:             tax.nssf,
        shif:             tax.shif,
        total_deductions: tax.totalDeductions,
        net_salary:       tax.net,
        status:           'pending',
      })
      .select().maybeSingle();
    if (err) throw err;
    await fetchPayrollRecords(aId);
    return { ...data, ...tax };
  }, [fetchPayrollRecords]);

  const approvePayroll = useCallback(async (payrollId) => {
    const aId = adminIdRef.current;
    const { error: err } = await supabase
      .from('payroll_records')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', payrollId);
    if (err) throw err;
    await Promise.all([fetchPayrollRecords(aId), fetchJournalEntries(aId)]);
  }, [fetchPayrollRecords, fetchJournalEntries]);

  return {
    adminId,
    companyProfile,
    invoices,
    journalEntries,
    automatedEntries,
    chartOfAccounts,
    payrollRecords,
    employees,
    clients,
    assets,
    financialSummary,
    loading,
    error,
    addAccountToCOA,
    toggleAccountStatus,
    createJournalEntry,
    postJournalEntry,
    reverseJournalEntry,
    createInvoice,
    updateInvoiceStatus,
    deleteInvoice,
    runPayroll,
    approvePayroll,
    refetch: loadAll,
    TRIGGER_LABELS,
    DEFAULT_COA,
  };
};

export default useFinanceHub;
