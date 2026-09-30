/**
 * useConsultancyServices
 *
 * The Services tab of Inventory & Clients: the firm's service catalogue, the
 * price list behind each service, and the clients mapped to them. Tables and
 * rules: supabase/migrations/20260925160000_consultancy_services.sql.
 *
 * READS ARE WHOLE, NOT PAGED. A consultancy's catalogue is tens of rows and its
 * client book hundreds, and the tab counts them ("3 clients") — a count taken
 * over a capped read is silently wrong, so every list goes through
 * fetchAllRows.
 *
 * WRITES. A service and its price list save through save_consultancy_service()
 * in one transaction, so a price option the rules refuse leaves the service
 * exactly as it was. Engagements are single rows and go straight to the table.
 * Every write asks for the affected id back: PostgREST reports a row-level
 * security refusal as a success that changed nothing, and "saved" must mean
 * saved.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAllRows';
import { buildTerms, isCurrentEngagement } from '../config/consultancyPricing';

// Module-level, never Date.now(): a remount inside one millisecond would be
// handed the still-joining channel, and .on() on it throws.
let _consultancyChannelSeq = 0;

const MIGRATION = '20260925160000_consultancy_services.sql';

/** A database refusal, in the words the person at the desk needs. */
export const friendlyError = (err) => {
  const code = err?.code || '';
  const said = `${err?.message || ''} ${err?.details || ''}`;
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || /schema cache/i.test(said)) {
    return `The Services area is not installed on this database yet — apply migration ${MIGRATION}.`;
  }
  if (said.includes('consultancy_services_name_uniq')) return 'A service with that name already exists.';
  if (said.includes('consultancy_services_code_uniq')) return 'Another service already uses that code.';
  if (said.includes('consultancy_engagements_service_id_fkey')) {
    return 'Clients are mapped to this service. Retire it instead, or remove its client mappings first.';
  }
  // 20260930120000: a service sold at the POS keeps its sales on record.
  if (said.includes('sales_consultancy_service_id_fkey')) {
    return 'This service has been sold at the Point of Sale. Retire it instead, so its sales stay on record.';
  }
  if (said.includes('consultancy_engagements_dates_chk')) return 'The end date cannot be before the start date.';
  return err?.message || 'Something went wrong. Please try again.';
};

const cleanText = (v) => String(v ?? '').trim() || null;

/**
 * The row an engagement form saves. Terms go through buildTerms, so what is
 * sent is what the database keeps — nothing it would silently clear.
 */
export const buildEngagementRow = (form = {}) => {
  const row = {
    service_id:        form.service_id,
    client_id:         form.client_id,
    cost_structure_id: form.cost_structure_id || null,
    status:            form.status || 'active',
    start_date:        form.start_date || null,
    end_date:          form.end_date || null,
    notes:             cleanText(form.notes),
    ...buildTerms(form.terms),
  };
  // Omitted rather than null on a new mapping, so the column default (today,
  // in Nairobi) applies.
  if (!form.id && !row.start_date) delete row.start_date;
  return row;
};

