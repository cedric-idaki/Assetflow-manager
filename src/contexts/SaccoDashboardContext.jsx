/**
 * SaccoDashboardContext
 *
 * Mounts the Sacco dashboard's data + realtime once at the app level (above the
 * router, like AdminDashboardProvider) so state survives tab/page navigation.
 * Backs /sacco-dashboard. Every query is scoped to the current sacco_admin via
 * admin_id (RLS also enforces this server-side — see 20260701140000_sacco_schema).
 *
 * The loan approval flow runs the real amortization engine
 * (src/utils/saccoAmortization.js) and persists the schedule to
 * public.sacco_loan_schedule.
 */
import React, {
  createContext, useContext, useState, useEffect, useCallback, useRef,
} from 'react';
import { supabase } from '../lib/supabase';
import { generateSchedule } from '../utils/saccoAmortization';
import { tierForMembers, calculateMonthlyBill } from '../config/saccoTiers';

const SaccoDashboardContext = createContext(null);

const getAdminId = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id;
};

export const SaccoDashboardProvider = ({ children }) => {
  const [sacco,         setSacco]         = useState(null);
  const [members,       setMembers]       = useState([]);
  const [contributions, setContributions] = useState([]);
  const [loanProducts,  setLoanProducts]  = useState([]);
  const [loans,         setLoans]         = useState([]);
  const [schedules,     setSchedules]     = useState([]);
  const [shares,        setShares]        = useState([]);
  const [listings,      setListings]      = useState([]);
  const [transfers,     setTransfers]     = useState([]);
  const [motions,       setMotions]       = useState([]);
  const [votes,         setVotes]         = useState([]);
  const [documents,     setDocuments]     = useState([]);
  const [invoices,      setInvoices]      = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  const channelsRef = useRef([]);
  const hasLoaded   = useRef(false);

  // A friendly display name join used by several member-referencing tables.
  const MEMBER_JOIN = 'member:sacco_members(id, full_name, member_no)';

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const fetchSacco = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('saccos').select('*')
        .eq('admin_id', adminId).order('created_at').limit(1).maybeSingle();
      setSacco(data);
      setConnectionStatus('connected');
    } catch (_) { setConnectionStatus('disconnected'); }
  }, []);

  const fetchMembers = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_members').select('*')
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setMembers(data || []);
    } catch (_) {}
  }, []);

  const fetchContributions = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_contributions')
        .select(`*, ${MEMBER_JOIN}`).eq('admin_id', adminId)
        .order('created_at', { ascending: false });
      setContributions(data || []);
    } catch (_) {}
  }, []);

  const fetchLoanProducts = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_loan_products').select('*')
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setLoanProducts(data || []);
    } catch (_) {}
  }, []);

  const fetchLoans = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_loans')
        .select(`*, ${MEMBER_JOIN}, product:sacco_loan_products(name)`)
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setLoans(data || []);
    } catch (_) {}
  }, []);

  const fetchSchedules = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_loan_schedule').select('*')
        .eq('admin_id', adminId).order('period_no', { ascending: true });
      setSchedules(data || []);
    } catch (_) {}
  }, []);

  const fetchShares = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_shares')
        .select(`*, ${MEMBER_JOIN}`).eq('admin_id', adminId);
      setShares(data || []);
    } catch (_) {}
  }, []);

  const fetchListings = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_share_listings')
        .select('*, seller:sacco_members!seller_member_id(id, full_name, member_no)')
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setListings(data || []);
    } catch (_) {}
  }, []);

  const fetchTransfers = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_share_transfers').select('*')
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setTransfers(data || []);
    } catch (_) {}
  }, []);

  const fetchMotions = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_motions')
        .select('*, proposer:sacco_members!proposer_id(full_name), seconder:sacco_members!seconder_id(full_name)')
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setMotions(data || []);
    } catch (_) {}
  }, []);

  const fetchVotes = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_votes').select('*')
        .eq('admin_id', adminId);
      setVotes(data || []);
    } catch (_) {}
  }, []);

  const fetchDocuments = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_documents').select('*')
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setDocuments(data || []);
    } catch (_) {}
  }, []);

  const fetchInvoices = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_invoices').select('*')
        .eq('admin_id', adminId).order('period', { ascending: false });
      setInvoices(data || []);
    } catch (_) {}
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchSacco(), fetchMembers(), fetchContributions(), fetchLoanProducts(),
      fetchLoans(), fetchSchedules(), fetchShares(), fetchListings(),
      fetchTransfers(), fetchMotions(), fetchVotes(), fetchDocuments(), fetchInvoices(),
    ]);
    hasLoaded.current = true;
    setLoading(false);
  }, [
    fetchSacco, fetchMembers, fetchContributions, fetchLoanProducts, fetchLoans,
    fetchSchedules, fetchShares, fetchListings, fetchTransfers, fetchMotions,
    fetchVotes, fetchDocuments, fetchInvoices,
  ]);

  // ── Derived stats ───────────────────────────────────────────────────────────
  const activeMembers = members.filter((m) => m.status === 'active').length;
  const totalSavings = contributions
    .filter((c) => c.status === 'paid')
    .reduce((s, c) => s + parseFloat(c.amount || 0), 0);
  const activeLoans = loans.filter((l) => l.status === 'active').length;
  const totalShareValue = shares.reduce(
    (s, r) => s + (parseInt(r.shares_held, 10) || 0) * parseFloat(r.par_value || 0), 0);

  const stats = {
    totalMembers: members.length,
    activeMembers,
    totalSavings,
    activeLoans,
    totalShareValue,
    tier: tierForMembers(activeMembers),
    billing: calculateMonthlyBill({ members: activeMembers, storageGb: sacco?.storage_used_gb || 0, tier: sacco?.tier }),
    openMotions: motions.filter((m) => m.status === 'open').length,
  };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saccoId = sacco?.id || null;

  const addMember = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_members').insert({
      admin_id: adminId, sacco_id: saccoId,
      member_no: form.member_no || `M-${Date.now().toString().slice(-6)}`,
      full_name: form.full_name, phone: form.phone || '', email: form.email || '',
      national_id: form.national_id || '', gender: form.gender || null,
      member_role: form.member_role || 'member', status: form.status || 'active',
      kyc_status: form.kyc_status || 'pending',
      next_of_kin_name: form.next_of_kin_name || '', next_of_kin_relationship: form.next_of_kin_relationship || '',
      next_of_kin_phone: form.next_of_kin_phone || '', next_of_kin_id: form.next_of_kin_id || '',
    });
    if (error) throw error;
    await fetchMembers();
  }, [saccoId, fetchMembers]);

  const updateMember = useCallback(async (id, patch) => {
    const { error } = await supabase.from('sacco_members')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await fetchMembers();
  }, [fetchMembers]);

  const recordContribution = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_contributions').insert({
      admin_id: adminId, sacco_id: saccoId, member_id: form.member_id,
      amount: parseFloat(form.amount) || 0,
      contribution_type: form.contribution_type || 'monthly',
      due_date: form.due_date || null,
      paid_date: form.paid_date || new Date().toISOString().slice(0, 10),
      status: form.status || 'paid',
      penalty_amount: parseFloat(form.penalty_amount) || 0,
      reference: form.reference || '', notes: form.notes || '',
    });
    if (error) throw error;
    await fetchContributions();
  }, [saccoId, fetchContributions]);

  const createLoanProduct = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_loan_products').insert({
      admin_id: adminId, sacco_id: saccoId, name: form.name,
      amortization_method: form.amortization_method || 'reducing_balance',
      annual_interest_rate: parseFloat(form.annual_interest_rate) || 12,
      max_term_months: parseInt(form.max_term_months, 10) || 12,
      penalty_rate: parseFloat(form.penalty_rate) || 0,
      is_active: form.is_active !== false,
    });
    if (error) throw error;
    await fetchLoanProducts();
  }, [saccoId, fetchLoanProducts]);

  const createLoan = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_loans').insert({
      admin_id: adminId, sacco_id: saccoId, member_id: form.member_id,
      product_id: form.product_id || null,
      principal: parseFloat(form.principal) || 0,
      annual_interest_rate: parseFloat(form.annual_interest_rate) || 12,
      term_months: parseInt(form.term_months, 10) || 12,
      method: form.method || 'reducing_balance',
      balloon_amount: parseFloat(form.balloon_amount) || 0,
      purpose: form.purpose || '', status: 'pending',
    });
    if (error) throw error;
    await fetchLoans();
  }, [saccoId, fetchLoans]);

  // Approve a loan → run the amortization engine → persist the schedule.
  const approveLoan = useCallback(async (loan) => {
    const adminId = await getAdminId();
    const now = new Date();
    const { schedule } = generateSchedule(loan.method, {
      principal: loan.principal,
      annualRate: loan.annual_interest_rate,
      termMonths: loan.term_months,
      balloonAmount: loan.balloon_amount,
      startDate: now.toISOString().slice(0, 10),
    });

    const rows = schedule.map((r) => ({
      admin_id: adminId, loan_id: loan.id, period_no: r.periodNo,
      due_date: r.dueDate || null, opening_balance: r.openingBalance,
      interest: r.interest, principal: r.principal, payment: r.payment,
      closing_balance: r.closingBalance, paid: false,
    }));

    // Replace any prior schedule (e.g. re-approval), then write the fresh one.
    await supabase.from('sacco_loan_schedule').delete().eq('loan_id', loan.id);
    if (rows.length) {
      const { error: schedErr } = await supabase.from('sacco_loan_schedule').insert(rows);
      if (schedErr) throw schedErr;
    }

    const { error } = await supabase.from('sacco_loans').update({
      status: 'active', disbursed_at: now.toISOString(), approved_by: adminId,
      updated_at: now.toISOString(),
    }).eq('id', loan.id);
    if (error) throw error;

    await Promise.all([fetchLoans(), fetchSchedules()]);
  }, [fetchLoans, fetchSchedules]);

  const rejectLoan = useCallback(async (loanId) => {
    const { error } = await supabase.from('sacco_loans')
      .update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', loanId);
    if (error) throw error;
    await fetchLoans();
  }, [fetchLoans]);

  const recordRepayment = useCallback(async (scheduleRow) => {
    const { error } = await supabase.from('sacco_loan_schedule')
      .update({ paid: true, paid_date: new Date().toISOString().slice(0, 10) })
      .eq('id', scheduleRow.id);
    if (error) throw error;
    // If every row is now paid, close the loan.
    const remaining = schedules.filter((s) => s.loan_id === scheduleRow.loan_id && !s.paid && s.id !== scheduleRow.id);
    if (remaining.length === 0) {
      await supabase.from('sacco_loans').update({ status: 'closed' }).eq('id', scheduleRow.loan_id);
      await fetchLoans();
    }
    await fetchSchedules();
  }, [schedules, fetchSchedules, fetchLoans]);

  const saveShares = useCallback(async (form) => {
    const adminId = await getAdminId();
    const existing = shares.find((s) => s.member_id === form.member_id);
    if (existing) {
      const { error } = await supabase.from('sacco_shares').update({
        shares_held: parseInt(form.shares_held, 10) || 0,
        par_value: parseFloat(form.par_value) || 0,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('sacco_shares').insert({
        admin_id: adminId, sacco_id: saccoId, member_id: form.member_id,
        shares_held: parseInt(form.shares_held, 10) || 0,
        par_value: parseFloat(form.par_value) || 0,
      });
      if (error) throw error;
    }
    await fetchShares();
  }, [shares, saccoId, fetchShares]);

  const createListing = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_share_listings').insert({
      admin_id: adminId, sacco_id: saccoId, seller_member_id: form.seller_member_id,
      shares: parseInt(form.shares, 10) || 0,
      price_per_share: parseFloat(form.price_per_share) || 0,
      status: 'open', expiry_date: form.expiry_date || null,
    });
    if (error) throw error;
    await fetchListings();
  }, [saccoId, fetchListings]);

  // Buyer expresses interest → creates a pending transfer + flags the listing.
  const requestTransfer = useCallback(async (listing, buyerMemberId) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_share_transfers').insert({
      admin_id: adminId, sacco_id: saccoId, listing_id: listing.id,
      seller_member_id: listing.seller_member_id, buyer_member_id: buyerMemberId,
      shares: listing.shares, price: listing.shares * listing.price_per_share,
      status: 'pending',
    });
    if (error) throw error;
    await supabase.from('sacco_share_listings').update({ status: 'pending_approval' }).eq('id', listing.id);
    await Promise.all([fetchTransfers(), fetchListings()]);
  }, [saccoId, fetchTransfers, fetchListings]);

  // Admin approval settles the transfer: move shares seller → buyer.
  const approveTransfer = useCallback(async (transfer) => {
    const adminId = await getAdminId();
    const sellerRow = shares.find((s) => s.member_id === transfer.seller_member_id);
    const buyerRow  = shares.find((s) => s.member_id === transfer.buyer_member_id);
    const par = parseFloat(sellerRow?.par_value || buyerRow?.par_value || 0);

    if (sellerRow) {
      await supabase.from('sacco_shares').update({
        shares_held: Math.max(0, (parseInt(sellerRow.shares_held, 10) || 0) - transfer.shares),
      }).eq('id', sellerRow.id);
    }
    if (buyerRow) {
      await supabase.from('sacco_shares').update({
        shares_held: (parseInt(buyerRow.shares_held, 10) || 0) + transfer.shares,
      }).eq('id', buyerRow.id);
    } else {
      await supabase.from('sacco_shares').insert({
        admin_id: adminId, sacco_id: saccoId, member_id: transfer.buyer_member_id,
        shares_held: transfer.shares, par_value: par,
      });
    }
    await supabase.from('sacco_share_transfers').update({ status: 'settled', approved_by: adminId }).eq('id', transfer.id);
    if (transfer.listing_id) await supabase.from('sacco_share_listings').update({ status: 'settled' }).eq('id', transfer.listing_id);
    await Promise.all([fetchShares(), fetchTransfers(), fetchListings()]);
  }, [shares, saccoId, fetchShares, fetchTransfers, fetchListings]);

  // ── Voting lifecycle ────────────────────────────────────────────────────────
  const createMotion = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_motions').insert({
      admin_id: adminId, sacco_id: saccoId, title: form.title,
      description: form.description || '', ballot_type: form.ballot_type || 'visible',
      proposer_id: form.proposer_id || null, status: 'proposed',
      quorum_percent: parseInt(form.quorum_percent, 10) || 0,
    });
    if (error) throw error;
    await fetchMotions();
  }, [saccoId, fetchMotions]);

  const secondMotion = useCallback(async (motionId, seconderId) => {
    const { error } = await supabase.from('sacco_motions')
      .update({ seconder_id: seconderId, status: 'seconded', updated_at: new Date().toISOString() })
      .eq('id', motionId);
    if (error) throw error;
    await fetchMotions();
  }, [fetchMotions]);

  const openVoting = useCallback(async (motionId, votingEnd) => {
    const { error } = await supabase.from('sacco_motions').update({
      status: 'open', voting_start: new Date().toISOString(),
      voting_end: votingEnd || null, updated_at: new Date().toISOString(),
    }).eq('id', motionId);
    if (error) throw error;
    await fetchMotions();
  }, [fetchMotions]);

  const castVote = useCallback(async (motion, memberId, choice) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_votes').upsert({
      admin_id: adminId, motion_id: motion.id, member_id: memberId,
      choice, is_secret: motion.ballot_type === 'secret',
    }, { onConflict: 'motion_id,member_id' });
    if (error) throw error;
    await fetchVotes();
  }, [fetchVotes]);

  const publishResults = useCallback(async (motion) => {
    const motionVotes = votes.filter((v) => v.motion_id === motion.id);
    const yes = motionVotes.filter((v) => v.choice === 'yes').length;
    const no  = motionVotes.filter((v) => v.choice === 'no').length;
    const passed = yes > no;
    const { error } = await supabase.from('sacco_motions').update({
      status: passed ? 'passed' : 'rejected', updated_at: new Date().toISOString(),
    }).eq('id', motion.id);
    if (error) throw error;
    await fetchMotions();
  }, [votes, fetchMotions]);

  const uploadDocument = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_documents').insert({
      admin_id: adminId, sacco_id: saccoId, title: form.title,
      doc_type: form.doc_type || 'other', version: form.version || 'v1.0',
      file_url: form.file_url || '', effective_date: form.effective_date || null,
      uploaded_by: adminId,
    });
    if (error) throw error;
    await fetchDocuments();
  }, [saccoId, fetchDocuments]);

  // ── CSV export (same helper shape as the admin dashboard) ────────────────────
  const exportCSV = useCallback((data, filename) => {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const csv = [
      keys.join(','),
      ...data.map((row) => keys.map((k) => `"${String(row[k] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── Initial load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (hasLoaded.current) return;
    fetchAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime (core tables) ────────────────────────────────────────────────────
  useEffect(() => {
    const t = Date.now();
    const mk = (name, table, cb) => supabase
      .channel(`sacco_${name}_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, cb)
      .subscribe();

    const chs = [
      mk('members', 'sacco_members', fetchMembers),
      mk('contribs', 'sacco_contributions', fetchContributions),
      mk('loans', 'sacco_loans', () => { fetchLoans(); fetchSchedules(); }),
      mk('shares', 'sacco_shares', fetchShares),
      mk('motions', 'sacco_motions', fetchMotions),
      mk('votes', 'sacco_votes', fetchVotes),
    ];
    channelsRef.current = chs;
    return () => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    sacco, members, contributions, loanProducts, loans, schedules,
    shares, listings, transfers, motions, votes, documents, invoices,
    stats, loading, connectionStatus,
    refetch: fetchAll,
    // Refresh the members list WITHOUT flipping the dashboard into its loading
    // skeleton (fetchAll would unmount the active tab and kill open modals).
    refreshMembers: fetchMembers,
    addMember, updateMember, recordContribution,
    createLoanProduct, createLoan, approveLoan, rejectLoan, recordRepayment,
    saveShares, createListing, requestTransfer, approveTransfer,
    createMotion, secondMotion, openVoting, castVote, publishResults,
    uploadDocument, exportCSV,
  };

  return (
    <SaccoDashboardContext.Provider value={value}>
      {children}
    </SaccoDashboardContext.Provider>
  );
};

export const useSaccoDashboardContext = () => {
  const ctx = useContext(SaccoDashboardContext);
  if (!ctx) throw new Error('useSaccoDashboardContext must be used within SaccoDashboardProvider');
  return ctx;
};

export default SaccoDashboardContext;
