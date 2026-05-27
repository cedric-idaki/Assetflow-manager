/**
 * StaffDashboardContext
 * Hoists StaffDashboard's data fetching above the router so data
 * survives navigation / tab-switch remount cycles.
 *
 * Key behaviours:
 *  - hasLoaded guard (useRef) prevents re-fetch on remount after first load
 *  - refetch() bypasses the guard so the "Refresh" button still works
 *  - user?.id AND userProfile?.admin_id in useEffect deps reset the guard on
 *    auth change (logout/login) — StaffDashboard is the only new provider that
 *    needs both because queries are scoped to admin_id
 *  - modals / openModal / closeModal follow the same pattern as AdminDashboardContext
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

const StaffDashboardContext = createContext(null);

export const StaffDashboardProvider = ({ children }) => {
  const { user, userProfile } = useAuth();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState({ clients: 0, payments: 0, assets: 0, revenue: 0 });
  const [activity, setActivity] = useState([]);
  const [adminName, setAdminName] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  // ── hasLoaded guard — prevents re-fetch on remount ──────────────────────────
  const hasLoaded = useRef(false);

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [modals, setModals] = useState({});

  const openModal = useCallback((name, data = null) => {
    setModals(prev => ({ ...prev, [name]: data ?? true }));
  }, []);

  const closeModal = useCallback((name) => {
    setModals(prev => ({ ...prev, [name]: false }));
  }, []);

  // ── loadData — extracted from StaffDashboard.jsx ───────────────────────────
  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const adminId = userProfile?.admin_id;

      // Run all queries in parallel
      const [clientsRes, paymentsRes, assetsRes, activityRes, adminRes] = await Promise.allSettled([
        adminId
          ? supabase.from('clients').select('id', { count: 'exact', head: true }).eq('admin_id', adminId)
          : Promise.resolve({ data: null, count: 0 }),
        adminId
          ? supabase.from('payments').select('amount').eq('admin_id', adminId).eq('status', 'completed')
          : Promise.resolve({ data: [] }),
        adminId
          ? supabase.from('assets').select('id', { count: 'exact', head: true }).eq('admin_id', adminId)
          : Promise.resolve({ data: null, count: 0 }),
        supabase
          .from('audit_logs')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(8),
        adminId
          ? supabase.from('user_profiles').select('full_name').eq('id', adminId).single()
          : Promise.resolve({ data: null }),
      ]);

      const clients  = clientsRes.status === 'fulfilled'  ? (clientsRes.value.count  || 0) : 0;
      const assets   = assetsRes.status === 'fulfilled'   ? (assetsRes.value.count   || 0) : 0;
      const payments = paymentsRes.status === 'fulfilled' ? (paymentsRes.value.data  || []) : [];
      const revenue  = payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const logs     = activityRes.status === 'fulfilled' ? (activityRes.value.data  || []) : [];
      const admin    = adminRes.status === 'fulfilled'    ? adminRes.value.data : null;

      setKpis({ clients, assets, payments: payments.length, revenue });
      setActivity(logs);
      setAdminName(admin?.full_name || '');
      setLastUpdated(new Date());

      // Mark as loaded after first successful fetch
      hasLoaded.current = true;
    } catch (err) {
      console.error('StaffDashboardContext loadData error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, userProfile?.admin_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── refetch — unconditional, bypasses the hasLoaded guard ──────────────────
  const refetch = useCallback(() => {
    return loadData();
  }, [loadData]);

  // ── Trigger fetch on mount; guard prevents re-fetch on remount ─────────────
  // user?.id in deps resets the guard when the authenticated user changes
  useEffect(() => {
    if (hasLoaded.current) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only — hasLoaded guard handles remount protection

  // ── Reset hasLoaded when user or admin_id changes (logout / login) ──────────
  useEffect(() => {
    hasLoaded.current = false;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, userProfile?.admin_id]);

  // ── Context value ───────────────────────────────────────────────────────────
  const value = {
    loading,
    kpis,
    activity,
    adminName,
    lastUpdated,
    refetch,
    modals,
    openModal,
    closeModal,
  };

  return (
    <StaffDashboardContext.Provider value={value}>
      {children}
    </StaffDashboardContext.Provider>
  );
};

export const useStaffDashboardContext = () => {
  const ctx = useContext(StaffDashboardContext);
  if (!ctx) {
    throw new Error(
      'useStaffDashboardContext must be used within StaffDashboardProvider'
    );
  }
  return ctx;
};
