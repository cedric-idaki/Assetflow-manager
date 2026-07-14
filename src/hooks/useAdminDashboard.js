import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, getAccessToken } from '../lib/supabase';
import { emailLoginCredentials, generateTempPassword } from '../services/credentialsEmailService';

// Upload a file to a Supabase Storage bucket with progress reporting via XHR,
// falling back to the JS client (no progress) if the direct upload fails so
// correctness is never sacrificed for the progress bar.
const uploadWithProgress = async (bucket, path, file, onProgress) => {
  const rawUrl = import.meta.env?.VITE_SUPABASE_URL || '';
  const anon   = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';
  const base   = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}.supabase.co`;
  const token  = (await getAccessToken()) || anon;
  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${base}/storage/v1/object/${bucket}/${encodeURI(path)}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', anon);
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.setRequestHeader('cache-control', '3600');
      if (file.type) xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload  = () => (xhr.status >= 200 && xhr.status < 300)
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(file);
    });
  } catch (err) {
    // Fallback: JS client upload (no progress) so the upload still completes.
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: true, cacheControl: '3600', contentType: file.type || 'application/pdf',
    });
    if (error) throw error;
    if (onProgress) onProgress(100);
  }
};

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

  const [clients,        setClients]        = useState([]);
  const [assets,         setAssets]         = useState([]);
  const [agents,         setAgents]         = useState([]);
  const [staff,          setStaff]          = useState([]);
  const [contracts,      setContracts]      = useState([]);
  const [payments,       setPayments]       = useState([]);
  const [auditLogs,      setAuditLogs]      = useState([]);
  const [subscription,   setSubscription]   = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [salesAnalytics, setSalesAnalytics] = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  const channelsRef = useRef([]);
  const hasLoaded   = useRef(false);

  const getAdminId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id;
  };

  // ── Company profile ──────────────────────────────────────────────────────────
  const fetchCompanyProfile = useCallback(async () => {
    try {
      const adminId = await getAdminId();
      const { data } = await supabase
        .from('company_profiles')
        .select('*')
        .eq('admin_id', adminId)
        .maybeSingle();
      setCompanyProfile(data);
    } catch (_) {}
  }, []);

  // ── Subscription ─────────────────────────────────────────────────────────────
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
    } catch (_) {}
  }, []);

  // ── Stats ────────────────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const adminId = await getAdminId();

      const [
        { count: totalClients },
        { count: activeClients },
        { count: pendingKYC },
        { data: assetData },
        { count: totalAgents },
        { data: paymentData },
        { data: clientBalances },
        { count: totalContracts },
        { count: totalStaff },
      ] = await Promise.all([
        supabase.from('clients').select('id', { count: 'exact', head: true }).eq('admin_id', adminId),
        supabase.from('clients').select('id', { count: 'exact', head: true }).eq('admin_id', adminId).eq('client_status', 'active'),
        supabase.from('clients').select('id', { count: 'exact', head: true }).eq('admin_id', adminId).eq('kyc_status', 'unverified'),
        supabase.from('assets').select('selling_price').eq('registered_by', adminId),
        supabase.from('agents').select('id', { count: 'exact', head: true }).eq('admin_id', adminId),
        supabase.from('payments').select('amount, payment_status').eq('processed_by', adminId),
        supabase.from('clients').select('outstanding_balance').eq('admin_id', adminId),
        supabase.from('company_contracts').select('id', { count: 'exact', head: true }).eq('admin_id', adminId),
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('admin_id', adminId).eq('is_active', true),
      ]);

      const totalRevenue = (paymentData || [])
        .filter(p => p.payment_status === 'completed')
        .reduce((s, p) => s + parseFloat(p.amount || 0), 0);

      const outstandingBalance = (clientBalances || [])
        .reduce((s, c) => s + parseFloat(c.outstanding_balance || 0), 0);

      setStats({
        totalClients:      totalClients   || 0,
        activeClients:     activeClients  || 0,
        totalAssets:       (assetData || []).length,
        totalRevenue,
        outstandingBalance,
        totalAgents:       totalAgents    || 0,
        pendingKYC:        pendingKYC     || 0,
        totalContracts:    totalContracts || 0,
        totalStaff:        totalStaff     || 0,
      });
      setConnectionStatus('connected');
    } catch (_) {
      setConnectionStatus('disconnected');
    }
  }, []);

  // ── Data fetchers ────────────────────────────────────────────────────────────
  const fetchClients = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('clients').select('*').eq('admin_id', adminId)
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
      .from('agents').select('*').eq('admin_id', adminId);
    setAgents(data || []);
  }, []);

  const fetchStaff = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('user_profiles').select('*').eq('admin_id', adminId);
    setStaff(data || []);
  }, []);

  const fetchContracts = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('company_contracts')
      .select('*, client:clients(full_name, account_number, email)')
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
      .from('audit_logs').select('*').eq('admin_id', adminId);
    setAuditLogs(data || []);
  }, []);

  const fetchSalesAnalytics = useCallback(async () => {
    const adminId = await getAdminId();
    const { data } = await supabase
      .from('agents')
      .select('id, full_name, total_sales, total_commission, target_amount, agent_status')
      .eq('admin_id', adminId);
    setSalesAnalytics(data || []);
  }, []);

  // ── fetchAll ─────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchStats(), fetchCompanyProfile(), fetchSubscription(),
      fetchClients(), fetchAssets(), fetchAgents(), fetchStaff(),
      fetchContracts(), fetchPayments(), fetchAuditLogs(), fetchSalesAnalytics(),
    ]);
    hasLoaded.current = true;
    setLoading(false);
  }, [
    fetchStats, fetchCompanyProfile, fetchSubscription,
    fetchClients, fetchAssets, fetchAgents, fetchStaff,
    fetchContracts, fetchPayments, fetchAuditLogs, fetchSalesAnalytics,
  ]);

  // ── Action: create sales agent (REST — no session hijack) ────────────────────
  const createSalesAgent = useCallback(async (agentData) => {
    // Tag the agent with its creating admin so the agent's portal can resolve an
    // admin when registering clients (prevents "Cannot determine admin").
    const adminId         = await getAdminId();
    const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const res  = await fetch(`${supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': supabaseAnonKey },
      body: JSON.stringify({
        email: agentData.email, password: agentData.password,
        // must_change_password: the portal blocks access until the agent
        // replaces this admin-issued password with their own.
        data: { full_name: agentData.fullName, role: 'sales_agent', must_change_password: true },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.msg || json?.message || 'Failed to create agent auth account.');

    const userId = json?.id ?? json?.user?.id;
    if (!userId) throw new Error('Agent creation failed — no user ID returned.');

    await supabase.from('user_profiles').upsert({
      id: userId, email: agentData.email, full_name: agentData.fullName,
      role: 'sales_agent', phone: agentData.phone || '', is_active: true,
      admin_id: adminId,
    });

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .insert({
        user_id: userId, agent_code: `AGT-${Date.now()}`,
        full_name: agentData.fullName, email: agentData.email,
        phone: agentData.phone, region: agentData.region,
        commission_rate: agentData.commissionRate || 5,
        target_amount:   agentData.targetAmount   || 0,
        admin_id:        adminId,
      })
      .select().maybeSingle();
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

    await fetchAgents();
    return agent;
  }, [fetchAgents]);

  // alias used by AgentsTab
  const createAgent = useCallback((agentData) => createSalesAgent(agentData), [createSalesAgent]);

  // ── Action: invite client ────────────────────────────────────────────────────
  const inviteClient = useCallback(async (formData) => {
    const adminId         = await getAdminId();
    const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    // Generate a real temporary password (previously a throwaway string that
    // nobody ever saw) so it can be emailed to the client.
    const tempPassword = generateTempPassword();

    const res  = await fetch(`${supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': supabaseAnonKey },
      body: JSON.stringify({
        email: formData.email,
        password: tempPassword,
        data: { full_name: formData.fullName, role: 'client', must_change_password: true },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.msg || json?.message || 'Failed to create client account.');

    const userId = json?.id ?? json?.user?.id;
    if (!userId) throw new Error('Client creation failed — no user ID returned.');

    const { error: profileErr } = await supabase.from('user_profiles').upsert({
      id: userId, email: formData.email, full_name: formData.fullName,
      phone: formData.phone || '', role: 'client', admin_id: adminId, is_active: true,
    });
    if (profileErr) throw profileErr;

    const { error: clientErr } = await supabase.from('clients').insert({
      full_name: formData.fullName, email: formData.email, phone: formData.phone || '',
      admin_id: adminId, created_by: adminId,
      agent_id: formData.agentId || null,
      client_status: 'active', kyc_status: 'unverified',
    });
    if (clientErr) throw clientErr;

    // Auto-email the temp credentials to the client (non-fatal).
    emailLoginCredentials({
      to: formData.email,
      type: 'client_welcome',
      data: {
        fullName: formData.fullName,
        email:    formData.email,
        password: tempPassword,
      },
    });

    await Promise.all([fetchClients(), fetchStats()]);
  }, [fetchClients, fetchStats]);

  // ── Action: invite staff ─────────────────────────────────────────────────────
  const inviteStaff = useCallback(async (formData) => {
    const adminId         = await getAdminId();
    const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    // ── Enforce the plan's user limit ───────────────────────────────────────────
    // Only portal-staff consume seats. Clients (customers) and HR employees
    // (role 'staff', no login portal) are unlimited and do NOT count. Once the
    // limit is hit the admin must upgrade (extra users are KES 360 each).
    const { data: sub } = await supabase
      .from('company_subscriptions')
      .select('max_users, plan:subscription_plans(max_users)')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxUsers = sub?.max_users ?? sub?.plan?.max_users ?? null;
    if (maxUsers != null) {
      const { count: seatCount } = await supabase
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId)
        .eq('is_active', true)
        .neq('role', 'client')
        .neq('role', 'staff');
      if ((seatCount || 0) >= maxUsers) {
        throw new Error(
          `You've reached your plan's user limit (${maxUsers}). Upgrade your plan to add more users — extra users are KES 360 each. Employees without a login portal are unlimited.`
        );
      }
    }

    const staffPassword = formData.password || generateTempPassword();

    const res  = await fetch(`${supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': supabaseAnonKey },
      body: JSON.stringify({
        email: formData.email,
        password: staffPassword,
        data: { full_name: formData.full_name, role: formData.role, must_change_password: true },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.msg || json?.message || 'Failed to create staff account.');

    const userId = json?.id ?? json?.user?.id;
    if (!userId) throw new Error('Staff creation failed — no user ID returned.');

    const { error } = await supabase.from('user_profiles').upsert({
      id: userId, email: formData.email, full_name: formData.full_name,
      phone: formData.phone || '', role: formData.role || 'operations',
      admin_id: adminId, is_active: true,
    });
    if (error) throw error;

    // Auto-email the temp credentials to the new staff member (non-fatal).
    emailLoginCredentials({
      to: formData.email,
      type: 'staff_welcome',
      data: {
        fullName:   formData.full_name,
        email:      formData.email,
        password:   staffPassword,
        role:       formData.role || 'operations',
        department: formData.department,
      },
    });

    await Promise.all([fetchStaff(), fetchStats()]);
  }, [fetchStaff, fetchStats]);

  // ── Action: toggle staff active ──────────────────────────────────────────────
  const toggleStaffActive = useCallback(async (userId, isActive) => {
    const { error } = await supabase
      .from('user_profiles').update({ is_active: isActive }).eq('id', userId);
    if (error) throw error;
    await fetchStaff();
  }, [fetchStaff]);

  // ── Action: upload contract ──────────────────────────────────────────────────
const uploadContract = useCallback(async (formData, file, onProgress) => {
  const adminId   = await getAdminId();
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath  = `${adminId}/${Date.now()}_${cleanName}`;

  await uploadWithProgress('contracts', filePath, file, onProgress);

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

  // ── Export CSV ───────────────────────────────────────────────────────────────
  const exportCSV = useCallback((data, filename) => {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const csv  = [
      keys.join(','),
      ...data.map(row =>
        keys.map(k => `"${String(row[k] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── Initial load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (hasLoaded.current) return;
    fetchAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = Date.now();

    const clientsCh = supabase
      .channel(`admin_clients_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' },
        () => { fetchClients(); fetchStats(); })
      .subscribe();

    const paymentsCh = supabase
      .channel(`admin_payments_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' },
        () => { fetchPayments(); fetchStats(); })
      .subscribe();

    const agentsCh = supabase
      .channel(`admin_agents_${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' },
        () => { fetchAgents(); fetchSalesAnalytics(); })
      .subscribe();

    const staffCh = supabase
      .channel(`admin_staff_${t}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_profiles' },
        () => { fetchStaff(); fetchStats(); })
      .subscribe(s => {
        if (s === 'SUBSCRIBED')                          setConnectionStatus('connected');
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setConnectionStatus('disconnected');
      });

    channelsRef.current = [clientsCh, paymentsCh, agentsCh, staffCh];
    return () => {
      channelsRef.current.forEach(ch => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Return ───────────────────────────────────────────────────────────────────
  return {
    stats, clients, assets, agents, staff, contracts,
    payments, auditLogs, subscription, companyProfile, salesAnalytics,
    loading, connectionStatus,
    refetch: fetchAll,
    createSalesAgent, createAgent,
    inviteClient, inviteStaff, toggleStaffActive, uploadContract,
    exportCSV,
  };
};

export default useAdminDashboard;
