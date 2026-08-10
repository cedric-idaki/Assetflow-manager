import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { auditLogsService } from '../services/supabaseService';
import { sendAssistRequest, sendAssistUpdate } from '../services/emailService';
import {
  helpTypeLabel, declineReasonLabel, isHelpType, isDeclineReason,
} from '../utils/assistReasons';

// What a gold agent earns for taking an admin through onboarding on a bronze
// agent's behalf. Paid on completion, not on request.
export const ASSIST_FEE = 1000;

const portalUrl = () =>
  (typeof window !== 'undefined' ? `${window.location.origin}/sales-agent-portal` : '');

// Assist notifications are a courtesy on top of the portal, which already shows
// the request in realtime. A bounced mailbox must never fail the action itself.
const notify = (send) => {
  Promise.resolve()
    .then(send)
    .catch(err => console.error('assist notification failed:', err?.message));
};

export const useSalesAgentPortal = () => {
  const { user, userProfile } = useAuth();
  const [agentProfile, setAgentProfile] = useState(null);
  // What this agent registers:
  //   • agents.agent_type 'sacco'  → 'sacco'  (registers saccos — created from /sacco-oversight)
  //   otherwise decided by WHO created the agent:
  //   • created by a super_admin → 'company' (registers companies / admin accounts)
  //   • created by an admin      → 'client'  (registers clients for that admin)
  const [agentMode, setAgentMode] = useState('company');
  const [leads, setLeads] = useState([]);
  const [goldAgents, setGoldAgents] = useState([]);
  // Assist requests this agent is party to — as the bronze agent who asked for
  // help, or the gold agent being asked. RLS returns both sides.
  const [assists, setAssists] = useState([]);
  // A failed fetch and a genuinely empty inbox look identical once the rows are
  // gone, and "no bronze agent needs help" is the more believable of the two —
  // so the gold agent would sit on unanswered requests thinking there were none.
  const [assistsError, setAssistsError] = useState(null);
  const [walletTransactions, setWalletTransactions] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [completedFollowUps, setCompletedFollowUps] = useState([]);
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

  // ── Fetch assist requests (both directions) ───────────────────────────────
  // The gold agent's inbox and the bronze agent's sent list are the same rows
  // read from opposite ends, so one query serves both.
  const fetchAssists = useCallback(async (agentId) => {
    if (!agentId) return;
    const cols  = 'id, full_name, agent_code, region, phone, email';
    const scope = `bronze_agent_id.eq.${agentId},gold_agent_id.eq.${agentId}`;
    try {
      const { data, error: err } = await supabase
        .from('agent_assists')
        .select(
          `*,
           bronze:agents!agent_assists_bronze_agent_id_fkey(${cols}),
           gold:agents!agent_assists_gold_agent_id_fkey(${cols})`
        )
        .or(scope)
        .order('created_at', { ascending: false });
      if (err) throw err;
      setAssists(data || []);
      setAssistsError(null);
    } catch (err) {
      // The embed depends on the FK constraint names and on agents RLS letting
      // this agent read their counterpart. Neither is worth an empty inbox —
      // fall back to the bare rows and stitch the names on separately.
      console.error('fetchAssists embed failed, retrying flat:', err?.message);
      try {
        const { data, error: flatErr } = await supabase
          .from('agent_assists')
          .select('*')
          .or(scope)
          .order('created_at', { ascending: false });
        if (flatErr) throw flatErr;

        const rows = data || [];
        const ids  = [...new Set(rows.flatMap(r => [r.bronze_agent_id, r.gold_agent_id]).filter(Boolean))];
        let byId = {};
        if (ids.length) {
          const { data: people } = await supabase.from('agents').select(cols).in('id', ids);
          byId = Object.fromEntries((people || []).map(p => [p.id, p]));
        }
        setAssists(rows.map(r => ({
          ...r,
          bronze: byId[r.bronze_agent_id] || null,
          gold:   byId[r.gold_agent_id]   || null,
        })));
        setAssistsError(null);
      } catch (flatErr) {
        console.error('fetchAssists error:', flatErr?.message);
        setAssists([]);
        setAssistsError(flatErr?.message || 'Could not load assist requests.');
      }
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
  // Every OPEN follow-up, including ones already past their time. The old query
  // filtered to scheduled_at >= now, which silently hid exactly the appointments
  // an agent has missed — the ones they most need to see.
  const fetchFollowUps = useCallback(async (agentId) => {
    if (!agentId) return;
    try {
      const { data, error: err } = await supabase
        .from('follow_ups')
        .select('*')
        .eq('agent_id', agentId)
        .eq('is_completed', false)
        .order('scheduled_at', { ascending: true });
      if (err) throw err;
      setFollowUps(data || []);
    } catch (err) {
      console.error('fetchFollowUps error:', err?.message);
      setFollowUps([]);
    }
  }, []);

  // ── Fetch completed follow-ups (recent history for the panel) ─────────────
  const fetchCompletedFollowUps = useCallback(async (agentId) => {
    if (!agentId) return;
    try {
      const { data, error: err } = await supabase
        .from('follow_ups')
        .select('*')
        .eq('agent_id', agentId)
        .eq('is_completed', true)
        .order('completed_at', { ascending: false })
        .limit(20);
      if (err) throw err;
      setCompletedFollowUps(data || []);
    } catch (err) {
      console.error('fetchCompletedFollowUps error:', err?.message);
      setCompletedFollowUps([]);
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

      // Resolve what this agent registers. Sacco-side agents are tagged on the
      // agents row itself (agent_type 'sacco', set from /sacco-oversight); for
      // the rest it comes from the role of whoever created them: an
      // admin-created agent registers clients for that admin, a
      // super-admin-created agent registers companies / admin accounts.
      if (agent?.agent_type === 'sacco') {
        setAgentMode('sacco');
      } else try {
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
        fetchCompletedFollowUps(agent?.id),
        fetchActivityFeed(),
        fetchCommissions(agent?.id),
        fetchGoldAgents(agent?.id),
        fetchAssists(agent?.id),
      ]);
    } catch (err) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, fetchAgentProfile, fetchLeads, fetchWallet, fetchExpenses, fetchFollowUps, fetchCompletedFollowUps, fetchActivityFeed, fetchAssists]);

  useEffect(() => {
    if (user?.id) loadAll();
  }, [user?.id]);

  // ── Realtime subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    if (!agentProfile?.id) return;
    const agentId = agentProfile.id;

    const agentProfileChannel = supabase
      .channel(`agent_profile_${agentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents', filter: `id=eq.${agentId}` }, async (payload) => {
        if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
          const nextProfile = payload.new || payload?.new?.[0] || null;
          if (nextProfile) {
            setAgentProfile(prev => ({ ...(prev || {}), ...nextProfile }));
            if (nextProfile.agent_plan !== agentProfile?.agent_plan) {
              await loadAll();
            }
          }
        }
      })
      .subscribe();

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follow_ups', filter: `agent_id=eq.${agentId}` }, () => {
        fetchFollowUps(agentId);
        fetchCompletedFollowUps(agentId);
      })
      .subscribe();

    const auditChannel = supabase
      .channel(`audit_${user?.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs', filter: `user_id=eq.${user?.id}` }, () => fetchActivityFeed())
      .subscribe();

    // A realtime filter matches one column, so each side of an assist needs its
    // own channel. The incoming one is the point of the feature: a gold agent
    // should see "someone needs help" while it is still useful, not at payday.
    const assistsInChannel = supabase
      .channel(`assists_in_${agentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_assists', filter: `gold_agent_id=eq.${agentId}` }, () => fetchAssists(agentId))
      .subscribe();

    const assistsOutChannel = supabase
      .channel(`assists_out_${agentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_assists', filter: `bronze_agent_id=eq.${agentId}` }, () => fetchAssists(agentId))
      .subscribe();

    channelsRef.current = [agentProfileChannel, leadsChannel, walletChannel, expensesChannel, followUpsChannel, auditChannel, assistsInChannel, assistsOutChannel];

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

  // ── Follow-ups / appointments ─────────────────────────────────────────────
  // "Check me next week" becomes a row here. remind_at drives both the portal
  // badge and the reminder email sent by the agent-followup-reminders worker;
  // the DB trigger defaults it to an hour before the appointment when omitted.
  const scheduleFollowUp = useCallback(async ({
    leadId, leadName, appointmentType, scheduledAt, remindAt, location, notes,
  }) => {
    if (!agentProfile?.id) throw new Error('Agent profile not ready. Please refresh the page.');
    if (!scheduledAt) throw new Error('Pick a date and time for the appointment.');

    const { data, error: err } = await supabase
      .from('follow_ups')
      .insert({
        agent_id:         agentProfile.id,
        lead_id:          leadId   || null,
        lead_name:        leadName || null,
        appointment_type: appointmentType || 'follow_up',
        scheduled_at:     new Date(scheduledAt).toISOString(),
        remind_at:        remindAt ? new Date(remindAt).toISOString() : null,
        location:         location || null,
        notes:            notes    || null,
        is_completed:     false,
      })
      .select()
      .maybeSingle();
    if (err) throw err;

    // Audit log doubles as the in-app notification — the header bell reads
    // audit_logs, so scheduling one shows up there without a second table.
    await auditLogsService.log(
      'create',
      'follow_ups',
      `Follow-up scheduled with ${leadName || 'a lead'} on ${new Date(scheduledAt).toLocaleString('en-GB')}${location ? ` at ${location}` : ''}`,
      data?.id,
      null,
      {
        lead_id: leadId, lead_name: leadName, scheduled_at: scheduledAt,
        appointment_type: appointmentType, agent_code: agentProfile?.agent_code,
      }
    );
    return data;
  }, [agentProfile?.id, agentProfile?.agent_code]);

  const rescheduleFollowUp = useCallback(async (followUpId, newScheduledAt, newRemindAt) => {
    // The DB trigger clears reminder_sent_at when scheduled_at moves, so a
    // pushed-back appointment gets a fresh reminder instead of staying silent.
    const { error: err } = await supabase
      .from('follow_ups')
      .update({
        scheduled_at: new Date(newScheduledAt).toISOString(),
        ...(newRemindAt ? { remind_at: new Date(newRemindAt).toISOString() } : {}),
      })
      .eq('id', followUpId);
    if (err) throw err;
    await fetchFollowUps(agentProfile?.id);
  }, [agentProfile?.id, fetchFollowUps]);

  const completeFollowUp = useCallback(async (followUpId, outcome) => {
    const { data, error: err } = await supabase
      .from('follow_ups')
      .update({ is_completed: true, outcome: outcome || null })
      .eq('id', followUpId)
      .select()
      .maybeSingle();
    if (err) throw err;
    await auditLogsService.log(
      'update',
      'follow_ups',
      `Follow-up with ${data?.lead_name || 'lead'} marked done${outcome ? ` — ${outcome}` : ''}`,
      followUpId,
      null,
      { outcome, agent_code: agentProfile?.agent_code }
    );
    await Promise.allSettled([
      fetchFollowUps(agentProfile?.id),
      fetchCompletedFollowUps(agentProfile?.id),
    ]);
    return data;
  }, [agentProfile?.id, agentProfile?.agent_code, fetchFollowUps, fetchCompletedFollowUps]);

  const cancelFollowUp = useCallback(async (followUpId) => {
    const { error: err } = await supabase.from('follow_ups').delete().eq('id', followUpId);
    if (err) throw err;
    await fetchFollowUps(agentProfile?.id);
  }, [agentProfile?.id, fetchFollowUps]);

  // ── Mark a lead as converted into a paying account ────────────────────────
  // Called once the client confirms they want to proceed AND the account has
  // actually been created, so the lead can never be registered twice.
  const markLeadConverted = useCallback(async (leadId, { entity, refId } = {}) => {
    if (!leadId) return null;
    const patch = {
      stage:        'closed',
      converted_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    };
    if (entity) patch.converted_entity = entity;
    if (refId)  patch.converted_ref_id = refId;

    const { data, error: err } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', leadId)
      .select()
      .maybeSingle();
    if (err) throw err;

    setLeads(prev => prev.map(l => (l.id === leadId ? { ...l, ...patch } : l)));
    await auditLogsService.log(
      'update',
      'leads',
      `Lead "${data?.full_name || ''}" converted to ${entity || 'an account'} by agent ${agentProfile?.agent_code || ''}`,
      leadId,
      null,
      { converted_entity: entity, converted_ref_id: refId, agent_code: agentProfile?.agent_code }
    );
    return data;
  }, [agentProfile?.agent_code]);

  // ── Assist requests ───────────────────────────────────────────────────────
  // A bronze agent ASKS a gold agent for help onboarding an admin. The request
  // starts at 'requested' (the DB trigger forces it) and the gold agent's
  // KES 1000 is only credited when they mark the assist complete.
  const assignAssist = useCallback(async ({ goldAgentId, adminName, adminId, helpType, note }) => {
    if (!agentProfile?.id) throw new Error('Agent profile not ready. Please refresh the page.');
    if (!goldAgentId) throw new Error('Please select a gold agent.');
    const { data, error: err } = await supabase
      .from('agent_assists')
      .insert({
        bronze_agent_id: agentProfile.id,
        gold_agent_id:   goldAgentId,
        admin_id:        adminId   || null,
        admin_name:      adminName || null,
        help_type:       isHelpType(helpType) ? helpType : 'other',
        note:            note      || null,
        amount:          ASSIST_FEE,
        status:          'requested',
      })
      .select()
      .maybeSingle();
    if (err) throw err;
    await auditLogsService.log(
      'create',
      'agent_assists',
      `Agent ${agentProfile?.agent_code || ''} asked a gold agent for help onboarding admin ${adminName || ''} — ${helpTypeLabel(helpType)} (KES ${ASSIST_FEE} on completion)`,
      data?.id,
      null,
      { gold_agent_id: goldAgentId, admin_name: adminName, amount: ASSIST_FEE, help_type: helpType, note, bronze_agent_code: agentProfile?.agent_code }
    );

    // Email the gold agent — most of the time they are not looking at the portal.
    const gold = (goldAgents || []).find(g => g.id === goldAgentId);
    if (gold?.email) {
      notify(() => sendAssistRequest(gold.email, {
        goldName:    gold.full_name,
        bronzeName:  agentProfile?.full_name,
        bronzeCode:  agentProfile?.agent_code,
        bronzePhone: agentProfile?.phone,
        bronzeEmail: agentProfile?.email,
        adminName,
        helpType:    helpTypeLabel(helpType),
        note,
        amount:      ASSIST_FEE,
        portalUrl:   portalUrl(),
      }));
    }
    return data;
  }, [agentProfile, goldAgents]);

  // Gold side: accept or decline a pending request. A decline carries a reason —
  // the DB guard rejects one without it, so the picker in the panel is not the
  // only thing standing between the bronze agent and an unexplained "no".
  const respondToAssist = useCallback(async (assist, decision, reason) => {
    if (!['accepted', 'declined'].includes(decision)) throw new Error('Invalid response.');
    // Callers pass { reasonCode, reason } now; a bare string is still honoured so
    // an older call site degrades to "other" rather than throwing.
    const { reasonCode, reasonText } = typeof reason === 'string'
      ? { reasonCode: null, reasonText: reason }
      : { reasonCode: reason?.reasonCode || null, reasonText: reason?.reason || '' };

    if (decision === 'declined' && !reasonCode && !reasonText.trim()) {
      throw new Error('Pick a reason before declining — the agent who asked needs to know why.');
    }

    const assistId  = assist?.id || assist;
    const label     = declineReasonLabel(reasonCode);
    // What the bronze agent reads: the picked reason, plus their words when given.
    const fullReason = decision === 'declined'
      ? [label, reasonText.trim()].filter(Boolean).join(' — ')
      : null;

    const { data, error: err } = await supabase
      .from('agent_assists')
      .update({
        status:              decision,
        decline_reason_code: decision === 'declined' ? (isDeclineReason(reasonCode) ? reasonCode : 'other') : null,
        decline_reason:      fullReason,
      })
      .eq('id', assistId)
      .select()
      .maybeSingle();
    if (err) throw err;

    // Tell the bronze agent — a decline they never hear about is the same as
    // silence, which is what this whole feature exists to remove.
    if (assist?.bronze?.email) {
      notify(() => sendAssistUpdate(assist.bronze.email, {
        recipientName: assist.bronze.full_name,
        actorName:     agentProfile?.full_name,
        actorCode:     agentProfile?.agent_code,
        status:        decision,
        adminName:     assist.admin_name,
        declineReason: fullReason,
        portalUrl:     portalUrl(),
      }));
    }
    await auditLogsService.log(
      'update',
      'agent_assists',
      `Gold agent ${agentProfile?.agent_code || ''} ${decision} the assist for admin ${data?.admin_name || ''}${fullReason ? ` — ${fullReason}` : ''}`,
      assistId,
      null,
      { status: decision, reason: fullReason, decline_reason_code: data?.decline_reason_code, gold_agent_code: agentProfile?.agent_code }
    );
    return data;
  }, [agentProfile]);

  // Gold side: the onboarding is done — this is what releases the commission.
  const completeAssist = useCallback(async (assist, outcome) => {
    const assistId = assist?.id || assist;
    const { data, error: err } = await supabase
      .from('agent_assists')
      .update({ status: 'completed', outcome: outcome || null })
      .eq('id', assistId)
      .select()
      .maybeSingle();
    if (err) throw err;

    if (assist?.bronze?.email) {
      notify(() => sendAssistUpdate(assist.bronze.email, {
        recipientName: assist.bronze.full_name,
        actorName:     agentProfile?.full_name,
        actorCode:     agentProfile?.agent_code,
        status:        'completed',
        adminName:     assist.admin_name,
        outcome,
        amount:        data?.amount || ASSIST_FEE,
        portalUrl:     portalUrl(),
      }));
    }
    await auditLogsService.log(
      'update',
      'agent_assists',
      `Gold agent ${agentProfile?.agent_code || ''} completed the assist for admin ${data?.admin_name || ''} — KES ${data?.amount || ASSIST_FEE} credited`,
      assistId,
      null,
      { status: 'completed', outcome, amount: data?.amount, gold_agent_code: agentProfile?.agent_code }
    );
    return data;
  }, [agentProfile]);

  // Bronze side: withdraw a request that is no longer needed.
  const cancelAssist = useCallback(async (assist) => {
    const assistId = assist?.id || assist;
    const { data, error: err } = await supabase
      .from('agent_assists')
      .update({ status: 'cancelled' })
      .eq('id', assistId)
      .select()
      .maybeSingle();
    if (err) throw err;

    // Only worth an email if the gold agent had already taken it on.
    if (assist?.status === 'accepted' && assist?.gold?.email) {
      notify(() => sendAssistUpdate(assist.gold.email, {
        recipientName: assist.gold.full_name,
        actorName:     agentProfile?.full_name,
        actorCode:     agentProfile?.agent_code,
        status:        'cancelled',
        adminName:     assist.admin_name,
        portalUrl:     portalUrl(),
      }));
    }
    await auditLogsService.log(
      'update',
      'agent_assists',
      `Agent ${agentProfile?.agent_code || ''} cancelled the assist request for admin ${data?.admin_name || ''}`,
      assistId,
      null,
      { status: 'cancelled', agent_code: agentProfile?.agent_code }
    );
    return data;
  }, [agentProfile]);

  // ── Follow-up buckets — what the portal badge and panel both read ─────────
  const followUpBuckets = (() => {
    const now       = new Date();
    const endOfDay  = new Date(now); endOfDay.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(now); endOfWeek.setDate(now.getDate() + 7);

    const overdue  = [];
    const today    = [];
    const thisWeek = [];
    const later    = [];

    (followUps || []).forEach((f) => {
      const at = new Date(f.scheduled_at);
      if      (at < now)       overdue.push(f);
      else if (at <= endOfDay) today.push(f);
      else if (at <= endOfWeek) thisWeek.push(f);
      else                      later.push(f);
    });

    return {
      overdue, today, thisWeek, later,
      // What the bell-style badge shows: things needing attention right now.
      actionable: overdue.length + today.length,
      total: (followUps || []).length,
    };
  })();

  // ── Assist buckets — the gold agent's inbox and the bronze agent's sent list ─
  const assistBuckets = (() => {
    const me       = agentProfile?.id;
    const incoming = (assists || []).filter(a => me && a.gold_agent_id === me);
    const outgoing = (assists || []).filter(a => me && a.bronze_agent_id === me);

    const pending  = incoming.filter(a => a.status === 'requested');
    const active   = incoming.filter(a => a.status === 'accepted');

    return {
      incoming,
      outgoing,
      pending,
      active,
      history:  incoming.filter(a => ['completed', 'declined', 'cancelled'].includes(a.status)),
      // The header badge: requests waiting on this agent plus jobs they accepted
      // and have not closed out (an accepted assist is unpaid until completed).
      actionable: pending.length + active.length,
      // Money sitting on the table — accepted work not yet marked complete.
      unclaimed: active.reduce((s, a) => s + parseFloat(a.amount || 0), 0),
    };
  })();

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
    completedFollowUps,
    followUpBuckets,
    activityFeed,
    commissions,
    commissionKpis,
    kpis,
    loading,
    connected,
    error,
    registerLead,
    updateLeadStage,
    markLeadConverted,
    scheduleFollowUp,
    rescheduleFollowUp,
    completeFollowUp,
    cancelFollowUp,
    requestWithdrawal,
    logExpense,
    assists,
    assistBuckets,
    assistsError,
    refetchAssists: () => fetchAssists(agentProfile?.id),
    assignAssist,
    respondToAssist,
    completeAssist,
    cancelAssist,
    refetch: loadAll,
  };
};

export default useSalesAgentPortal;