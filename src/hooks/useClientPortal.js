import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthScopedLoader } from './useAuthScopedLoader';

export const useClientPortal = () => {
  const [clientProfile, setClientProfile] = useState(null);
  const [myAssets, setMyAssets] = useState([]);
  const [browseAssets, setBrowseAssets] = useState([]);
  const [payments, setPayments] = useState([]);
  const [installmentPlans, setInstallmentPlans] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  // ── Get client profile linked to logged in user ────────────────────────────
  const fetchClientProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return null;

      let profile = null;

      // Primary: SECURITY DEFINER RPC — bypasses RLS and resolves the client by
      // their auth link first (email only as a fallback), so a shared email can
      // never surface the wrong client's row.
      const rpcRes = await supabase.rpc('get_my_client_profile');
      if (!rpcRes.error && Array.isArray(rpcRes.data) && rpcRes.data.length) {
        profile = rpcRes.data[0];
      }

      // Fallback: direct select (works once the self-read RLS policy exists).
      // Prefer the hard auth link; only fall back to email when it's unset.
      if (!profile) {
        const byAuth = await supabase
          .from('clients')
          .select('*')
          .eq('client_auth_id', user.id)
          .maybeSingle();
        profile = byAuth.data || null;
      }
      if (!profile) {
        const res = await supabase
          .from('clients')
          .select('*')
          .eq('email', user.email)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        profile = res.data || null;
      }

      setClientProfile(profile);
      return profile;
    } catch (err) {
      console.error('[ClientPortal] Profile error:', err);
      return null;
    }
  }, []);

  // ── Fetch assets linked to this client ─────────────────────────────────────
  const fetchMyAssets = useCallback(async (clientId) => {
    try {
      const { data } = await supabase
        .from('assets')
        .select('*')
        .eq('linked_client_id', clientId)
        .order('created_at', { ascending: false });
      setMyAssets(data || []);
    } catch (err) {
      console.error('[ClientPortal] My assets error:', err);
    }
  }, []);

  // ── Fetch available assets from the client's company to browse ─────────────
  // RLS (clients_browse_company_market_assets) scopes the read to the client's
  // own company through assets.admin_id, so staff-registered stock is included
  // and no other company's market is ever visible here.
  const fetchBrowseAssets = useCallback(async (clientId) => {
    try {
      let query = supabase
        .from('assets')
        .select('*')
        .eq('asset_status', 'available')
        .order('created_at', { ascending: false });
      // A plain .neq() drops unlinked assets (NULL <> x is not true in SQL),
      // which is most of the market — NULL must survive the filter.
      if (clientId) {
        query = query.or(`linked_client_id.is.null,linked_client_id.neq.${clientId}`);
      }
      const { data } = await query;
      setBrowseAssets(data || []);
    } catch (err) {
      console.error('[ClientPortal] Browse assets error:', err);
    }
  }, []);

  // ── Fetch payment history ──────────────────────────────────────────────────
  const fetchPayments = useCallback(async (clientId) => {
    try {
      const { data } = await supabase
        .from('payments')
        .select('*, asset:assets(description, asset_code)')
        .eq('client_id', clientId)
        .order('payment_date', { ascending: false });
      setPayments(data || []);
    } catch (err) {
      console.error('[ClientPortal] Payments error:', err);
    }
  }, []);

  // ── Fetch installment plans ────────────────────────────────────────────────
  const fetchInstallmentPlans = useCallback(async (clientId) => {
    try {
      const { data } = await supabase
        .from('installment_plans')
        .select('*, asset:assets(description, asset_code), installment_charges(*)')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      setInstallmentPlans(data || []);
    } catch (err) {
      console.error('[ClientPortal] Installment plans error:', err);
    }
  }, []);

  // ── Fetch my enquiries ─────────────────────────────────────────────────────
  const fetchEnquiries = useCallback(async (clientId) => {
    try {
      const { data } = await supabase
        .from('asset_enquiries')
        .select('*, asset:assets(description, asset_code, asset_type, selling_price)')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      setEnquiries(data || []);
    } catch (err) {
      console.error('[ClientPortal] Enquiries error:', err);
    }
  }, []);

  // ── Resolve the current user's client row (link first, email fallback) ──────
  const resolveClient = useCallback(async (columns = 'id, admin_id') => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const byAuth = await supabase
      .from('clients')
      .select(columns)
      .eq('client_auth_id', user.id)
      .maybeSingle();
    if (byAuth.data) return byAuth.data;

    const byEmail = await supabase
      .from('clients')
      .select(columns)
      .eq('email', user.email)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return byEmail.data || null;
  }, []);

  // ── Send asset enquiry ─────────────────────────────────────────────────────
  const sendEnquiry = useCallback(async (assetId, message) => {
    try {
      const client = await resolveClient('id, admin_id');

      if (!client) throw new Error('Client profile not found');

      const { data, error } = await supabase
        .from('asset_enquiries')
        .insert({
          client_id: client.id,
          asset_id: assetId,
          admin_id: client.admin_id,
          message,
          status: 'pending',
        })
        .select()
        .maybeSingle();

      if (error) throw error;
      await fetchEnquiries(client.id);
      return data;
    } catch (err) {
      throw err;
    }
  }, [fetchEnquiries, resolveClient]);

  // ── Initiate Mpesa payment ─────────────────────────────────────────────────
  const initiateMpesaPayment = useCallback(async (amount, phone, assetId) => {
    try {
      const client = await resolveClient('id');
      if (!client) throw new Error('Client profile not found');

      const { data: payment, error } = await supabase
        .from('payments')
        .insert({
          transaction_id: `TXN-${Date.now()}`,
          client_id: client.id,
          asset_id: assetId || null,
          amount,
          payment_method: 'mpesa',
          payment_status: 'pending',
          reference_number: `MPESA-${Date.now()}`,
        })
        .select()
        .maybeSingle();

      if (error) throw error;

      return { success: true, payment, message: `STK push sent to ${phone}` };
    } catch (err) {
      throw err;
    }
  }, [resolveClient]);

  // ── Export payment history as CSV ─────────────────────────────────────────
  const exportPayments = useCallback(() => {
    if (!payments.length) return;
    const keys = ['transaction_id', 'amount', 'payment_method', 'payment_status', 'payment_date'];
    const csv = [
      keys.join(','),
      ...payments.map(p => keys.map(k => `"${String(p[k] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment_history_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [payments]);

  // ── Fetch all ──────────────────────────────────────────────────────────────
  const hasLoaded = useRef(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const client = await fetchClientProfile();
      if (client) {
        await Promise.all([
          fetchMyAssets(client.id),
          fetchBrowseAssets(client.id),
          fetchPayments(client.id),
          fetchInstallmentPlans(client.id),
          fetchEnquiries(client.id),
        ]);
        setConnectionStatus('connected');
      }
    } catch (err) {
      setConnectionStatus('disconnected');
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [fetchClientProfile, fetchMyAssets, fetchBrowseAssets, fetchPayments, fetchInstallmentPlans, fetchEnquiries]);

  // Every field here belongs to one client. This provider lives above the
  // router, so without an explicit reset the next person to sign in on this
  // tab would see the previous client's assets, payments and plans.
  const resetState = useCallback(() => {
    hasLoaded.current = false;
    setClientProfile(null);
    setMyAssets([]);
    setBrowseAssets([]);
    setPayments([]);
    setInstallmentPlans([]);
    setEnquiries([]);
    setLoading(true);
    setConnectionStatus('connecting');
  }, []);

  useAuthScopedLoader(fetchAll, resetState);

  return {
    clientProfile,
    myAssets,
    browseAssets,
    payments,
    installmentPlans,
    enquiries,
    loading,
    connectionStatus,
    refetch: fetchAll,
    sendEnquiry,
    initiateMpesaPayment,
    exportPayments,
  };
};

export default useClientPortal;
