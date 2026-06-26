import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { auditLogsService } from '../services/supabaseService';

export const useSalesAgentPortal = () => {
  const { user, userProfile } = useAuth();
  const [agentProfile, setAgentProfile] = useState(null);
  // What this agent registers, decided by WHO created the agent:
  //   • created by a super_admin → 'company' (registers companies / admin accounts)
  //   • created by an admin      → 'client'  (registers clients for that admin)
  const [agentMode, setAgentMode] = useState('company');
  const [leads, setLeads] = useState([]);
  const [goldAgents, setGoldAgents] = useState([]);
  const [walletTransactions, setWalletTransactions] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const channelsRef = useRef([]);

  // ── Generate a unique agent code ─────────────────────────────────────────
  const generateAgentCode = (name) => {
    const initials = (name || 'AG')
      .split(' ')
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 3);
    return `${initials}-${Date.now().toString().slice(-5)}`;
  };

  // ── Fetch or auto-create agent profile ───────────────────────────────────
  const fetchAgentProfile = useCallback(async () => {
    if (!user?.id) return null;
    try {
      // Try to find existing agent record
      const { data, error: err } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        setAgentProfile(data);
        return data;
      }

      // If not found (PGRST116 = no rows), auto-create one
      if (err?.code === 'PGRST116') {
        const fullName = userProfile?.full_name || user?.email?.split('@')[0] || 'Sales Agent';
        const agentCode = generateAgentCode(fullName);
        const newAgent = {
          user_id:          user.id,
          full_name:        fullName,
          email:            user.email,
          phone:            userProfile?.phone || null,
          agent_code:       agentCode,
          region:           userProfile?.department || 'General',
          commission_rate:  5,
          target_amount:    0,
          total_sales:      0,
          total_commission: 0,
          agent_status:     'active',
          admin_id:         userProfile?.admin_id || null,
        };

        const { data: created, error: createErr } = await supabase
          .from('agents')
          .insert(newAgent)
          .select()
          .maybeSingle();

        if (createErr) {
          // agents table may have different columns — try minimal insert
          const { data: minimal, error: minErr } = await supabase
            .from('agents')
            .insert({ user_id: user.id, full_name: fullName, email: user.email, agent_code: agentCode })
            .select()
            .maybeSingle();

          if (minErr) throw minErr;
          setAgentProfile(minimal);
          return minimal;
        }

        setAgentProfile(created);
        return created;
      }

      throw err;
    } catch (err) {
      console.error('fetchAgentProfile error:', err?.message);
      // Return a synthetic profile so the page still renders
      const syntheticProfile = {
        id: null,
        user_id: user.id,
        full_name: userProfile?.full_name || 'Sales Agent',
        email: user.email,
        agent_code: 'PENDING',
        region: 'General',
        commission_rate: 5,
        target_amount: 0,
        total_sales: 0,
        total_commission: 0,
      };
      setAgentProfile(syntheticProfile);
      return syntheticProfile;
    }
  }, [user?.id, userProfile]);

  // ── Fetch leads ───────────────────────────────────────────────────────────
  const fetchLeads = useCallback(async (agentId) => {
    if (!agentId) return;
    try {
      const { data, error: err } = await supabase
        .from('leads')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });
      if (err) throw err;
      setLeads(data || []);
    } catch (err) {
      console.error('fetchLeads error:', err?.message);
      setLeads([]);
    }
  }, []);

  // ── Fetch gold agents (assist targets for bronze agents) ──────────────────
  const fetchGoldAgents = useCallback(async (selfAgentId) => {
    try {
      let q = supabase
        .from('agents')
        .select('id, full_name, agent_code, region, email')
        .eq('agent_plan', 'gold');
      if (selfAgentId) q = q.neq('id', selfAgentId);
      const { data, error: err } = await q.order('full_name', { ascending: true });
      if (err) throw err;
      setGoldAgents(data || []);
    } catch (err) {
      console.error('fetchGoldAgents error:', err?.message);
      setGoldAgents([]);
    }
  }, []);

  // ── Fetch wallet ──────────────────────────────────────────────────────────
  const fetchWallet = useCallback(async (agentId) => {
    if (!agentId) return;
    try {
      const { data, error: err } = await supabase
        .from('agent_wallets')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });
      if (err) throw err;
      setWalletTransactions(data || []);
    } catch (err) {
      console.error('fetchWallet error:', err?.message);
      setWalletTransactions([]);
    }
  }, []);

  // ── Fetch expenses ────────────────────────────────────────────────────────
  const fetchExpenses = useCallback(async (agentId) => {
    if (!agentId) return;
    try {
      const { data, error: err } = await supabase
        .from('sales_expenses')
        .select('*')
        .eq('agent_id', agentId)
        .order('expense_date', { ascending: false });
      if (err) throw err;
      setExpenses(data || []);
    } catch (err) {
      console.error('fetchExpenses error:', err?.message);
      setExpenses([]);
    }
  }, []);

  // ── Fetch follow-ups ──────────────────────────────────────────────────────
  const fetchFollowUps = useCallback(async (agentId) => {
    if (!agentId) return;
    try {
      const { data, error: err } = await supabase
        .from('follow_ups')
        .select('*')
        .eq('agent_id', agentId)
        .eq('is_completed', false)
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true });
      if (err) throw err;
      setFollowUps(data || []);
    } catch (err) {
      console.error('fetchFollowUps error:', err?.message);
      setFollowUps([]);
    }
  }, []);

  // ── Fetch commission records ──────────────────────────────────────────────
  const fetchCommissions = useCallback(async (agentId) => {
    if (!agentId) return;
    try {
      const { data, error: err } = await supabase
        .from('commission_records')
        .select('*, sale:sales(invoice_number, pricing_model, total_amount, sale_date)')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });
      if (err) throw err;
      setCommissions(data || []);
    } catch (err) {
      console.error('fetchCommissions error:', err?.message);
      setCommissions([]);
    }
  }, []);

  // ── Fetch activity feed ───────────────────────────────────────────────────
  const fetchActivityFeed = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error: err } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (err) throw err;
      setActivityFeed(data || []);
    } catch (err) {
      console.error('fetchActivityFeed error:', err?.message);
      setActivityFeed([]);
    }
  }, [user?.id]);

  // ── Initial load ──────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const agent = await fetchAgentProfile();

      // Resolve what this agent registers from the role of whoever created them.
      // An admin-created agent (creator role 'admin') registers clients for that
      // admin; a super-admin-created agent registers companies / admin accounts.
      try {
        const creatorId = agent?.admin_id || userProfile?.admin_id;
        if (creatorId) {
          const { data: creator } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', creatorId)
            .maybeSingle();
          setAgentMode(creator?.role === 'admin' ? 'client' : 'company');
        } else {
          setAgentMode('company');
        }
      } catch {
        setAgentMode('company');
      }

      // Load all data in parallel — even if agentId is null, each fetch guards itself
      await Promise.allSettled([
        fetchLeads(agent?.id),
        fetchWallet(agent?.id),
        fetchExpenses(agent?.id),
        fetchFollowUps(agent?.id),
        fetchActivityFeed(),
        fetchCommissions(agent?.id),
        fetchGoldAgents(agent?.id),
      ]);
    } catch (err) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, fetchAgentProfile, fetchLeads, fetchWallet, fetchExpenses, fetchFollowUps, fetchActivityFeed]);

  useEffect(() => {
    if (user?.id) loadAll();
  }, [user?.id]);

  // ── Realtime subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    if (!agentProfile?.id) return;
    const agentId = agentProfile.id;

    const leadsChannel = supabase
      .channel(`leads_${agentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `agent_id=eq.${agentId}` }, () => fetchLeads(agentId))
      .subscribe((status) => { if (status === 'SUBSCRIBED') setConnected(true); });

    const walletChannel = supabase
      .channel(`wallet_${agentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_wallets', filter: `agent_id=eq.${agentId}` }, () => fetchWallet(agentId))
      .subscribe();

    const expensesChannel = supabase
      .channel(`expenses_${agentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_expenses', filter: `agent_id=eq.${agentId}` }, () => fetchExpenses(agentId))
      .subscribe();

    const followUpsChannel = supabase
      .channel(`followups_${agentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follow_ups', filter: `agent_id=eq.${agentId}` }, () => fetchFollowUps(agentId))
      .subscribe();

    const auditChannel = supabase
      .channel(`audit_${user?.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs', filter: `user_id=eq.${user?.id}` }, () => fetchActivityFeed())
      .subscribe();

    channelsRef.current = [leadsChannel, walletChannel, expensesChannel, followUpsChannel, auditChannel];

    return () => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
      setConnected(false);
    };
  }, [agentProfile?.id]);

  // ── Computed KPIs ─────────────────────────────────────────────────────────
  const kpis = {
    totalDeals: leads.filter(l => l.stage === 'closed').length,
    leadsInPipeline: leads.filter(l => l.stage !== 'closed').length,
    totalSales: parseFloat(agentProfile?.total_sales || 0),
    totalCommission: parseFloat(agentProfile?.total_commission || 0),
    commissionThisMonth: (() => {
      const now = new Date();
      return walletTransactions
        .filter(t => {
          const d = new Date(t.created_at);
          return t.tx_type === 'credit' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        })
        .reduce((sum, t) => sum + parseFloat(t.total_earned || 0), 0);
    })(),
    walletBalance: (() => {
      const credits = walletTransactions.filter(t => t.tx_type === 'credit').reduce((s, t) => s + parseFloat(t.total_earned || 0), 0);
      const withdrawals = walletTransactions.filter(t => t.tx_type === 'withdrawal').reduce((s, t) => s + parseFloat(t.total_withdrawn || 0), 0);
      return credits - withdrawals;
    })(),
    totalEarned: walletTransactions.filter(t => t.tx_type === 'credit').reduce((s, t) => s + parseFloat(t.total_earned || 0), 0),
    totalWithdrawn: walletTransactions.filter(t => t.tx_type === 'withdrawal').reduce((s, t) => s + parseFloat(t.total_withdrawn || 0), 0),
    totalExpenses: expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0),
  };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const registerLead = useCallback(async (formData) => {
    if (!agentProfile?.id) throw new Error('Agent profile not ready. Please refresh the page.');
   const { data, error: err } = await supabase
      .from('leads')
      .insert({
        agent_id:               agentProfile.id,
        full_name:              formData.name,
        phone:                  formData.phone,
        email:                  formData.email,
        asset_interest:         formData.assetInterest,
        budget_range:           formData.budgetRange            || null,
        priority:               formData.priority || 'medium',
        stage:                  'new_lead',
        source:                 formData.source,
        notes:                  formData.notes,
        // KYC fields
        physical_address:       formData.physicalAddress       || null,
        kra_pin:                formData.kraPin                || null,
        postal_address:         formData.postalAddress         || null,
        next_of_kin_name:       formData.nextOfKinName         || null,
        next_of_kin_phone:      formData.nextOfKinPhone        || null,
        next_of_kin_relationship: formData.nextOfKinRelationship || null,
      })
      .select()
      .maybeSingle();
    if (err) throw err;
    await auditLogsService.log(
      'create',
      'leads',
      `Sales agent registered new lead: ${formData.name} (${formData.phone || ''}) — Interest: ${formData.assetInterest || ''}`,
      data.id,
      null,
      { name: formData.name, phone: formData.phone, email: formData.email, asset_interest: formData.assetInterest, agent_code: agentProfile?.agent_code }
    );
    return data;
  }, [agentProfile?.id, user?.id]);

  const updateLeadStage = useCallback(async (leadId, newStage) => {
    const { error: err } = await supabase
      .from('leads')
      .update({ stage: newStage, updated_at: new Date().toISOString() })
      .eq('id', leadId);
    if (err) throw err;
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: newStage } : l));
    await auditLogsService.log(
      'update',
      'leads',
      `Lead stage updated to "${newStage.replace(/_/g, ' ')}" by agent ${agentProfile?.agent_code || ''}`,
      leadId,
      null,
      { stage: newStage, agent_code: agentProfile?.agent_code }
    );
  }, [user?.id, agentProfile]);

  const requestWithdrawal = useCallback(async (amount, description) => {
    if (!agentProfile?.id) throw new Error('Agent profile not ready.');
    const { data, error: err } = await supabase
      .from('agent_wallets')
      .insert({
        agent_id: agentProfile.id,
        total_earned: 0,
        total_withdrawn: parseFloat(amount),
        available_balance: -parseFloat(amount),
        tx_type: 'withdrawal',
        description: description || 'Withdrawal request',
      })
      .select()
      .maybeSingle();
    if (err) throw err;
    await auditLogsService.log(
      'create',
      'agent_wallets',
      `Commission withdrawal request: KES ${amount} by agent ${agentProfile?.agent_code || ''} — ${description || ''}`,
      data.id,
      null,
      { amount, agent_code: agentProfile?.agent_code, description }
    );
    return data;
  }, [agentProfile?.id, user?.id]);

  const logExpense = useCallback(async (expenseData) => {
    if (!agentProfile?.id) throw new Error('Agent profile not ready.');
    const { data, error: err } = await supabase
      .from('sales_expenses')
      .insert({
        agent_id: agentProfile.id,
        lead_id: expenseData.leadId || null,
        category: expenseData.category || 'other',
        amount: parseFloat(expenseData.amount),
        description: expenseData.description,
        expense_date: expenseData.date || new Date().toISOString().split('T')[0],
      })
      .select()
      .maybeSingle();
    if (err) throw err;
    await auditLogsService.log(
      'create',
      'sales_expenses',
      `Expense logged by agent ${agentProfile?.agent_code || ''}: ${expenseData.category} — KES ${expenseData.amount}`,
      data.id,
      null,
      { category: expenseData.category, amount: expenseData.amount, agent_code: agentProfile?.agent_code }
    );
    return data;
  }, [agentProfile?.id, user?.id]);

  // ── Assign a gold agent to assist with an admin (bronze agents) ──────────────
  // The DB trigger credits the chosen gold agent KES 1000 on insert.
  const assignAssist = useCallback(async ({ goldAgentId, adminName, adminId }) => {
    if (!agentProfile?.id) throw new Error('Agent profile not ready. Please refresh the page.');
    if (!goldAgentId) throw new Error('Please select a gold agent.');
    const { data, error: err } = await supabase
      .from('agent_assists')
      .insert({
        bronze_agent_id: agentProfile.id,
        gold_agent_id:   goldAgentId,
        admin_id:        adminId   || null,
        admin_name:      adminName || null,
        amount:          1000,
        status:          'assigned',
      })
      .select()
      .maybeSingle();
    if (err) throw err;
    await auditLogsService.log(
      'create',
      'agent_assists',
      `Agent ${agentProfile?.agent_code || ''} assigned a gold agent to onboard admin ${adminName || ''} (KES 1000 commission)`,
      data?.id,
      null,
      { gold_agent_id: goldAgentId, admin_name: adminName, amount: 1000, bronze_agent_code: agentProfile?.agent_code }
    );
    return data;
  }, [agentProfile?.id]);

  // Commission KPIs
  const commissionKpis = {
    totalPending:  commissions.filter(c => c.status === 'pending').reduce((s,c) => s + parseFloat(c.commission_amount || 0), 0),
    totalApproved: commissions.filter(c => c.status === 'approved').reduce((s,c) => s + parseFloat(c.commission_amount || 0), 0),
    totalPaid:     commissions.filter(c => c.status === 'paid').reduce((s,c) => s + parseFloat(c.commission_amount || 0), 0),
    totalEarned:   commissions.reduce((s,c) => s + parseFloat(c.commission_amount || 0), 0),
    count:         commissions.length,
  };

  return {
    agentProfile,
    agentMode,
    goldAgents,
    leads,
    walletTransactions,
    expenses,
    followUps,
    activityFeed,
    commissions,
    commissionKpis,
    kpis,
    loading,
    connected,
    error,
    registerLead,
    updateLeadStage,
    requestWithdrawal,
    logExpense,
    assignAssist,
    refetch: loadAll,
  };
};

export default useSalesAgentPortal;