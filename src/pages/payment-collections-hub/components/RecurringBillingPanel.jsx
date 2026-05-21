import React, { useState, useEffect, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import StripePaymentForm from './StripePaymentForm';
import { supabase } from '../../../lib/supabase';
import { clientsService } from '../../../services/supabaseService';

const stripePromise = loadStripe(import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY || '');

const SpinnerIcon = ({ size = 14 }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>
);

const STATUS_CONFIG = {
  active:    { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/20', dot: 'bg-emerald-500', label: 'Active' },
  paused:    { bg: 'bg-amber-500/10',   text: 'text-amber-600',   border: 'border-amber-500/20',   dot: 'bg-amber-500',   label: 'Paused' },
  completed: { bg: 'bg-blue-500/10',    text: 'text-blue-600',    border: 'border-blue-500/20',    dot: 'bg-blue-500',    label: 'Completed' },
  cancelled: { bg: 'bg-red-500/10',     text: 'text-red-600',     border: 'border-red-500/20',     dot: 'bg-red-500',     label: 'Cancelled' },
  failed:    { bg: 'bg-red-500/10',     text: 'text-red-600',     border: 'border-red-500/20',     dot: 'bg-red-500',     label: 'Failed' },
};

const CHARGE_STATUS_CONFIG = {
  scheduled:  { bg: 'bg-muted',          text: 'text-muted-foreground', label: 'Scheduled' },
  processing: { bg: 'bg-blue-500/10',    text: 'text-blue-600',         label: 'Processing' },
  succeeded:  { bg: 'bg-emerald-500/10', text: 'text-emerald-600',      label: 'Paid' },
  failed:     { bg: 'bg-red-500/10',     text: 'text-red-600',          label: 'Failed' },
  retrying:   { bg: 'bg-amber-500/10',   text: 'text-amber-600',        label: 'Retrying' },
  cancelled:  { bg: 'bg-muted',          text: 'text-muted-foreground', label: 'Cancelled' },
};

const frequencyOptions = [
  { value: 'weekly',    label: 'Weekly' },
  { value: 'biweekly',  label: 'Bi-Weekly' },
  { value: 'monthly',   label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

const formatCurrency = (val, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 })?.format(val || 0);

const formatDate = (d) =>
  d ? new Date(d)?.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const daysUntil = (d) => {
  if (!d) return null;
  return Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));
};

export default function RecurringBillingPanel() {
  const [view, setView] = useState('list'); // 'list' | 'create' | 'detail'
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [charges, setCharges] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Stripe confirmation state
  const [stripeClientSecret, setStripeClientSecret] = useState(null);
  const [pendingChargeId, setPendingChargeId] = useState(null);

  // Create form state
  const [form, setForm] = useState({
    clientId: '',
    planName: '',
    totalAmount: '',
    totalInstallments: '12',
    frequency: 'monthly',
    startDate: new Date()?.toISOString()?.split('T')?.[0],
    maxRetries: '3',
    retryIntervalDays: '3',
    notes: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [creating, setCreating] = useState(false);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase?.from('installment_plans')?.select('*, clients(full_name, email, account_number)')?.order('created_at', { ascending: false });
      if (err) throw err;
      setPlans(data || []);
    } catch (err) {
      setError('Failed to load installment plans: ' + err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCharges = useCallback(async (planId) => {
    try {
      const { data, error: err } = await supabase?.from('installment_charges')?.select('*')?.eq('plan_id', planId)?.order('installment_number', { ascending: true });
      if (err) throw err;
      setCharges(data || []);
    } catch (err) {
      console.error('Failed to load charges:', err);
    }
  }, []);

  const loadClients = useCallback(async () => {
    try {
      const data = await clientsService?.getAll();
      setClients(data?.map(c => ({ value: c?.id, label: `${c?.full_name} — ${c?.account_number}` })) || []);
    } catch (err) {
      console.error('Failed to load clients:', err);
    }
  }, []);

  useEffect(() => {
    loadPlans();
    loadClients();
  }, [loadPlans, loadClients]);

  useEffect(() => {
    if (selectedPlan) loadCharges(selectedPlan?.id);
  }, [selectedPlan, loadCharges]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase?.channel('installment_plans_changes')?.on('postgres_changes', { event: '*', schema: 'public', table: 'installment_plans' }, () => loadPlans())?.on('postgres_changes', { event: '*', schema: 'public', table: 'installment_charges' }, () => {
        if (selectedPlan) loadCharges(selectedPlan?.id);
      })?.subscribe();
    return () => supabase?.removeChannel(channel);
  }, [loadPlans, loadCharges, selectedPlan]);

  const validateForm = () => {
    const errs = {};
    if (!form?.clientId) errs.clientId = 'Select a client';
    if (!form?.planName) errs.planName = 'Plan name is required';
    if (!form?.totalAmount || parseFloat(form?.totalAmount) <= 0) errs.totalAmount = 'Enter a valid total amount';
    if (!form?.totalInstallments || parseInt(form?.totalInstallments) < 1) errs.totalInstallments = 'At least 1 installment required';
    if (!form?.startDate) errs.startDate = 'Start date is required';
    setFormErrors(errs);
    return Object.keys(errs)?.length === 0;
  };

  const handleCreatePlan = async (e) => {
    e?.preventDefault();
    if (!validateForm()) return;
    setCreating(true);
    setError(null);
    try {
      const { data: { user } } = await supabase?.auth?.getUser();
      const { data, error: err } = await supabase?.functions?.invoke('create-installment-plan', {
        body: {
          planData: {
            clientId: form?.clientId,
            planName: form?.planName,
            totalAmount: parseFloat(form?.totalAmount),
            totalInstallments: parseInt(form?.totalInstallments),
            frequency: form?.frequency,
            startDate: form?.startDate,
            maxRetries: parseInt(form?.maxRetries) || 3,
            retryIntervalDays: parseInt(form?.retryIntervalDays) || 3,
            currency: 'usd',
            notes: form?.notes || null,
          },
          customerInfo: {
            userId: user?.id || null,
            email: user?.email || null,
            firstName: user?.user_metadata?.full_name?.split(' ')?.[0] || 'Customer',
            lastName: user?.user_metadata?.full_name?.split(' ')?.[1] || '',
          },
        },
      });
      if (err || data?.error) throw new Error(data?.error || err?.message);
      setSuccessMsg(`Plan "${form?.planName}" created with ${form?.totalInstallments} installments.`);
      setForm({ clientId: '', planName: '', totalAmount: '', totalInstallments: '12', frequency: 'monthly', startDate: new Date()?.toISOString()?.split('T')?.[0], maxRetries: '3', retryIntervalDays: '3', notes: '' });
      setView('list');
      await loadPlans();
    } catch (err) {
      setError('Failed to create plan: ' + err?.message);
    } finally {
      setCreating(false);
    }
  };

  const handleChargeNow = async (charge) => {
    setActionLoading(charge?.id);
    setError(null);
    try {
      const { data, error: err } = await supabase?.functions?.invoke('process-installment-charge', {
        body: { chargeId: charge?.id },
      });
      if (err) throw err;
      if (data?.requiresAction && data?.clientSecret) {
        setStripeClientSecret(data?.clientSecret);
        setPendingChargeId(charge?.id);
      } else if (data?.success) {
        setSuccessMsg(`Installment #${charge?.installment_number} charged successfully!`);
        await loadCharges(selectedPlan?.id);
        await loadPlans();
        const updated = plans?.find(p => p?.id === selectedPlan?.id);
        if (updated) setSelectedPlan(updated);
      } else {
        setError(`Charge failed: ${data?.failureReason || 'Unknown error'}. ${data?.nextRetryDate ? `Next retry: ${formatDate(data?.nextRetryDate)}` : ''}`);
      }
    } catch (err) {
      setError('Failed to process charge: ' + err?.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStripeSuccess = async () => {
    setStripeClientSecret(null);
    setPendingChargeId(null);
    setSuccessMsg('Payment confirmed successfully!');
    if (selectedPlan) {
      await loadCharges(selectedPlan?.id);
      await loadPlans();
    }
  };

  const handlePausePlan = async (plan) => {
    setActionLoading(`pause-${plan?.id}`);
    try {
      const newStatus = plan?.plan_status === 'paused' ? 'active' : 'paused';
      const { error: err } = await supabase?.from('installment_plans')?.update({ plan_status: newStatus, updated_at: new Date()?.toISOString() })?.eq('id', plan?.id);
      if (err) throw err;
      setSuccessMsg(`Plan ${newStatus === 'paused' ? 'paused' : 'resumed'} successfully.`);
      await loadPlans();
      if (selectedPlan?.id === plan?.id) {
        setSelectedPlan(prev => ({ ...prev, plan_status: newStatus }));
      }
    } catch (err) {
      setError('Failed to update plan: ' + err?.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelPlan = async (plan) => {
    if (!window.confirm(`Cancel plan "${plan?.plan_name}"? This cannot be undone.`)) return;
    setActionLoading(`cancel-${plan?.id}`);
    try {
      const { error: err } = await supabase?.from('installment_plans')?.update({ plan_status: 'cancelled', updated_at: new Date()?.toISOString() })?.eq('id', plan?.id);
      if (err) throw err;
      setSuccessMsg('Plan cancelled.');
      await loadPlans();
      if (selectedPlan?.id === plan?.id) setView('list');
    } catch (err) {
      setError('Failed to cancel plan: ' + err?.message);
    } finally {
      setActionLoading(null);
    }
  };

  const installmentAmount = form?.totalAmount && form?.totalInstallments
    ? (parseFloat(form?.totalAmount) / parseInt(form?.totalInstallments))?.toFixed(2)
    : null;

  // Stripe confirmation overlay
  if (stripeClientSecret) {
    return (
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => { setStripeClientSecret(null); setPendingChargeId(null); }} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="ArrowLeft" size={16} color="currentColor" />
          </button>
          <div>
            <h3 className="text-base font-semibold text-foreground">Confirm Installment Payment</h3>
            <p className="text-xs text-muted-foreground">Enter card details to process this installment</p>
          </div>
        </div>
        <Elements stripe={stripePromise} options={{ clientSecret: stripeClientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#7c3aed', borderRadius: '8px' } } }}>
          <StripePaymentForm
            clientSecret={stripeClientSecret}
            amount={charges?.find(c => c?.id === pendingChargeId)?.amount || 0}
            onSuccess={handleStripeSuccess}
            onCancel={() => { setStripeClientSecret(null); setPendingChargeId(null); }}
          />
        </Elements>
      </div>
    );
  }

  // Create plan form
  if (view === 'create') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => setView('list')} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="ArrowLeft" size={16} color="currentColor" />
          </button>
          <div>
            <h3 className="text-base font-semibold text-foreground">Create Installment Plan</h3>
            <p className="text-xs text-muted-foreground">Set up recurring auto-charge billing for a client</p>
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
            <Icon name="AlertCircle" size={14} color="currentColor" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={12} color="currentColor" /></button>
          </div>
        )}
        <form onSubmit={handleCreatePlan} className="bg-card rounded-xl border border-border p-5 space-y-4">
          <Select
            label="Client"
            options={clients}
            value={form?.clientId}
            onChange={(v) => setForm(p => ({ ...p, clientId: v }))}
            error={formErrors?.clientId}
            required
            searchable
          />
          <Input
            label="Plan Name"
            value={form?.planName}
            onChange={(e) => setForm(p => ({ ...p, planName: e?.target?.value }))}
            error={formErrors?.planName}
            placeholder="e.g. Monthly Vehicle Installment"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Total Amount ($)"
              type="number"
              min="1"
              step="0.01"
              value={form?.totalAmount}
              onChange={(e) => setForm(p => ({ ...p, totalAmount: e?.target?.value }))}
              error={formErrors?.totalAmount}
              placeholder="120000"
              required
            />
            <Input
              label="Number of Installments"
              type="number"
              min="1"
              max="360"
              value={form?.totalInstallments}
              onChange={(e) => setForm(p => ({ ...p, totalInstallments: e?.target?.value }))}
              error={formErrors?.totalInstallments}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Billing Frequency"
              options={frequencyOptions}
              value={form?.frequency}
              onChange={(v) => setForm(p => ({ ...p, frequency: v }))}
            />
            <Input
              label="Start Date"
              type="date"
              value={form?.startDate}
              onChange={(e) => setForm(p => ({ ...p, startDate: e?.target?.value }))}
              error={formErrors?.startDate}
              required
            />
          </div>

          {installmentAmount && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Per installment amount</span>
                <span className="text-lg font-bold text-primary">${parseFloat(installmentAmount)?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {form?.totalInstallments} × ${parseFloat(installmentAmount)?.toLocaleString('en-US', { minimumFractionDigits: 2 })} = ${parseFloat(form?.totalAmount || 0)?.toLocaleString('en-US', { minimumFractionDigits: 2 })} total
              </p>
            </div>
          )}

          <div className="border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">Retry Settings</p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Max Retries"
                type="number"
                min="0"
                max="10"
                value={form?.maxRetries}
                onChange={(e) => setForm(p => ({ ...p, maxRetries: e?.target?.value }))}
              />
              <Input
                label="Retry Interval (days)"
                type="number"
                min="1"
                max="30"
                value={form?.retryIntervalDays}
                onChange={(e) => setForm(p => ({ ...p, retryIntervalDays: e?.target?.value }))}
              />
            </div>
          </div>

          <Input
            label="Notes (optional)"
            value={form?.notes}
            onChange={(e) => setForm(p => ({ ...p, notes: e?.target?.value }))}
            placeholder="Additional notes about this plan"
          />

          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="default" fullWidth disabled={creating}>
              {creating ? 'Creating Plan...' : 'Create Installment Plan'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setView('list')} disabled={creating}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // Plan detail view
  if (view === 'detail' && selectedPlan) {
    const sc = STATUS_CONFIG?.[selectedPlan?.plan_status] || STATUS_CONFIG?.active;
    const progress = selectedPlan?.total_installments > 0
      ? Math.round((selectedPlan?.installments_paid / selectedPlan?.total_installments) * 100)
      : 0;
    const daysToNext = daysUntil(selectedPlan?.next_charge_date);

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => { setView('list'); setSelectedPlan(null); setCharges([]); }} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="ArrowLeft" size={16} color="currentColor" />
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-foreground truncate">{selectedPlan?.plan_name}</h3>
            <p className="text-xs text-muted-foreground">{selectedPlan?.clients?.full_name} · {selectedPlan?.clients?.account_number}</p>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sc?.bg} ${sc?.text} border ${sc?.border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${sc?.dot}`} />
            {sc?.label}
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
            <Icon name="AlertCircle" size={14} color="currentColor" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={12} color="currentColor" /></button>
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm">
            <Icon name="CheckCircle" size={14} color="currentColor" />
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="ml-auto"><Icon name="X" size={12} color="currentColor" /></button>
          </div>
        )}
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card rounded-xl border border-border p-5">
            <p className="text-xs text-muted-foreground mb-1">Total Amount</p>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(selectedPlan?.total_amount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{selectedPlan?.installments_paid}/{selectedPlan?.total_installments} paid</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <p className="text-xs text-muted-foreground mb-1">Per Installment</p>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(selectedPlan?.installment_amount)}</p>
            <p className="text-xs text-muted-foreground mt-1 capitalize">{selectedPlan?.frequency}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <p className="text-xs text-muted-foreground mb-1">Next Charge</p>
            {selectedPlan?.next_charge_date ? (
              <>
                <p className="text-base font-bold text-foreground">{formatDate(selectedPlan?.next_charge_date)}</p>
                <p className={`text-xs mt-1 font-medium ${
                  daysToNext !== null && daysToNext <= 3 ? 'text-red-500' :
                  daysToNext !== null && daysToNext <= 7 ? 'text-amber-500' : 'text-muted-foreground'
                }`}>
                  {daysToNext !== null && daysToNext < 0 ? `${Math.abs(daysToNext)}d overdue` :
                   daysToNext === 0 ? 'Due today' :
                   daysToNext !== null ? `In ${daysToNext} days` : ''}
                </p>
              </>
            ) : (
              <p className="text-base font-bold text-muted-foreground">—</p>
            )}
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <p className="text-xs text-muted-foreground mb-1">Retry Config</p>
            <p className="text-base font-bold text-foreground">{selectedPlan?.max_retries} retries</p>
            <p className="text-xs text-muted-foreground mt-1">Every {selectedPlan?.retry_interval_days}d</p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">Billing Progress</span>
            <span className="text-sm font-bold text-primary">{progress}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Started {formatDate(selectedPlan?.start_date)}</span>
            <span>Ends {formatDate(selectedPlan?.end_date)}</span>
          </div>
        </div>
        {/* Plan actions */}
        {selectedPlan?.plan_status !== 'completed' && selectedPlan?.plan_status !== 'cancelled' && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePausePlan(selectedPlan)}
              disabled={!!actionLoading}
              iconName={selectedPlan?.plan_status === 'paused' ? 'Play' : 'Pause'}
              iconPosition="left"
            >
              {actionLoading === `pause-${selectedPlan?.id}` ? 'Updating...' : selectedPlan?.plan_status === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCancelPlan(selectedPlan)}
              disabled={!!actionLoading}
              iconName="XCircle"
              iconPosition="left"
              className="text-red-500 border-red-500/30 hover:bg-red-500/10"
            >
              {actionLoading === `cancel-${selectedPlan?.id}` ? 'Cancelling...' : 'Cancel Plan'}
            </Button>
          </div>
        )}
        {/* Charge schedule */}
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-3">Billing Schedule</h4>
          {charges?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center bg-card rounded-xl border border-border">
              <Icon name="Calendar" size={24} color="var(--color-muted-foreground)" />
              <p className="text-sm text-muted-foreground mt-2">No charges scheduled</p>
            </div>
          ) : (
            <div className="space-y-2">
              {charges?.map((charge) => {
                const csc = CHARGE_STATUS_CONFIG?.[charge?.charge_status] || CHARGE_STATUS_CONFIG?.scheduled;
                const isActionable = ['scheduled', 'retrying', 'failed']?.includes(charge?.charge_status) && selectedPlan?.plan_status === 'active';
                const isLoading = actionLoading === charge?.id;
                return (
                  <div key={charge?.id} className="flex items-center gap-3 p-3 bg-card rounded-xl border border-border">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      <span className="text-xs font-bold text-muted-foreground">#{charge?.installment_number}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{formatCurrency(charge?.amount)}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${csc?.bg} ${csc?.text}`}>{csc?.label}</span>
                        {charge?.retry_attempt > 0 && (
                          <span className="text-xs text-amber-500">Retry {charge?.retry_attempt}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {charge?.charge_status === 'succeeded' ? `Paid ${formatDate(charge?.charged_at)}` : `Due ${formatDate(charge?.scheduled_date)}`}
                        {charge?.next_retry_date && charge?.charge_status === 'retrying' && ` · Next retry ${formatDate(charge?.next_retry_date)}`}
                      </p>
                      {charge?.failure_reason && (
                        <p className="text-xs text-red-500 mt-0.5 truncate">{charge?.failure_reason}</p>
                      )}
                    </div>
                    {isActionable && (
                      <button
                        onClick={() => handleChargeNow(charge)}
                        disabled={isLoading || !!actionLoading}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {isLoading ? <SpinnerIcon size={12} /> : <Icon name="Zap" size={12} color="currentColor" />}
                        {isLoading ? 'Charging...' : 'Charge Now'}
                      </button>
                    )}
                    {charge?.charge_status === 'succeeded' && (
                      <Icon name="CheckCircle" size={16} color="var(--color-success, #10b981)" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Plans list view
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Recurring Installment Plans</h3>
          <p className="text-xs text-muted-foreground">Auto-charge clients on scheduled due dates</p>
        </div>
        <Button variant="default" size="sm" onClick={() => { setView('create'); setError(null); setSuccessMsg(null); }} iconName="Plus" iconPosition="left">
          New Plan
        </Button>
      </div>
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
          <Icon name="AlertCircle" size={14} color="currentColor" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={12} color="currentColor" /></button>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm">
          <Icon name="CheckCircle" size={14} color="currentColor" />
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="ml-auto"><Icon name="X" size={12} color="currentColor" /></button>
        </div>
      )}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3]?.map(i => (
            <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : plans?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-card rounded-xl border border-border">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Icon name="RefreshCw" size={22} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-medium text-foreground">No installment plans yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create a plan to start recurring billing</p>
          <Button variant="default" size="sm" className="mt-4" onClick={() => setView('create')} iconName="Plus" iconPosition="left">Create First Plan</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {plans?.map((plan) => {
            const sc = STATUS_CONFIG?.[plan?.plan_status] || STATUS_CONFIG?.active;
            const progress = plan?.total_installments > 0
              ? Math.round((plan?.installments_paid / plan?.total_installments) * 100)
              : 0;
            const daysToNext = daysUntil(plan?.next_charge_date);
            return (
              <div
                key={plan?.id}
                onClick={() => { setSelectedPlan(plan); setView('detail'); setError(null); setSuccessMsg(null); }}
                className="bg-card rounded-xl border border-border p-4 cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{plan?.plan_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{plan?.clients?.full_name} · {plan?.clients?.account_number}</p>
                  </div>
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${sc?.bg} ${sc?.text} border ${sc?.border} flex-shrink-0`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc?.dot}`} />
                    {sc?.label}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                  <span>{formatCurrency(plan?.installment_amount)} / {plan?.frequency}</span>
                  <span>{plan?.installments_paid}/{plan?.total_installments} installments</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {plan?.next_charge_date ? (
                      <span className={daysToNext !== null && daysToNext <= 3 ? 'text-red-500 font-medium' : ''}>
                        Next: {formatDate(plan?.next_charge_date)}
                        {daysToNext !== null && daysToNext <= 7 && daysToNext >= 0 && ` (${daysToNext}d)`}
                        {daysToNext !== null && daysToNext < 0 && ` (${Math.abs(daysToNext)}d overdue)`}
                      </span>
                    ) : 'No upcoming charges'}
                  </span>
                  <span className="text-primary font-medium">{formatCurrency(plan?.total_amount)} total</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