export const useConsultancyServices = (adminId) => {
  const [services, setServices] = useState([]);
  const [costStructures, setCostStructures] = useState([]);
  const [engagements, setEngagements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Only the most recently started read may set state. A slow read begun
  // before a save must not land after the save's own reload and put the
  // pre-save list back on screen.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!adminId) return;
    const mine = ++loadSeq.current;
    try {
      const [svc, options, mapped] = await Promise.all([
        fetchAllRows(() => supabase
          .from('consultancy_services')
          .select('*')
          .eq('admin_id', adminId)
          .order('name')
          .order('id')),
        fetchAllRows(() => supabase
          .from('consultancy_cost_structures')
          .select('*')
          .eq('admin_id', adminId)
          .order('service_id')
          .order('sort_order')
          .order('id')),
        fetchAllRows(() => supabase
          .from('consultancy_engagements')
          .select('*, client:clients(id, full_name, account_number, email, phone)')
          .eq('admin_id', adminId)
          .order('created_at', { ascending: false })
          .order('id')),
      ]);
      if (mine !== loadSeq.current) return;
      setServices(svc);
      setCostStructures(options);
      setEngagements(mapped);
      setError(null);
    } catch (err) {
      // What is on screen stays: a failed refresh must not read as "you offer
      // nothing and have no clients".
      if (mine === loadSeq.current) setError(friendlyError(err));
    } finally {
      if (mine === loadSeq.current) setLoading(false);
    }
  }, [adminId]);

  useEffect(() => { load(); }, [load]);

  // A colleague's change arrives without a refresh. One save touches several
  // rows (a service and each of its price options), so the reload waits for
  // the burst to finish instead of running once per row.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!adminId) return undefined;
    let timer = null;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadRef.current(), 300);
    };
    const channel = supabase
      .channel(`consultancy_services_${++_consultancyChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultancy_services' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultancy_cost_structures' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultancy_engagements' }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [adminId]);

  // ── Derived views ─────────────────────────────────────────────────────────
  const optionsByService = useMemo(() => {
    const map = {};
    costStructures.forEach((o) => { (map[o.service_id] = map[o.service_id] || []).push(o); });
    return map;
  }, [costStructures]);

  const engagementsByService = useMemo(() => {
    const map = {};
    engagements.forEach((e) => { (map[e.service_id] = map[e.service_id] || []).push(e); });
    return map;
  }, [engagements]);

  const categories = useMemo(
    () => [...new Set(services.map(s => s.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [services],
  );

  const summary = useMemo(() => {
    const current = engagements.filter(e => isCurrentEngagement(e.status));
    return {
      activeServices:   services.filter(s => s.is_active).length,
      retiredServices:  services.filter(s => !s.is_active).length,
      priceOptions:     costStructures.length,
      currentMappings:  current.length,
      clientsServed:    new Set(current.map(e => e.client_id)).size,
    };
  }, [services, costStructures, engagements]);

  // ── Writes ────────────────────────────────────────────────────────────────

  /** A service and its COMPLETE price list, in one transaction. */
  const saveService = useCallback(async ({ service = {}, costStructures: options = [] }) => {
    const { data, error: err } = await supabase.rpc('save_consultancy_service', {
      p_service: {
        id:           service.id || null,
        name:         cleanText(service.name),
        service_code: cleanText(service.service_code),
        category:     cleanText(service.category),
        description:  cleanText(service.description),
        is_active:    service.is_active !== false,
      },
      p_cost_structures: options.map(o => ({
        id:         o.id || null,
        label:      cleanText(o.label),
        is_default: !!o.is_default,
        ...buildTerms(o),
      })),
    });
    if (err) throw new Error(friendlyError(err));
    await load();
    return data;
  }, [load]);

  /** Retire a service (still on record, no longer offered) or bring it back. */
  const setServiceActive = useCallback(async (id, isActive) => {
    const { data, error: err } = await supabase
      .from('consultancy_services')
      .update({ is_active: isActive })
      .eq('id', id)
      .select('id');
    if (err) throw new Error(friendlyError(err));
    if (!data?.length) throw new Error('The service was not changed — you may not have permission to edit it.');
    await load();
  }, [load]);

  /** Only a service no client is mapped to; the database refuses the rest. */
  const deleteService = useCallback(async (id) => {
    const { data, error: err } = await supabase
      .from('consultancy_services')
      .delete()
      .eq('id', id)
      .select('id');
    if (err) throw new Error(friendlyError(err));
    if (!data?.length) throw new Error('The service was not deleted — you may not have permission to delete it.');
    await load();
  }, [load]);

  /** Map a client to a service, or change an existing mapping. */
  const saveEngagement = useCallback(async (form) => {
    const row = buildEngagementRow(form);
    const { data, error: err } = form.id
      ? await supabase.from('consultancy_engagements').update(row).eq('id', form.id).select('id')
      : await supabase.from('consultancy_engagements').insert(row).select('id');
    if (err) throw new Error(friendlyError(err));
    if (!data?.length) throw new Error('The mapping was not saved — you may not have permission to change it.');
    await load();
    return data[0].id;
  }, [load]);

  const deleteEngagement = useCallback(async (id) => {
    const { data, error: err } = await supabase
      .from('consultancy_engagements')
      .delete()
      .eq('id', id)
      .select('id');
    if (err) throw new Error(friendlyError(err));
    if (!data?.length) throw new Error('The mapping was not removed — you may not have permission to remove it.');
    await load();
  }, [load]);

  return {
    services,
    costStructures,
    engagements,
    optionsByService,
    engagementsByService,
    categories,
    summary,
    loading,
    error,
    reload: load,
    saveService,
    setServiceActive,
    deleteService,
    saveEngagement,
    deleteEngagement,
  };
};

export default useConsultancyServices;
