/**
 * useCustomerRecord
 *
 * Everything known about ONE person, gathered when their record is opened.
 *
 * The CRM screens deal in counts — "7 contacts", "Qualified", "14 days quiet".
 * That is the right altitude for a list and the wrong one for a conversation:
 * before ringing somebody you need what was actually said, what they wanted,
 * what they have already paid and what you promised them. This hook fetches
 * that, and only when a record is actually opened — the oversight tab already
 * issues four queries on mount and must not issue seven more per row.
 *
 * WHAT A LEAD BECAME decides where its commercial standing lives, because the
 * two sales forces sell different things:
 *
 *   • converted_entity 'client'          → a row in public.clients inside the
 *     (admin's agents, 'client' mode)      admin's own tenant, with payments,
 *                                          KYC and an outstanding balance.
 *
 *   • converted_entity 'company'/'sacco'  → an independent tenant. Its payments
 *     (super admin's agents)               are ITS OWN and deliberately not
 *                                          readable here (see 20260820140000);
 *                                          the standing that IS visible is the
 *                                          company_subscriptions row.
 *
 * NO NEW RLS. Every table below is readable under policies these roles already
 * hold. Each fetch is independent and failure-tolerant for exactly that reason:
 * if one table is not reachable for this caller, that section goes quiet rather
 * than blanking the whole record — and it is a signal the data does not belong
 * in the view, not a reason to widen a policy.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';
import { daysSince } from './useCrmInteractions';

const TOUCH_COLS = 'id, agent_id, lead_id, client_id, contact_name, interaction_type, direction, '
                 + 'subject, summary, outcome, duration_minutes, occurred_at, next_step, created_at';
const FOLLOW_COLS = 'id, agent_id, lead_id, lead_name, appointment_type, scheduled_at, is_completed, '
                  + 'completed_at, outcome, location, notes, remind_at';
const CLIENT_COLS = 'id, account_number, full_name, email, phone, national_id, address, city, '
                  + 'client_status, kyc_status, outstanding_balance, credit_score, total_assets, created_at';
const PAYMENT_COLS = 'id, transaction_id, amount, payment_method, payment_status, reference_number, payment_date, created_at';
const SUB_COLS = 'id, admin_id, plan_name, status, price_paid, max_users, start_date, end_date, created_at';
const LINK_COLS = 'id, token, asset_id, recipient_name, channel, is_active, view_count, enquiry_count, '
                + 'first_viewed_at, last_viewed_at, created_at';
const ASSET_COLS = 'id, asset_code, asset_type, description, selling_price, asset_status, location, make, model, year';

/** Settle a query without letting one unreadable table sink the whole record. */
const soft = async (label, run) => {
  try {
    const { data, error } = await run();
    if (error) {
      logger.debug('[useCustomerRecord] section unavailable', { label, message: error.message });
      return { data: null, blocked: true };
    }
    return { data, blocked: false };
  } catch (err) {
    logger.debug('[useCustomerRecord] section threw', { label, message: err?.message });
    return { data: null, blocked: true };
  }
};

