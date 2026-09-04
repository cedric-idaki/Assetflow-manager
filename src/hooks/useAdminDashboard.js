import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, getAccessToken } from '../lib/supabase';
import { getTenantAdminId } from '../lib/tenant';
import { useAuthScopedLoader } from './useAuthScopedLoader';
import { emailLoginCredentials, generateTempPassword } from '../services/credentialsEmailService';

// Module-level counter, not Date.now(): React StrictMode mounts an effect twice,
// and both runs can land inside the same millisecond. supabase.channel(name)
// RETURNS AN EXISTING channel for a name already in use, so the second run got
// the first run's already-subscribed channel and .on() threw
// "cannot add `postgres_changes` callbacks ... after `subscribe()`", which the
// error boundary rendered as a blank "Something went wrong" page.
// Same fix and same reasoning as useCrmOversight.
let _adminDashboardChannelSeq = 0;

// Account number (BRS 3.4 format, same as the client registration form):
// AF-YYYY-000001. The column is UNIQUE NOT NULL so it must always be supplied.
const generateAccountNumber = () => {
  const year = new Date().getFullYear();
  const seq  = String(Math.floor(Math.random() * 999999) + 1).padStart(6, '0');
  return `AF-${year}-${seq}`;
};

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

  // The TENANT that owns this session's data, not the signed-in user's own id:
  // an admin's staff must see the admin's rows, and never anyone else's.
  // Mirrors public.current_admin_id(), which is what RLS enforces server-side.
  const getAdminId = async () => getTenantAdminId();

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
        supabase.from('assets').select('selling_price').eq('admin_id', adminId),
        supabase.from('agents').select('id', { count: 'exact', head: true }).eq('admin_id', adminId),
        supabase.from('payments').select('amount, payment_status').eq('admin_id', adminId),
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
      .eq('admin_id', adminId);
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
      .eq('admin_id', adminId);
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

  // ── Action: create sales agent ───────────────────────────────────────────────
  //
  // Goes through the create-staff-user Edge Function rather than /auth/v1/signup
  // plus a client-side profile upsert. The old path produced agents whose
  // `agents.admin_id` named this admin while their `user_profiles.admin_id` was
  // NULL — a split that leaves the agent orphaned from the tenant that created
  // them, because current_admin_id() reads the PROFILE and coalesces NULL to the
  // user's own id, making them their own tenant of one.
  //
  // Why the old path failed, and failed SILENTLY:
  //   1. /auth/v1/signup fires handle_new_user(), which inserts the profile with
  //      no admin_id — it only copies id/email/full_name/avatar_url/role.
  //   2. The follow-up upsert therefore hit an EXISTING row, so it became an
  //      UPDATE.
  //   3. That row's admin_id is NULL, so it is not in this admin's tenant and
  //      RLS does not match it: 0 rows affected — and zero rows is not an error,
  //      so nothing threw and nothing was logged.
  // Chicken-and-egg: claiming a row into your tenant requires already being able
  // to see it, and you cannot see it until it is in your tenant.
  //
  // The Edge Function writes the profile with the service role, so RLS cannot
  // silently drop the tenant key, and it derives admin_id from the caller's own
  // session server-side rather than trusting the body.
  const createSalesAgent = useCallback(async (agentData) => {
    const adminId     = await getAdminId();
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
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || json?.message || 'Failed to create agent account.');

    const userId = json?.id;
    if (!userId) throw new Error('Agent creation failed — no user ID returned.');

    // Verify the tenant key actually landed before creating the agents row.
    // The old code assumed it had, which is exactly how the split shipped: the
    // agents insert below succeeds against a different table with a different
    // policy, so an unowned profile still produced a fully-formed agent.
    // A MISSING row counts as failure, not as "nothing to check". The
    // user_profiles_select policy admits `admin_id = auth.uid()`, so a correctly
    // linked profile is always readable by the admin who just created it —
    // therefore an empty read means the tenant key did not land and RLS is
    // hiding the row, which is precisely the silent case being guarded against.
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('admin_id')
      .eq('id', userId)
      .maybeSingle();

    if (!profile || profile.admin_id !== adminId) {
      throw new Error(
        'The agent login was created but could not be linked to your company, '
        + 'so it would not see your data. Do not use it — contact support to '
        + 'repair the ownership record.',
      );
    }

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

    // The clients row is created FIRST, then the login is provisioned against
    // it. Two reasons for this order:
    //   • create-staff-user links clients.client_auth_id when it is given a
    //     client_id, and that link is what lets the portal resolve the right
    //     client when several share an email. It could never be set when the
    //     login was created before the row existed.
    //   • if provisioning fails, a retry can still attach a login to the
    //     existing client. The old order failed the other way round, leaving an
    //     auth user with no client row AND the email address consumed.
    let accountNumber = generateAccountNumber();
    let clientRow     = null;
    let clientErr     = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await supabase.from('clients').insert({
        account_number: accountNumber,
        full_name: formData.fullName, email: formData.email, phone: formData.phone || '',
        admin_id: adminId, created_by: adminId,
        agent_id: formData.agentId || null,
        client_status: 'active', kyc_status: 'unverified',
      }).select('id').maybeSingle();
      clientRow = data;
      clientErr = error;
      // account_number is UNIQUE NOT NULL — retry on the (rare) chance the
      // random sequence collides with an existing client.
      if (!error || error.code !== '23505' || !`${error.message}`.includes('account_number')) break;
      accountNumber = generateAccountNumber();
    }
    if (clientErr) throw clientErr;

    // Through create-staff-user rather than /auth/v1/signup + a client-side
    // profile upsert. handle_new_user() creates that profile row with NO
    // admin_id, so the upsert lands as an UPDATE on a row outside this admin's
    // tenant — RLS matches zero rows and returns NO ERROR, so `if (profileErr)`
    // could never catch it. The result was a client orphaned from the tenant
    // that created them. The Edge Function writes the profile with the service
    // role, where RLS cannot silently drop the tenant key.
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Your session has expired — sign in again to invite a client.');

    const res = await fetch(`${supabaseUrl}/functions/v1/create-staff-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        email: formData.email,
        password: tempPassword,
        full_name: formData.fullName,
        role: 'client',
        phone: formData.phone || '',
        admin_id: adminId,
        client_id: clientRow?.id || null,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || json?.message || 'Failed to create client account.');

    const userId = json?.id;
    if (!userId) throw new Error('Client creation failed — no user ID returned.');

    // Confirm the tenant key landed. A missing row counts as failure: the
    // user_profiles_select policy admits `admin_id = auth.uid()`, so a
    // correctly linked profile is always readable by the admin who made it.
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('admin_id')
      .eq('id', userId)
      .maybeSingle();

    if (!profile || profile.admin_id !== adminId) {
      throw new Error(
        `The client record was saved (${accountNumber}) but their login could not `
        + 'be linked to your company, so it would not see your data. Contact '
        + 'support to repair the ownership record before sharing the credentials.',
      );
    }

    // Auto-email the temp credentials to the client (non-fatal).
    emailLoginCredentials({
      to: formData.email,
      type: 'client_welcome',
      data: {
        fullName:      formData.fullName,
        email:         formData.email,
        password:      tempPassword,
        accountNumber,
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

    // `error` above CANNOT catch the failure this guards against. handle_new_user()
    // has already inserted this profile without an admin_id, so the upsert lands
    // as an UPDATE on a row outside this admin's tenant: RLS matches zero rows
    // and reports success. The staff member would be created orphaned — able to
    // sign in, but resolving their own id as their tenant and therefore seeing
    // none of this company's data.
    //
    // Unlike the client and agent paths this one does NOT go through
    // create-staff-user, because that function's CAN_CREATE matrix does not
    // allow an `admin` to create the `hr` role that this form offers, so routing
    // it there would start rejecting HR staff. Until the matrix gains 'hr' and
    // the function is redeployed, the best available fix is to fail loudly
    // rather than ship an orphan silently.
    const { data: staffProfile } = await supabase
      .from('user_profiles')
      .select('admin_id')
      .eq('id', userId)
      .maybeSingle();

    if (!staffProfile || staffProfile.admin_id !== adminId) {
      throw new Error(
        'The staff login was created but could not be linked to your company, so '
        + 'it would not see any of your data. Do not share the credentials — '
        + 'contact support to repair the ownership record.',
      );
    }

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

  // ── Reset ────────────────────────────────────────────────────────────────────
  // Wipes every row this hook holds. This provider is mounted above the router
  // and therefore outlives a sign-out, so without this the next user to sign in
  // on the same tab would render the previous user's data.
  const resetState = useCallback(() => {
    hasLoaded.current = false;
    setStats({
      totalClients: 0, activeClients: 0, totalAssets: 0, totalRevenue: 0,
      outstandingBalance: 0, totalAgents: 0, pendingKYC: 0, totalContracts: 0,
      totalStaff: 0,
    });
    setClients([]);
    setAssets([]);
    setAgents([]);
    setStaff([]);
    setContracts([]);
    setPayments([]);
    setAuditLogs([]);
    setSubscription(null);
    setCompanyProfile(null);
    setSalesAnalytics([]);
    setLoading(true);
    setConnectionStatus('connecting');
  }, []);

  // ── Initial load — once per signed-in user, never while signed out ──────────
  const userId = useAuthScopedLoader(fetchAll, resetState);

  // ── Realtime ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return undefined;
    const t = ++_adminDashboardChannelSeq;

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
    // Re-subscribed per user: a channel opened for the previous session would
    // otherwise keep pushing refetches into the new one.
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Action: the tenant's client self-registration switch ─────────────────────
  // Direct clients register at /user-registration-screen against this company's
  // signup_code (20260830220000). Two controls, and they are not the same thing:
  //
  //   • setSelfSignupEnabled — opens or closes the door. Closing it stops abuse
  //     AND stops every legitimate registration, so it is a shutdown, not a fix.
  //   • rotateSignupCode — mints a new code and kills the old one in one
  //     statement. This is the remedy when a code has been forwarded somewhere
  //     it should not have been, because the door stays open.
  // Both go through RPCs rather than an UPDATE on company_profiles. That table
  // is policed by a migration this repo does not hold, and an UPDATE that RLS
  // declines matches zero rows and returns NO ERROR -- the switch would look
  // like it worked and would not have. The RPCs raise instead, and scope
  // themselves to current_admin_id() so neither can touch another tenant.
  const setSelfSignupEnabled = useCallback(async (enabled) => {
    const { error } = await supabase.rpc('set_self_signup', { p_enabled: Boolean(enabled) });
    if (error) throw error;
    await fetchCompanyProfile();
  }, [fetchCompanyProfile]);

  const rotateSignupCode = useCallback(async () => {
    const { data, error } = await supabase.rpc('rotate_signup_code');
    if (error) throw error;
    await fetchCompanyProfile();
    return data;
  }, [fetchCompanyProfile]);

  // ── Return ───────────────────────────────────────────────────────────────────
  return {
    stats, clients, assets, agents, staff, contracts,
    payments, auditLogs, subscription, companyProfile, salesAnalytics,
    loading, connectionStatus,
    refetch: fetchAll,
    createSalesAgent, createAgent,
    inviteClient, inviteStaff, toggleStaffActive, uploadContract,
    setSelfSignupEnabled, rotateSignupCode,
    exportCSV,
  };
};

export default useAdminDashboard;
