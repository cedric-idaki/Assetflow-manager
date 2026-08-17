/**
 * useAgentCatalog
 *
 * The catalogue a sales agent can share from, plus the links they have already
 * sent and what those links did.
 *
 * Agents could always READ their tenant's assets — the assets_tenant_manage
 * policy (20260708150000) admits any staff member of the registrant's tenant —
 * they just had nowhere to see them. This hook is that missing half.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

// Sold and off-the-road items are not sendable; reserved ones are, because
// deals fall through and an agent wants a second buyer lined up.
const SHAREABLE_STATUSES = ['available', 'reserved'];

const CATALOG_COLUMNS = [
  'id', 'asset_code', 'asset_type', 'description', 'selling_price', 'asset_status',
  'location', 'make', 'model', 'year', 'color', 'property_type', 'property_size',
  'images', 'metadata', 'created_at',
].join(', ');

/** First usable image URL, whatever shape the row stores. */
export const firstImage = (asset) => {
  const list = Array.isArray(asset?.images) ? asset.images : [];
  for (const item of list) {
    const url = typeof item === 'string' ? item : (item?.url ?? item?.src);
    if (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) return url.trim();
  }
  return null;
};

export const useAgentCatalog = (agentProfile) => {
  const agentId = agentProfile?.id || null;

  const [assets,  setAssets]  = useState([]);
  const [links,   setLinks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchAssets = useCallback(async () => {
    // RLS (assets_tenant_staff) scopes this to the agent's own tenant via
    // assets.admin_id, so the catalogue can never list another company's stock.
    const { data, error: err } = await supabase
      .from('assets')
      .select(CATALOG_COLUMNS)
      .in('asset_status', SHAREABLE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(500);

    if (err) throw err;
    return data || [];
  }, []);

  const fetchLinks = useCallback(async (id) => {
    if (!id) return [];
    const { data, error: err } = await supabase
      .from('asset_share_links')
      .select(`
        id, token, asset_id, lead_id, recipient_name, recipient_phone, recipient_email,
        channel, note, is_active, expires_at, view_count, enquiry_count,
        first_viewed_at, last_viewed_at, created_at,
        asset:assets ( id, description, asset_type, selling_price, location, images, asset_status )
      `)
      .eq('agent_id', id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (err) throw err;
    return data || [];
  }, []);

  const refetch = useCallback(async () => {
    if (!agentId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [assetRows, linkRows] = await Promise.all([fetchAssets(), fetchLinks(agentId)]);
      setAssets(assetRows);
      setLinks(linkRows);
    } catch (err) {
      logger.error('[useAgentCatalog] load failed', { message: err?.message });
      setError(err?.message || 'Could not load the catalogue.');
    } finally {
      setLoading(false);
    }
  }, [agentId, fetchAssets, fetchLinks]);

  useEffect(() => { refetch(); }, [refetch]);

  // A link's counts change when a buyer opens it, which is exactly when the
  // agent is not looking at the tab. Keep them live.
  useEffect(() => {
    if (!agentId) return undefined;

    const channel = supabase
      .channel(`agent_share_links_${agentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'asset_share_links', filter: `agent_id=eq.${agentId}` },
        () => { fetchLinks(agentId).then(setLinks).catch(() => {}); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [agentId, fetchLinks]);

  /** Live links keyed by asset, so the grid can say "shared · 4 views". */
  const linksByAsset = useMemo(() => {
    const map = {};
    for (const link of links) {
      if (!link.is_active) continue;
      (map[link.asset_id] ||= []).push(link);
    }
    return map;
  }, [links]);

  const stats = useMemo(() => {
    const active = links.filter(l => l.is_active);
    return {
      linksShared:    links.length,
      activeLinks:    active.length,
      totalViews:     links.reduce((s, l) => s + (l.view_count || 0), 0),
      totalEnquiries: links.reduce((s, l) => s + (l.enquiry_count || 0), 0),
      // Links that were opened but produced nothing — the follow-up list.
      viewedNoEnquiry: active.filter(l => (l.view_count || 0) > 0 && !(l.enquiry_count || 0)).length,
    };
  }, [links]);

  return { assets, links, linksByAsset, stats, loading, error, refetch };
};

export default useAgentCatalog;
