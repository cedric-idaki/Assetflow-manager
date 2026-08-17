/**
 * SaccoMemberContext
 *
 * Data layer for the Member Self-Service Portal (/sacco-member-portal, BRS
 * v3.0 Section 5). Mounted above the router like the other providers, but it
 * only fetches when the logged-in user has the 'sacco_member' role.
 *
 * Every read is scoped server-side by the member RLS policies in
 * 20260708130000_sacco_member_portal.sql — the client resolves the member row
 * via sacco_members.user_id = auth.uid() and everything else follows from it.
 */
import React, {
  createContext, useContext, useState, useEffect, useCallback, useRef,
} from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

const SaccoMemberContext = createContext(null);

export const SaccoMemberProvider = ({ children }) => {
  const { user, userProfile } = useAuth();
  const isMember = userProfile?.role === 'sacco_member';

  const [me,            setMe]            = useState(null);   // own sacco_members row
  const [sacco,         setSacco]         = useState(null);
  const [members,       setMembers]       = useState([]);     // names only, for marketplace/voting
  const [contributions, setContributions] = useState([]);
  const [contributionTypes, setContributionTypes] = useState([]); // active types = expected contributions
  // Server-computed figures (expected, outstanding, missed months). Derived in
  // one place — sacco_member_contribution_stats — so the member portal and the
  // treasurer's defaulters report can never disagree about who is behind.
  const [contributionStats, setContributionStats] = useState(null);
  const [loanProducts,  setLoanProducts]  = useState([]);
  const [loans,         setLoans]         = useState([]);
  const [schedules,     setSchedules]     = useState([]);
  const [shares,        setShares]        = useState([]);
  const [listings,      setListings]      = useState([]);
  const [transfers,     setTransfers]     = useState([]);
  const [sharePrices,   setSharePrices]   = useState([]);
  const [saccoTotals,   setSaccoTotals]   = useState({ totalShares: 0, totalMarketValue: 0, shareholders: 0 });
  // Share engine (20260801200000_sacco_share_engine)
  const [shareSettings, setShareSettings] = useState(null);
  const [shareTxns,     setShareTxns]     = useState([]);
  const [certificates,  setCertificates]  = useState([]);
  const [dividends,     setDividends]     = useState([]);
  const [dividendAllocations, setDividendAllocations] = useState([]);
  const [treasury,      setTreasury]      = useState(null);
  const [motions,       setMotions]       = useState([]);
  const [votes,         setVotes]         = useState([]);
  const [elections,          setElections]          = useState([]);
  const [electionPositions,  setElectionPositions]  = useState([]);
  const [electionCandidates, setElectionCandidates] = useState([]);
  const [myVoterRows,        setMyVoterRows]        = useState([]); // RLS: own register rows only
  const [documents,     setDocuments]     = useState([]);
  const [contracts,     setContracts]     = useState([]);
  const [loading,       setLoading]       = useState(true);

  const channelsRef = useRef([]);

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const fetchMe = useCallback(async () => {
    if (!user?.id) return null;
    const { data } = await supabase.from('sacco_members').select('*')
      .eq('user_id', user.id).maybeSingle();
    setMe(data);
    return data;
  }, [user?.id]);

  const fetchSacco = useCallback(async (saccoId) => {
    if (!saccoId) return;
    const { data } = await supabase.from('saccos').select('*')
      .eq('id', saccoId).maybeSingle();
    setSacco(data);
  }, []);

  const fetchMembers = useCallback(async () => {
    const { data } = await supabase.from('sacco_members')
      .select('id, full_name, member_no, status');
    setMembers(data || []);
  }, []);

  const fetchContributions = useCallback(async () => {
    // RLS returns only this member's rows. Ordered by when the money actually
    // moved, falling back to when the entry was raised for still-pending ones.
    const { data } = await supabase.from('sacco_contributions').select('*')
      .order('paid_at', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: false });
    setContributions(data || []);
  }, []);

  const fetchContributionStats = useCallback(async () => {
    const { data, error } = await supabase.rpc('sacco_member_contribution_stats');
    if (error) { setContributionStats(null); return; }
    setContributionStats(Array.isArray(data) ? data[0] || null : data);
  }, []);

  // Active types the admin has published — what the member is expected to pay.
  const fetchContributionTypes = useCallback(async () => {
    const { data } = await supabase.from('sacco_contribution_types').select('*')
      .eq('is_active', true)
      .order('due_date', { ascending: true, nullsFirst: false });
    setContributionTypes(data || []);
  }, []);

  const fetchLoanProducts = useCallback(async () => {
    const { data } = await supabase.from('sacco_loan_products').select('*')
      .eq('is_active', true).order('name');
    setLoanProducts(data || []);
  }, []);

  const fetchLoans = useCallback(async () => {
    const { data } = await supabase.from('sacco_loans')
      .select('*, product:sacco_loan_products(name)')
      .order('created_at', { ascending: false });
    setLoans(data || []);
  }, []);

  const fetchSchedules = useCallback(async () => {
    const { data } = await supabase.from('sacco_loan_schedule').select('*')
      .order('period_no', { ascending: true });
    setSchedules(data || []);
  }, []);

  const fetchShares = useCallback(async () => {
    const { data } = await supabase.from('sacco_shares').select('*');
    setShares(data || []);
  }, []);

  const fetchListings = useCallback(async () => {
    const { data } = await supabase.from('sacco_share_listings')
      .select('*, seller:sacco_members!seller_member_id(id, full_name, member_no)')
      .order('created_at', { ascending: false });
    setListings(data || []);
  }, []);

  const fetchTransfers = useCallback(async () => {
    const { data } = await supabase.from('sacco_share_transfers').select('*')
      .order('created_at', { ascending: false });
    setTransfers(data || []);
  }, []);

  // Sacco-wide daily market value (RLS: members read their own sacco's prices).
  const fetchSharePrices = useCallback(async () => {
    const { data } = await supabase.from('sacco_share_prices').select('*')
      .order('effective_date', { ascending: false });
    setSharePrices(data || []);
  }, []);

  // ── Share engine (RLS: each of these returns only the member's own rows) ──
  // The market's rules — fee, floor, limits, hours — so the portal can explain
  // a refusal before the server has to.
  const fetchShareSettings = useCallback(async () => {
    const { data } = await supabase.from('sacco_share_settings').select('*').limit(1).maybeSingle();
    setShareSettings(data);
  }, []);

  // My own share ledger: every purchase, sale, transfer and dividend.
  const fetchShareTxns = useCallback(async () => {
    const { data } = await supabase.from('sacco_share_transactions').select('*')
      .order('created_at', { ascending: false });
    setShareTxns(data || []);
  }, []);

  const fetchMyCertificates = useCallback(async () => {
    const { data } = await supabase.from('sacco_share_certificates').select('*')
      .order('created_at', { ascending: false });
    setCertificates(data || []);
  }, []);

  // Declarations are sacco-wide news; allocations are strictly mine.
  const fetchMyDividends = useCallback(async () => {
    const [{ data: decls }, { data: allocs }] = await Promise.all([
      supabase.from('sacco_dividend_declarations').select('*').order('record_date', { ascending: false }),
      supabase.from('sacco_dividend_allocations').select('*'),
    ]);
    setDividends(decls || []);
    setDividendAllocations(allocs || []);
  }, []);

  const fetchTreasury = useCallback(async () => {
    const { data } = await supabase.from('sacco_share_treasury').select('*').limit(1).maybeSingle();
    setTreasury(data);
  }, []);

  // Privacy-preserving aggregate (own sacco only) → drives "% of total shares".
  const fetchSaccoTotals = useCallback(async () => {
    const { data } = await supabase.rpc('sacco_member_share_totals');
    const row = Array.isArray(data) ? data[0] : data;
    setSaccoTotals({
      totalShares: parseInt(row?.total_shares, 10) || 0,
      totalMarketValue: parseFloat(row?.total_market_value || 0),
      shareholders: parseInt(row?.shareholders, 10) || 0,
    });
  }, []);

  const fetchMotions = useCallback(async () => {
    const { data } = await supabase.from('sacco_motions')
      .select('*, proposer:sacco_members!proposer_id(full_name), seconder:sacco_members!seconder_id(full_name)')
      .order('created_at', { ascending: false });
    setMotions(data || []);
  }, []);

  const fetchVotes = useCallback(async () => {
    // RLS returns: own votes + everyone's votes on visible ballots.
    const { data } = await supabase.from('sacco_votes')
      .select('*, member:sacco_members(full_name)');
    setVotes(data || []);
  }, []);

  const fetchElections = useCallback(async () => {
    const { data } = await supabase.from('sacco_elections').select('*')
      .order('created_at', { ascending: false });
    setElections(data || []);
  }, []);

  const fetchElectionPositions = useCallback(async () => {
    const { data } = await supabase.from('sacco_election_positions').select('*')
      .order('display_order', { ascending: true });
    setElectionPositions(data || []);
  }, []);

  const fetchElectionCandidates = useCallback(async () => {
    // Two FKs point at sacco_members, so both joins must be disambiguated.
    const { data } = await supabase.from('sacco_election_candidates')
      .select('*, member:sacco_members!member_id(id, full_name, member_no), nominator:sacco_members!nominated_by(full_name)')
      .order('created_at', { ascending: false });
    setElectionCandidates(data || []);
  }, []);

  const fetchMyVoterRows = useCallback(async () => {
    const { data } = await supabase.from('sacco_election_voters').select('*');
    setMyVoterRows(data || []);
  }, []);

  const fetchDocuments = useCallback(async () => {
    const { data } = await supabase.from('sacco_documents').select('*')
      .order('created_at', { ascending: false });
    setDocuments(data || []);
  }, []);

  const fetchContracts = useCallback(async (memberId) => {
    if (!memberId) return;
    const { data } = await supabase.from('company_contracts').select('*')
      .eq('member_id', memberId).order('created_at', { ascending: false });
    setContracts(data || []);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const meRow = await fetchMe();
    await Promise.all([
      fetchSacco(meRow?.sacco_id),
      fetchMembers(), fetchContributions(), fetchContributionStats(), fetchContributionTypes(), fetchLoanProducts(), fetchLoans(),
      fetchSchedules(), fetchShares(), fetchListings(), fetchTransfers(), fetchSharePrices(), fetchSaccoTotals(),
      fetchMotions(), fetchVotes(), fetchDocuments(), fetchContracts(meRow?.id),
      fetchElections(), fetchElectionPositions(), fetchElectionCandidates(), fetchMyVoterRows(),
      fetchShareSettings(), fetchShareTxns(), fetchMyCertificates(), fetchMyDividends(), fetchTreasury(),
    ]);
    setLoading(false);
  }, [
    fetchMe, fetchSacco, fetchMembers, fetchContributions, fetchContributionStats, fetchContributionTypes, fetchLoanProducts,
    fetchLoans, fetchSchedules, fetchShares, fetchListings, fetchTransfers, fetchSharePrices, fetchSaccoTotals,
    fetchMotions, fetchVotes, fetchDocuments, fetchContracts,
    fetchElections, fetchElectionPositions, fetchElectionCandidates, fetchMyVoterRows,
    fetchShareSettings, fetchShareTxns, fetchMyCertificates, fetchMyDividends, fetchTreasury,
  ]);

  // ── Derived stats (portal home mini-cards, BRS 5.1) ───────────────────────
  // 'paid' is the pre-20260801 spelling of 'completed'; both count as settled.
  const settled = contributions.filter((c) => ['completed', 'paid'].includes(c.status));
  const sum = (rows) => rows.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
  const totalSavings      = sum(settled);
  const totalShareCapital = sum(settled.filter((c) => c.account === 'share_capital'));
  const totalDeposits     = sum(settled.filter((c) => (c.account || 'deposits') === 'deposits'));
  const lastContribution  = settled[0] || null; // fetchContributions orders by paid_at desc
  const pendingContributions = contributions.filter((c) => c.status === 'pending');
  const unpaidSchedule = schedules.filter((s) => !s.paid);
  const loanBalance = unpaidSchedule.reduce((s, r) => s + parseFloat(r.payment || 0), 0);
  const nextDue = unpaidSchedule
    .filter((r) => r.due_date)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0]?.due_date || null;
  const myShares = shares[0] || null;
  const currentMarketValue = parseFloat(sharePrices[0]?.market_value || 0);
  const shareValue = (parseInt(myShares?.shares_held, 10) || 0) * (currentMarketValue || parseFloat(myShares?.par_value || 0));
  const openMotions = motions.filter((m) => m.status === 'open').length;
  // Elections needing my attention: open nominations, or an open ballot I'm
  // registered for and haven't cast yet.
  const openElections = elections.filter((e) => {
    if (e.status === 'nominations_open') return true;
    if (e.status !== 'voting_open') return false;
    const reg = myVoterRows.find((r) => r.election_id === e.id);
    return !!reg && !reg.voted_at;
  }).length;

  const stats = {
    totalSavings, totalDeposits, totalShareCapital, lastContribution,
    pendingContributions: pendingContributions.length,
    // Server-side figures win when available — they know the member's monthly
    // obligation and start date, which the client-side ledger alone does not.
    outstanding:   parseFloat(contributionStats?.outstanding || 0),
    missedMonths:  parseInt(contributionStats?.missed_months, 10) || 0,
    nextDueDate:   contributionStats?.next_due_date || null,
    monthlyTarget: parseFloat(contributionStats?.monthly_contribution || me?.monthly_contribution || 0),
    thisMonth:     parseFloat(contributionStats?.this_month || 0),
    loanBalance, nextDue, shareValue, openMotions, openElections,
  };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateProfile = useCallback(async (patch) => {
    // Privileged columns are pinned server-side by protect_sacco_member_columns.
    const { error } = await supabase.from('sacco_members')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', me?.id);
    if (error) throw error;
    await fetchMe();
  }, [me?.id, fetchMe]);

  // ── Contributions (member self-service) ───────────────────────────────────
  // Always through the RPC: there is no member INSERT policy on
  // sacco_contributions, precisely so a member cannot write a completed row.
  const submitContribution = useCallback(async (form) => {
    const { data, error } = await supabase.rpc('sacco_member_submit_contribution', {
      p_amount: parseFloat(form.amount) || 0,
      p_contribution_type: form.contribution_type || 'monthly',
      p_account: form.account || 'deposits',
      p_payment_method: form.payment_method || 'mpesa',
      p_reference: form.reference || null,
      p_notes: form.notes || null,
      p_period_month: form.period_month || null,
    });
    if (error) throw error;
    await Promise.all([fetchContributions(), fetchContributionStats()]);
    return Array.isArray(data) ? data[0] : data;
  }, [fetchContributions, fetchContributionStats]);

  const cancelContribution = useCallback(async (id) => {
    const { error } = await supabase.rpc('sacco_member_cancel_contribution', { p_id: id });
    if (error) throw error;
    await Promise.all([fetchContributions(), fetchContributionStats()]);
  }, [fetchContributions, fetchContributionStats]);

  /**
   * Fire the STK push for a contribution that already exists as pending.
   * The edge function re-reads that row and pushes for ITS amount, so nothing
   * sent from here is trusted as an instruction to move money.
   *
   * accountRef is the contribution's own transaction number: contributions are
   * collected on the platform paybill, so the reference on the M-Pesa statement
   * has to identify the exact entry, not just the member (member numbers are
   * only unique within one sacco). 'CTR-' + 8 digits is exactly the 12
   * characters Daraja allows.
   */
  const payContributionByMpesa = useCallback(async (contribution, phone) => {
    const data = await invokeSupabaseFunction('mpesa-stk-push', {
      body: {
        purpose: 'sacco_contribution',
        contributionId: contribution.id,
        phone,
        amount: Math.round(parseFloat(contribution.amount) || 0),
        accountRef: contribution.txn_no || me?.member_no || 'CONTRIB',
      },
    });
    if (data?.error) throw new Error(data.error || 'M-Pesa request failed');
    return data;
  }, [me?.member_no]);

  /** Poll the transaction the push created — the callback settles it server-side. */
  const checkMpesaContribution = useCallback(async (checkoutRequestId) => {
    const { data } = await supabase.from('mpesa_transactions')
      .select('status, result_desc, mpesa_receipt_number')
      .eq('checkout_request_id', checkoutRequestId)
      .maybeSingle();
    return data || null;
  }, []);

  const applyLoan = useCallback(async (form) => {
    const { error } = await supabase.from('sacco_loans').insert({
      admin_id: me?.admin_id, sacco_id: me?.sacco_id, member_id: me?.id,
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
  }, [me, fetchLoans]);

  // ── Share market ──────────────────────────────────────────────────────────
  // Members no longer write the order book directly: every action goes through
  // the share engine's SECURITY DEFINER RPCs, which own the escrow, the holding
  // limits and the cost basis, and settle the trade in one transaction.
  const shareRpc = useCallback(async (fn, args = {}) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message || 'The share market rejected that action.');
    return data;
  }, []);

  const refreshMarket = useCallback(async () => {
    await Promise.all([
      fetchShares(), fetchListings(), fetchTransfers(), fetchSharePrices(),
      fetchSaccoTotals(), fetchShareTxns(), fetchMyCertificates(), fetchMyDividends(),
    ]);
  }, [fetchShares, fetchListings, fetchTransfers, fetchSharePrices,
      fetchSaccoTotals, fetchShareTxns, fetchMyCertificates, fetchMyDividends]);

  // Post a sell (or buy) order onto the book.
  const createListing = useCallback(async (form) => {
    const data = await shareRpc('sacco_share_place_order', {
      p_side: form.side || 'sell',
      p_shares: parseInt(form.shares, 10) || 0,
      p_price: parseFloat(form.price_per_share) || 0,
      p_expiry: form.expiry_date || null,
      p_member_id: null,
      p_as_treasury: false,
    });
    await refreshMarket();
    return data;
  }, [shareRpc, refreshMarket]);

  const cancelListing = useCallback(async (listing) => {
    const data = await shareRpc('sacco_share_cancel_order', { p_id: listing.id, p_reason: null });
    await refreshMarket();
    return data;
  }, [shareRpc, refreshMarket]);

  const updateListing = useCallback(async (listing, patch) => {
    const data = await shareRpc('sacco_share_update_order', {
      p_id: listing.id,
      p_shares: patch.shares !== undefined ? (parseInt(patch.shares, 10) || 0) : listing.shares,
      p_price: patch.price_per_share !== undefined
        ? (parseFloat(patch.price_per_share) || 0) : listing.price_per_share,
      p_expiry: patch.expiry_date !== undefined ? (patch.expiry_date || null) : (listing.expiry_date || null),
    });
    await refreshMarket();
    return data;
  }, [shareRpc, refreshMarket]);

  // Take an order off the book. Partial fills are allowed when the society's
  // rules permit them, so `shares` may be fewer than the order's full size.
  const buyListing = useCallback(async (listing, shareCount) => {
    const data = await shareRpc('sacco_share_execute_order', {
      p_listing_id: listing.id,
      p_shares: shareCount ? parseInt(shareCount, 10) : null,
      p_member_id: null,
      p_as_treasury: false,
    });
    await refreshMarket();
    return data;
  }, [shareRpc, refreshMarket]);

  // Gift/transfer shares to a fellow member, when the society allows it.
  const transferShares = useCallback(async ({ to_member, shares: qty, reason }) => {
    const data = await shareRpc('sacco_share_direct_transfer', {
      p_shares: parseInt(qty, 10) || 0,
      p_price: 0,
      p_from_member: null,
      p_to_member: to_member,
      p_from_treasury: false,
      p_to_treasury: false,
      p_reason: reason || null,
    });
    await refreshMarket();
    return data;
  }, [shareRpc, refreshMarket]);

  const proposeMotion = useCallback(async (form) => {
    const { error } = await supabase.from('sacco_motions').insert({
      admin_id: me?.admin_id, sacco_id: me?.sacco_id, title: form.title,
      description: form.description || '', ballot_type: form.ballot_type || 'visible',
      proposer_id: me?.id, status: 'proposed',
      quorum_percent: parseInt(form.quorum_percent, 10) || 0,
    });
    if (error) throw error;
    await fetchMotions();
  }, [me, fetchMotions]);

  const secondMotion = useCallback(async (motion) => {
    const { error } = await supabase.from('sacco_motions')
      .update({ seconder_id: me?.id, status: 'seconded', updated_at: new Date().toISOString() })
      .eq('id', motion.id);
    if (error) throw error;
    await fetchMotions();
  }, [me, fetchMotions]);

  const castVote = useCallback(async (motion, choice) => {
    const { error } = await supabase.from('sacco_votes').upsert({
      admin_id: me?.admin_id, motion_id: motion.id, member_id: me?.id,
      choice, is_secret: motion.ballot_type === 'secret',
    }, { onConflict: 'motion_id,member_id' });
    if (error) throw error;
    await fetchVotes();
  }, [me, fetchVotes]);

  // Aggregate totals — the only way members see secret ballot results (VT1.5).
  const getMotionResults = useCallback(async (motionId) => {
    const { data, error } = await supabase.rpc('sacco_motion_results', { p_motion_id: motionId });
    if (error) throw error;
    return data?.[0] || { yes_count: 0, no_count: 0, abstain_count: 0, total_votes: 0 };
  }, []);

  // ── Elections (polling station) ────────────────────────────────────────────
  const nominateCandidate = useCallback(async (form) => {
    const { error } = await supabase.from('sacco_election_candidates').insert({
      admin_id: me?.admin_id, sacco_id: me?.sacco_id,
      election_id: form.election_id, position_id: form.position_id,
      member_id: form.member_id || me?.id,       // self-nomination by default
      nominated_by: me?.id, status: 'pending',
      manifesto: form.manifesto || '',
    });
    if (error) throw error;
    await fetchElectionCandidates();
  }, [me, fetchElectionCandidates]);

  const withdrawCandidacy = useCallback(async (candidate) => {
    const { error } = await supabase.from('sacco_election_candidates')
      .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
      .eq('id', candidate.id);
    if (error) throw error;
    await fetchElectionCandidates();
  }, [fetchElectionCandidates]);

  // Cast the ballot — one atomic RPC, final once cast. Returns the anonymous
  // receipt code; this is the ONLY time it is ever revealed (the DB keeps no
  // link between the member and their ballot).
  const castBallot = useCallback(async (electionId, choices) => {
    const { data, error } = await supabase.rpc('sacco_election_cast_ballot', {
      p_election_id: electionId, p_choices: choices,
    });
    if (error) throw error;
    await fetchMyVoterRows();
    return data;
  }, [fetchMyVoterRows]);

  // Aggregate results — the DB returns nothing until they're published.
  const getElectionTally = useCallback(async (electionId) => {
    const { data, error } = await supabase.rpc('sacco_election_tally', { p_election_id: electionId });
    if (error) throw error;
    return data || [];
  }, []);

  const getElectionTurnout = useCallback(async (electionId) => {
    const { data, error } = await supabase.rpc('sacco_election_turnout', { p_election_id: electionId });
    if (error) throw error;
    return data?.[0] || { registered: 0, voted: 0, percent: 0 };
  }, []);

  const verifyReceipt = useCallback(async (electionId, code) => {
    const { data, error } = await supabase.rpc('sacco_election_verify_receipt', {
      p_election_id: electionId, p_receipt: code,
    });
    if (error) throw error;
    return data || [];
  }, []);

  // ── CSV export (same helper as the sacco dashboard) ───────────────────────
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

  // ── Reset ─────────────────────────────────────────────────────────────────
  // This is one member's own financial position — savings, loans, shares,
  // ballots. It must be gone the moment the session that owns it ends.
  const resetState = useCallback(() => {
    setMe(null);
    setSacco(null);
    setMembers([]);
    setContributions([]);
    setContributionTypes([]);
    setContributionStats(null);
    setLoanProducts([]);
    setLoans([]);
    setSchedules([]);
    setShares([]);
    setListings([]);
    setTransfers([]);
    setSharePrices([]);
    setSaccoTotals({ totalShares: 0, totalMarketValue: 0, shareholders: 0 });
    setShareSettings(null);
    setShareTxns([]);
    setCertificates([]);
    setDividends([]);
    setDividendAllocations([]);
    setTreasury(null);
    setMotions([]);
    setVotes([]);
    setElections([]);
    setElectionPositions([]);
    setElectionCandidates([]);
    setMyVoterRows([]);
    setDocuments([]);
    setContracts([]);
    setLoading(true);
  }, []);

  // ── Initial load — only for sacco members ─────────────────────────────────
  // The reset runs first and only when the signed-in user actually changes, so
  // a different member (or a sign-out) never leaves the previous member's
  // position on screen. `isMember` arrives a tick after the session, which is
  // why the load is keyed on both.
  const memberUserIdRef = useRef(null);
  useEffect(() => {
    const uid = user?.id ?? null;
    if (memberUserIdRef.current !== uid) {
      memberUserIdRef.current = uid;
      resetState();
    }
    if (!uid || !isMember) return;
    fetchAll();
  }, [isMember, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMember) return undefined;
    const t = Date.now();
    const mk = (name, table, cb) => supabase
      .channel(`sacco_member_${name}_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, cb)
      .subscribe();

    const chs = [
      mk('contribs', 'sacco_contributions', () => { fetchContributions(); fetchContributionStats(); }),
      mk('loans', 'sacco_loans', () => { fetchLoans(); fetchSchedules(); }),
      mk('shares', 'sacco_shares', fetchShares),
      mk('share_prices', 'sacco_share_prices', fetchSharePrices),
      mk('listings', 'sacco_share_listings', fetchListings),
      // A live market: an order taken by someone else must vanish immediately.
      mk('share_transfers', 'sacco_share_transfers', () => { fetchTransfers(); fetchShareTxns(); }),
      mk('share_treasury', 'sacco_share_treasury', fetchTreasury),
      mk('share_certs', 'sacco_share_certificates', fetchMyCertificates),
      mk('dividends', 'sacco_dividend_declarations', fetchMyDividends),
      mk('motions', 'sacco_motions', fetchMotions),
      mk('votes', 'sacco_votes', fetchVotes),
      mk('elections', 'sacco_elections', fetchElections),
      mk('elect_cands', 'sacco_election_candidates', fetchElectionCandidates),
      mk('elect_voters', 'sacco_election_voters', fetchMyVoterRows),
    ];
    channelsRef.current = chs;
    return () => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [isMember]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    me, sacco, members, contributions, contributionStats, contributionTypes, loanProducts, loans, schedules,
    shares: myShares, sharePrices, currentMarketValue, saccoTotals, listings, transfers, motions, votes, documents, contracts,
    elections, electionPositions, electionCandidates, myVoterRows,
    shareSettings, shareTxns, certificates, dividends, dividendAllocations, treasury,
    stats, loading,
    refetch: fetchAll,
    updateProfile, applyLoan,
    submitContribution, cancelContribution, payContributionByMpesa, checkMpesaContribution,
    createListing, cancelListing, updateListing, buyListing, transferShares, refreshMarket,
    proposeMotion, secondMotion, castVote, getMotionResults,
    nominateCandidate, withdrawCandidacy, castBallot,
    getElectionTally, getElectionTurnout, verifyReceipt,
    exportCSV,
  };

  return (
    <SaccoMemberContext.Provider value={value}>
      {children}
    </SaccoMemberContext.Provider>
  );
};

export const useSaccoMemberContext = () => {
  const ctx = useContext(SaccoMemberContext);
  if (!ctx) throw new Error('useSaccoMemberContext must be used within SaccoMemberProvider');
  return ctx;
};

export default SaccoMemberContext;
