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
  const [loanProducts,  setLoanProducts]  = useState([]);
  const [loans,         setLoans]         = useState([]);
  const [schedules,     setSchedules]     = useState([]);
  const [shares,        setShares]        = useState([]);
  const [listings,      setListings]      = useState([]);
  const [transfers,     setTransfers]     = useState([]);
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
    const { data } = await supabase.from('sacco_contributions').select('*')
      .order('due_date', { ascending: false });
    setContributions(data || []);
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
      fetchMembers(), fetchContributions(), fetchLoanProducts(), fetchLoans(),
      fetchSchedules(), fetchShares(), fetchListings(), fetchTransfers(),
      fetchMotions(), fetchVotes(), fetchDocuments(), fetchContracts(meRow?.id),
      fetchElections(), fetchElectionPositions(), fetchElectionCandidates(), fetchMyVoterRows(),
    ]);
    setLoading(false);
  }, [
    fetchMe, fetchSacco, fetchMembers, fetchContributions, fetchLoanProducts,
    fetchLoans, fetchSchedules, fetchShares, fetchListings, fetchTransfers,
    fetchMotions, fetchVotes, fetchDocuments, fetchContracts,
    fetchElections, fetchElectionPositions, fetchElectionCandidates, fetchMyVoterRows,
  ]);

  // ── Derived stats (portal home mini-cards, BRS 5.1) ───────────────────────
  const totalSavings = contributions
    .filter((c) => c.status === 'paid')
    .reduce((s, c) => s + parseFloat(c.amount || 0), 0);
  const unpaidSchedule = schedules.filter((s) => !s.paid);
  const loanBalance = unpaidSchedule.reduce((s, r) => s + parseFloat(r.payment || 0), 0);
  const nextDue = unpaidSchedule
    .filter((r) => r.due_date)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0]?.due_date || null;
  const myShares = shares[0] || null;
  const shareValue = (parseInt(myShares?.shares_held, 10) || 0) * parseFloat(myShares?.par_value || 0);
  const openMotions = motions.filter((m) => m.status === 'open').length;
  // Elections needing my attention: open nominations, or an open ballot I'm
  // registered for and haven't cast yet.
  const openElections = elections.filter((e) => {
    if (e.status === 'nominations_open') return true;
    if (e.status !== 'voting_open') return false;
    const reg = myVoterRows.find((r) => r.election_id === e.id);
    return !!reg && !reg.voted_at;
  }).length;

  const stats = { totalSavings, loanBalance, nextDue, shareValue, openMotions, openElections };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateProfile = useCallback(async (patch) => {
    // Privileged columns are pinned server-side by protect_sacco_member_columns.
    const { error } = await supabase.from('sacco_members')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', me?.id);
    if (error) throw error;
    await fetchMe();
  }, [me?.id, fetchMe]);

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

  const createListing = useCallback(async (form) => {
    const { error } = await supabase.from('sacco_share_listings').insert({
      admin_id: me?.admin_id, sacco_id: me?.sacco_id, seller_member_id: me?.id,
      shares: parseInt(form.shares, 10) || 0,
      price_per_share: parseFloat(form.price_per_share) || 0,
      status: 'open', expiry_date: form.expiry_date || null,
    });
    if (error) throw error;
    await fetchListings();
  }, [me, fetchListings]);

  const cancelListing = useCallback(async (listing) => {
    const { error } = await supabase.from('sacco_share_listings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', listing.id);
    if (error) throw error;
    await fetchListings();
  }, [fetchListings]);

  // Buyer expression of interest (BRS 5.3.2 step 3) — settlement is admin-side.
  const buyListing = useCallback(async (listing) => {
    const { error } = await supabase.from('sacco_share_transfers').insert({
      admin_id: me?.admin_id, sacco_id: me?.sacco_id, listing_id: listing.id,
      seller_member_id: listing.seller_member_id, buyer_member_id: me?.id,
      shares: listing.shares, price: listing.shares * listing.price_per_share,
      status: 'pending',
    });
    if (error) throw error;
    await supabase.from('sacco_share_listings')
      .update({ status: 'pending_approval', updated_at: new Date().toISOString() })
      .eq('id', listing.id);
    await Promise.all([fetchTransfers(), fetchListings()]);
  }, [me, fetchTransfers, fetchListings]);

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

  // ── Initial load — only for sacco members ─────────────────────────────────
  useEffect(() => {
    if (!isMember || !user?.id) return;
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
      mk('contribs', 'sacco_contributions', fetchContributions),
      mk('loans', 'sacco_loans', () => { fetchLoans(); fetchSchedules(); }),
      mk('shares', 'sacco_shares', fetchShares),
      mk('listings', 'sacco_share_listings', fetchListings),
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
    me, sacco, members, contributions, loanProducts, loans, schedules,
    shares: myShares, listings, transfers, motions, votes, documents, contracts,
    elections, electionPositions, electionCandidates, myVoterRows,
    stats, loading,
    refetch: fetchAll,
    updateProfile, applyLoan,
    createListing, cancelListing, buyListing,
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
