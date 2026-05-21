import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export const useAdminDashboard = () => {
  const [stats, setStats] = useState({
    totalClients: 0, activeClients: 0, totalAssets: 0,
    totalRevenue: 0, outstandingBalance: 0, totalAgents: 0,
    pendingKYC: 0, totalContracts: 0, totalStaff: 0,
  });
  const [clients, setClients]             = useState([]);
  const [assets, setAssets]               = useState([]);
  const [agents, setAgents]               = useState([]);
  const [staff, setStaff]                 = useState([]);
  const [contracts, setContracts]         = useState([]);
  const [payments, setPayments]           = useState([]);
  const [auditLogs, setAuditLogs]         = useState([]);
  const [subscription, setSubscription]   = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [salesAnalytics, setSalesAnalytics] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const channelsRef = useRef([]);

  const getAdminId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id;
  };

  const fetchCompanyProfile = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
        .from('company_profiles').select('*')
        .eq('admin_id', adminId).single();
      setCompanyProfile(data);
    } catch (err) {}
  }, []);

  const fetchSubscription = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
        .from('company_subscriptions')
        .select('*, plan:subscription_plans(*)')
        .eq('admin_id', adminId)
        .order('created_at', { ascending: false })
        .limit(1).single();
      setSubscription(data);
    } catch (err) {}
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const adminId = await getAdminId();

      const { count: totalClients } = await supabase
        .from('clients').select('id', { count: 'exact', head: true }).eq('admin_id', adminId);
      const { count: activeClients } = await supabase
        .from('clients').select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId).eq('client_status', 'active');
      const { count: pendingKYC } = await supabase
        .from('clients').select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId).eq('kyc_status', 'unverified');

      const { data: assetData } = await supabase
        .from('assets').select('selling_price, asset_status').eq('registered_by', adminId);
      const totalAssets = (assetData || []).length;

      const { count: totalAgents } = await supabase
        .from('agents').select('id', { count: 'exact', head: true }).eq('admin_id', adminId);

      const { data: paymentData } = await supabase
        .from('payments').select('amount, payment_status').eq('processed_by', adminId);
      const totalRevenue = (paymentData || [])
        .filter(p => p.payment_status === 'completed')
        .reduce((s, p) => s + parseFloat(p.amount || 0), 0);

      const { data: clientBalances } = await supabase
  .from('clients').select('id').eq('admin_id', adminId);
