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

// Sentinel buyer id meaning "the house buys" (treasury buy-back via a listing).
export const TREASURY_BUYER = '__treasury__';

const getAdminId = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id;
};

export const SaccoDashboardProvider = ({ children }) => {
  const [sacco,         setSacco]         = useState(null);
  const [members,       setMembers]       = useState([]);
  const [contributions, setContributions] = useState([]);
  const [contributionTypes, setContributionTypes] = useState([]);
  const [loanProducts,  setLoanProducts]  = useState([]);
  const [loans,         setLoans]         = useState([]);
  const [schedules,     setSchedules]     = useState([]);
  const [shares,        setShares]        = useState([]);
  const [sharePrices,   setSharePrices]   = useState([]);
  const [listings,      setListings]      = useState([]);
  const [transfers,     setTransfers]     = useState([]);
  const [treasury,      setTreasury]      = useState(null);
  const [motions,       setMotions]       = useState([]);
  const [votes,         setVotes]         = useState([]);
  const [elections,          setElections]          = useState([]);
  const [electionPositions,  setElectionPositions]  = useState([]);
  const [electionCandidates, setElectionCandidates] = useState([]);
  const [electionVoters,     setElectionVoters]     = useState([]);
  const [electionAudit,      setElectionAudit]      = useState([]);
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

  const fetchContributionTypes = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_contribution_types').select('*')
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setContributionTypes(data || []);
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

  // The house: authorized cap + the pool of shares the sacco itself trades.
  const fetchTreasury = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_share_treasury').select('*')
        .eq('admin_id', adminId).limit(1).maybeSingle();
      setTreasury(data);
    } catch (_) {}
  }, []);

  // Daily market-value series the sacco_admin publishes (latest = current value).
  const fetchSharePrices = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_share_prices').select('*')
        .eq('admin_id', adminId).order('effective_date', { ascending: false });
      setSharePrices(data || []);
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

  const fetchElections = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_elections').select('*')
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setElections(data || []);
    } catch (_) {}
  }, []);

  const fetchElectionPositions = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_election_positions').select('*')
        .eq('admin_id', adminId).order('display_order', { ascending: true });
      setElectionPositions(data || []);
    } catch (_) {}
  }, []);

  const fetchElectionCandidates = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      // Two FKs point at sacco_members, so both joins must be disambiguated.
      const { data } = await supabase.from('sacco_election_candidates')
        .select('*, member:sacco_members!member_id(id, full_name, member_no), nominator:sacco_members!nominated_by(full_name)')
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setElectionCandidates(data || []);
    } catch (_) {}
  }, []);

  const fetchElectionVoters = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_election_voters').select('*')
        .eq('admin_id', adminId).order('full_name', { ascending: true });
      setElectionVoters(data || []);
    } catch (_) {}
  }, []);

  const fetchElectionAudit = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase.from('sacco_election_audit').select('*')
        .eq('admin_id', adminId).order('created_at', { ascending: false });
      setElectionAudit(data || []);
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
      fetchSacco(), fetchMembers(), fetchContributions(), fetchContributionTypes(),
      fetchLoanProducts(), fetchLoans(), fetchSchedules(), fetchShares(), fetchListings(),
      fetchTransfers(), fetchTreasury(), fetchSharePrices(), fetchMotions(), fetchVotes(), fetchDocuments(), fetchInvoices(),
      fetchElections(), fetchElectionPositions(), fetchElectionCandidates(),
      fetchElectionVoters(), fetchElectionAudit(),
    ]);
    hasLoaded.current = true;
    setLoading(false);
  }, [
    fetchSacco, fetchMembers, fetchContributions, fetchContributionTypes,
    fetchLoanProducts, fetchLoans, fetchSchedules, fetchShares, fetchListings,
    fetchTransfers, fetchTreasury, fetchSharePrices, fetchMotions, fetchVotes, fetchDocuments, fetchInvoices,
    fetchElections, fetchElectionPositions, fetchElectionCandidates,
    fetchElectionVoters, fetchElectionAudit,
  ]);

  // ── Derived stats ───────────────────────────────────────────────────────────
  const activeMembers = members.filter((m) => m.status === 'active').length;
  const totalSavings = contributions
    .filter((c) => c.status === 'paid')
    .reduce((s, c) => s + parseFloat(c.amount || 0), 0);
  const activeLoans = loans.filter((l) => l.status === 'active').length;
  const totalShareValue = shares.reduce(
    (s, r) => s + (parseInt(r.shares_held, 10) || 0) * parseFloat(r.par_value || 0), 0);
  // Market value the admin publishes: latest price × all shares in issue.
  const totalSharesHeld = shares.reduce((s, r) => s + (parseInt(r.shares_held, 10) || 0), 0);
  const currentMarketValue = parseFloat(sharePrices[0]?.market_value || 0);
  const marketCap = totalSharesHeld * currentMarketValue;

  const stats = {
    totalMembers: members.length,
    activeMembers,
    totalSavings,
    activeLoans,
    totalShareValue,
    tier: tierForMembers(activeMembers),
    billing: calculateMonthlyBill({ members: activeMembers, storageGb: sacco?.storage_used_gb || 0, tier: sacco?.tier }),
    openMotions: motions.filter((m) => m.status === 'open').length,
    activeElections: elections.filter((e) => ['nominations_open', 'voting_open'].includes(e.status)).length,
    pendingCandidates: electionCandidates.filter((c) => c.status === 'pending').length,
  };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saccoId = sacco?.id || null;

  const addMember = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_members').insert({
      admin_id: adminId, sacco_id: saccoId,
      member_no: (form.member_no || '').trim(),
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

  const createContributionType = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_contribution_types').insert({
      admin_id: adminId, sacco_id: saccoId, name: form.name.trim(),
      description: form.description || '',
      suggested_amount: parseFloat(form.suggested_amount) || 0,
      frequency: form.frequency || 'one-off',
      due_date: form.due_date || null,
      is_active: true,
    });
    if (error) throw error;
    await fetchContributionTypes();
  }, [saccoId, fetchContributionTypes]);

  const updateContributionType = useCallback(async (id, patch) => {
    const { error } = await supabase.from('sacco_contribution_types')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await fetchContributionTypes();
  }, [fetchContributionTypes]);

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

  // Publish (or revise) the market value per share for a given day. Upserts on
  // (sacco_id, effective_date) so re-setting today's value overwrites it.
  const setMarketValue = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_share_prices').upsert({
      admin_id: adminId, sacco_id: saccoId,
      market_value: parseFloat(form.market_value) || 0,
      effective_date: form.effective_date || new Date().toISOString().slice(0, 10),
      note: form.note || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'sacco_id,effective_date' });
    if (error) throw error;
    await fetchSharePrices();
  }, [saccoId, fetchSharePrices]);

  // Create/update the treasury row (authorized cap, house pool, par).
  const saveTreasury = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_share_treasury').upsert({
      admin_id: adminId, sacco_id: saccoId,
      authorized_shares: parseInt(form.authorized_shares, 10) || 0,
      treasury_shares: parseInt(form.treasury_shares, 10) || 0,
      par_value: parseFloat(form.par_value) || 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'sacco_id' });
    if (error) throw error;
    await fetchTreasury();
  }, [saccoId, fetchTreasury]);

  const createListing = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_share_listings').insert({
      admin_id: adminId, sacco_id: saccoId,
      seller_member_id: form.seller_is_treasury ? null : form.seller_member_id,
      seller_is_treasury: !!form.seller_is_treasury,
      shares: parseInt(form.shares, 10) || 0,
      price_per_share: parseFloat(form.price_per_share) || 0,
      status: 'open', expiry_date: form.expiry_date || null,
    });
    if (error) throw error;
    await fetchListings();
  }, [saccoId, fetchListings]);

  // Buyer expresses interest → creates a pending transfer + flags the listing.
  // The buyer may be TREASURY_BUYER: the house buying a member's listing.
  const requestTransfer = useCallback(async (listing, buyerMemberId) => {
    const adminId = await getAdminId();
    const buyerIsTreasury = buyerMemberId === TREASURY_BUYER;
    const { error } = await supabase.from('sacco_share_transfers').insert({
      admin_id: adminId, sacco_id: saccoId, listing_id: listing.id,
      seller_member_id: listing.seller_member_id,
      seller_is_treasury: !!listing.seller_is_treasury,
      buyer_member_id: buyerIsTreasury ? null : buyerMemberId,
      buyer_is_treasury: buyerIsTreasury,
      shares: listing.shares, price: listing.shares * listing.price_per_share,
      status: 'pending',
    });
    if (error) throw error;
    await supabase.from('sacco_share_listings').update({ status: 'pending_approval' }).eq('id', listing.id);
    await Promise.all([fetchTransfers(), fetchListings()]);
  }, [saccoId, fetchTransfers, fetchListings]);

  // House trades move the sacco's own cash, so settlement also posts share
  // capital to the Finance Hub ledger (Dr Bank/Cr Share Capital on a sale,
  // reversed on a buy-back). Best-effort: the books may not be seeded yet.
  const postTreasuryJournal = useCallback(async (transfer) => {
    const amount = Math.round(parseFloat(transfer.price || 0) * 100) / 100;
    if (!(amount > 0) || !saccoId) return false;
    const sale = !!transfer.seller_is_treasury;
    const { error } = await supabase.rpc('sacco_post_journal', {
      p_sacco_id: saccoId,
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: sale ? 'Treasury share sale to member' : 'Treasury share buy-back from member',
      p_lines: sale
        ? [{ account_code: '1020', debit: amount, credit: 0 }, { account_code: '3010', debit: 0, credit: amount }]
        : [{ account_code: '3010', debit: amount, credit: 0 }, { account_code: '1020', debit: 0, credit: amount }],
      p_reference: `SHR-${String(transfer.id).slice(0, 8)}`,
      p_member_id: sale ? transfer.buyer_member_id : transfer.seller_member_id,
      p_source_table: 'sacco_share_transfers',
      p_source_id: transfer.id,
      p_is_automated: true,
    });
    return !error;
  }, [saccoId]);

  // Admin approval settles the transfer: move shares seller → buyer. Either
  // side may be the house (treasury pool). Returns { ledgerPosted } so the UI
  // can say whether a house trade reached the books.
  const approveTransfer = useCallback(async (transfer) => {
    const adminId = await getAdminId();
    const qty = parseInt(transfer.shares, 10) || 0;
    const sellerRow = transfer.seller_is_treasury ? null : shares.find((s) => s.member_id === transfer.seller_member_id);
    const buyerRow  = transfer.buyer_is_treasury  ? null : shares.find((s) => s.member_id === transfer.buyer_member_id);
    const par = parseFloat(sellerRow?.par_value || buyerRow?.par_value || treasury?.par_value || 0);

    if (transfer.seller_is_treasury || transfer.buyer_is_treasury) {
      if (!treasury) throw new Error('Set up the treasury first (Treasury settings on the Shares tab).');
      const pool = parseInt(treasury.treasury_shares, 10) || 0;
      if (transfer.seller_is_treasury && pool < qty) {
        throw new Error(`The treasury pool holds only ${pool} shares — cannot sell ${qty}.`);
      }
      const { error } = await supabase.from('sacco_share_treasury').update({
        treasury_shares: transfer.seller_is_treasury ? pool - qty : pool + qty,
        updated_at: new Date().toISOString(),
      }).eq('id', treasury.id);
      if (error) throw error;
    }

    if (sellerRow) {
      await supabase.from('sacco_shares').update({
        shares_held: Math.max(0, (parseInt(sellerRow.shares_held, 10) || 0) - qty),
      }).eq('id', sellerRow.id);
    }
    if (!transfer.buyer_is_treasury) {
      if (buyerRow) {
        await supabase.from('sacco_shares').update({
          shares_held: (parseInt(buyerRow.shares_held, 10) || 0) + qty,
        }).eq('id', buyerRow.id);
      } else {
        await supabase.from('sacco_shares').insert({
          admin_id: adminId, sacco_id: saccoId, member_id: transfer.buyer_member_id,
          shares_held: qty, par_value: par,
        });
      }
    }
    await supabase.from('sacco_share_transfers').update({ status: 'settled', approved_by: adminId }).eq('id', transfer.id);
    if (transfer.listing_id) await supabase.from('sacco_share_listings').update({ status: 'settled' }).eq('id', transfer.listing_id);

    let ledgerPosted = false;
    if (!!transfer.seller_is_treasury !== !!transfer.buyer_is_treasury) {
      try { ledgerPosted = await postTreasuryJournal(transfer); } catch (_) {}
    }
    await Promise.all([fetchShares(), fetchTransfers(), fetchListings(), fetchTreasury()]);
    return { ledgerPosted };
  }, [shares, treasury, saccoId, postTreasuryJournal, fetchShares, fetchTransfers, fetchListings, fetchTreasury]);

  // The house buys back a member's shares directly (admin-initiated, settles
  // immediately — the admin is both initiator and approver).
  const treasuryBuyBack = useCallback(async (form) => {
    const adminId = await getAdminId();
    const qty = parseInt(form.shares, 10) || 0;
    const price = parseFloat(form.price_per_share) || 0;
    const { data, error } = await supabase.from('sacco_share_transfers').insert({
      admin_id: adminId, sacco_id: saccoId,
      seller_member_id: form.seller_member_id, seller_is_treasury: false,
      buyer_member_id: null, buyer_is_treasury: true,
      shares: qty, price: qty * price, status: 'pending',
    }).select().single();
    if (error) throw error;
    return approveTransfer(data);
  }, [saccoId, approveTransfer]);

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

  // Close a motion through the quorum-aware DB function: it counts the ballots
  // (bypassing vote RLS so secret ballots stay aggregate-only), checks quorum
  // against the active-member count, and sets passed/rejected. Returns the
  // outcome { yes, no, abstain, total, eligible, quorum_met, passed, status }.
  const publishResults = useCallback(async (motion) => {
    const { data, error } = await supabase.rpc('sacco_motion_close', { p_motion_id: motion.id });
    if (error) throw error;
    await fetchMotions();
    return data;
  }, [fetchMotions]);

  // ── Elections lifecycle (polling station) ──────────────────────────────────
  // Every state transition runs through a SECURITY DEFINER RPC (see
  // 20260715120000_sacco_elections.sql): the DB freezes the voter register,
  // stores ballots with no voter identity and computes the tally. Direct
  // writes to status/register/ballots are refused at trigger level, so the
  // client can only ask — never tamper.

  const refreshElections = useCallback(async () => {
    await Promise.all([
      fetchElections(), fetchElectionPositions(), fetchElectionCandidates(),
      fetchElectionVoters(), fetchElectionAudit(),
    ]);
  }, [fetchElections, fetchElectionPositions, fetchElectionCandidates, fetchElectionVoters, fetchElectionAudit]);

  const electionRpc = useCallback(async (fn, electionId) => {
    const { data, error } = await supabase.rpc(fn, { p_election_id: electionId });
    if (error) throw error;
    return data;
  }, []);

  const createElection = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_elections').insert({
      admin_id: adminId, sacco_id: saccoId, title: form.title,
      description: form.description || '',
      quorum_percent: parseInt(form.quorum_percent, 10) || 0,
    });
    if (error) throw error;
    await Promise.all([fetchElections(), fetchElectionAudit()]);
  }, [saccoId, fetchElections, fetchElectionAudit]);

  const updateElection = useCallback(async (id, patch) => {
    const { error } = await supabase.from('sacco_elections')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await fetchElections();
  }, [fetchElections]);

  // Drafts only — later stages are history and can only be cancelled (DB-enforced).
  const deleteElection = useCallback(async (id) => {
    const { error } = await supabase.from('sacco_elections').delete().eq('id', id);
    if (error) throw error;
    await refreshElections();
  }, [refreshElections]);

  const addElectionPosition = useCallback(async (electionId, form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_election_positions').insert({
      admin_id: adminId, sacco_id: saccoId, election_id: electionId,
      title: form.title, description: form.description || '',
      seats: Math.max(1, parseInt(form.seats, 10) || 1),
      display_order: parseInt(form.display_order, 10) || 0,
    });
    if (error) throw error;
    await fetchElectionPositions();
  }, [saccoId, fetchElectionPositions]);

  const updateElectionPosition = useCallback(async (id, patch) => {
    const { error } = await supabase.from('sacco_election_positions')
      .update(patch).eq('id', id);
    if (error) throw error;
    await fetchElectionPositions();
  }, [fetchElectionPositions]);

  const deleteElectionPosition = useCallback(async (id) => {
    const { error } = await supabase.from('sacco_election_positions').delete().eq('id', id);
    if (error) throw error;
    await Promise.all([fetchElectionPositions(), fetchElectionCandidates()]);
  }, [fetchElectionPositions, fetchElectionCandidates]);

  const openNominations = useCallback(async (electionId) => {
    await electionRpc('sacco_election_open_nominations', electionId);
    await refreshElections();
  }, [electionRpc, refreshElections]);

  const closeNominations = useCallback(async (electionId) => {
    await electionRpc('sacco_election_close_nominations', electionId);
    await refreshElections();
  }, [electionRpc, refreshElections]);

  // Freezes the voter register (active members at this instant). Returns the
  // register size the DB reported.
  const openElectionVoting = useCallback(async (electionId) => {
    const registerSize = await electionRpc('sacco_election_open_voting', electionId);
    await refreshElections();
    return registerSize;
  }, [electionRpc, refreshElections]);

  const closeElectionVoting = useCallback(async (electionId) => {
    await electionRpc('sacco_election_close_voting', electionId);
    await refreshElections();
  }, [electionRpc, refreshElections]);

  const publishElectionResults = useCallback(async (electionId) => {
    const results = await electionRpc('sacco_election_publish_results', electionId);
    await refreshElections();
    return results;
  }, [electionRpc, refreshElections]);

  const cancelElection = useCallback(async (electionId) => {
    await electionRpc('sacco_election_cancel', electionId);
    await refreshElections();
  }, [electionRpc, refreshElections]);

  // Set (or clear) the auto-transition schedule. Pass null for any leg to leave
  // that transition manual. The DB refuses edits once voting has opened.
  const setElectionSchedule = useCallback(async (electionId, { nominations_close, voting_open, voting_close }) => {
    const { error } = await supabase.rpc('sacco_election_set_schedule', {
      p_election_id: electionId,
      p_nominations_close: nominations_close || null,
      p_voting_open: voting_open || null,
      p_voting_close: voting_close || null,
    });
    if (error) throw error;
    await refreshElections();
  }, [refreshElections]);

  const approveCandidate = useCallback(async (candidate) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_election_candidates').update({
      status: 'approved', vetted_by: adminId,
      vetted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', candidate.id);
    if (error) throw error;
    await Promise.all([fetchElectionCandidates(), fetchElectionAudit()]);
  }, [fetchElectionCandidates, fetchElectionAudit]);

  const rejectCandidate = useCallback(async (candidate) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_election_candidates').update({
      status: 'rejected', vetted_by: adminId,
      vetted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', candidate.id);
    if (error) throw error;
    await Promise.all([fetchElectionCandidates(), fetchElectionAudit()]);
  }, [fetchElectionCandidates, fetchElectionAudit]);

  // Admin adds a candidate directly (already vetted, nominated_by = null).
  const addCandidateDirect = useCallback(async (form) => {
    const adminId = await getAdminId();
    const { error } = await supabase.from('sacco_election_candidates').insert({
      admin_id: adminId, sacco_id: saccoId,
      election_id: form.election_id, position_id: form.position_id,
      member_id: form.member_id, nominated_by: null,
      status: 'approved', manifesto: form.manifesto || '',
      vetted_by: adminId, vetted_at: new Date().toISOString(),
    });
    if (error) throw error;
    await Promise.all([fetchElectionCandidates(), fetchElectionAudit()]);
  }, [saccoId, fetchElectionCandidates, fetchElectionAudit]);

  // Aggregate tally (post-close preview + published view). Empty while voting
  // is open — the DB refuses early counts for everyone.
  const getElectionTally = useCallback(async (electionId) => {
    const { data, error } = await supabase.rpc('sacco_election_tally', { p_election_id: electionId });
    if (error) throw error;
    return data || [];
  }, []);

  const verifyElectionReceipt = useCallback(async (electionId, code) => {
    const { data, error } = await supabase.rpc('sacco_election_verify_receipt', {
      p_election_id: electionId, p_receipt: code,
    });
    if (error) throw error;
    return data || [];
  }, []);

  // Edge-function caller (same shape as MembersTab's callFunction).
  const callFunction = useCallback(async (fn, body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('No active session.');
    const rawUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const supabaseUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}.supabase.co`;
    const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || 'Request failed');
    return json;
  }, []);

  // Email every active member about an election event. One email per
  // recipient (a shared `to` array would leak addresses to everyone).
  // Callers fire-and-forget: delivery failures never block the lifecycle.
  const notifyElection = useCallback(async (type, election, extra = {}) => {
    const recipients = members.filter((m) => m.status === 'active' && m.email);
    if (recipients.length === 0) return { sent: 0, failed: 0 };
    const results = await Promise.allSettled(recipients.map((m) =>
      callFunction('send-email', {
        type,
        to: m.email,
        data: {
          fullName: m.full_name,
          saccoName: sacco?.name,
          electionTitle: election.title,
          portalUrl: `${window.location.origin}/login`,
          ...extra,
        },
      })));
    const failed = results.filter((r) => r.status === 'rejected').length;
    return { sent: results.length - failed, failed };
  }, [members, sacco?.name, callFunction]);

  // Email every active member about a motion event (e.g. voting opened). Same
  // one-email-per-recipient, fire-and-forget shape as notifyElection.
  const notifyMotion = useCallback(async (type, motion, extra = {}) => {
    const recipients = members.filter((m) => m.status === 'active' && m.email);
    if (recipients.length === 0) return { sent: 0, failed: 0 };
    const results = await Promise.allSettled(recipients.map((m) =>
      callFunction('send-email', {
        type,
        to: m.email,
        data: {
          fullName: m.full_name,
          saccoName: sacco?.name,
          motionTitle: motion.title,
          ballotType: motion.ballot_type,
          portalUrl: `${window.location.origin}/login`,
          ...extra,
        },
      })));
    const failed = results.filter((r) => r.status === 'rejected').length;
    return { sent: results.length - failed, failed };
  }, [members, sacco?.name, callFunction]);

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
      mk('share_prices', 'sacco_share_prices', fetchSharePrices),
      mk('motions', 'sacco_motions', fetchMotions),
      mk('votes', 'sacco_votes', fetchVotes),
      mk('elections', 'sacco_elections', fetchElections),
      mk('elect_pos', 'sacco_election_positions', fetchElectionPositions),
      mk('elect_cands', 'sacco_election_candidates', () => { fetchElectionCandidates(); fetchElectionAudit(); }),
      mk('elect_voters', 'sacco_election_voters', fetchElectionVoters),  // live turnout
    ];
    channelsRef.current = chs;
    return () => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    sacco, members, contributions, contributionTypes, loanProducts, loans, schedules,
    shares, sharePrices, listings, transfers, treasury, motions, votes, documents, invoices,
    currentMarketValue, marketCap, totalSharesHeld,
    elections, electionPositions, electionCandidates, electionVoters, electionAudit,
    stats, loading, connectionStatus,
    refetch: fetchAll,
    // Refresh the members list WITHOUT flipping the dashboard into its loading
    // skeleton (fetchAll would unmount the active tab and kill open modals).
    refreshMembers: fetchMembers,
    addMember, updateMember, recordContribution,
    createContributionType, updateContributionType,
    createLoanProduct, createLoan, approveLoan, rejectLoan, recordRepayment,
    saveShares, setMarketValue, createListing, requestTransfer, approveTransfer,
    saveTreasury, treasuryBuyBack,
    createMotion, secondMotion, openVoting, castVote, publishResults, notifyMotion,
    createElection, updateElection, deleteElection,
    addElectionPosition, updateElectionPosition, deleteElectionPosition,
    openNominations, closeNominations, openElectionVoting, closeElectionVoting,
    publishElectionResults, cancelElection, setElectionSchedule,
    approveCandidate, rejectCandidate, addCandidateDirect,
    getElectionTally, verifyElectionReceipt, notifyElection, refreshElections,
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
