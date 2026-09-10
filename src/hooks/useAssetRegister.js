/**
 * useAssetRegister
 *
 * The SACCO's asset register: what it owns, where each thing is, what it is
 * worth, and the paperwork that proves it.
 *
 * READS ARE PAGED, TOTALS ARE NOT. The two are separate on purpose. The table
 * shows a page from usePagedQuery so opening the register costs the same for a
 * SACCO with forty assets and one with four thousand; the KPI cards read
 * public.sacco_asset_register_summary(), which aggregates the WHOLE register in
 * Postgres. Summing the rows on screen would produce a total of the page, which
 * is the one number a treasurer must never be shown — same rule as
 * sacco_dashboard_stats().
 *
 * WRITES GO STRAIGHT TO THE TABLE, not through an RPC, because the invariants
 * that matter here are already triggers: asset tags, the status ⇄ is_disposed
 * lockstep, the movement trail and the tenant stamp all live in
 * 20260830200000_sacco_asset_register.sql and hold no matter who writes.
 *
 * WHAT THIS HOOK WILL NOT DO is post to the ledger on a valuation. Registering
 * a NEW asset optionally posts its purchase (the Finance Hub has always done
 * that, and this reuses it); revaluing an existing one does not, because an
 * upward revaluation is an equity movement that needs a treasurer's journal,
 * not a side effect of editing a field.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';
import { usePagedQuery } from './usePagedQuery';
import { categoryMeta, TERMINAL_STATUSES } from '../config/assetRegister';

// A module-level counter, not Date.now(): StrictMode mounts effects twice and
// both runs can land in the same millisecond, and supabase.channel() hands back
// the already-subscribed channel for a name in use — which then throws when
// .on() is called on it. Same fix as SaccoDashboardContext.
let _assetRegisterChannelSeq = 0;

/** Rows per page in the register table. */
export const PAGE_SIZE = 25;

/** The private bucket holding title deeds, logbooks and the rest. */
export const ASSET_DOC_BUCKET = 'sacco-asset-documents';

/** Anything larger than this is a scan nobody needed at that resolution. */
export const MAX_DOC_BYTES = 25 * 1024 * 1024;

const EMPTY_SUMMARY = {
  totalAssets: 0,
  inService: 0,
  disposed: 0,
  needsAttention: 0,
  totalCost: 0,
  totalDepreciation: 0,
  totalBookValue: 0,
  totalCurrentValue: 0,
  valuedAssets: 0,
  undocumented: 0,
  expiringDocuments: 0,
  byCategory: {},
  byStatus: {},
};

/**
 * The owning tenant, resolved the way public.current_admin_id() does it
 * server-side so the client filter and the RLS policy always agree.
 */
const getAdminId = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return null;
  const { data } = await supabase.from('user_profiles').select('admin_id').eq('id', uid).maybeSingle();
  return data?.admin_id || uid;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** '' from an untouched optional number input means "not given", not zero. */
const optionalNumber = (v) => (v === '' || v === null || v === undefined ? null : num(v));

/** Storage object names must survive a URL; a client filename need not. */
const safeFileName = (name) => String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);

/**
 * Shape a form into the row the table expects.
 *
 * The GL account comes from the CATEGORY unless the operator has overridden it.
 * That is the join between the register and the accounts: pick "Motor
 * Vehicles" and the purchase capitalises to 1330, so the Balance Sheet's PPE
 * breakdown agrees with the register without anyone maintaining two lists.
 */
export const buildAssetRow = (form = {}) => {
  const meta = categoryMeta(form.category);
  const terminal = TERMINAL_STATUSES.includes(form.status);

  return {
    asset_name:        String(form.asset_name || '').trim(),
    category:          form.category || 'other',
    description:       form.description?.trim() || null,
    location:          form.location?.trim() || null,
    status:            form.status || 'in_use',
    serial_number:     form.serial_number?.trim() || null,
    supplier:          form.supplier?.trim() || null,
    gl_code:           form.gl_code || meta.gl,
    acquisition_date:  form.acquisition_date,
    cost:              num(form.cost),
    residual_value:    num(form.residual_value),
    useful_life_years: form.useful_life_years === '' || form.useful_life_years == null
                         ? meta.life
                         : num(form.useful_life_years),
    method:            form.method || 'straight_line',
    current_value:     optionalNumber(form.current_value),
    valuation_date:    form.current_value === '' || form.current_value == null
                         ? null
                         : (form.valuation_date || null),
    valuation_basis:   form.current_value === '' || form.current_value == null
                         ? null
                         : (form.valuation_basis || 'internal'),
    notes:             form.notes?.trim() || null,
    // The trigger clears these when the status is not terminal, but sending
    // them only when they apply keeps the intent visible in the request too.
    disposal_reason:   terminal ? (form.disposal_reason?.trim() || null) : null,
    disposal_date:     terminal ? (form.disposal_date || null) : null,
    disposal_proceeds: terminal ? optionalNumber(form.disposal_proceeds) : null,
  };
};

