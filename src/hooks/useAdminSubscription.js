import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { planForUsers, planById, subscriptionPriceFor } from '../config/companyPlans';

/**
 * Admin platform subscription, backed by the existing company_subscriptions /
 * subscription_plans / mpesa_subscription_payments tables.
 *
 *   • current plan  — latest company_subscriptions row for the admin
 *                     (max_users = licensed seats, price_paid, start/end dates).
 *   • history       — every company_subscriptions row (each downloadable as an
 *                     invoice from the profile page).
 *   • seat change   — upgrade/downgrade is stashed in pending_* columns and only
 *                     takes effect once the current period ends (see migration
 *                     20260626160000_company_subscription_scheduled_change.sql).
 *                     When the period has passed it is applied opportunistically
 *                     on load (a new active row is created) — no cron needed.
 *   • payment       — recorded in mpesa_subscription_payments (the real M-Pesa
 *                     STK/Daraja call is wired up later).
 */

const DAY = 86400000;
const parseDate = (d) => (d ? new Date(d) : null);
const addDays   = (date, n) => new Date(date.getTime() + n * DAY);
const isoDate    = (d) => d.toISOString().slice(0, 10);

const getAdminId = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
};

// Error thrown when the scheduling columns haven't been added yet.
const isMissingColumn = (err) =>
  err && (err.code === 'PGRST204' || err.code === '42703' || /column .* does not exist/i.test(err.message || ''));

// Apply a scheduled change once the current period has ended: create the next
// period's active row and clear the pending fields. Idempotent — skips if a row
// for the next period already exists. No-ops if the pending columns are absent.
const applyPendingIfDue = async (sub) => {
  if (!sub || sub.pending_max_users == null || !sub.end_date) return sub;
  const end = parseDate(sub.end_date);
  if (Date.now() <= end.getTime()) return sub; // period still running

  // Already rolled over?
  const { data: existing } = await supabase
    .from('company_subscriptions')
    .select('id')
    .eq('admin_id', sub.admin_id)
    .eq('start_date', sub.end_date)
    .maybeSingle();

  if (!existing) {
    const plan = planById(sub.pending_plan_name);
    let planId = null;
    if (plan) {
      const { data: planRow } = await supabase
        .from('subscription_plans').select('id').eq('name', plan.id).maybeSingle();
      planId = planRow?.id ?? null;
    }
    await supabase.from('company_subscriptions').insert({
      admin_id:   sub.admin_id,
      plan_id:    planId,
      plan_name:  sub.pending_plan_name,
      status:     'active',
      price_paid: sub.pending_price ?? subscriptionPriceFor(sub.pending_max_users),
      max_users:  sub.pending_max_users,
      start_date: sub.end_date,
      end_date:   addDays(end, 30).toISOString(),
    });
  }

  // Clear the pending change on the old row.
  await supabase
    .from('company_subscriptions')
    .update({ pending_max_users: null, pending_plan_name: null, pending_price: null, pending_effective_date: null })
    .eq('id', sub.id);

  return null; // signal: re-fetch latest
};

export const useAdminSubscription = () => {
  const [subscription, setSubscription] = useState(null);
  const [history, setHistory]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const adminId = await getAdminId();
      if (!adminId) { setLoading(false); return; }

      const latest = async () => {
        const { data } = await supabase
          .from('company_subscriptions')
          .select('*, plan:subscription_plans(*)')
          .eq('admin_id', adminId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return data;
      };

      let sub = await latest();
      const rolled = await applyPendingIfDue(sub);
      if (rolled === null && sub) sub = await latest(); // re-fetch after rollover
      setSubscription(sub);

      const { data: rows } = await supabase
        .from('company_subscriptions')
        .select('*, plan:subscription_plans(*)')
        .eq('admin_id', adminId)
        .order('created_at', { ascending: false });
      setHistory(rows || []);
    } catch (err) {
      console.error('useAdminSubscription load error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Schedule a seat upgrade/downgrade — effective once the current period ends.
  // Passing the current seat count cancels any pending change.
  const changeSeats = useCallback(async (newSeats) => {
    if (!subscription) return;
    const seats = Math.max(1, parseInt(newSeats, 10) || 1);
    const clearing = seats === subscription.max_users;
    const plan = planForUsers(seats);

    const patch = clearing
      ? { pending_max_users: null, pending_plan_name: null, pending_price: null, pending_effective_date: null }
      : {
          pending_max_users:      seats,
          pending_plan_name:      plan?.id ?? subscription.plan_name,
          pending_price:          subscriptionPriceFor(seats),
          pending_effective_date: subscription.end_date,
        };

    const { data, error: updErr } = await supabase
      .from('company_subscriptions')
      .update(patch)
      .eq('id', subscription.id)
      .select('*, plan:subscription_plans(*)')
      .maybeSingle();

    if (updErr) {
      if (isMissingColumn(updErr)) {
        const e = new Error('Scheduling needs a quick DB update — apply migration 20260626160000_company_subscription_scheduled_change.sql.');
        e.needsMigration = true;
        throw e;
      }
      throw updErr;
    }
    setSubscription(data);
    return data;
  }, [subscription]);

  // Record a subscription payment intent (M-Pesa STK / Daraja wired up later).
  const recordPayment = useCallback(async (phone, amount) => {
    const adminId = await getAdminId();
    const { error: payErr } = await supabase.from('mpesa_subscription_payments').insert({
      admin_id:     adminId,
      phone_number: phone,
      amount,
      status:       'pending',
    });
    if (payErr) throw payErr;
  }, []);

  // ── Derived values ───────────────────────────────────────────────────────
  const seats     = subscription?.max_users ?? 0;
  const planName  = subscription?.plan_name || null;
  const plan      = planName ? planById(planName) : null;
  const pricePaid = parseFloat(subscription?.price_paid || 0);
  const monthlyCost = subscriptionPriceFor(seats); // recurring (excludes install fee)

  const endDate = parseDate(subscription?.end_date);
  const expired = endDate ? Date.now() > endDate.getTime() : false;
  const daysRemaining = endDate
    ? Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / DAY))
    : null;

  const unpaid    = subscription?.status === 'pending';
  const outstanding = unpaid ? pricePaid : 0;
  const nextCharge  = subscription?.pending_price != null
    ? parseFloat(subscription.pending_price)
    : monthlyCost;

  const almostDepleted = expired || outstanding > 0 || (daysRemaining != null && daysRemaining <= 7);

  return {
    subscription, history, loading, error,
    seats, planName, plan, pricePaid, monthlyCost,
    endDate: subscription?.end_date || null,
    startDate: subscription?.start_date || null,
    status: subscription?.status || null,
    daysRemaining, expired, outstanding, nextCharge, almostDepleted,
    changeSeats, recordPayment, refetch: load,
  };
};

export default useAdminSubscription;
