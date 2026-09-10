/**
 * useAssetValuation
 *
 * What the SACCO's assets are worth, and how much of that anybody has actually
 * checked.
 *
 * TWO SERVER AGGREGATES, NO CLIENT ARITHMETIC. Both figures come from
 * public.sacco_asset_valuation_totals() and
 * public.sacco_asset_valuation_by_category(), which aggregate every held asset
 * in Postgres. Nothing here reduces over a list of rows — useAssetRegister's
 * rows are one page of twenty-five, and a valuation computed from a page is a
 * valuation of a page. Same rule as sacco_dashboard_stats() and the register
 * summary; it is the one number a treasurer must never be shown wrong.
 *
 * THE TWO CALLS ARE INDEPENDENT ON PURPOSE. The totals are not "the category
 * rows, added up": the report's header has to be true even when the breakdown
 * fails, and the Overview tile wants the headline without paying for a
 * breakdown it does not render. Pass `categories: false` for that case.
 *
 * READ-ONLY. Recording a valuation is revalueAsset() in useAssetRegister, and
 * it deliberately does not post to the ledger — an upward revaluation is an
 * equity movement under IAS 16 and needs a treasurer's journal, not a side
 * effect of a report being opened.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

// Module-level counter, not Date.now(): StrictMode mounts effects twice and
// both runs can land in the same millisecond, and supabase.channel() hands back
// the already-subscribed channel for a name in use — which then throws when
// .on() is called on it. Same fix as useAssetRegister.
let _assetValuationChannelSeq = 0;

export const EMPTY_VALUATION_TOTALS = {
  heldAssets: 0,
  valuedAssets: 0,
  unvaluedAssets: 0,
  staleValuations: 0,
  totalCost: 0,
  totalDepreciation: 0,
  totalBookValue: 0,
  totalCurrentValue: 0,
  valuedCurrentValue: 0,
  valuedBookValue: 0,
  unvaluedBookValue: 0,
  revaluationDelta: 0,
  byBasis: {},
  lastValuedOn: null,
};

const n = (v) => {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mapTotals = (row) => ({
  heldAssets:         n(row.held_assets),
  valuedAssets:       n(row.valued_assets),
  unvaluedAssets:     n(row.unvalued_assets),
  staleValuations:    n(row.stale_valuations),
  totalCost:          n(row.total_cost),
  totalDepreciation:  n(row.total_depreciation),
  totalBookValue:     n(row.total_book_value),
  totalCurrentValue:  n(row.total_current_value),
  valuedCurrentValue: n(row.valued_current_value),
  valuedBookValue:    n(row.valued_book_value),
  unvaluedBookValue:  n(row.unvalued_book_value),
  revaluationDelta:   n(row.revaluation_delta),
  byBasis:            row.by_basis || {},
  lastValuedOn:       row.last_valued_on || null,
});

const mapCategory = (row) => ({
  category:           row.category || 'other',
  assetCount:         n(row.asset_count),
  valuedCount:        n(row.valued_count),
  staleCount:         n(row.stale_count),
  totalCost:          n(row.total_cost),
  totalDepreciation:  n(row.total_depreciation),
  totalBookValue:     n(row.total_book_value),
  totalCurrentValue:  n(row.total_current_value),
  valuedCurrentValue: n(row.valued_current_value),
  valuedBookValue:    n(row.valued_book_value),
  revaluationDelta:   n(row.revaluation_delta),
});

/**
 * @param {object}  options
 * @param {boolean} options.enabled     Skip the whole thing — for a caller whose
 *                                      tenant has the asset module frozen.
 * @param {boolean} options.categories  Load the per-category breakdown too.
 */
export const useAssetValuation = ({ enabled = true, categories = true } = {}) => {
  const [totals, setTotals] = useState(EMPTY_VALUATION_TOTALS);
  const [byCategory, setByCategory] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);

    // Settled, not all: a failed breakdown must not blank a header that loaded,
    // and a failed header must not hide a breakdown that did. Either half is
    // worth showing on its own; showing zeroes for the other half would read as
    // "you own nothing", which is the most alarming possible way to fail.
    const [totalsRes, categoryRes] = await Promise.allSettled([
      supabase.rpc('sacco_asset_valuation_totals'),
      categories ? supabase.rpc('sacco_asset_valuation_by_category') : Promise.resolve(null),
    ]);

    const problems = [];

    if (totalsRes.status === 'fulfilled' && !totalsRes.value?.error) {
      const data = totalsRes.value?.data;
      const row = Array.isArray(data) ? data[0] : data;
      setTotals(row ? mapTotals(row) : EMPTY_VALUATION_TOTALS);
    } else {
      const reason = totalsRes.reason?.message || totalsRes.value?.error?.message;
      logger.warn('Asset valuation totals unavailable', { error: reason });
      problems.push('the valuation totals');
      setTotals(EMPTY_VALUATION_TOTALS);
    }

    if (categories) {
      if (categoryRes.status === 'fulfilled' && !categoryRes.value?.error) {
        setByCategory((categoryRes.value?.data || []).map(mapCategory));
      } else {
        const reason = categoryRes.reason?.message || categoryRes.value?.error?.message;
        logger.warn('Asset valuation by category unavailable', { error: reason });
        problems.push('the category breakdown');
        setByCategory([]);
      }
    }

    setError(problems.length ? `Could not load ${problems.join(' or ')}.` : null);
    setLoadedAt(new Date());
    setLoading(false);
  }, [enabled, categories]);

  useEffect(() => { load(); }, [load]);

  // A ref so the realtime effect below does not resubscribe every time `load`
  // changes identity.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return undefined;
    const ch = supabase
      .channel(`asset_valuation_${++_assetValuationChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sacco_fixed_assets' },
          () => { loadRef.current(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled]);

  return { totals, byCategory, loading, error, loadedAt, refresh: load };
};

export default useAssetValuation;
