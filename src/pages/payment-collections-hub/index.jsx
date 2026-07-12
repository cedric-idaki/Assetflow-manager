import React, { useState, useCallback, useEffect } from 'react';
import Icon from '../../components/AppIcon';
import PaymentEntryForm from './components/PaymentEntryForm';
import PaymentAllocationPanel from './components/PaymentAllocationPanel';
import OverdueAccountsSection from './components/OverdueAccountsSection';
import TransactionHistoryTable from './components/TransactionHistoryTable';
import PenaltyCalculationPanel from './components/PenaltyCalculationPanel';
import RecurringBillingPanel from './components/RecurringBillingPanel';
import PaymentAlertsPanel from './components/PaymentAlertsPanel';
import MainLayout from '../../layouts/MainLayout';
import RealtimeStatusBar from '../../components/ui/RealtimeStatusBar';
import LivePulseWidget from '../../components/ui/LivePulseWidget';
import { useRealtimePayments } from '../../hooks/useRealtimePayments';
import { assetsService, clientsService, auditLogsService, paymentsService } from '../../services/supabaseService';
import { supabase } from '../../lib/supabase';
import { sendPaymentConfirmation, sendInvoiceEmail } from '../../services/emailService';

const SpinnerIcon = ({ size = 14 }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>
);

const EVENT_ICONS = {
  new_payment: { icon: 'PlusCircle', color: 'text-emerald-500', label: 'New payment' },
  status_change: { icon: 'RefreshCw', color: 'text-blue-500', label: 'Status changed' },
  installment_plan: { icon: 'Calendar', color: 'text-violet-500', label: 'Installment plan' },
  charge_failed: { icon: 'XCircle', color: 'text-red-500', label: 'Charge failed' },
  charge_succeeded: { icon: 'CheckCircle', color: 'text-emerald-500', label: 'Charge succeeded' },
};

