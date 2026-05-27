/**
 * DirectorDashboardContext
 * Hoists DirectorDashboard's data fetching above the router so data
 * survives navigation / tab-switch remount cycles.
 *
 * Key behaviours:
 *  - hasLoaded guard (useRef) prevents re-fetch on remount after first load
 *  - refetch() bypasses the guard so the "Refresh" button still works
 *  - user?.id in useEffect deps resets the guard on auth change (logout/login)
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

const DirectorDashboardContext = createContext(null);

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const DirectorDashboardProvider = ({ children }) => {
  const { user } = useAuth();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState({});
  const [collectionTrend, setCollectionTrend] = useState([]);
  const [topAssets, setTopAssets] = useState([]);
  const [agentPerformance, setAgentPerformance] = useState([]);
  const [portfolioHealth, setPortfolioHealth] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  // ── hasLoaded guard — prevents re-fetch on remount ──────────────────────────
  const hasLoaded = useRef(false);

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [modals, setModals] = useState({
    assetDetail: null,
    clientDetail: null,
    approvalDetail: null,
  });

  const openModal = useCallback((name, data = null) => {
    setModals(prev => ({ ...prev, [name]: data ?? true }));
  }, []);

  const closeModal = useCallback((name) => {
    setModals(prev => ({ ...prev, [name]: false }));
  }, []);

  // ── fetchAll — extracted from DirectorDashboard.jsx ────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const year = new Date().getFullYear();

      const [
        clientsRes, assetsRes, paymentsRes, plansRes, agentsRes, pendingRes
      ] = await Promise.allSettled([
        supabase.from('clients').select('id, outstanding_balance, client_status'),
        supabase.from('assets').select('id, selling_price, asset_status, asset_type, asset_name'),
        supabase.from('payments').select('amount, payment_date, payment_status').gte('payment_date', `${year}-01-01`),
        supabase.from('installment_plans').select('total_amount, installments_paid, installment_amount, plan_status'),
        supabase.from('agents').select('id, full_name, total_sales, total_commission, commission_rate'),
        supabase.from('maker_checker_queue').select('id').eq('status', 'pending'),
      ]);

      const clients = clientsRes.status === 'fulfilled' ? clientsRes.value.data || [] : [];
      const assets = assetsRes.status === 'fulfilled' ? assetsRes.value.data || [] : [];
      const payments = paymentsRes.status === 'fulfilled' ? paymentsRes.value.data || [] : [];
      const plans = plansRes.status === 'fulfilled' ? plansRes.value.data || [] : [];
      const agents = agentsRes.status === 'fulfilled' ? agentsRes.value.data || [] : [];
      const pending = pendingRes.status === 'fulfilled' ? pendingRes.value.data || [] : [];

      // KPIs
      const totalAssetValue = assets.reduce((s, a) => s + parseFloat(a.selling_price || 0), 0);
      const totalCollected = payments
        .filter(p => p.payment_status === 'completed')
        .reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const totalOutstanding =
        clients.reduce((s, c) => s + parseFloat(c.outstanding_balance || 0), 0) ||
        plans
          .filter(p => p.plan_status === 'active')
          .reduce(
            (s, p) =>
              s +
              (parseFloat(p.total_amount || 0) -
                parseFloat(p.installments_paid || 0) * parseFloat(p.installment_amount || 0)),
            0
          );
      const activeClients = clients.filter(c => c.client_status === 'active').length;
      const soldAssets = assets.filter(a => a.asset_status === 'sold').length;
      const efficiency = totalAssetValue > 0 ? (totalCollected / totalAssetValue) * 100 : 0;

      setKpis({
        totalAssetValue,
        totalCollected,
        totalOutstanding,
        activeClients,
        soldAssets,
        totalAssets: assets.length,
        efficiency,
        pendingApprovals: pending.length,
        totalAgents: agents.length,
      });

      // Monthly collection trend (last 6 months)
      const currentMonth = new Date().getMonth();
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const mIdx = (currentMonth - i + 12) % 12;
        const mPayments = payments.filter(p => {
          const d = new Date(p.payment_date);
          return d.getMonth() === mIdx && p.payment_status === 'completed';
        });
        trend.push({
          month: MONTHS[mIdx],
          collected: Math.round(mPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0)),
          count: mPayments.length,
        });
      }
      setCollectionTrend(trend);

      // Top 5 assets by selling price
      const top = [...assets]
        .sort((a, b) => parseFloat(b.selling_price || 0) - parseFloat(a.selling_price || 0))
        .slice(0, 5)
        .map(a => ({
          name: (a.asset_name || 'Unknown').slice(0, 20),
          value: Math.round(parseFloat(a.selling_price || 0) / 1000),
          status: a.asset_status,
        }));
      setTopAssets(top);

      // Agent performance (top 5)
      const agentData = agents.slice(0, 5).map(a => ({
        name: (a.full_name || 'Agent').split(' ')[0],
        sales: Math.round(parseFloat(a.total_sales || 0) / 1000),
        commission: Math.round(parseFloat(a.total_commission || 0) / 1000),
      }));
      setAgentPerformance(agentData);

      // Portfolio health
      const activeCount = assets.filter(a => a.asset_status === 'active').length;
      const soldCount = assets.filter(a => a.asset_status === 'sold').length;
      const reservedCount = assets.filter(a => a.asset_status === 'reserved').length;
      setPortfolioHealth({ activeCount, soldCount, reservedCount, total: assets.length });

      setLastUpdated(new Date());

      // Mark as loaded after first successful fetch
      hasLoaded.current = true;
    } catch (err) {
      console.error('DirectorDashboardContext fetchAll error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── refetch — unconditional, bypasses the hasLoaded guard ──────────────────
  const refetch = useCallback(() => {
    return fetchAll();
  }, [fetchAll]);

  // ── Trigger fetch on mount; guard prevents re-fetch on remount ─────────────
  // user?.id in deps resets the guard when the authenticated user changes
  useEffect(() => {
    if (hasLoaded.current) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only — hasLoaded guard handles remount protection

  // ── Reset hasLoaded when user changes (logout / login) ─────────────────────
  useEffect(() => {
    hasLoaded.current = false;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Context value ───────────────────────────────────────────────────────────
  const value = {
    loading,
    kpis,
    collectionTrend,
    topAssets,
    agentPerformance,
    portfolioHealth,
    lastUpdated,
    refetch,
    modals,
    openModal,
    closeModal,
  };

  return (
    <DirectorDashboardContext.Provider value={value}>
      {children}
    </DirectorDashboardContext.Provider>
  );
};

export const useDirectorDashboardContext = () => {
  const ctx = useContext(DirectorDashboardContext);
  if (!ctx) {
    throw new Error(
      'useDirectorDashboardContext must be used within DirectorDashboardProvider'
    );
  }
  return ctx;
};