/** Server column names for the sort control, so the UI cannot invent one. */
export const SORT_OPTIONS = [
  { value: 'acquisition_date', label: 'Newest first',   ascending: false },
  { value: 'asset_name',       label: 'Name (A–Z)',     ascending: true  },
  { value: 'cost',             label: 'Highest value',  ascending: false },
  { value: 'asset_tag',        label: 'Asset tag',      ascending: true  },
];

export const useAssetRegister = (sacco, { search = '', category = 'all', status = 'all', sort = 'acquisition_date' } = {}) => {
  const saccoId = sacco?.id || null;

  const [adminId, setAdminId] = useState(null);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [canPost, setCanPost] = useState(false);
  const [error, setError] = useState(null);

  const saccoIdRef = useRef(saccoId);
  useEffect(() => { saccoIdRef.current = saccoId; }, [saccoId]);

  useEffect(() => {
    let cancelled = false;
    getAdminId().then((id) => { if (!cancelled) setAdminId(id); });
    return () => { cancelled = true; };
  }, []);

  /**
   * Can a purchase be capitalised to the ledger from here?
   *
   * One row, not the whole of useSaccoFinance. That hook loads ten tables
   * including every journal entry, which is the right cost for the Finance Hub
   * and the wrong cost for a register tab whose job is a paged list. All this
   * needs to know is whether a chart of accounts exists to post into.
   */
  useEffect(() => {
    if (!adminId) return undefined;
    let cancelled = false;
    supabase
      .from('sacco_society_config')
      .select('coa_seeded_at')
      .eq('admin_id', adminId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setCanPost(!!data?.coa_seeded_at); });
    return () => { cancelled = true; };
  }, [adminId]);

  // ── The page on screen ────────────────────────────────────────────────────
  const ordering = SORT_OPTIONS.find((o) => o.value === sort) || SORT_OPTIONS[0];

  const pager = usePagedQuery({
    table: 'sacco_fixed_assets',
    columns: '*',
    applyFilters: (q) => {
      let query = q.eq('admin_id', adminId);
      if (category !== 'all') query = query.eq('category', category);
      // "Active" is the register's working view: everything the SACCO still
      // holds. Without it the default list is dominated by things sold years
      // ago, which is the opposite of what a register is opened for.
      if (status === 'active') query = query.eq('is_disposed', false);
      else if (status === 'disposed') query = query.eq('is_disposed', true);
      else if (status !== 'all') query = query.eq('status', status);
      return query;
    },
    order: { column: ordering.value, ascending: ordering.ascending },
    searchColumns: ['asset_name', 'asset_tag', 'description', 'location', 'serial_number', 'supplier'],
    search,
    pageSize: PAGE_SIZE,
    enabled: !!adminId,
    deps: [adminId, category, status, sort],
  });

  // ── Whole-book totals ─────────────────────────────────────────────────────
  const loadSummary = useCallback(async () => {
    if (!adminId) return;
    setSummaryLoading(true);
    try {
      const { data, error: err } = await supabase.rpc('sacco_asset_register_summary');
      if (err) throw err;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setSummary(EMPTY_SUMMARY); return; }

      setSummary({
        totalAssets:       Number(row.total_assets) || 0,
        inService:         Number(row.in_service) || 0,
        disposed:          Number(row.disposed_assets) || 0,
        needsAttention:    Number(row.needs_attention) || 0,
        totalCost:         Number(row.total_cost) || 0,
        totalDepreciation: Number(row.total_depreciation) || 0,
        totalBookValue:    Number(row.total_book_value) || 0,
        totalCurrentValue: Number(row.total_current_value) || 0,
        valuedAssets:      Number(row.valued_assets) || 0,
        undocumented:      Number(row.undocumented_assets) || 0,
        expiringDocuments: Number(row.expiring_documents) || 0,
        byCategory:        row.by_category || {},
        byStatus:          row.by_status || {},
      });
      setError(null);
    } catch (e) {
      // The register itself still renders from the paged rows. Say the totals
      // are unavailable rather than showing zeroes, which read as "you own
      // nothing" — the most alarming possible way to fail.
      logger.warn('Asset register summary unavailable', { error: e?.message });
      setSummary(EMPTY_SUMMARY);
      setError(e?.message || 'Register totals could not be loaded.');
    } finally {
      setSummaryLoading(false);
    }
  }, [adminId]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Destructured so the callback below depends on the function itself rather
  // than on the whole pager object, which changes identity every render.
  const { refresh: refreshPage } = pager;

  const refresh = useCallback(async () => {
    await Promise.all([refreshPage(), loadSummary()]);
  }, [refreshPage, loadSummary]);

  // Keep a ref so the realtime effect below does not resubscribe on every
  // render just because refresh's identity changed.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!adminId) return undefined;
    const ch = supabase
      .channel(`asset_register_${++_assetRegisterChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sacco_fixed_assets' },
          () => { refreshRef.current(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sacco_asset_documents' },
          () => { refreshRef.current(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [adminId]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Register a new asset.
   *
   * `postPurchase` capitalises the cost to the category's asset account against
   * the bank. It is opt-in and defaults OFF here, unlike the Finance Hub modal
   * that defaults it on: most rows entered into a register on day one are
   * assets the SACCO has owned for years and whose purchase was posted (or
   * never posted) long ago. Posting those again would invent expenditure that
   * never happened this period.
   */
  const createAsset = useCallback(async (form, { postPurchase = false } = {}) => {
    const row = buildAssetRow(form);
    const { data, error: err } = await supabase
      .from('sacco_fixed_assets')
      .insert({ ...row, sacco_id: saccoIdRef.current })
      .select()
      .maybeSingle();
    if (err) throw err;

    let posted = null;
    if (postPurchase && row.cost > 0 && saccoIdRef.current) {
      // The same two lines the FIXED_ASSET_PURCHASE template posts: debit the
      // category's asset account, credit whatever paid for it. Sent through
      // sacco_post_journal so the §10.2 rules still apply — it must balance,
      // both accounts must exist in the society's chart, and a closed period
      // rejects it.
      const { data: entryId, error: postErr } = await supabase.rpc('sacco_post_journal', {
        p_sacco_id:      saccoIdRef.current,
        p_entry_date:    row.acquisition_date,
        p_description:   `Purchase of ${row.asset_name}`,
        p_lines: [
          { account_code: row.gl_code,              debit: row.cost, credit: 0 },
          { account_code: form.paid_from || '1020', debit: 0,        credit: row.cost },
        ],
        p_template_code: 'FIXED_ASSET_PURCHASE',
        p_source_table:  'sacco_fixed_assets',
        p_source_id:     data.id,
      });

      // Non-fatal: the asset is registered either way. A SACCO whose books are
      // not seeded, or whose period is closed, still needs its register — and
      // losing the asset row over a bookkeeping refusal would be the wrong
      // trade. The caller is told, so it can say so rather than claim success.
      if (postErr) {
        logger.warn('Asset registered but the purchase could not be posted', {
          assetId: data.id, error: postErr.message,
        });
        posted = { ok: false, reason: postErr.message };
      } else {
        posted = { ok: true, entryId };
      }
    }

    await refresh();
    return { asset: data, posted };
  }, [refresh]);

  const updateAsset = useCallback(async (id, form) => {
    const { data, error: err } = await supabase
      .from('sacco_fixed_assets')
      .update({ ...buildAssetRow(form), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (err) throw err;
    await refresh();
    return data;
  }, [refresh]);

  /**
   * Take an asset out of service.
   *
   * A separate call from updateAsset because it is a separate decision, and
   * because it must carry a reason: the database derives is_disposed from the
   * status, and the depreciation job stops charging from that moment. An
   * unexplained gap in the depreciation schedule is exactly what an auditor
   * asks about.
   */
  const disposeAsset = useCallback(async (id, { status = 'disposed', disposal_date, disposal_reason, disposal_proceeds }) => {
    const { error: err } = await supabase
      .from('sacco_fixed_assets')
      .update({
        status,
        disposal_date:     disposal_date || new Date().toISOString().slice(0, 10),
        disposal_reason:   disposal_reason?.trim() || null,
        disposal_proceeds: optionalNumber(disposal_proceeds),
        updated_at:        new Date().toISOString(),
      })
      .eq('id', id);
    if (err) throw err;
    await refresh();
  }, [refresh]);

  /** Record what the asset is worth today. Does not touch the ledger. */
  const revalueAsset = useCallback(async (id, { current_value, valuation_date, valuation_basis }) => {
    const { error: err } = await supabase
      .from('sacco_fixed_assets')
      .update({
        current_value:   optionalNumber(current_value),
        valuation_date:  valuation_date || new Date().toISOString().slice(0, 10),
        valuation_basis: valuation_basis || 'internal',
        updated_at:      new Date().toISOString(),
      })
      .eq('id', id);
    if (err) throw err;
    await refresh();
  }, [refresh]);

  /**
   * Deleting a register row is almost never what someone means — an asset that
   * exists and then does not leaves the Balance Sheet's PPE line unexplained.
   * Kept available for a genuine mis-keyed entry, and named so nobody reaches
   * for it to record a sale.
   */
  const deleteAsset = useCallback(async (id) => {
    const { error: err } = await supabase.from('sacco_fixed_assets').delete().eq('id', id);
    if (err) throw err;
    await refresh();
  }, [refresh]);

  // ── Documents ─────────────────────────────────────────────────────────────

  const listDocuments = useCallback(async (assetId) => {
    const { data, error: err } = await supabase
      .from('sacco_asset_documents')
      .select('*')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return data || [];
  }, []);

  const listEvents = useCallback(async (assetId) => {
    const { data, error: err } = await supabase
      .from('sacco_asset_events')
      .select('*')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (err) throw err;
    return data || [];
  }, []);

  /**
   * Attach a file to an asset.
   *
   * The object path is `<admin_id>/<asset_id>/<timestamp>_<name>` because that
   * FIRST SEGMENT is the whole access-control story: the bucket policy reads it
   * through storage_path_is_own_tenant(), so a document filed under another
   * tenant's id is refused by Postgres rather than by this function. The
   * timestamp keeps a re-upload of the same filename from silently replacing
   * the earlier scan.
   */
  const uploadDocument = useCallback(async (assetId, file, meta = {}) => {
    if (!file) throw new Error('Choose a file to attach.');
    if (file.size > MAX_DOC_BYTES) {
      throw new Error(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_DOC_BYTES / 1048576} MB.`);
    }
    const tenant = adminId || await getAdminId();
    if (!tenant) throw new Error('Your session has expired. Sign in again to upload.');

    const path = `${tenant}/${assetId}/${Date.now()}_${safeFileName(file.name)}`;
    const { error: upErr } = await supabase.storage
      .from(ASSET_DOC_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
    if (upErr) throw upErr;

    const { data, error: err } = await supabase
      .from('sacco_asset_documents')
      .insert({
        asset_id:   assetId,
        doc_type:   meta.doc_type || 'other',
        title:      meta.title?.trim() || null,
        file_name:  file.name,
        // The bare path, not a URL. Signed URLs expire; the path does not, and
        // lib/storageUrl resolves one from the other at render time.
        file_url:   path,
        mime_type:  file.type || null,
        size_bytes: file.size,
        issued_on:  meta.issued_on || null,
        expires_on: meta.expires_on || null,
        notes:      meta.notes?.trim() || null,
      })
      .select()
      .maybeSingle();

    if (err) {
      // The row is what makes the object findable. Without it the upload is an
      // orphan nobody can see or delete through the UI, so undo it.
      await supabase.storage.from(ASSET_DOC_BUCKET).remove([path]).catch(() => {});
      throw err;
    }

    await loadSummary();
    return data;
  }, [adminId, loadSummary]);

  const deleteDocument = useCallback(async (doc) => {
    const { error: err } = await supabase.from('sacco_asset_documents').delete().eq('id', doc.id);
    if (err) throw err;

    // Best-effort: an object left behind is invisible and harmless, whereas
    // failing the whole delete over a storage hiccup leaves a row pointing at
    // a file the user believes is gone.
    if (doc.file_url) {
      await supabase.storage.from(ASSET_DOC_BUCKET).remove([doc.file_url]).catch((e) => {
        logger.warn('Asset document row deleted but the file remains', { path: doc.file_url, error: e?.message });
      });
    }
    await loadSummary();
  }, [loadSummary]);

  /**
   * Every asset the tenant owns, for the CSV export.
   *
   * Deliberately NOT the paged rows: exporting "the register" and getting the
   * twenty-five rows that happened to be on screen is the kind of quiet
   * wrongness that ends up in a board pack. Ordered the same way the table is
   * so the file matches what was on screen.
   */
  const fetchAllForExport = useCallback(async () => {
    if (!adminId) return [];
    const { data, error: err } = await supabase
      .from('sacco_fixed_assets')
      .select('*')
      .eq('admin_id', adminId)
      .order(ordering.value, { ascending: ordering.ascending });
    if (err) throw err;
    return data || [];
  }, [adminId, ordering.value, ordering.ascending]);

  return {
    adminId,
    assets: pager.rows,
    pager,
    summary,
    summaryLoading,
    /** Whether a purchase can be capitalised — the chart of accounts is seeded. */
    canPost,
    error: error || pager.error,
    refresh,
    createAsset,
    updateAsset,
    disposeAsset,
    revalueAsset,
    deleteAsset,
    listDocuments,
    listEvents,
    uploadDocument,
    deleteDocument,
    fetchAllForExport,
  };
};

export default useAssetRegister;
