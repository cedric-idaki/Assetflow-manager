/**
 * AccountantDashboardContext
 * Hoists AccountantDashboard's data fetching above the router so data
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

const AccountantDashboardContext = createContext(null);

export const AccountantDashboardProvider = ({ children }) => {
  const { user } = useAuth();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState({});
  const [monthlyBreakdown, setMonthlyBreakdown] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [recentPayments, setRecentPayments] = useState([]);
  const [overdueAccounts, setOverdueAccounts] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  // ── hasLoaded guard — prevents re-fetch on remount ──────────────────────────
  const hasLoaded = useRef(false);

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [modals, setModals] = useState({
    paymentDetail: null,
    clientDetail: null,
    approvalDetail: null,
  });

  const openModal = useCallback((name, data = null) => {
    setModals(prev => ({ ...prev, [name]: data ?? true }));
  }, []);

  const closeModal = useCallback((name) => {
    setModals(prev => ({ ...prev, [name]: false }));
  }, []);

  // ── fetchAll — extracted from AccountantDashboard.jsx ──────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const year = new Date().getFullYear();

      const [paymentsRes, plansRes, clientsRes, pendingRes] = await Promise.allSettled([
        supabase
          .from('payments')
          .select(
            'id, amount, payment_date, payment_status, payment_method, client:clients(full_name, account_number)'
          )
          .order('payment_date', { ascending: false }),
        supabase
          .from('installment_plans')
          .select(
            'id, total_amount, installments_paid, installment_amount, plan_status, client:clients(full_name, account_number, outstanding_balance)'
          )
          .eq('plan_status', 'active'),
        supabase.from('clients').select('id, outstanding_balance, client_status'),
        supabase.from('maker_checker_queue').select('id').eq('status', 'pending'),
      ]);

      const payments =
        paymentsRes.status === 'fulfilled' ? paymentsRes.value.data || [] : [];
      const plans =
        plansRes.status === 'fulfilled' ? plansRes.value.data || [] : [];
      const clients =
        clientsRes.status === 'fulfilled' ? clientsRes.value.data || [] : [];
      const pending =
        pendingRes.status === 'fulfilled' ? pendingRes.value.data || [] : [];

      const ytdPayments = payments.filter(
        p => new Date(p.payment_date).getFullYear() === year
      );
      const completedYTD = ytdPayments.filter(p => p.payment_status === 'completed');
      const totalCollectedYTD = completedYTD.reduce(
        (s, p) => s + parseFloat(p.amount || 0),
        0
      );

      const totalOutstanding =
        clients.reduce((s, c) => s + parseFloat(c.outstanding_balance || 0), 0) ||
        plans.reduce(
          (s, p) =>
            s +
            Math.max(
              0,
              parseFloat(p.total_amount || 0) -
                parseFloat(p.installments_paid || 0) *
                  parseFloat(p.installment_amount || 0)
            ),
          0
        );

      const thisMonth = new Date().getMonth();
      const thisMonthPayments = completedYTD.filter(
        p => new Date(p.payment_date).getMonth() === thisMonth
      );
      const totalCollectedThisMonth = thisMonthPayments.reduce(
        (s, p) => s + parseFloat(p.amount || 0),
        0
      );

      const lastMonth = (thisMonth - 1 + 12) % 12;
      const lastMonthPayments = completedYTD.filter(
        p => new Date(p.payment_date).getMonth() === lastMonth
      );
      const totalCollectedLastMonth = lastMonthPayments.reduce(
        (s, p) => s + parseFloat(p.amount || 0),
        0
      );
      const momChange =
        totalCollectedLastMonth > 0
          ? ((totalCollectedThisMonth - totalCollectedLastMonth) /
              totalCollectedLastMonth) *
            100
          : 0;

      const pendingPayments = payments.filter(p => p.payment_status === 'pending');
      const failedPayments = payments.filter(p => p.payment_status === 'failed');

      setKpis({
        totalCollectedYTD,
        totalCollectedThisMonth,
        totalOutstanding,
        pendingCount: pendingPayments.length,
        pendingAmount: pendingPayments.reduce(
          (s, p) => s + parseFloat(p.amount || 0),
          0
        ),
        failedCount: failedPayments.length,
        activePlans: plans.length,
        pendingApprovals: pending.length,
        momChange,
      });

      // Monthly breakdown (last 6 months)
      const MONTHS = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      ];
      const monthly = [];
      for (let i = 5; i >= 0; i--) {
        const mIdx = (thisMonth - i + 12) % 12;
        const mCompleted = completedYTD.filter(
          p => new Date(p.payment_date).getMonth() === mIdx
        );
        const mPending = ytdPayments.filter(
          p =>
            p.payment_status === 'pending' &&
            new Date(p.payment_date).getMonth() === mIdx
        );
        monthly.push({
          month: MONTHS[mIdx],
          collected: Math.round(
            mCompleted.reduce((s, p) => s + parseFloat(p.amount || 0), 0)
          ),
          pending: Math.round(
            mPending.reduce((s, p) => s + parseFloat(p.amount || 0), 0)
          ),
        });
      }
      setMonthlyBreakdown(monthly);

      // Payment method breakdown
      const methodMap = {};
      completedYTD.forEach(p => {
        const m = (p.payment_method || 'other')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        methodMap[m] = (methodMap[m] || 0) + parseFloat(p.amount || 0);
      });
      setPaymentMethods(
        Object.entries(methodMap)
          .map(([name, value]) => ({ name, value: Math.round(value) }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
      );

      // Recent payments (last 10)
      setRecentPayments(payments.slice(0, 10));

      // Overdue accounts (plans where outstanding > 0, ordered by amount)
      const overdue = plans
        .map(p => ({
          clientName: p.client?.full_name || 'Unknown',
          accountNumber: p.client?.account_number || '—',
          outstanding: Math.max(
            0,
            parseFloat(p.total_amount || 0) -
              parseFloat(p.installments_paid || 0) *
                parseFloat(p.installment_amount || 0)
          ),
        }))
        .filter(p => p.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding)
        .slice(0, 5);
      setOverdueAccounts(overdue);

      setLastUpdated(new Date());

      // Mark as loaded after first successful fetch
      hasLoaded.current = true;
    } catch (err) {
      console.error('AccountantDashboardContext fetchAll error:', err);
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
    monthlyBreakdown,
    paymentMethods,
    recentPayments,
    overdueAccounts,
    lastUpdated,
    refetch,
    modals,
    openModal,
    closeModal,
  };

  return (
    <AccountantDashboardContext.Provider value={value}>
      {children}
    </AccountantDashboardContext.Provider>
  );
};

export const useAccountantDashboardContext = () => {
  const ctx = useContext(AccountantDashboardContext);
  if (!ctx) {
    throw new Error(
      'useAccountantDashboardContext must be used within AccountantDashboardProvider'
    );
  }
  return ctx;
};
