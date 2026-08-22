import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';
import { useAuthScopedLoader } from '../hooks/useAuthScopedLoader';
import { MODULE_KEYS, dependenciesOf, dependentsOf } from '../config/modules';

// Module-level counter, not Date.now(): React StrictMode mounts an effect twice
// and two channels with the same name crash the page.
let _modulesChannelSeq = 0;

const TenantModulesContext = createContext(null);

export const useModules = () => {
  const ctx = useContext(TenantModulesContext);
  if (!ctx) throw new Error('useModules must be used within TenantModulesProvider');
  return ctx;
};

/**
 * Which modules this tenant has switched on.
 *
 * Loaded once per signed-in user from public.my_tenant_modules(), which returns
 * one row per module in the catalogue with 'enabled' for anything the tenant
 * has no row for.
 *
 * FAILS OPEN, matching module_enabled() in the database: an unknown status
 * reads as enabled. This is a commercial gate, not a security boundary — the
 * database refuses writes into a frozen module regardless of what this context
 * believes, so the worst a failed load can do is show a nav item that then
 * refuses to save. The opposite default would black out a paying tenant's
 * portal over one failed request.
 */
export const TenantModulesProvider = ({ children }) => {
  const [statuses, setStatuses] = useState({});   // key -> { status, frozenReason, frozenAt }
  const [loading,  setLoading]  = useState(true);
  const [loadError, setLoadError] = useState(null);

  const reset = useCallback(() => {
    setStatuses({});
    setLoading(true);
    setLoadError(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('my_tenant_modules');
      if (error) throw error;

      const next = {};
      (data || []).forEach((row) => {
        next[row.module_key] = {
          status:       row.status,
          frozenReason: row.frozen_reason,
          frozenAt:     row.frozen_at,
        };
      });
      setStatuses(next);
      setLoadError(null);
    } catch (err) {
      // Not deployed yet, offline, or an RLS surprise. Leave statuses empty:
      // isEnabled() then reports everything enabled, which is the pre-modules
      // behaviour of the whole app.
      logger.warn('Module entitlements could not be loaded — all modules treated as on', {
        error: err?.message,
      });
      setLoadError(err?.message || 'Module list unavailable');
      setStatuses({});
    } finally {
      setLoading(false);
    }
  }, []);

  const userId = useAuthScopedLoader(load, reset);

  // A super admin freezing a module, or the tenant switching one on in another
  // tab, should take effect without a re-login.
  React.useEffect(() => {
    if (!userId) return undefined;
    const ch = supabase
      .channel(`tenant_modules_${++_modulesChannelSeq}`)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'tenant_modules' },
          () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  const isEnabled = useCallback(
    (key) => {
      if (!key) return true;                       // ungated
      const row = statuses[key];
      if (!row) return true;                       // fail open — see header
      return row.status === 'enabled';
    },
    [statuses],
  );

  const isFrozen = useCallback((key) => !isEnabled(key), [isEnabled]);

  const statusOf = useCallback(
    (key) => statuses[key] || { status: 'enabled', frozenReason: null, frozenAt: null },
    [statuses],
  );

  /** True when the tenant may lift this freeze themselves. */
  const canSelfEnable = useCallback(
    (key) => !['plan', 'admin'].includes(statuses[key]?.frozenReason),
    [statuses],
  );

  /**
   * Flip one module. The database is the authority: it re-checks the role, the
   * freeze reason and the dependency graph, so a rejection here is a real
   * rejection and not a UI opinion.
   */
  const setModule = useCallback(async (key, status) => {
    const { data, error } = await supabase.rpc('set_tenant_module', {
      p_module: key,
      p_status: status,
    });
    if (error) {
      logger.warn('Module switch refused', { key, status, error: error.message });
      return { error };
    }
    // Enabling pulls dependencies on server-side too — refetch rather than
    // guess which extra rows changed.
    await load();
    return { data };
  }, [load]);

  const value = useMemo(() => ({
    statuses,
    loading,
    loadError,
    isEnabled,
    isFrozen,
    statusOf,
    canSelfEnable,
    setModule,
    reload: load,
    // Convenience wrappers over the catalogue, bound to this tenant's statuses.
    enabledKeys: MODULE_KEYS.filter((k) => isEnabled(k)),
    // Enabled modules that would break if `key` were frozen — freezing is
    // refused while this is non-empty, server-side as well as here.
    blockersFor: (key) => dependentsOf(key, isEnabled),
    // Frozen modules that switching `key` on will switch on too.
    willAlsoEnable: (key) => dependenciesOf(key).filter((k) => !isEnabled(k)),
  }), [statuses, loading, loadError, isEnabled, isFrozen, statusOf, canSelfEnable, setModule, load]);

  return (
    <TenantModulesContext.Provider value={value}>
      {children}
    </TenantModulesContext.Provider>
  );
};

export default TenantModulesProvider;
