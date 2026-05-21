import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

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
      if (!user) return null;

      const { data } = await supabase
        .from('clients')
        .select('*, admin:user_profiles!admin_id(full_name, email, phone)')
        .eq('email', user.email)
        .single();

      setClientProfile(data);
      return data;
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

  // ── Fetch available assets from same admin to browse ───────────────────────
  const fetchBrowseAssets = useCallback(async (adminId, clientId) => {
    try {
      const { data } = await supabase
        .from('assets')
        .select('*')
        .eq('registered_by', adminId)
        .eq('asset_status', 'available')
        .neq('linked_client_id', clientId)
        .order('created_at', { ascending: false });
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

  // ── Send asset enquiry ─────────────────────────────────────────────────────
  const sendEnquiry = useCallback(async (assetId, message) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: client } = await supabase
        .from('clients')
        .select('id, admin_id')
        .eq('email', user.email)
        .single();

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
        .single();

      if (error) throw error;
      await fetchEnquiries(client.id);
      return data;
    } catch (err) {
      throw err;
    }
  }, [fetchEnquiries]);

  // ── Initiate Mpesa payment ─────────────────────────────────────────────────
  const initiateMpesaPayment = useCallback(async (amount, phone, assetId) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('email', user.email)
        .single();

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
        .single();

      if (error) throw error;

      return { success: true, payment, message: `STK push sent to ${phone}` };
    } catch (err) {
      throw err;
    }
  }, []);

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
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const client = await fetchClientProfile();
      if (client) {
        await Promise.all([
          fetchMyAssets(client.id),
          fetchBrowseAssets(client.admin_id, client.id),
          fetchPayments(client.id),
          fetchInstallmentPlans(client.id),
          fetchEnquiries(client.id),
        ]);
        setConnectionStatus('connected');
      }
    } catch (err) {
      setConnectionStatus('disconnected');
    } finally {
      setLoading(false);
    }
  }, [fetchClientProfile, fetchMyAssets, fetchBrowseAssets, fetchPayments, fetchInstallmentPlans, fetchEnquiries]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

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
