import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '/src/lib/supabase.js';
import { useAuthScopedLoader } from './useAuthScopedLoader';
import { emailLoginCredentials } from '../services/credentialsEmailService';
import { auditLogsService } from '../services/supabaseService';

// Module-level counter, not Date.now(): a remount can land inside the same
// millisecond as the teardown before it. supabase.channel(name) RETURNS AN
// EXISTING channel for a name already in use, so the second run would get the
// first run's already-subscribed channel and .on() throws
// "cannot add `postgres_changes` callbacks ... after `subscribe()`", which the
// error boundary renders as a blank "Something went wrong" page.
// Same fix and same reasoning as useAdminDashboard and useCrmOversight.
let _superAdminDashboardChannelSeq = 0;

export const useSuperAdminDashboard = () => {
  const [stats, setStats] = useState({
    activeAccounts: 0, inactiveAccounts: 0, totalValue: 0,
    totalSales: 0, totalSalesUsers: 0, pendingRegistrations: 0, totalTransactions: 0,
  });
  const [assetBreakdown, setAssetBreakdown]     = useState([]);
  const [companyAnalytics, setCompanyAnalytics] = useState([]);
  const [auditTrail, setAuditTrail]             = useState([]);
  const [salesAgents, setSalesAgents]           = useState([]);
  const [salesTarget, setSalesTarget]           = useState({ target: 0, achieved: 0, percentage: 0 });
  const [staffUsers, setStaffUsers]             = useState([]);
  const [contracts, setContracts]               = useState([]);
  const [clients, setClients]                   = useState([]);
  const [withdrawalRequests, setWithdrawalRequests] = useState([]);
  // Every assist a gold agent turned down. Refusals used to be visible only to
  // the two agents involved, so a gold agent who declined everything looked the
  // same from up here as one nobody had asked.
  const [assistRejections, setAssistRejections] = useState([]);
  const [loading, setLoading]                   = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const channelsRef = useRef([]);

  const getAdminId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id;
  };

  const fetchStats = useCallback(async () => {
    try {
      const { count: activeAccounts } = await supabase
        .from('clients').select('id', { count: 'exact', head: true }).eq('client_status', 'active');
      const { count: inactiveAccounts } = await supabase
        .from('clients').select('id', { count: 'exact', head: true }).neq('client_status', 'active');
      const { data: assets } = await supabase.from('assets').select('selling_price, asset_status');
      const totalValue = (assets || []).reduce((s, a) => s + parseFloat(a.selling_price || 0), 0);
      const { data: completedPays } = await supabase.from('payments').select('amount, client_id').eq('payment_status', 'completed');
      const totalSales = (completedPays || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const totalSalesUsers = new Set((completedPays || []).map(p => p.client_id)).size;
      const { count: pendingRegistrations } = await supabase
        .from('user_profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', false);
      const { data: allPayments } = await supabase.from('payments').select('amount');
      const totalTransactions = (allPayments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      setStats({ activeAccounts: activeAccounts || 0, inactiveAccounts: inactiveAccounts || 0, totalValue, totalSales, totalSalesUsers, pendingRegistrations: pendingRegistrations || 0, totalTransactions });
      setConnectionStatus('connected');
    } catch (err) {
      setConnectionStatus('disconnected');
    }
  }, []);

  const fetchAssetBreakdown = useCallback(async () => {
    try {
      const { data } = await supabase.from('assets').select('asset_type, selling_price, asset_status');
      const types = {};
      (data || []).forEach(a => {
        const t = a.asset_type || 'other';
        if (!types[t]) types[t] = { type: t, count: 0, totalValue: 0, sold: 0 };
        types[t].count++;
        types[t].totalValue += parseFloat(a.selling_price || 0);
        if (a.asset_status === 'sold') types[t].sold++;
      });
      setAssetBreakdown(Object.values(types));
    } catch (err) {
      console.error('fetchAssetBreakdown error:', err.message);
    }
  }, []);

  const fetchCompanyAnalytics = useCallback(async () => {
    try {
      const { data: admins } = await supabase.from('user_profiles').select('id, full_name, email, is_active, created_at').eq('role', 'admin');
      const { data: clients } = await supabase.from('clients').select('id, client_status, outstanding_balance, created_by, created_at');
      const { data: payments } = await supabase.from('payments').select('amount, payment_status, client_id, processed_by');
      const analytics = (admins || []).map(admin => {
        const adminClients = (clients || []).filter(c => c.created_by === admin.id);
        const activeClients = adminClients.filter(c => c.client_status === 'active').length;
        const clientIds = adminClients.map(c => c.id);
        const adminPayments = (payments || []).filter(p => clientIds.includes(p.client_id));
        const totalRevenue = adminPayments.filter(p => p.payment_status === 'completed').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
        const outstanding = adminClients.reduce((s, c) => s + parseFloat(c.outstanding_balance || 0), 0);
        return { id: admin.id, name: admin.full_name || 'Unknown Company', email: admin.email, isActive: admin.is_active, totalClients: adminClients.length, activeClients, totalRevenue, outstanding, joinedDate: admin.created_at, transactionCount: adminPayments.length };
      });
      setCompanyAnalytics(analytics);
    } catch (err) {
      console.error('fetchCompanyAnalytics error:', err.message);
    }
  }, []);

  const fetchAuditTrail = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('audit_logs')
        .select('id, action, description, table_name, severity, created_at, old_values, new_values, record_id, user_id')
        .in('action', ['create', 'update', 'delete', 'login', 'logout', 'approve', 'reject', 'kyc_status_change'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (data && data.length > 0) {
        const userIds = [...new Set(data.map(log => log.user_id).filter(Boolean))];
        const { data: users } = await supabase
          .from('user_profiles')
          .select('id, full_name, role, email')
          .in('id', userIds);
        const userMap = {};
        (users || []).forEach(u => { userMap[u.id] = u; });
        setAuditTrail(data.map(log => ({ ...log, user: userMap[log.user_id] || null })));
      } else {
        setAuditTrail(data || []);
      }
    } catch (err) {
      console.error('fetchAuditTrail error:', err.message);
    }
  }, []);

  const fetchSalesAgents = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      if (!adminId) return;

      const { data, error } = await supabase
        .from('agents')
        .select('*, user:user_id(id, full_name, email, is_active), admin:admin_id(id, full_name, email)')
        // An agent belongs to whoever created them: an admin-created agent works
        // that company's clients, a super-admin-created one sells the platform.
        // Without this filter the super admin's dashboard listed every admin's
        // agents alongside their own, and RLS does not catch it — the agents
        // policy hands global viewers a blanket read.
        .eq('admin_id', adminId)
        // Sacco-side agents belong to /sacco-oversight, not the company dashboard.
        .or('agent_type.is.null,agent_type.neq.sacco')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSalesAgents(data || []);
    } catch (err) {
      console.error('fetchSalesAgents error:', err.message);
    }
  }, []);

  // Declined assists, newest first — read via the platform-wide select policy
  // added in 20260802090000. The embed needs the FK constraint names; if either
  // side fails to resolve the names are stitched on from a second query rather
  // than dropping the row, because a rejection with no gold agent attached is
  // exactly the one worth reading.
  const fetchAssistRejections = useCallback(async () => {
    const cols = 'id, full_name, agent_code, region, email, phone, agent_plan';
    try {
      const { data, error } = await supabase
        .from('agent_assists')
        .select(
          `*,
           bronze:agents!agent_assists_bronze_agent_id_fkey(${cols}),
           gold:agents!agent_assists_gold_agent_id_fkey(${cols})`
        )
        .eq('status', 'declined')
        .order('responded_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      setAssistRejections(data || []);
    } catch (err) {
      console.error('fetchAssistRejections embed failed, retrying flat:', err?.message);
      try {
        const { data, error: flatErr } = await supabase
          .from('agent_assists')
          .select('*')
          .eq('status', 'declined')
          .order('responded_at', { ascending: false, nullsFirst: false });
        if (flatErr) throw flatErr;

        const rows = data || [];
        const ids  = [...new Set(rows.flatMap(r => [r.bronze_agent_id, r.gold_agent_id]).filter(Boolean))];
        let byId = {};
        if (ids.length) {
          const { data: people } = await supabase.from('agents').select(cols).in('id', ids);
          byId = Object.fromEntries((people || []).map(p => [p.id, p]));
        }
        setAssistRejections(rows.map(r => ({
          ...r,
          bronze: byId[r.bronze_agent_id] || null,
          gold:   byId[r.gold_agent_id]   || null,
        })));
      } catch (flatErr) {
        console.error('fetchAssistRejections error:', flatErr?.message);
        setAssistRejections([]);
      }
    }
  }, []);

  const fetchSalesTarget = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      if (!adminId) return;

      // Scoped to this super admin's own agents for the same reason the list
      // above is — otherwise the target bar mixed in other admins' teams.
      const { data: agents } = await supabase
        .from('agents')
        .select('target_amount, total_sales')
        .eq('admin_id', adminId)
        .or('agent_type.is.null,agent_type.neq.sacco');
      const target = (agents || []).reduce((s, a) => s + parseFloat(a.target_amount || 0), 0);
      const achieved = (agents || []).reduce((s, a) => s + parseFloat(a.total_sales || 0), 0);
      const percentage = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
      setSalesTarget({ target, achieved, percentage });
    } catch (err) {
      console.error('fetchSalesTarget error:', err.message);
    }
  }, []);

  const fetchStaffUsers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, full_name, email, role, phone, is_active, created_at')
        .in('role', ['accountant', 'hr', 'manager', 'staff','it_support'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      setStaffUsers(data || []);
    } catch (err) {
      console.error('fetchStaffUsers error:', err.message);
    }
  }, []);

  const fetchClients = useCallback(async () => {
    const adminId = await getAdminId();
    if (!adminId) return;
    const { data } = await supabase
      .from('clients')
      .select('id, full_name, account_number')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false });
    setClients(data || []);
  }, []);

  const fetchWithdrawalRequests = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('agent_wallets')
        .select('*')
        .eq('tx_type', 'withdrawal')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = data || [];
      const agentIds = [...new Set(rows.map(r => r.agent_id).filter(Boolean))];
      let agentMap = {};

      if (agentIds.length > 0) {
        const { data: agents, error: agentError } = await supabase
          .from('agents')
          .select('id, full_name, agent_code, email')
          .in('id', agentIds);

        if (agentError) throw agentError;
        agentMap = Object.fromEntries((agents || []).map(agent => [agent.id, agent]));
      }

      setWithdrawalRequests(rows.map(row => ({
        ...row,
        status: row.status || 'pending',
        agent: agentMap[row.agent_id] || null,
      })));
    } catch (err) {
      console.error('fetchWithdrawalRequests error:', err?.message);
      setWithdrawalRequests([]);
    }
  }, []);

  /**
   * Settle one withdrawal request — the shared body of approve and reject.
   *
   * Two things here are load-bearing, and both exist because this releases
   * money and a false "done" is worse than a visible failure:
   *
   *   `.select('id')`. Without it PostgREST answers an UPDATE with 204 No
   *   Content and `error` stays NULL EVEN WHEN THE STATEMENT MATCHED NO ROW.
   *   A row-level-security policy that refuses the write is therefore
   *   indistinguishable from a successful one, and the caller would report the
   *   money as released while nothing changed. Asking for the affected ids is
   *   what turns a silent denial back into something detectable. It is not
   *   hypothetical: until 20260904120000 this table had no UPDATE policy at
   *   all, so EVERY approval took that path.
   *
   *   Throwing rather than returning when the row is unknown. This used to be
   *   a bare `return`, so clicking Approve on a request that had just been
   *   settled in another tab did nothing at all and said nothing about it.
   *
   * Callers must surface what this throws — see WithdrawalRequestsTab, which
   * is where the message reaches the person who clicked.
   */
  const settleWithdrawalRequest = useCallback(async (requestId, decision) => {
    const request = withdrawalRequests.find(r => r.id === requestId);
    if (!request) {
      throw new Error('That withdrawal request is no longer in the queue. Refresh and try again.');
    }

    const { data, error } = await supabase
      .from('agent_wallets')
      .update({
        status: decision,
        reviewed_at: new Date().toISOString(),
        reviewed_by: 'super_admin',
      })
      .eq('id', requestId)
      .select('id');

    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error(
        `The withdrawal was not ${decision} — the database accepted the request but changed no row. ` +
        'This usually means row-level security refused the update. Nothing has been paid out.'
      );
    }

    await auditLogsService.log(
      decision === 'approved' ? 'approve' : 'reject',
      'agent_wallets',
      `Super admin ${decision} withdrawal request of KES ${request.total_withdrawn || 0} for agent ${request.agent?.agent_code || 'Unknown agent'}`,
      requestId,
      null,
      { amount: request.total_withdrawn, agent_id: request.agent_id, status: decision }
    );

    await fetchWithdrawalRequests();
  }, [withdrawalRequests, fetchWithdrawalRequests]);

  const approveWithdrawalRequest = useCallback(
    (requestId) => settleWithdrawalRequest(requestId, 'approved'),
    [settleWithdrawalRequest],
  );

  const rejectWithdrawalRequest = useCallback(
    (requestId) => settleWithdrawalRequest(requestId, 'rejected'),
    [settleWithdrawalRequest],
  );

  const fetchContracts = useCallback(async () => {
    const adminId = await getAdminId();
    if (!adminId) return;
    const { data } = await supabase
      .from('company_contracts')
      .select('*, client:clients(full_name, account_number)')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false });
    setContracts(data || []);
  }, []);

  // ── Action: upload contract (mirrors admin dashboard) ────────────────────────
  const uploadContract = useCallback(async (formData, file) => {
    const adminId   = await getAdminId();
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath  = `${adminId}/${Date.now()}_${cleanName}`;

    const { error: uploadError } = await supabase.storage
      .from('contracts').upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || 'application/pdf',
      });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('contracts').getPublicUrl(filePath);

    const { error } = await supabase.from('company_contracts').insert({
      admin_id: adminId,
      contract_name: formData.name,
      contract_type: formData.type,
      client_id: formData.clientId || null,
      file_url: publicUrl,
      is_template: formData.isTemplate || false,
    });
    if (error) throw error;

    await fetchContracts();
  }, [fetchContracts]);

  const updateSalesAgentPlan = useCallback(async (agentId, plan) => {
    const { data, error } = await supabase
      .from('agents')
      .update({
        agent_plan: plan,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agentId)
      .select()
      .maybeSingle();

    if (error) throw error;

    try {
      const { data: agentProfile } = await supabase
        .from('agents')
        .select('full_name, email')
        .eq('id', agentId)
        .maybeSingle();

      const actionLabel = plan === 'gold' ? 'upgraded' : 'downgraded';
      await auditLogsService.log(
        'update',
        'agents',
        `Super admin ${actionLabel} sales agent "${agentProfile?.full_name || 'Unknown Agent'}" to ${plan} tier`,
        agentId,
        { agent_plan: plan === 'gold' ? 'bronze' : 'gold' },
        { agent_plan: plan }
      );
    } catch (auditErr) {
      console.warn('Agent plan audit log skipped:', auditErr?.message);
    }

    await fetchSalesAgents();
    return data;
  }, [fetchSalesAgents]);

  const upgradeSalesAgentToGold = useCallback(async (agentId) => updateSalesAgentPlan(agentId, 'gold'), [updateSalesAgentPlan]);
  const downgradeSalesAgentToBronze = useCallback(async (agentId) => updateSalesAgentPlan(agentId, 'bronze'), [updateSalesAgentPlan]);

  // The super admin creating the agent becomes the agent's admin. Without this,
  // agents.admin_id stays null and the agent's portal can't resolve an admin when
  // creating clients ("Cannot determine admin. Contact support.").
  //
  // Routed through the create-staff-user Edge Function for the same reason as the
  // admin-side twin in useAdminDashboard: the old path was /auth/v1/signup plus a
  // client-side user_profiles upsert, and handle_new_user() has already inserted
  // that profile row with NO admin_id by the time the upsert runs — so the upsert
  // is an UPDATE, and an UPDATE is subject to RLS.
  //
  // That happened to keep working HERE only because is_global_viewer() lets a
  // super admin see every profile, so the UPDATE matched its row. The identical
  // code on the admin side matched ZERO rows, silently, and shipped agents whose
  // agents.admin_id and user_profiles.admin_id disagreed. Depending on a
  // global-read escape hatch for correctness is one policy change away from the
  // same silent failure, so this path no longer relies on it.
  //
  // admin_id is sent explicitly: the Edge Function lets a super_admin place an
  // account in any tenant, and defaults to NULL when none is named — which would
  // orphan the agent rather than making them this super admin's.
  const createSalesAgent = useCallback(async (agentData) => {
    const adminId = await getAdminId();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Your session has expired — sign in again to create an agent.');

    const res = await fetch(`${supabaseUrl}/functions/v1/create-staff-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        email: agentData.email,
        password: agentData.password,
        full_name: agentData.fullName,
        role: 'sales_agent',
        phone: agentData.phone || '',
        admin_id: adminId,
      }),
    });

    const signUpJson = await res.json();
    if (!res.ok) {
      throw new Error(signUpJson?.error || signUpJson?.message || 'Failed to create agent account.');
    }

    const userId = signUpJson?.id;
    if (!userId) throw new Error('Agent creation failed — no user ID returned.');

    // Verify the tenant key landed before creating the agents row, so the two
    // can no longer disagree. A missing row counts as failure too: a super admin
    // reads every profile via is_global_viewer(), so an empty result here means
    // the profile does not exist at all.
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('admin_id')
      .eq('id', userId)
      .maybeSingle();

    if (!profile || profile.admin_id !== adminId) {
      throw new Error(
        'The agent login was created but could not be linked to your account, '
        + 'so it would not resolve an admin when registering clients. Do not use '
        + 'it — repair the ownership record first.',
      );
    }

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .insert({
        user_id: userId, agent_code: `AGT-${Date.now()}`,
        full_name: agentData.fullName, email: agentData.email,
        phone: agentData.phone, region: agentData.region,
        admin_id: adminId,
        commission_rate: agentData.commissionRate || 5,
        target_amount: agentData.targetAmount || 0,
        agent_plan: agentData.plan || 'bronze',
      })
      .select()
      .maybeSingle();
    if (agentError) throw agentError;

    // Auto-email the credentials (non-fatal — the creator also sees them once).
    emailLoginCredentials({
      to: agentData.email,
      type: 'staff_welcome',
      data: {
        fullName: agentData.fullName,
        email:    agentData.email,
        password: agentData.password,
        role:     'sales_agent',
      },
    });

    await fetchSalesAgents();
    return agent;
  }, [fetchSalesAgents]);

  const exportCSV = useCallback((data, filename) => {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const csv = [keys.join(','), ...data.map(row =>
      keys.map(k => `"${String(row[k] ?? '').replace(/"/g, '""')}"`).join(',')
    )].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchStats(),
      fetchAssetBreakdown(),
      fetchCompanyAnalytics(),
      fetchAuditTrail(),
      fetchSalesAgents(),
      fetchSalesTarget(),
      fetchStaffUsers(),
      fetchContracts(),
      fetchClients(),
      fetchAssistRejections(),
      fetchWithdrawalRequests(),
    ]);
    setLoading(false);
  }, [fetchStats, fetchAssetBreakdown, fetchCompanyAnalytics, fetchAuditTrail, fetchSalesAgents, fetchSalesTarget, fetchStaffUsers, fetchContracts, fetchClients, fetchAssistRejections, fetchWithdrawalRequests]);

  const resetState = useCallback(() => {
    setStats({
      activeAccounts: 0, inactiveAccounts: 0, totalValue: 0,
      totalSales: 0, totalSalesUsers: 0, pendingRegistrations: 0, totalTransactions: 0,
    });
    setAssetBreakdown([]);
    setCompanyAnalytics([]);
    setAuditTrail([]);
    setSalesAgents([]);
    setSalesTarget({ target: 0, achieved: 0, percentage: 0 });
    setStaffUsers([]);
    setContracts([]);
    setClients([]);
    setWithdrawalRequests([]);
    setAssistRejections([]);
    setLoading(true);
    setConnectionStatus('connecting');
  }, []);

  // ── Initial load — once per signed-in user, never while signed out ──────────
  const userId = useAuthScopedLoader(fetchAll, resetState);

  // ── Realtime ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return undefined;
    const t = ++_superAdminDashboardChannelSeq;

    const auditCh = supabase.channel(`sa_audit_${t}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, fetchAuditTrail)
      .subscribe(s => {
        if (s === 'SUBSCRIBED') setConnectionStatus('connected');
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setConnectionStatus('disconnected');
      });

    const clientsCh = supabase.channel(`sa_clients_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, fetchStats)
      .subscribe();

    const paymentsCh = supabase.channel(`sa_payments_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchStats();
        fetchCompanyAnalytics();
      })
      .subscribe();

    const agentsCh = supabase.channel(`sa_agents_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, () => {
        fetchSalesAgents();
        fetchSalesTarget();
      })
      .subscribe();

    const staffCh = supabase.channel(`sa_staff_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_profiles' }, fetchStaffUsers)
      .subscribe();

    // A rejection is worth seeing when it happens, not at the next page load.
    const assistsCh = supabase.channel(`sa_assists_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_assists' }, fetchAssistRejections)
      .subscribe();

    const withdrawalsCh = supabase.channel(`sa_withdrawals_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_wallets' }, fetchWithdrawalRequests)
      .subscribe();

    channelsRef.current = [auditCh, clientsCh, paymentsCh, agentsCh, staffCh, assistsCh, withdrawalsCh];
    return () => {
      channelsRef.current.forEach(ch => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
    // Re-subscribed per user: a channel opened for the previous session would
    // otherwise keep pushing refetches into the new one.
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    stats, assetBreakdown, companyAnalytics, auditTrail,
    salesAgents, salesTarget, staffUsers, contracts, clients, assistRejections, withdrawalRequests,
    loading, connectionStatus,
    refetch: fetchAll, createSalesAgent, upgradeSalesAgentToGold, downgradeSalesAgentToBronze, uploadContract, exportCSV,
    approveWithdrawalRequest, rejectWithdrawalRequest,
  };
};

export default useSuperAdminDashboard;
