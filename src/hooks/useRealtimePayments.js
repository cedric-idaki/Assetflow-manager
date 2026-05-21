import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { paymentsService } from '../services/supabaseService';

/**
 * useRealtimePayments
 * Subscribes to payments, installment_plans, installment_charges
 * and provides live payment status updates with per-widget timestamps.
 */
export const useRealtimePayments = () => {
  const [transactions, setTransactions] = useState([]);
  const [paymentStats, setPaymentStats] = useState({
    totalToday: 0,
    successCount: 0,
    failedCount: 0,
    pendingCount: 0,
    totalInstallmentPlans: 0,
    activeCharges: 0,
  });
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [syncing, setSyncing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [widgetTimestamps, setWidgetTimestamps] = useState({});
  const [recentEvents, setRecentEvents] = useState([]);
  const channelsRef = useRef([]);

  const updateWidgetTimestamp = useCallback((widget) => {
    setWidgetTimestamps(prev => ({ ...prev, [widget]: new Date() }));
  }, []);

  const addRecentEvent = useCallback((event) => {
    setRecentEvents(prev => [event, ...prev]?.slice(0, 10));
  }, []);

  const fetchTransactions = useCallback(async (trigger = 'init') => {
    setSyncing(true);
    try {
      const data = await paymentsService?.getAll();
      const mapped = (data || [])?.map(p => ({
        id: p?.id,
        transactionId: p?.transaction_id,
        clientName: p?.client?.full_name || 'Unknown',
        accountNumber: p?.client?.account_number || '-',
        paymentMethod: p?.payment_method,
        amount: parseFloat(p?.amount || 0),
        status: p?.payment_status,
        date: new Date(p.payment_date)?.toLocaleDateString(),
        reference: p?.reference_number,
      }));
      setTransactions(mapped);

      // Compute stats
      const today = new Date()?.toDateString();
      const todayPayments = (data || [])?.filter(p => new Date(p.payment_date)?.toDateString() === today);
      const successCount = (data || [])?.filter(p => p?.payment_status === 'completed' || p?.payment_status === 'successful')?.length;
      const failedCount = (data || [])?.filter(p => p?.payment_status === 'failed')?.length;
      const pendingCount = (data || [])?.filter(p => p?.payment_status === 'pending')?.length;
      const totalToday = todayPayments?.reduce((sum, p) => sum + parseFloat(p?.amount || 0), 0);

      // Fetch installment stats
      const { count: totalInstallmentPlans } = await supabase?.from('installment_plans')?.select('id', { count: 'exact', head: true }) || { count: 0 };

const { count: activeCharges } = await supabase?.from('installment_charges')?.select('id', { count: 'exact', head: true }) || { count: 0 };

      setPaymentStats({
        totalToday,
        successCount,
        failedCount,
        pendingCount,
        totalInstallmentPlans: totalInstallmentPlans || 0,
        activeCharges: activeCharges || 0,
      });

      setLastUpdated(new Date());
      setConnectionStatus('connected');

      if (trigger === 'payments') {
        updateWidgetTimestamp('transactions');
        updateWidgetTimestamp('stats');
      } else if (trigger === 'installment_plans') {
        updateWidgetTimestamp('recurring');
      } else if (trigger === 'installment_charges') {
        updateWidgetTimestamp('recurring');
        updateWidgetTimestamp('stats');
      } else {
        ['transactions', 'stats', 'recurring']?.forEach(w => updateWidgetTimestamp(w));
      }
    } catch (err) {
      console.error('[useRealtimePayments] fetch error:', err);
      setConnectionStatus('disconnected');
    } finally {
      setSyncing(false);
    }
  }, [updateWidgetTimestamp]);

  useEffect(() => {
    fetchTransactions('init');

    const paymentsCh = supabase?.channel('rt_payments_hub_payments')?.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payments' }, (payload) => {
        addRecentEvent({ type: 'new_payment', data: payload?.new, timestamp: new Date() });
        fetchTransactions('payments');
      })?.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payments' }, (payload) => {
        const prev = payload?.old?.payment_status;
        const next = payload?.new?.payment_status;
        if (prev !== next) {
          addRecentEvent({ type: 'status_change', from: prev, to: next, data: payload?.new, timestamp: new Date() });
        }
        fetchTransactions('payments');
      })?.subscribe(status => {
        if (status === 'SUBSCRIBED') setConnectionStatus('connected');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnectionStatus('disconnected');
        if (status === 'CLOSED') setConnectionStatus('connecting');
      });

    const installmentPlansCh = supabase?.channel('rt_payments_hub_plans')?.on('postgres_changes', { event: '*', schema: 'public', table: 'installment_plans' }, (payload) => {
        addRecentEvent({ type: 'installment_plan', data: payload?.new || payload?.old, timestamp: new Date() });
        fetchTransactions('installment_plans');
      })?.subscribe();

    const installmentChargesCh = supabase?.channel('rt_payments_hub_charges')?.on('postgres_changes', { event: '*', schema: 'public', table: 'installment_charges' }, (payload) => {
        const charge = payload?.new || payload?.old;
        if (charge?.status === 'failed') {
          addRecentEvent({ type: 'charge_failed', data: charge, timestamp: new Date() });
        } else if (charge?.status === 'succeeded') {
          addRecentEvent({ type: 'charge_succeeded', data: charge, timestamp: new Date() });
        }
        fetchTransactions('installment_charges');
      })?.subscribe();

    channelsRef.current = [paymentsCh, installmentPlansCh, installmentChargesCh];

    return () => {
      channelsRef?.current?.forEach(ch => supabase?.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [fetchTransactions, addRecentEvent]);

  return {
    transactions,
    paymentStats,
    connectionStatus,
    syncing,
    lastUpdated,
    widgetTimestamps,
    recentEvents,
    refetch: () => fetchTransactions('init'),
  };
};

export default useRealtimePayments;