const outstandingBalance = 0;

      const { count: totalContracts } = await supabase
        .from('company_contracts').select('id', { count: 'exact', head: true }).eq('admin_id', adminId);

      const { count: totalStaff } = await supabase
        .from('user_profiles').select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId).eq('is_active', true);

      setStats({
        totalClients: totalClients || 0, activeClients: activeClients || 0,
        totalAssets, totalRevenue, outstandingBalance,
        totalAgents: totalAgents || 0, pendingKYC: pendingKYC || 0,
        totalContracts: totalContracts || 0, totalStaff: totalStaff || 0,
      });
      setConnectionStatus('connected');
    } catch (err) {
      setConnectionStatus('disconnected');
    }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
        .from('clients').select('*').eq('admin_id', adminId)
        .order('created_at', { ascending: false });
      setClients(data || []);
    } catch (err) {}
  }, []);

  const fetchAssets = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
        .from('assets')
        .select('*, linked_client:clients(full_name, account_number)')
        .eq('registered_by', adminId)
        .order('created_at', { ascending: false });
      setAssets(data || []);
    } catch (err) {}
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
        .from('agents').select('*').eq('admin_id', adminId)
        .order('created_at', { ascending: false });
      setAgents(data || []);
    } catch (err) {}
  }, []);

  // ── Fetch staff (non-agent users under this admin) ─────────────────────────
  const fetchStaff = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
        .from('user_profiles').select('*')
        .eq('admin_id', adminId)
        .order('created_at', { ascending: false });
      setStaff(data || []);
    } catch (err) {}
  }, []);

  const fetchContracts = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
        .from('company_contracts')
        .select('*, client:clients(full_name, account_number)')
        .eq('admin_id', adminId)
        .order('created_at', { ascending: false });
      setContracts(data || []);
    } catch (err) {}
  }, []);

  const fetchPayments = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
  .from('payments')
  .select('*, client:clients(full_name, account_number)')
  .eq('processed_by', adminId)
  .order('payment_date', { ascending: false })
  .limit(20);
      setPayments(data || []);
    } catch (err) {}
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
        .from('audit_logs').select('*').eq('admin_id', adminId)
        .order('created_at', { ascending: false }).limit(30);
      setAuditLogs(data || []);
    } catch (err) {}
  }, []);

  const fetchSalesAnalytics = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
        .from('agents')
        .select('id, full_name, total_sales, total_commission, target_amount, agent_status')
        .eq('admin_id', adminId);
      setSalesAnalytics(data || []);
    } catch (err) {}
  }, []);

  // ── Invite client ──────────────────────────────────────────────────────────
  const inviteClient = useCallback(async (clientData) => {
    const adminId = await getAdminId();
    const { data, error } = await supabase.from('client_invitations').insert({
      admin_id: adminId, email: clientData.email,
      full_name: clientData.fullName, phone: clientData.phone,
      agent_id: clientData.agentId || null,
    }).select().single();
    if (error) throw error;

    const { data: client, error: clientError } = await supabase.from('clients').insert({
      account_number: `ACC-${Date.now()}`,
      full_name: clientData.fullName, email: clientData.email,
      phone: clientData.phone, admin_id: adminId,
      client_status: 'pending', kyc_status: 'unverified',
    }).select().single();
    if (clientError) throw clientError;

    await fetchClients();
    await fetchStats();
    return { invitation: data, client };
  }, [fetchClients, fetchStats]);

  // ── Create sales agent ─────────────────────────────────────────────────────
  // Uses signUp (not admin.createUser which requires service role key)
  const createAgent = useCallback(async (agentData) => {
    const adminId = await getAdminId();

    // Sign up the user via standard auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: agentData.email,
      password: agentData.password,
      options: {
        data: { full_name: agentData.fullName, role: 'sales_agent' },
      },
    });
    if (authError) throw authError;

    const userId = authData?.user?.id;
    if (!userId) throw new Error('User creation failed — no user ID returned.');

    // Create user_profile
    await supabase.from('user_profiles').upsert({
      id: userId, email: agentData.email,
      full_name: agentData.fullName, role: 'sales_agent',
      phone: agentData.phone || '', admin_id: adminId, is_active: true,
    });

    // Create agent record
    const { data: agent, error: agentError } = await supabase.from('agents').insert({
      user_id: userId, admin_id: adminId,
      agent_code: `AGT-${Date.now()}`,
      full_name: agentData.fullName, email: agentData.email,
      phone: agentData.phone, region: agentData.region,
      commission_rate: agentData.commissionRate || 5,
      target_amount: agentData.targetAmount || 0,
    }).select().single();
    if (agentError) throw agentError;

    await fetchAgents();
    await fetchStats();
    return agent;
  }, [fetchAgents, fetchStats]);

  // ── Invite staff member ────────────────────────────────────────────────────
 const inviteStaff = useCallback(async (staffData) => {
    const adminId = await getAdminId();

    // Check subscription user limit
    if (subscription?.plan?.max_users || subscription?.max_users) {
      const limit = subscription?.plan?.max_users || subscription?.max_users;
      const currentCount = staff.filter(s => s.is_active !== false).length;
      if (currentCount >= limit) {
        throw new Error(
          `Your ${subscription?.plan?.name || 'current'} plan allows a maximum of ${limit} users. ` +
          `Please contact support to upgrade your subscription.`
        );
      }
    }

    // Get the admin's current session token
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    // Call the Edge Function — admin session is never touched
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-staff-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email:      staffData.email.trim().toLowerCase(),
          password:   staffData.password,
          full_name:  staffData.full_name.trim(),
          role:       staffData.role,
          phone:      staffData.phone || '',
          department: staffData.department || '',
          admin_id:   adminId,
        }),
      }
    );

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Failed to create staff member.');
    }

    await fetchStaff();
    await fetchStats();
    return result;
  }, [fetchStaff, fetchStats, staff, subscription]);

  // ── Toggle staff active status ─────────────────────────────────────────────
  const toggleStaffActive = useCallback(async (userId, isActive) => {
    const { error } = await supabase.from('user_profiles')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw error;
    await fetchStaff();
    await fetchStats();
  }, [fetchStaff, fetchStats]);

  // ── Upload contract ────────────────────────────────────────────────────────
  const uploadContract = useCallback(async (contractData, file) => {
    const adminId = await getAdminId();
    let fileUrl = null, fileName = null;

    if (file) {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${adminId}/${Date.now()}_${cleanName}`;
      const { error: uploadError } = await supabase.storage
        .from('contracts').upload(filePath, file, {
          cacheControl: '3600', upsert: false, contentType: 'application/pdf',
        });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('contracts').getPublicUrl(filePath);
      fileUrl = urlData.publicUrl;
      fileName = file.name;
    }

    const { data, error } = await supabase.from('company_contracts').insert({
      admin_id: adminId, client_id: contractData.clientId || null,
      contract_name: contractData.name, contract_type: contractData.type || 'general',
      file_url: fileUrl, file_name: fileName,
      is_template: contractData.isTemplate || false, status: 'active',
    }).select().single();
    if (error) throw error;
    await fetchContracts();
    return data;
  }, [fetchContracts]);

  // ── Export CSV ─────────────────────────────────────────────────────────────
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

  // ── Fetch all ──────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchStats(), fetchCompanyProfile(), fetchSubscription(),
      fetchClients(), fetchAssets(), fetchAgents(), fetchStaff(),
      fetchContracts(), fetchPayments(), fetchAuditLogs(), fetchSalesAnalytics(),
    ]);
    setLoading(false);
  }, [
    fetchStats, fetchCompanyProfile, fetchSubscription,
    fetchClients, fetchAssets, fetchAgents, fetchStaff,
    fetchContracts, fetchPayments, fetchAuditLogs, fetchSalesAnalytics,
  ]);

  useEffect(() => {
    fetchAll();

    const clientsCh = supabase.channel('admin_clients')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => { fetchClients(); fetchStats(); })
      .subscribe(s => {
        if (s === 'SUBSCRIBED') setConnectionStatus('connected');
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setConnectionStatus('disconnected');
      });

    const paymentsCh = supabase.channel('admin_payments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => { fetchPayments(); fetchStats(); })
      .subscribe();

    const agentsCh = supabase.channel('admin_agents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, () => { fetchAgents(); fetchSalesAnalytics(); })
      .subscribe();

    const staffCh = supabase.channel('admin_staff')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_profiles' }, () => { fetchStaff(); fetchStats(); })
  .subscribe();

    channelsRef.current = [clientsCh, paymentsCh, agentsCh, staffCh];
    return () => {
      channelsRef.current.forEach(ch => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [fetchAll, fetchClients, fetchStats, fetchPayments, fetchAgents, fetchSalesAnalytics, fetchStaff]);

  return {
    stats, clients, assets, agents, staff,
    contracts, payments, auditLogs, subscription,
    companyProfile, salesAnalytics, loading, connectionStatus,
    refetch: fetchAll,
    inviteClient, createAgent, inviteStaff, toggleStaffActive,
    uploadContract, exportCSV,
  };
};

export default useAdminDashboard;
