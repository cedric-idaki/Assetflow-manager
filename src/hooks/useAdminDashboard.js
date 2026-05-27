import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';

export const useAdminDashboard = () => {
  const [stats, setStats] = useState({
    totalClients: 0,
    activeClients: 0,
    totalAssets: 0,
    totalRevenue: 0,
    outstandingBalance: 0,
    totalAgents: 0,
    pendingKYC: 0,
    totalContracts: 0,
    totalStaff: 0,
  });

  const [clients, setClients] = useState([]);
  const [assets, setAssets] = useState([]);
  const [agents, setAgents] = useState([]);
  const [staff, setStaff] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [salesAnalytics, setSalesAnalytics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  const channelsRef = useRef([]);
  const hasLoaded = useRef(false);

  const getAdminId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id;
  };

  // ---------------------------------------------------------------------------
  // COMPANY PROFILE
  // ---------------------------------------------------------------------------

  const fetchCompanyProfile = useCallback(async () => {
    try {
      const adminId = await getAdminId();

      const { data } = await supabase
        .from('company_profiles')
        .select('*')
        .eq('admin_id', adminId)
        .maybeSingle();

      setCompanyProfile(data);
    } catch (err) {}
  }, []);

  // ---------------------------------------------------------------------------
  // SUBSCRIPTION
  // ---------------------------------------------------------------------------

  const fetchSubscription = useCallback(async () => {
    try {
      const adminId = await getAdminId();

      const { data } = await supabase
        .from('company_subscriptions')
        .select('*, plan:subscription_plans(*)')
        .eq('admin_id', adminId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setSubscription(data);
    } catch (err) {}
  }, []);

  // ---------------------------------------------------------------------------
  // STATS (FIXED OUTSTANDING BALANCE)
  // ---------------------------------------------------------------------------

  const fetchStats = useCallback(async () => {
    try {
      const adminId = await getAdminId();

      const { count: totalClients } = await supabase
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId);

      const { count: activeClients } = await supabase
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId)
        .eq('client_status', 'active');

      const { count: pendingKYC } = await supabase
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId)
        .eq('kyc_status', 'unverified');

      const { data: assetData } = await supabase
        .from('assets')
        .select('selling_price')
        .eq('registered_by', adminId);

      const totalAssets = (assetData || []).length;

      const { count: totalAgents } = await supabase
        .from('agents')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId);

      const { data: paymentData } = await supabase
        .from('payments')
        .select('amount, payment_status')
        .eq('processed_by', adminId);

      const totalRevenue = (paymentData || [])
        .filter(p => p.payment_status === 'completed')
        .reduce((s, p) => s + parseFloat(p.amount || 0), 0);

      // ✅ FIXED: was incorrectly hardcoded
      const { data: clientBalances } = await supabase
        .from('clients')
        .select('outstanding_balance')
        .eq('admin_id', adminId);

      const outstandingBalance = (clientBalances || []).reduce(
        (sum, c) => sum + parseFloat(c.outstanding_balance || 0),
        0
      );

      const { count: totalContracts } = await supabase
        .from('company_contracts')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId);

      const { count: totalStaff } = await supabase
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId)
        .eq('is_active', true);

      setStats({
        totalClients: totalClients || 0,
        activeClients: activeClients || 0,
        totalAssets,
        totalRevenue,
        outstandingBalance,
        totalAgents: totalAgents || 0,
        pendingKYC: pendingKYC || 0,
        totalContracts: totalContracts || 0,
        totalStaff: totalStaff || 0,
      });

      setConnectionStatus('connected');
    } catch (err) {
      setConnectionStatus('disconnected');
    }
  }, []);

  // ---------------------------------------------------------------------------
  // OTHER FETCHERS (UNCHANGED LOGIC)
  // ---------------------------------------------------------------------------

  const fetchClients = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false });

    setClients(data || []);
  }, []);

  const fetchAssets = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('assets')
      .select('*, linked_client:clients(full_name, account_number)')
      .eq('registered_by', adminId);

    setAssets(data || []);
  }, []);

  const fetchAgents = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('agents')
      .select('*')
      .eq('admin_id', adminId);

    setAgents(data || []);
  }, []);

  const fetchStaff = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('admin_id', adminId);

    setStaff(data || []);
  }, []);

  const fetchContracts = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('company_contracts')
      .select('*, client:clients(full_name, account_number)')
      .eq('admin_id', adminId);

    setContracts(data || []);
  }, []);

  const fetchPayments = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('payments')
      .select('*, client:clients(full_name, account_number)')
      .eq('processed_by', adminId);

    setPayments(data || []);
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('admin_id', adminId);

    setAuditLogs(data || []);
  }, []);

  const fetchSalesAnalytics = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('agents')
      .select(
        'id, full_name, total_sales, total_commission, target_amount, agent_status'
      )
      .eq('admin_id', adminId);

    setSalesAnalytics(data || []);
  }, []);

  // ---------------------------------------------------------------------------
  // FETCH ALL
  // ---------------------------------------------------------------------------

  const fetchAll = useCallback(async () => {
    setLoading(true);

    await Promise.all([
      fetchStats(),
      fetchCompanyProfile(),
      fetchSubscription(),
      fetchClients(),
      fetchAssets(),
      fetchAgents(),
      fetchStaff(),
      fetchContracts(),
      fetchPayments(),
      fetchAuditLogs(),
      fetchSalesAnalytics(),
    ]);

    hasLoaded.current = true;
    setLoading(false);
  }, [
    fetchStats,
    fetchCompanyProfile,
    fetchSubscription,
    fetchClients,
    fetchAssets,
    fetchAgents,
    fetchStaff,
    fetchContracts,
    fetchPayments,
    fetchAuditLogs,
    fetchSalesAnalytics,
  ]);

  // ---------------------------------------------------------------------------
  // INITIAL LOAD — runs once on mount; realtime handles updates after that
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (hasLoaded.current) return;
    fetchAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // REALTIME — set up once; callbacks reference stable useCallback functions
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const clientsCh = supabase
      .channel('admin_clients')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        fetchClients();
        fetchStats();
      })
      .subscribe();

    const paymentsCh = supabase
      .channel('admin_payments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchPayments();
        fetchStats();
      })
      .subscribe();

    const agentsCh = supabase
      .channel('admin_agents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, () => {
        fetchAgents();
        fetchSalesAnalytics();
      })
      .subscribe();

    const staffCh = supabase
      .channel('admin_staff')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_profiles' }, () => {
        fetchStaff();
        fetchStats();
      })
      .subscribe();

    channelsRef.current = [clientsCh, paymentsCh, agentsCh, staffCh];

    return () => {
      channelsRef.current.forEach(ch => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // RETURN
  // ---------------------------------------------------------------------------

  return {
    stats,
    clients,
    assets,
    agents,
    staff,
    contracts,
    payments,
    auditLogs,
    subscription,
    companyProfile,
    salesAnalytics,
    loading,
    connectionStatus,
    refetch: fetchAll,
  };
};

export default useAdminDashboard;