const PaymentCollectionsHub = () => {
  const [activeTab, setActiveTab] = useState('payment-entry');
  const [linkedAssets, setLinkedAssets] = useState([]);
  const [overdueAccounts, setOverdueAccounts] = useState([]);
  const [currentAllocations, setCurrentAllocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const {
    transactions,
    paymentStats,
    connectionStatus,
    syncing,
    lastUpdated,
    widgetTimestamps,
    recentEvents,
    refetch,
  } = useRealtimePayments();

  const loadLinkedAssets = useCallback(async () => {
    try {
      // Scope to the current company (tenant). RLS also enforces this, but the
      // explicit filter keeps the query intentional and fast.
      const { data: { user } } = await supabase.auth.getUser();
      let adminId = user?.id || null;
      if (user) {
        const { data: profile } = await supabase
          .from('user_profiles').select('role, admin_id').eq('id', user.id).maybeSingle();
        adminId = profile?.role === 'admin' ? user.id : (profile?.admin_id || user.id);
      }
      const data = await assetsService?.getAll({ status: 'reserved', adminId });
      setLinkedAssets(data?.map(a => ({
        id: a?.asset_code,
        name: a?.description,
        type: a?.asset_type,
        totalValue: parseFloat(a?.selling_price || 0),
        outstandingBalance: parseFloat(a?.current_value || 0),
      })));
    } catch (err) {
      console.error('Failed to load assets:', err);
    }
  }, []);

  const loadOverdueAccounts = useCallback(async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data: charges } = await supabase
        .from('installment_charges')
        .select('client_id, amount, scheduled_date, plan:installment_plans(client:clients(full_name, account_number))')
        .eq('charge_status', 'scheduled')
        .lt('scheduled_date', today.toISOString().split('T')[0]);

      const clientMap = {};
      (charges || []).forEach((c) => {
        const client = c.plan?.client;
        const key = c.client_id || String(Math.random());
        const daysOverdue = Math.floor((today - new Date(c.scheduled_date)) / 86400000);
        if (!clientMap[key]) {
          clientMap[key] = {
            id: key,
            clientName: client?.full_name || 'Unknown',
            accountNumber: client?.account_number || '—',
            overdueAmount: 0,
            maxDays: 0,
            category: '30',
            dueDate: new Date(c.scheduled_date).toLocaleDateString(),
          };
        }
        clientMap[key].overdueAmount += parseFloat(c.amount || 0);
        clientMap[key].maxDays = Math.max(clientMap[key].maxDays, daysOverdue);
        clientMap[key].category = clientMap[key].maxDays > 60 ? '90' : clientMap[key].maxDays > 30 ? '60' : '30';
      });
      setOverdueAccounts(Object.values(clientMap));
    } catch (err) {
      console.error('Failed to load overdue accounts:', err);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadLinkedAssets(), loadOverdueAccounts()]);
      setLoading(false);
    };
    init();
  }, [loadLinkedAssets, loadOverdueAccounts]);

  const handlePaymentSubmit = async (paymentData) => {
    // Merge in any allocations set from the allocation panel
    const enrichedPaymentData = {
      ...paymentData,
      allocations: paymentData?.allocations?.length > 0 ? paymentData.allocations : currentAllocations,
    };
    try {
      // New allocation engine returns result object — skip old processing
      if (enrichedPaymentData?.receiptNumber || enrichedPaymentData?.success !== undefined) {
        await refetch();
        return;
      }
      const record = await paymentsService?.create(enrichedPaymentData);
      await auditLogsService?.log('create', 'payments', `Payment recorded: ${enrichedPaymentData?.amount}`);
      // Auto-send payment confirmation + invoice emails
      try {
        const clientEmail = enrichedPaymentData?.clientEmail;
        if (clientEmail) {
          const txn = {
            transactionId: record?.transaction_id || enrichedPaymentData?.referenceNumber || `TXN-${Date.now()}`,
            timestamp: new Date()?.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }),
            amount: parseFloat(enrichedPaymentData?.amount || 0),
            paymentMethod: enrichedPaymentData?.paymentMethod,
            referenceNumber: enrichedPaymentData?.referenceNumber,
            status: 'successful',
          };
          const clientInfo = enrichedPaymentData?.clientInfo || { name: enrichedPaymentData?.clientId, email: clientEmail };
          const assetInfo = enrichedPaymentData?.assetInfo || null;
          const allocations = enrichedPaymentData?.allocations || [];
          await sendPaymentConfirmation(clientEmail, { transaction: txn, client: clientInfo, asset: assetInfo, allocations });
          const invoiceNumber = `INV-${Date.now()}`;
          await sendInvoiceEmail(clientEmail, {
            invoice: { invoiceNumber, issueDate: new Date()?.toISOString(), dueDate: new Date()?.toISOString(), total: parseFloat(enrichedPaymentData?.amount || 0) },
            client: clientInfo,
            asset: assetInfo,
            lineItems: allocations?.length > 0 ? allocations : [{ description: 'Payment', quantity: 1, unitPrice: parseFloat(enrichedPaymentData?.amount || 0), amount: parseFloat(enrichedPaymentData?.amount || 0) }],
          });
        }
      } catch (emailErr) {
        console.warn('Email notification failed (non-blocking):', emailErr?.message);
      }
    } catch (err) {
      setError('Failed to record payment: ' + err?.message);
    }
  };

  const handleAllocationChange = (allocations) => {
    setCurrentAllocations(allocations);
  };

  const tabs = [
    { id: 'payment-entry', label: 'Payment Entry', icon: 'CreditCard' },
    { id: 'allocation', label: 'Allocation', icon: 'PieChart' },
    { id: 'overdue', label: `Overdue (${overdueAccounts?.length})`, icon: 'AlertTriangle' },
    { id: 'history', label: `History (${transactions?.length})`, icon: 'Clock' },
    { id: 'penalties', label: 'Penalties', icon: 'Calculator' },
    { id: 'recurring', label: 'Recurring', icon: 'RefreshCw' },
    { id: 'alerts', label: 'Alerts', icon: 'Bell' },
  ];

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Payment Collections</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Track and manage all payment transactions</p>
          </div>
          <button
            onClick={refetch}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Icon name="RefreshCw" size={12} color="currentColor" className={syncing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Global Real-time Status Bar */}
        <RealtimeStatusBar
          connectionStatus={connectionStatus}
          lastUpdated={lastUpdated}
          syncing={syncing}
          label="Payments"
        />

        {/* Live Payment Stats Bar */}
        <LivePulseWidget lastUpdated={widgetTimestamps?.['stats']} syncing={syncing} label="Payment Stats">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Today's Collections", value: `KES ${paymentStats?.totalToday?.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: 'TrendingUp', color: 'text-emerald-600 bg-emerald-500/10' },
              { label: 'Successful', value: paymentStats?.successCount, icon: 'CheckCircle', color: 'text-emerald-600 bg-emerald-500/10' },
              { label: 'Failed', value: paymentStats?.failedCount, icon: 'XCircle', color: 'text-red-600 bg-red-500/10' },
              { label: 'Pending', value: paymentStats?.pendingCount, icon: 'Clock', color: 'text-amber-600 bg-amber-500/10' },
              { label: 'Active Plans', value: paymentStats?.totalInstallmentPlans, icon: 'Calendar', color: 'text-violet-600 bg-violet-500/10' },
              { label: 'Pending Charges', value: paymentStats?.activeCharges, icon: 'Zap', color: 'text-blue-600 bg-blue-500/10' },
            ]?.map((stat, idx) => (
              <div key={idx} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
                <div className={`w-7 h-7 rounded-xl ${stat?.color} flex items-center justify-center`}>
                  <Icon name={stat?.icon} size={14} color="currentColor" />
                </div>
                <p className="text-2xl font-bold text-foreground leading-tight">{stat?.value}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">{stat?.label}</p>
              </div>
            ))}
          </div>
        </LivePulseWidget>

        {/* Recent Real-time Events Feed */}
        {recentEvents?.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <h3 className="text-sm font-semibold text-foreground">Live Events</h3>
              </div>
              <span className="text-xs text-muted-foreground">{recentEvents?.length} recent</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recentEvents?.slice(0, 6)?.map((event, idx) => {
                const cfg = EVENT_ICONS?.[event?.type] || { icon: 'Activity', color: 'text-muted-foreground', label: event?.type };
                return (
                  <div key={idx} className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-muted border border-border/50 text-xs">
                    <Icon name={cfg?.icon} size={13} color="currentColor" className={cfg?.color} />
                    <div>
                      <p className="font-medium text-foreground">{cfg?.label}</p>
                      <p className="text-muted-foreground">{event?.timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
            <Icon name="AlertCircle" size={16} color="currentColor" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} color="currentColor" /></button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto">
          {tabs?.map(tab => (
            <button
              key={tab?.id}
              onClick={() => setActiveTab(tab?.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-smooth whitespace-nowrap ${
                activeTab === tab?.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon name={tab?.icon} size={14} color="currentColor" />
              {tab?.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="h-64 rounded-xl bg-muted animate-pulse relative overflow-hidden">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground/60">
              <SpinnerIcon size={32} />
              <span className="text-sm font-medium">Loading payment data...</span>
            </div>
          </div>
        ) : (
          <LivePulseWidget
            lastUpdated={activeTab === 'history' ? widgetTimestamps?.['transactions'] : activeTab === 'recurring' ? widgetTimestamps?.['recurring'] : widgetTimestamps?.['stats']}
            syncing={syncing}
            label="Payment Content"
          >
            <div className="bg-card border border-border rounded-xl p-5 relative">
              {activeTab === 'payment-entry' && <PaymentEntryForm linkedAssets={linkedAssets} onSubmit={handlePaymentSubmit} />}
              {activeTab === 'allocation' && <PaymentAllocationPanel linkedAssets={linkedAssets} totalAmount={linkedAssets?.reduce((sum, asset) => sum + (asset?.outstandingBalance || 0), 0)} onAllocationChange={handleAllocationChange} />}
              {activeTab === 'overdue' && <OverdueAccountsSection overdueAccounts={overdueAccounts} />}
              {activeTab === 'history' && <TransactionHistoryTable transactions={transactions} />}
              {activeTab === 'penalties' && <PenaltyCalculationPanel overdueAccounts={overdueAccounts} onPenaltyApplied={() => loadOverdueAccounts()} />}
              {activeTab === 'recurring' && <RecurringBillingPanel />}
              {activeTab === 'alerts' && <PaymentAlertsPanel />}
            </div>
          </LivePulseWidget>
        )}
      </div>
    </MainLayout>
  );
};

export default PaymentCollectionsHub;
