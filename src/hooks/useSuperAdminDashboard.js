import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

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
  const [loading, setLoading]                   = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const channelsRef = useRef([]);

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
      console.error('useSuperAdminDashboard error:', err.message);
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
      console.error('useSuperAdminDashboard error:', err.message);
    }
  }, []);

  const fetchAuditTrail = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('audit_logs')
        .select('id, action, description, table_name, severity, created_at, old_values, new_values, record_id, user:user_profiles(full_name, role, email)')
        .in('action', ['create', 'update', 'delete', 'login', 'logout', 'approve', 'reject', 'kyc_status_change'])
        .order('created_at', { ascending: false })
        .limit(50);
      setAuditTrail(data || []);
    } catch (err) {
      console.error('useSuperAdminDashboard error:', err.message);
    }
  }, []);

  const fetchSalesAgents = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('agents')
        .select('*, user:user_profiles(full_name, email, is_active)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSalesAgents(data || []);
    } catch (err) {
      console.error('fetchSalesAgents error:', err.message);
    }
  }, []);

  const fetchSalesTarget = useCallback(async () => {
    try {
      const { data: agents } = await supabase.from('agents').select('target_amount, total_sales');
      const target = (agents || []).reduce((s, a) => s + parseFloat(a.target_amount || 0), 0);
      const achieved = (agents || []).reduce((s, a) => s + parseFloat(a.total_sales || 0), 0);
      const percentage = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
      setSalesTarget({ target, achieved, percentage });
    } catch (err) {
      console.error('useSuperAdminDashboard error:', err.message);
    }
  }, []);

  const createSalesAgent = useCallback(async (agentData) => {
    // ── Step 1: Snapshot the admin session BEFORE signUp touches it ──────────
    const { data: { session: adminSession } } = await supabase.auth.getSession();
    if (!adminSession) throw new Error('No active admin session. Please log in again.');

    // ── Step 2: Create the auth user (Supabase auto-switches session here) ───
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: agentData.email,
      password: agentData.password,
      options: {
        data: { full_name: agentData.fullName, role: 'sales_agent' },
      },
    });

    // ── Step 3: Restore admin session immediately ────────────────────────────
    await supabase.auth.setSession({
      access_token:  adminSession.access_token,
      refresh_token: adminSession.refresh_token,
    });

    if (authError) throw authError;

    const userId = authData?.user?.id;
    if (!userId) throw new Error('Agent creation failed — no user ID returned.');

    // ── Step 4: Wait for restored session to fully settle on the client ──────
    // All DB writes below must run as the admin (not the new agent).
    // Without this pause the Supabase client still has the agent token in flight.
    await new Promise(resolve => setTimeout(resolve, 1000));

    // ── Step 5: Upsert user profile (runs as admin — RLS satisfied) ──────────
    const { error: profileError } = await supabase.from('user_profiles').upsert({
      id:        userId,
      email:     agentData.email,
      full_name: agentData.fullName,
      role:      'sales_agent',
      phone:     agentData.phone || '',
      is_active: true,
    });
    if (profileError) console.error('Profile upsert error:', profileError.message);

    // ── Step 6: Insert into agents table ────────────────────────────────────
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .insert({
        user_id:         userId,
        agent_code:      `AGT-${Date.now()}`,
        full_name:       agentData.fullName,
        email:           agentData.email,
        phone:           agentData.phone,
        region:          agentData.region,
        commission_rate: agentData.commissionRate || 5,
        target_amount:   agentData.targetAmount || 0,
      })
      .select()
      .maybeSingle();
    if (agentError) throw agentError;

    // ── Step 7: Refresh the list — session is fully admin again by now ───────
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
    await Promise.all([fetchStats(), fetchAssetBreakdown(), fetchCompanyAnalytics(), fetchAuditTrail(), fetchSalesAgents(), fetchSalesTarget()]);
    setLoading(false);
  }, [fetchStats, fetchAssetBreakdown, fetchCompanyAnalytics, fetchAuditTrail, fetchSalesAgents, fetchSalesTarget]);

  useEffect(() => {
    fetchAll();

    const auditCh = supabase.channel('sa_audit')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, fetchAuditTrail)
      .subscribe(s => {
        if (s === 'SUBSCRIBED') setConnectionStatus('connected');
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setConnectionStatus('disconnected');
      });

    const clientsCh = supabase.channel('sa_clients')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, fetchStats)
      .subscribe();

    const paymentsCh = supabase.channel('sa_payments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => { fetchStats(); fetchCompanyAnalytics(); })
      .subscribe();

    const agentsCh = supabase.channel('sa_agents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, () => { fetchSalesAgents(); fetchSalesTarget(); })
      .subscribe();

    channelsRef.current = [auditCh, clientsCh, paymentsCh, agentsCh];
    return () => { channelsRef.current.forEach(ch => supabase.removeChannel(ch)); channelsRef.current = []; };
  }, [fetchAll, fetchAuditTrail, fetchStats, fetchCompanyAnalytics, fetchSalesAgents, fetchSalesTarget]);

  return { stats, assetBreakdown, companyAnalytics, auditTrail, salesAgents, salesTarget, loading, connectionStatus, refetch: fetchAll, createSalesAgent, exportCSV };
};

export default useSuperAdminDashboard;