export const useCustomerRecord = (lead, { enabled = true } = {}) => {
  const leadId    = lead?.id || null;
  const entity    = lead?.converted_entity || null;
  const refId     = lead?.converted_ref_id || null;
  const assetId   = lead?.asset_id || null;

  const [interactions, setInteractions] = useState([]);
  const [followUps, setFollowUps]       = useState([]);
  const [client, setClient]             = useState(null);
  const [payments, setPayments]         = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [shareLinks, setShareLinks]     = useState([]);
  const [asset, setAsset]               = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);

  const reset = useCallback(() => {
    setInteractions([]); setFollowUps([]); setClient(null);
    setPayments([]); setSubscriptions([]); setShareLinks([]); setAsset(null);
    setError(null);
  }, []);

  const load = useCallback(async () => {
    if (!enabled || !leadId) return;
    setLoading(true);
    setError(null);
    try {
      // The two that define the record. Everything else is context.
      const [touchRes, followRes, linkRes] = await Promise.all([
        soft('interactions', () => supabase.from('crm_interactions').select(TOUCH_COLS)
          .eq('lead_id', leadId).order('occurred_at', { ascending: false })),
        soft('follow_ups', () => supabase.from('follow_ups').select(FOLLOW_COLS)
          .eq('lead_id', leadId).order('scheduled_at', { ascending: false })),
        soft('share_links', () => supabase.from('asset_share_links').select(LINK_COLS)
          .eq('lead_id', leadId).order('created_at', { ascending: false })),
      ]);

      setInteractions(touchRes.data || []);
      setFollowUps(followRes.data || []);
      setShareLinks(linkRes.data || []);

      // A record whose own history could not be read is worth saying out loud —
      // an empty timeline would otherwise read as "nobody ever called them".
      if (touchRes.blocked) setError('Contact history could not be loaded for this record.');

      if (assetId) {
        const a = await soft('asset', () => supabase.from('assets').select(ASSET_COLS).eq('id', assetId).maybeSingle());
        setAsset(a.data || null);
      } else {
        setAsset(null);
      }

      // Commercial standing, resolved by what the lead became.
      if (entity === 'client' && refId) {
        const c = await soft('client', () => supabase.from('clients').select(CLIENT_COLS).eq('id', refId).maybeSingle());
        setClient(c.data || null);
        if (c.data) {
          const p = await soft('payments', () => supabase.from('payments').select(PAYMENT_COLS)
            .eq('client_id', refId).order('payment_date', { ascending: false }).limit(50));
          setPayments(p.data || []);
        } else {
          setPayments([]);
        }
        setSubscriptions([]);
      } else if ((entity === 'company' || entity === 'sacco') && refId) {
        // refId is the new tenant's admin id; its subscription is the standing
        // the platform owner is entitled to see. Its clients and payments are
        // that tenant's own and are deliberately not fetched.
        const s = await soft('subscriptions', () => supabase.from('company_subscriptions').select(SUB_COLS)
          .eq('admin_id', refId).order('created_at', { ascending: false }));
        setSubscriptions(s.data || []);
        setClient(null);
        setPayments([]);
      } else {
        setClient(null); setPayments([]); setSubscriptions([]);
      }
    } catch (err) {
      logger.error('[useCustomerRecord] load failed', { message: err?.message });
      setError(err?.message || 'Could not load this record.');
    } finally {
      setLoading(false);
    }
  }, [enabled, leadId, entity, refId, assetId]);

  useEffect(() => {
    if (!enabled || !leadId) { reset(); return; }
    load();
  }, [enabled, leadId, load, reset]);

  /** Follow-ups split the way somebody about to make a call reads them. */
  const followUpBuckets = useMemo(() => {
    const now = Date.now();
    const open = followUps.filter(f => !f.is_completed);
    return {
      overdue:  open.filter(f => new Date(f.scheduled_at).getTime() < now),
      upcoming: open.filter(f => new Date(f.scheduled_at).getTime() >= now),
      done:     followUps.filter(f => f.is_completed),
    };
  }, [followUps]);

  /** The one-line summary strip above the timeline. */
  const summary = useMemo(() => {
    const sorted = [...interactions].sort(
      (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
    );
    const first = sorted[0]?.occurred_at || null;
    const last  = sorted[sorted.length - 1]?.occurred_at || null;
    const totalMinutes = interactions.reduce((n, i) => n + (Number(i.duration_minutes) || 0), 0);

    return {
      contacts:     interactions.length,
      firstTouchAt: first,
      lastTouchAt:  last,
      // Falls back to the lead's own stamp: a lead contacted before the CRM
      // existed still has last_contact_at, and showing "never" would be a lie.
      quietDays:    daysSince(last || lead?.last_contact_at || lead?.created_at),
      totalMinutes,
      inbound:      interactions.filter(i => i.direction === 'inbound').length,
    };
  }, [interactions, lead]);

  const outstanding = useMemo(() => {
    if (client) return Number(client.outstanding_balance || 0);
    return null;
  }, [client]);

  const paidTotal = useMemo(
    () => payments
      .filter(p => (p.payment_status || '').toLowerCase() === 'completed')
      .reduce((n, p) => n + Number(p.amount || 0), 0),
    [payments],
  );

  return {
    interactions,
    followUps,
    followUpBuckets,
    client,
    payments,
    paidTotal,
    outstanding,
    subscriptions,
    shareLinks,
    asset,
    summary,
    loading,
    error,
    refetch: load,
  };
};

export default useCustomerRecord;
