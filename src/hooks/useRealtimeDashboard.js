import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export const useRealtimeDashboard = () => {
  const [kpis, setKpis] = useState({
    totalAssetValueSold: 0,
    totalCollected: 0,
    outstandingBalance: 0,
    collectionEfficiency: 0,
    pendingApprovals: 0,
  });
  const [agingBuckets, setAgingBuckets] = useState([
    { label: '1-30 Days', days: '1-30', amount: 0, count: 0, severity: 'low' },
    { label: '31-60 Days', days: '31-60', amount: 0, count: 0, severity: 'medium' },
    { label: '60+ Days', days: '60+', amount: 0, count: 0, severity: 'high' },
  ]);
  const [recentPayments, setRecentPayments] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const channelsRef = useRef([]);
  const hasLoaded = useRef(false);

  const fetchKPIs = useCallback(async () => {
    setSyncing(true);
    try {
      // 1. Total asset value sold — sum of selling_price from assets
      const { data: assets } = await supabase
        ?.from('assets')
        ?.select('selling_price');
      const totalAssetValueSold = (assets || [])?.reduce(
        (sum, a) => sum + parseFloat(a?.selling_price || 0), 0
      );

      // 2. Total collected — sum from payments where payment_status = 'completed'
      const { data: completedPayments } = await supabase
        ?.from('payments')
        ?.select('amount')
        ?.eq('payment_status', 'completed');
      const totalCollected = (completedPayments || [])?.reduce(
        (sum, p) => sum + parseFloat(p?.amount || 0), 0
      );

      // 3. Outstanding balance — sum of balance from installment_plans
      // balance = total_amount - (installments_paid * installment_amount)
      const { data: plans } = await supabase
        ?.from('installment_plans')
        ?.select('total_amount, installments_paid, installment_amount')
        ?.eq('plan_status', 'active');
      const outstandingBalance = (plans || [])?.reduce((sum, p) => {
        const paid = parseFloat(p?.installments_paid || 0) * parseFloat(p?.installment_amount || 0);
        const balance = parseFloat(p?.total_amount || 0) - paid;
        return sum + Math.max(0, balance);
      }, 0);

      // 4. Collection efficiency = collected / total asset value * 100
      const collectionEfficiency = totalAssetValueSold > 0
        ? Math.min(100, Math.round((totalCollected / totalAssetValueSold) * 100))
        : 0;

      // 5. Pending approvals from maker_checker_queue
      const { count: pendingApprovals } = await supabase
        ?.from('maker_checker_queue')
        ?.select('id', { count: 'exact', head: true })
        ?.eq('status', 'pending');

      setKpis({
        totalAssetValueSold,
        totalCollected,
        outstandingBalance,
        collectionEfficiency,
        pendingApprovals: pendingApprovals || 0,
      });
      setLastUpdated(new Date());
      setConnectionStatus('connected');
    } catch (err) {
      console.error('[useRealtimeDashboard] KPI fetch error:', err);
      setConnectionStatus('disconnected');
    } finally {
      setSyncing(false);
    }
  }, []);

  const fetchAgingAnalysis = useCallback(async () => {
    try {
      const today = new Date();
      const todayStr = today?.toISOString()?.split('T')?.[0];

      // Get overdue installment_charges (scheduled_date < today, not succeeded/cancelled)
      const { data: charges } = await supabase
        ?.from('installment_charges')
        ?.select('amount, scheduled_date, charge_status')
        ?.lt('scheduled_date', todayStr)
        ?.not('charge_status', 'in', '("succeeded","cancelled")');

      const bucket1 = { label: '1-30 Days', days: '1-30', amount: 0, count: 0, severity: 'low' };
      const bucket2 = { label: '31-60 Days', days: '31-60', amount: 0, count: 0, severity: 'medium' };
      const bucket3 = { label: '60+ Days', days: '60+', amount: 0, count: 0, severity: 'high' };

      (charges || [])?.forEach(charge => {
        const scheduledDate = new Date(charge?.scheduled_date);
        const daysOverdue = Math.floor((today - scheduledDate) / (1000 * 60 * 60 * 24));
        const amount = parseFloat(charge?.amount || 0);

        if (daysOverdue >= 1 && daysOverdue <= 30) {
          bucket1.amount += amount;
          bucket1.count += 1;
        } else if (daysOverdue >= 31 && daysOverdue <= 60) {
          bucket2.amount += amount;
          bucket2.count += 1;
        } else if (daysOverdue > 60) {
          bucket3.amount += amount;
          bucket3.count += 1;
        }
      });

      setAgingBuckets([bucket1, bucket2, bucket3]);
    } catch (err) {
      console.error('[useRealtimeDashboard] Aging fetch error:', err);
    }
  }, []);

  const fetchRecentPayments = useCallback(async () => {
    try {
      const { data } = await supabase
        ?.from('payments')
        ?.select('id, amount, payment_method, payment_status, payment_date, transaction_id, client:clients(full_name, account_number)')
        ?.order('payment_date', { ascending: false })
        ?.limit(10);
      setRecentPayments(data || []);
    } catch (err) {
      console.error('[useRealtimeDashboard] Recent payments fetch error:', err);
    }
  }, []);

  const fetchActivityFeed = useCallback(async () => {
    try {
      const { data } = await supabase
        ?.from('audit_logs')
        ?.select('id, action, description, table_name, severity, created_at, user:user_profiles(full_name, role)')
        ?.order('created_at', { ascending: false })
        ?.limit(15);
      setActivityFeed(data || []);
    } catch (err) {
      console.error('[useRealtimeDashboard] Activity feed fetch error:', err);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchKPIs(),
      fetchAgingAnalysis(),
      fetchRecentPayments(),
      fetchActivityFeed(),
    ]);
    hasLoaded.current = true;
    setLoading(false);
  }, [fetchKPIs, fetchAgingAnalysis, fetchRecentPayments, fetchActivityFeed]);

  // Initial load — runs once on mount
  useEffect(() => {
    if (hasLoaded.current) return;
    fetchAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime subscriptions — set up once, callbacks are stable useCallback refs
  useEffect(() => {
    const assetsCh = supabase
      ?.channel('rt_db_assets')
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'assets' }, () => fetchKPIs())
      ?.subscribe(status => {
        if (status === 'SUBSCRIBED') setConnectionStatus('connected');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnectionStatus('disconnected');
      });

    const paymentsCh = supabase
      ?.channel('rt_db_payments')
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchKPIs();
        fetchRecentPayments();
      })
      ?.subscribe();

    const plansCh = supabase
      ?.channel('rt_db_installment_plans')
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'installment_plans' }, () => fetchKPIs())
      ?.subscribe();

    const chargesCh = supabase
      ?.channel('rt_db_installment_charges')
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'installment_charges' }, () => fetchAgingAnalysis())
      ?.subscribe();

    const auditCh = supabase
      ?.channel('rt_db_audit_logs')
      ?.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, () => fetchActivityFeed())
      ?.subscribe();

    const makerCh = supabase
      ?.channel('rt_db_maker_checker')
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'maker_checker_queue' }, () => fetchKPIs())
      ?.subscribe();

    channelsRef.current = [assetsCh, paymentsCh, plansCh, chargesCh, auditCh, makerCh];

    return () => {
      channelsRef?.current?.forEach(ch => supabase?.removeChannel(ch));
      channelsRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    kpis,
    agingBuckets,
    recentPayments,
    activityFeed,
    connectionStatus,
    loading,
    syncing,
    lastUpdated,
    refetch: fetchAll,
  };
};

export default useRealtimeDashboard;
