import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

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
    const { data: { user } } = await supabase.auth.getUser();
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

  const fetchInvoices = useCallback(async (aId) => {
    try {
      const { data: payments, error: pErr } = await supabase
        .from('payments')
        .select('id, amount, payment_date, payment_status, transaction_id, reference_number, payment_method, notes, created_at, client_id')
        .eq('processed_by', aId)
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

      const now = new Date();
      const mapped = (payments || []).map((p, i) => {
        const client  = clientMap[p.client_id] || {};
        const payDate = new Date(p.payment_date || p.created_at);
        const dueDate = new Date(payDate);
        dueDate.setDate(dueDate.getDate() + 30);
        const isOverdue = p.payment_status !== 'completed' && dueDate < now;
        return {
          id:           p.id,
          invoice_no:   `INV-${String(2000 + i).padStart(4, '0')}`,
          date:         p.payment_date || p.created_at,
          due_date:     dueDate.toISOString().split('T')[0],
          client_name:  client.full_name      || 'Unknown',
          client_email: client.email          || '',
          client_phone: client.phone          || '',
          account_no:   client.account_number || '',
          asset:        '—',
          amount:       parseFloat(p.amount   || 0),
          vat_amount:   parseFloat(p.amount   || 0) * 0.16,
          status:       p.payment_status === 'completed' ? 'paid' : isOverdue ? 'overdue' : 'pending',
          method:       p.payment_method   || '—',
          reference:    p.reference_number || '—',
          notes:        p.notes            || '',
        };
      });
      setInvoices(mapped);
      return mapped;
    } catch { setInvoices([]); return []; }
  }, []);

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
      ]);
      computeSummary(journals, invList);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [resolveAdminId, fetchInvoices, fetchJournalEntries, fetchPayrollRecords,
      fetchEmployees, fetchCompanyProfile, fetchCOA, computeSummary]);

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const createJournalEntry = useCallback(async (entryData) => {
    const aId = adminIdRef.current;
    if (!aId) throw new Error('Not ready');
    const { data, error: err } = await supabase
      .from('journal_entries')
      .insert({
        admin_id:       aId,
        entry_date:     entryData.date || new Date().toISOString().split('T')[0],
        description:    entryData.description,
        debit_account:  entryData.debitAccount,
        credit_account: entryData.creditAccount,
        amount:         parseFloat(entryData.amount),
        entry_type:     entryData.entryType || 'general',
        reference:      entryData.reference || null,
        status:         'posted',
        is_automated:   false,
      })
      .select().maybeSingle();
    if (err) throw err;
    const journals = await fetchJournalEntries(aId);
    const invs     = await fetchInvoices(aId);
    computeSummary(journals, invs);
    return data;
  }, [fetchJournalEntries, fetchInvoices, computeSummary]);

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
    financialSummary,
    loading,
    error,
    addAccountToCOA,
    toggleAccountStatus,
    createJournalEntry,
    runPayroll,
    approvePayroll,
    refetch: loadAll,
    TRIGGER_LABELS,
    DEFAULT_COA,
  };
};

export default useFinanceHub;
