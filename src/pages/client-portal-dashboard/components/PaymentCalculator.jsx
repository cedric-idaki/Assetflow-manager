import React, { useState, useMemo, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { formatKEPhone } from '../../../utils/phoneUtils';
import { supabase } from '../../../lib/supabase';

const formatCurrency = (val) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(val || 0);

const formatDate = (d) =>
  d ? new Date(d)?.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

// Early payment discount tiers
const DISCOUNT_TIERS = [
  { daysEarly: 90, rate: 5, label: '5% off (90+ days early)' },
  { daysEarly: 60, rate: 3, label: '3% off (60+ days early)' },
  { daysEarly: 30, rate: 2, label: '2% off (30+ days early)' },
  { daysEarly: 14, rate: 1, label: '1% off (14+ days early)' },
  { daysEarly: 0, rate: 0, label: 'No discount' },
];

const getDiscount = (paymentDate, dueDate) => {
  if (!paymentDate || !dueDate) return DISCOUNT_TIERS?.[DISCOUNT_TIERS?.length - 1];
  const daysEarly = Math.ceil((new Date(dueDate) - new Date(paymentDate)) / (1000 * 60 * 60 * 24));
  if (daysEarly <= 0) return DISCOUNT_TIERS?.[DISCOUNT_TIERS?.length - 1];
  return DISCOUNT_TIERS?.find(t => daysEarly >= t?.daysEarly) || DISCOUNT_TIERS?.[DISCOUNT_TIERS?.length - 1];
};

const PaymentCalculator = ({ assets, payments, clientInfo }) => {
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => {
    const d = new Date();
    return d?.toISOString()?.split('T')?.[0];
  });
  const [scheduleName, setScheduleName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedSchedules, setSavedSchedules] = useState([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [showSchedules, setShowSchedules] = useState(false);
  const [activeTab, setActiveTab] = useState('calculator');

  // Reminder state
  const [reminderConfig, setReminderConfig] = useState({
    emailEnabled: true,
    smsEnabled: false,
    daysBefore: 3,
    emailAddress: clientInfo?.email || '',
    phoneNumber: clientInfo?.phone || '',
  });

  const selectedAsset = useMemo(
    () => assets?.find(a => a?.id === selectedAssetId),
    [assets, selectedAssetId]
  );

  // Pending payments for selected asset
  const pendingPayments = useMemo(() => {
    if (!selectedAssetId) return [];
    return payments
      ?.filter(p => p?.asset_id === selectedAssetId && p?.payment_status === 'pending')
      ?.sort((a, b) => new Date(a?.payment_date) - new Date(b?.payment_date));
  }, [payments, selectedAssetId]);

  // Total outstanding for selected asset
  const totalOutstanding = useMemo(() => {
    return pendingPayments?.reduce((sum, p) => sum + (p?.amount || 0), 0);
  }, [pendingPayments]);

  // Nearest due date
  const nearestDue = pendingPayments?.[0];

  // Discount calculation
  const discountInfo = useMemo(() => {
    if (!paymentAmount || !nearestDue?.payment_date) return null;
    const tier = getDiscount(paymentDate, nearestDue?.payment_date);
    const amount = parseFloat(paymentAmount) || 0;
    const discountAmt = (amount * tier?.rate) / 100;
    return {
      rate: tier?.rate,
      label: tier?.label,
      discountAmount: discountAmt,
      finalAmount: amount - discountAmt,
    };
  }, [paymentAmount, paymentDate, nearestDue]);

  // Projected balance simulation
  const projectedBalance = useMemo(() => {
    const amount = parseFloat(paymentAmount) || 0;
    if (!amount || !selectedAssetId) return null;
    const finalPay = discountInfo ? discountInfo?.finalAmount : amount;
    const remaining = Math.max(0, totalOutstanding - finalPay);
    const paidCount = pendingPayments?.filter(p => {
      let runningTotal = 0;
      for (const pay of pendingPayments) {
        runningTotal += pay?.amount || 0;
        if (runningTotal <= finalPay) return true;
        break;
      }
      return false;
    })?.length || 0;

    // Build month-by-month projection
    const months = [];
    let bal = totalOutstanding;
    for (let i = 0; i < 6; i++) {
      const d = new Date();
      d?.setMonth(d?.getMonth() + i);
      const monthLabel = d?.toLocaleDateString('en-KE', { month: 'short', year: 'numeric' });
      if (i === 0) {
        bal = Math.max(0, bal - finalPay);
        months?.push({ month: monthLabel, balance: bal, payment: finalPay, isPaymentMonth: true });
      } else {
        months?.push({ month: monthLabel, balance: bal, payment: 0, isPaymentMonth: false });
      }
    }

    return {
      currentBalance: totalOutstanding,
      afterPayment: remaining,
      savings: discountInfo?.discountAmount || 0,
      finalPayment: finalPay,
      months,
    };
  }, [paymentAmount, totalOutstanding, discountInfo, selectedAssetId, pendingPayments]);

  const loadSavedSchedules = useCallback(async () => {
    if (!clientInfo?.id) return;
    setLoadingSchedules(true);
    try {
      const { data, error } = await supabase
        ?.from('payment_schedules')
        ?.select('*, asset:assets(description, asset_code), payment_reminders(*)')
        ?.eq('client_id', clientInfo?.id)
        ?.order('scheduled_date', { ascending: true });
      if (!error) setSavedSchedules(data || []);
    } catch (e) {
      console.error('Failed to load schedules:', e);
    } finally {
      setLoadingSchedules(false);
    }
  }, [clientInfo?.id]);

  const handleSaveSchedule = async () => {
    if (!selectedAssetId || !paymentAmount || !scheduleName || !paymentDate) {
      setSaveError('Please fill in all required fields: asset, amount, date, and schedule name.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const finalAmt = discountInfo ? discountInfo?.finalAmount : parseFloat(paymentAmount);
      const { data: scheduleData, error: schedErr } = await supabase
        ?.from('payment_schedules')
        ?.insert({
          client_id: clientInfo?.id || null,
          asset_id: selectedAssetId,
          schedule_name: scheduleName,
          payment_amount: parseFloat(paymentAmount),
          scheduled_date: paymentDate,
          early_payment: (discountInfo?.rate || 0) > 0,
          discount_rate: discountInfo?.rate || 0,
          discount_amount: discountInfo?.discountAmount || 0,
          final_amount: finalAmt,
          notes: `Projected balance after payment: ${formatCurrency(projectedBalance?.afterPayment || 0)}`,
          status: 'pending',
        })
        ?.select()
        ?.single();

      if (schedErr) throw schedErr;

      // Save reminder if enabled
      if (scheduleData && (reminderConfig?.emailEnabled || reminderConfig?.smsEnabled)) {
        await supabase?.from('payment_reminders')?.insert({
          schedule_id: scheduleData?.id,
          client_id: clientInfo?.id || null,
          reminder_type: reminderConfig?.emailEnabled && reminderConfig?.smsEnabled ? 'both' : reminderConfig?.emailEnabled ? 'email' : 'sms',
          reminder_days_before: reminderConfig?.daysBefore,
          email_enabled: reminderConfig?.emailEnabled,
          sms_enabled: reminderConfig?.smsEnabled,
          email_address: reminderConfig?.emailAddress,
          phone_number: reminderConfig?.phoneNumber,
          is_active: true,
        });
      }

      setSaveSuccess(true);
      setScheduleName('');
      setTimeout(() => setSaveSuccess(false), 3000);
      if (showSchedules) loadSavedSchedules();
    } catch (err) {
      setSaveError(err?.message || 'Failed to save schedule. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSchedule = async (scheduleId) => {
    try {
      await supabase?.from('payment_schedules')?.delete()?.eq('id', scheduleId);
      setSavedSchedules(prev => prev?.filter(s => s?.id !== scheduleId));
    } catch (e) {
      console.error('Failed to delete schedule:', e);
    }
  };

  const handleViewSchedules = () => {
    setActiveTab('schedules');
    if (!showSchedules) {
      setShowSchedules(true);
      loadSavedSchedules();
    }
  };

  const todayStr = new Date()?.toISOString()?.split('T')?.[0];

  return (
    <div>
      {/* Tab Bar */}
      <div className="flex gap-1 mb-5 bg-muted/40 p-1 rounded-xl">
        <button
          onClick={() => setActiveTab('calculator')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'calculator' ?'bg-card text-foreground shadow-sm' :'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon name="Calculator" size={15} />
          Calculator
        </button>
        <button
          onClick={handleViewSchedules}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'schedules' ?'bg-card text-foreground shadow-sm' :'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon name="BookmarkCheck" size={15} />
          Saved Schedules
          {savedSchedules?.length > 0 && (
            <span className="flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-primary text-white">
              {savedSchedules?.length}
            </span>
          )}
        </button>
      </div>
      {activeTab === 'calculator' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Input Panel */}
          <div className="space-y-5">
            {/* Asset Selector */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Select Asset
              </label>
              <select
                value={selectedAssetId}
                onChange={e => setSelectedAssetId(e?.target?.value)}
                className="w-full px-3 py-2.5 text-sm bg-muted/40 border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="">Choose an asset...</option>
                {assets?.map(a => (
                  <option key={a?.id} value={a?.id}>
                    {a?.description} ({a?.asset_code})
                  </option>
                ))}
              </select>
            </div>

            {/* Selected Asset Info */}
            {selectedAsset && (
              <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon name="Package" size={16} color="var(--color-primary)" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{selectedAsset?.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Outstanding: <span className="font-medium text-foreground">{formatCurrency(totalOutstanding)}</span>
                    {pendingPayments?.length > 0 && ` · ${pendingPayments?.length} pending`}
                  </p>
                </div>
              </div>
            )}

            {/* Payment Amount */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Payment Amount (KES)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">KES</span>
                <input
                  type="number"
                  min="0"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e?.target?.value)}
                  placeholder="0"
                  className="w-full pl-12 pr-4 py-2.5 text-sm bg-muted/40 border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              {selectedAsset && totalOutstanding > 0 && (
                <div className="flex gap-2 mt-2">
                  {[0.25, 0.5, 0.75, 1]?.map(pct => (
                    <button
                      key={pct}
                      onClick={() => setPaymentAmount(Math.round(totalOutstanding * pct)?.toString())}
                      className="flex-1 text-xs py-1 rounded-lg bg-muted hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
                    >
                      {pct * 100}%
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Payment Date */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Payment Date
              </label>
              <input
                type="date"
                value={paymentDate}
                min={todayStr}
                onChange={e => setPaymentDate(e?.target?.value)}
                className="w-full px-3 py-2.5 text-sm bg-muted/40 border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              {nearestDue?.payment_date && (
                <p className="text-xs text-muted-foreground mt-1">
                  Next due: <span className="font-medium text-foreground">{formatDate(nearestDue?.payment_date)}</span>
                </p>
              )}
            </div>

            {/* Early Payment Discount Banner */}
            {discountInfo && discountInfo?.rate > 0 && (
              <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                  <Icon name="Tag" size={15} color="#10b981" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    Early Payment Discount: {discountInfo?.rate}% off
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">
                    You save <strong>{formatCurrency(discountInfo?.discountAmount)}</strong> — pay only{' '}
                    <strong>{formatCurrency(discountInfo?.finalAmount)}</strong>
                  </p>
                  <p className="text-xs text-emerald-500 mt-0.5">{discountInfo?.label}</p>
                </div>
              </div>
            )}

            {discountInfo && discountInfo?.rate === 0 && paymentAmount && nearestDue && (
              <div className="p-3 bg-muted/50 border border-border rounded-xl">
                <p className="text-xs text-muted-foreground">
                  <Icon name="Info" size={12} className="inline mr-1" />
                  Pay earlier to unlock discounts up to 5%. Next tier: pay 14+ days before due date.
                </p>
              </div>
            )}

            {/* Discount Tiers Info */}
            <div className="p-4 bg-muted/30 border border-border rounded-xl">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Early Payment Discount Tiers</p>
              <div className="space-y-2">
                {DISCOUNT_TIERS?.filter(t => t?.rate > 0)?.map((tier, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{tier?.daysEarly}+ days early</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      discountInfo?.rate === tier?.rate
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :'bg-muted text-muted-foreground'
                    }`}>
                      {tier?.rate}% off
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Results + Save Panel */}
          <div className="space-y-5">
            {/* Projected Balance Simulation */}
            {projectedBalance ? (
              <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Icon name="TrendingDown" size={15} color="var(--color-primary)" />
                    Projected Balance Simulation
                  </p>
                </div>
                <div className="p-4 space-y-4">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-muted/40 rounded-xl">
                      <p className="text-xs text-muted-foreground mb-1">Current Balance</p>
                      <p className="text-base font-bold text-foreground">{formatCurrency(projectedBalance?.currentBalance)}</p>
                    </div>
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                      <p className="text-xs text-muted-foreground mb-1">After Payment</p>
                      <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(projectedBalance?.afterPayment)}</p>
                    </div>
                    <div className="p-3 bg-muted/40 rounded-xl">
                      <p className="text-xs text-muted-foreground mb-1">You Pay</p>
                      <p className="text-base font-bold text-foreground">{formatCurrency(projectedBalance?.finalPayment)}</p>
                    </div>
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                      <p className="text-xs text-muted-foreground mb-1">Discount Savings</p>
                      <p className="text-base font-bold text-amber-600 dark:text-amber-400">{formatCurrency(projectedBalance?.savings)}</p>
                    </div>
                  </div>

                  {/* Balance Bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                      <span>Balance reduction</span>
                      <span>
                        {projectedBalance?.currentBalance > 0
                          ? Math.round(((projectedBalance?.currentBalance - projectedBalance?.afterPayment) / projectedBalance?.currentBalance) * 100)
                          : 0}%
                      </span>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-emerald-500 rounded-full transition-all duration-500"
                        style={{
                          width: `${projectedBalance?.currentBalance > 0
                            ? Math.min(100, ((projectedBalance?.currentBalance - projectedBalance?.afterPayment) / projectedBalance?.currentBalance) * 100)
                            : 0}%`
                        }}
                      />
                    </div>
                  </div>

                  {/* 6-Month Projection */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">6-Month Outlook</p>
                    <div className="space-y-1.5">
                      {projectedBalance?.months?.map((m, i) => (
                        <div key={i} className={`flex items-center justify-between py-1.5 px-2 rounded-lg ${
                          m?.isPaymentMonth ? 'bg-primary/5 border border-primary/20' : ''
                        }`}>
                          <span className="text-xs text-muted-foreground w-20">{m?.month}</span>
                          {m?.isPaymentMonth && (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">-{formatCurrency(m?.payment)}</span>
                          )}
                          <span className={`text-xs font-semibold ml-auto ${
                            m?.balance === 0 ? 'text-emerald-600' : 'text-foreground'
                          }`}>
                            {m?.balance === 0 ? 'Cleared ✓' : formatCurrency(m?.balance)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 bg-muted/20 border border-dashed border-border rounded-xl">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <Icon name="Calculator" size={22} color="var(--color-muted-foreground)" />
                </div>
                <p className="text-sm font-medium text-foreground">Select an asset and enter an amount</p>
                <p className="text-xs text-muted-foreground mt-1">to see your projected balance</p>
              </div>
            )}

            {/* Save for Later Section */}
            {projectedBalance && (
              <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Icon name="Bookmark" size={15} color="var(--color-primary)" />
                    Save Payment Schedule
                  </p>
                </div>
                <div className="p-4 space-y-4">
                  {/* Schedule Name */}
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Schedule Name *
                    </label>
                    <input
                      type="text"
                      value={scheduleName}
                      onChange={e => setScheduleName(e?.target?.value)}
                      placeholder="e.g. March Installment, Q2 Payment..."
                      className="w-full px-3 py-2.5 text-sm bg-muted/40 border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>

                  {/* Reminder Setup */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Reminder Setup</p>
                    <div className="space-y-3">
                      {/* Email Toggle */}
                      <div className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
                        <div className="flex items-center gap-2">
                          <Icon name="Mail" size={15} color="var(--color-muted-foreground)" />
                          <span className="text-sm text-foreground">Email Reminder</span>
                        </div>
                        <button
                          onClick={() => setReminderConfig(prev => ({ ...prev, emailEnabled: !prev?.emailEnabled }))}
                          className={`relative w-10 h-5 rounded-full transition-colors ${
                            reminderConfig?.emailEnabled ? 'bg-primary' : 'bg-muted'
                          }`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                            reminderConfig?.emailEnabled ? 'translate-x-5' : 'translate-x-0.5'
                          }`} />
                        </button>
                      </div>

                      {reminderConfig?.emailEnabled && (
                        <input
                          type="email"
                          value={reminderConfig?.emailAddress}
                          onChange={e => setReminderConfig(prev => ({ ...prev, emailAddress: e?.target?.value }))}
                          placeholder="Email address"
                          className="w-full px-3 py-2 text-sm bg-muted/40 border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                        />
                      )}

                      {/* SMS Toggle */}
                      <div className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
                        <div className="flex items-center gap-2">
                          <Icon name="MessageSquare" size={15} color="var(--color-muted-foreground)" />
                          <span className="text-sm text-foreground">SMS Reminder</span>
                        </div>
                        <button
                          onClick={() => setReminderConfig(prev => ({ ...prev, smsEnabled: !prev?.smsEnabled }))}
                          className={`relative w-10 h-5 rounded-full transition-colors ${
                            reminderConfig?.smsEnabled ? 'bg-primary' : 'bg-muted'
                          }`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                            reminderConfig?.smsEnabled ? 'translate-x-5' : 'translate-x-0.5'
                          }`} />
                        </button>
                      </div>

                      {reminderConfig?.smsEnabled && (
                        <input
                          type="tel"
                          value={reminderConfig?.phoneNumber}
                          onChange={e => setReminderConfig(prev => ({ ...prev, phoneNumber: formatKEPhone(e?.target?.value) }))}
                          placeholder="Phone number (e.g. +254...)"
                          className="w-full px-3 py-2 text-sm bg-muted/40 border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                        />
                      )}

                      {/* Days Before */}
                      <div>
                        <label className="block text-xs text-muted-foreground mb-2">Remind me</label>
                        <div className="flex gap-2">
                          {[1, 3, 7, 14]?.map(d => (
                            <button
                              key={d}
                              onClick={() => setReminderConfig(prev => ({ ...prev, daysBefore: d }))}
                              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                reminderConfig?.daysBefore === d
                                  ? 'bg-primary text-white' :'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary'
                              }`}
                            >
                              {d}d before
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Error / Success */}
                  {saveError && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                      <Icon name="AlertCircle" size={14} color="var(--color-error)" />
                      <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
                    </div>
                  )}
                  {saveSuccess && (
                    <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                      <Icon name="CheckCircle" size={14} color="#10b981" />
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">Schedule saved successfully!</p>
                    </div>
                  )}

                  {/* Save Button */}
                  <button
                    onClick={handleSaveSchedule}
                    disabled={saving || !scheduleName}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? (
                      <>
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <Icon name="BookmarkPlus" size={16} />
                        Save Schedule & Set Reminder
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {activeTab === 'schedules' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-foreground">Saved Payment Schedules</p>
            <button
              onClick={loadSavedSchedules}
              disabled={loadingSchedules}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
            >
              <Icon name="RefreshCw" size={12} />
              Refresh
            </button>
          </div>

          {loadingSchedules ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
          ) : savedSchedules?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Icon name="BookmarkX" size={22} color="var(--color-muted-foreground)" />
              </div>
              <p className="text-sm font-medium text-foreground">No saved schedules yet</p>
              <p className="text-xs text-muted-foreground mt-1">Use the calculator to create and save payment plans</p>
              <button
                onClick={() => setActiveTab('calculator')}
                className="mt-4 text-xs text-primary hover:underline"
              >
                Go to Calculator
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {savedSchedules?.map((schedule, idx) => {
                const reminder = schedule?.payment_reminders?.[0];
                const daysLeft = schedule?.scheduled_date
                  ? Math.ceil((new Date(schedule?.scheduled_date) - new Date()) / (1000 * 60 * 60 * 24))
                  : null;
                return (
                  <div key={schedule?.id || idx} className="bg-card border border-border rounded-xl p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                          schedule?.early_payment ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-primary/10'
                        }`}>
                          <Icon
                            name={schedule?.early_payment ? 'Zap' : 'Calendar'}
                            size={16}
                            color={schedule?.early_payment ? '#10b981' : 'var(--color-primary)'}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-bold text-foreground">{schedule?.schedule_name}</span>
                            {schedule?.early_payment && (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                {schedule?.discount_rate}% discount
                              </span>
                            )}
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              schedule?.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-700'
                                : daysLeft !== null && daysLeft < 0
                                ? 'bg-red-100 text-red-700' :'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            }`}>
                              {schedule?.status === 'completed' ? 'Completed' : daysLeft !== null && daysLeft < 0 ? 'Overdue' : 'Pending'}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatCurrency(schedule?.final_amount)}
                            {schedule?.discount_amount > 0 && (
                              <span className="text-emerald-600 ml-1">(saved {formatCurrency(schedule?.discount_amount)})</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Scheduled: {formatDate(schedule?.scheduled_date)}
                            {daysLeft !== null && (
                              <span className={`ml-1 font-medium ${
                                daysLeft < 0 ? 'text-error' : daysLeft <= 7 ? 'text-warning' : 'text-muted-foreground'
                              }`}>
                                ({daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`})
                              </span>
                            )}
                          </p>
                          {schedule?.asset && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {schedule?.asset?.description} · {schedule?.asset?.asset_code}
                            </p>
                          )}
                          {/* Reminder Info */}
                          {reminder && (
                            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border">
                              {reminder?.email_enabled && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Icon name="Mail" size={11} />
                                  {reminder?.email_address || 'Email'}
                                </span>
                              )}
                              {reminder?.sms_enabled && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Icon name="MessageSquare" size={11} />
                                  {reminder?.phone_number || 'SMS'}
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Icon name="Bell" size={11} />
                                {reminder?.reminder_days_before}d before
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteSchedule(schedule?.id)}
                        className="flex-shrink-0 p-1.5 text-muted-foreground hover:text-error hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        title="Delete schedule"
                      >
                        <Icon name="Trash2" size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PaymentCalculator;
