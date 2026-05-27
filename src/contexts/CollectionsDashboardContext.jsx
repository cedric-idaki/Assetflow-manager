/**
 * CollectionsDashboardContext
 * Hoists CollectionsDashboard's data fetching above the router so data
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

const CollectionsDashboardContext = createContext(null);

export const CollectionsDashboardProvider = ({ children }) => {
  const { user } = useAuth();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState({});
  const [agingBuckets, setAgingBuckets] = useState([]);
  const [overdueAccounts, setOverdueAccounts] = useState([]);
  const [weeklyTrend, setWeeklyTrend] = useState([]);
  const [recentPayments, setRecentPayments] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  // ── hasLoaded guard — prevents re-fetch on remount ──────────────────────────
  const hasLoaded = useRef(false);

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [modals, setModals] = useState({
    paymentDetail: null,
    clientDetail: null,
  });

  const openModal = useCallback((name, data = null) => {
    setModals(prev => ({ ...prev, [name]: data ?? true }));
  }, []);

  const closeModal = useCallback((name) => {
    setModals(prev => ({ ...prev, [name]: false }));
  }, []);

  // ── fetchAll — extracted from CollectionsDashboard.jsx ─────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [chargesRes, plansRes, paymentsRes] = await Promise.allSettled([
        supabase
          .from('installment_charges')
          .select(
            'id, amount, scheduled_date, charge_status, client_id, plan:installment_plans(plan_name, client:clients(full_name, account_number, phone))'
          )
          .order('scheduled_date', { ascending: true }),
        supabase
          .from('installment_plans')
          .select(
            'id, total_amount, installments_paid, installment_amount, plan_status, client:clients(full_name, account_number)'
          )
          .eq('plan_status', 'active'),
        supabase
          .from('payments')
          .select(
            'id, amount, payment_date, payment_status, client:clients(full_name, account_number)'
          )
          .order('payment_date', { ascending: false })
          .limit(10),
      ]);

      const charges =
        chargesRes.status === 'fulfilled' ? chargesRes.value.data || [] : [];
      const plans =
        plansRes.status === 'fulfilled' ? plansRes.value.data || [] : [];
      const payments =
        paymentsRes.status === 'fulfilled' ? paymentsRes.value.data || [] : [];

      // Overdue = scheduled before today AND not paid
      const overdue = charges.filter(
        c => c.charge_status === 'scheduled' && new Date(c.scheduled_date) < today
      );

      // Due today / this week
      const weekEnd = new Date(today);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const dueThisWeek = charges.filter(
        c =>
          c.charge_status === 'scheduled' &&
          new Date(c.scheduled_date) >= today &&
          new Date(c.scheduled_date) <= weekEnd
      );
      const dueToday = dueThisWeek.filter(c => {
        const d = new Date(c.scheduled_date);
        return d.toDateString() === today.toDateString();
      });

      const totalOverdue = overdue.reduce(
        (s, c) => s + parseFloat(c.amount || 0),
        0
      );
      const totalDueThisWeek = dueThisWeek.reduce(
        (s, c) => s + parseFloat(c.amount || 0),
        0
      );
      const completedThisMonth = payments.filter(p => {
        const d = new Date(p.payment_date);
        return (
          p.payment_status === 'completed' &&
          d.getMonth() === today.getMonth()
        );
      });
      const collectedThisMonth = completedThisMonth.reduce(
        (s, p) => s + parseFloat(p.amount || 0),
        0
      );

      setKpis({
        overdueCount: overdue.length,
        totalOverdue,
        dueTodayCount: dueToday.length,
        dueTodayAmount: dueToday.reduce(
          (s, c) => s + parseFloat(c.amount || 0),
          0
        ),
        dueThisWeekCount: dueThisWeek.length,
        totalDueThisWeek,
        collectedThisMonth,
        activePlans: plans.length,
      });

      // Aging buckets
      const bucket1 = overdue.filter(c => {
        const days = Math.floor(
          (today - new Date(c.scheduled_date)) / 86400000
        );
        return days >= 1 && days <= 30;
      });
      const bucket2 = overdue.filter(c => {
        const days = Math.floor(
          (today - new Date(c.scheduled_date)) / 86400000
        );
        return days >= 31 && days <= 60;
      });
      const bucket3 = overdue.filter(c => {
        const days = Math.floor(
          (today - new Date(c.scheduled_date)) / 86400000
        );
        return days > 60;
      });

      setAgingBuckets([
        {
          label: '1–30 Days',
          key: '1-30',
          count: bucket1.length,
          amount: bucket1.reduce((s, c) => s + parseFloat(c.amount || 0), 0),
        },
        {
          label: '31–60 Days',
          key: '31-60',
          count: bucket2.length,
          amount: bucket2.reduce((s, c) => s + parseFloat(c.amount || 0), 0),
        },
        {
          label: '60+ Days',
          key: '60+',
          count: bucket3.length,
          amount: bucket3.reduce((s, c) => s + parseFloat(c.amount || 0), 0),
        },
      ]);

      // Top overdue accounts (group by client)
      const clientOverdue = {};
      overdue.forEach(c => {
        const name = c.plan?.client?.full_name || 'Unknown';
        const acct = c.plan?.client?.account_number || '—';
        const phone = c.plan?.client?.phone || '—';
        const key = name + acct;
        const days = Math.floor(
          (today - new Date(c.scheduled_date)) / 86400000
        );
        if (!clientOverdue[key]) {
          clientOverdue[key] = { name, acct, phone, amount: 0, count: 0, maxDays: 0 };
        }
        clientOverdue[key].amount += parseFloat(c.amount || 0);
        clientOverdue[key].count++;
        clientOverdue[key].maxDays = Math.max(
          clientOverdue[key].maxDays,
          days
        );
      });
      setOverdueAccounts(
        Object.values(clientOverdue)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 8)
      );

      // Weekly collection trend (last 7 days)
      const weekly = [];
      for (let i = 6; i >= 0; i--) {
        const day = new Date(today);
        day.setDate(day.getDate() - i);
        const dayPayments = payments.filter(p => {
          const d = new Date(p.payment_date);
          return (
            p.payment_status === 'completed' &&
            d.toDateString() === day.toDateString()
          );
        });
        weekly.push({
          day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getDay()],
          collected: Math.round(
            dayPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0)
          ),
        });
      }
      setWeeklyTrend(weekly);
      setRecentPayments(payments.slice(0, 6));
      setLastUpdated(new Date());

      // Mark as loaded after first successful fetch
      hasLoaded.current = true;
    } catch (err) {
      console.error('CollectionsDashboardContext fetchAll error:', err);
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
    agingBuckets,
    overdueAccounts,
    weeklyTrend,
    recentPayments,
    lastUpdated,
    refetch,
    modals,
    openModal,
    closeModal,
  };

  return (
    <CollectionsDashboardContext.Provider value={value}>
      {children}
    </CollectionsDashboardContext.Provider>
  );
};

export const useCollectionsDashboardContext = () => {
  const ctx = useContext(CollectionsDashboardContext);
  if (!ctx) {
    throw new Error(
      'useCollectionsDashboardContext must be used within CollectionsDashboardProvider'
    );
  }
  return ctx;
};
