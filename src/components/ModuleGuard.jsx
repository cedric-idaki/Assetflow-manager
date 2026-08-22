import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './AppIcon';
import { useAuth, getRoleRedirectPath } from '../contexts/AuthContext';
import { useModules } from '../contexts/TenantModulesContext';
import { moduleByKey, moduleLabel } from '../config/modules';

/**
 * ModuleGuard wraps a route that belongs to an optional module and refuses it
 * while that module is frozen for this tenant.
 *
 * It sits INSIDE RoleGuard: role decides whether you are allowed near a page at
 * all, the module decides whether your organisation bought it. A frozen module
 * is not an error and not a 404 — the data is all still there — so this renders
 * an explanation and, for an admin who is allowed to lift the freeze, the
 * button that lifts it.
 *
 * Props:
 *   module — module key this route belongs to
 *   anyOf  — array of keys; the route opens if ANY of them is enabled. Used by
 *            pages that serve two modules at once (Assets & Clients).
 */
const ModuleGuard = ({ module, anyOf, children }) => {
  const { userProfile } = useAuth();
  const { isEnabled, loading, statusOf, canSelfEnable, setModule, willAlsoEnable } = useModules();

  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const keys = anyOf && anyOf.length ? anyOf : [module];
  const allowed = keys.some((k) => isEnabled(k));

  // Statuses arrive a beat after auth. Hold rather than flash the frozen
  // screen at somebody whose module is in fact switched on.
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm">Loading your modules...</span>
        </div>
      </div>
    );
  }

  if (allowed) return children;

  // ── Frozen ────────────────────────────────────────────────────────────────
  const key      = keys[0];
  const mod      = moduleByKey(key);
  const state    = statusOf(key);
  const role     = userProfile?.role;
  const isOwner  = role === 'admin' || role === 'sacco_admin' || role === 'super_admin';
  const lockedByPlatform = !canSelfEnable(key);
  // Dependencies that come on with it — set_tenant_module() enables these too,
  // so say so before the button is pressed rather than after.
  const alsoEnables = willAlsoEnable(key);

  const reasonText = {
    not_selected: 'This module was not selected when your organisation registered.',
    self:         'An administrator on your account switched this module off.',
    plan:         'This module is not part of your current subscription.',
    admin:        'This module has been suspended by the platform.',
  }[state.frozenReason] || 'This module is currently switched off for your account.';

  const enable = async () => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await setModule(key, 'enabled');
    setBusy(false);
    if (rpcError) setError(rpcError.message);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-sky-500/10 flex items-center justify-center">
          <Icon name={mod?.icon || 'Snowflake'} size={24} className="text-sky-500" />
        </div>

        <h1 className="text-lg font-semibold text-foreground">
          {moduleLabel(key)} is switched off
        </h1>

        <p className="text-sm text-muted-foreground">
          {reasonText}{' '}
          <span className="text-foreground">
            Nothing has been deleted — every record in this module is preserved and
            comes straight back the moment it is switched on again.
          </span>
        </p>

        {alsoEnables.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Switching it on also switches on: {alsoEnables.map(moduleLabel).join(', ')}.
          </p>
        )}

        {error && (
          <p className="text-sm text-red-500" role="alert">{error}</p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {isOwner && !lockedByPlatform && (
            <button
              onClick={enable}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Switching on...' : `Switch ${moduleLabel(key)} on`}
            </button>
          )}

          {isOwner && lockedByPlatform && (
            <span className="text-sm text-muted-foreground">
              Contact support to add this module to your plan.
            </span>
          )}

          {!isOwner && (
            <span className="text-sm text-muted-foreground">
              Ask your administrator to switch it on.
            </span>
          )}

          <Link
            to={getRoleRedirectPath(role)}
            className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted text-foreground"
          >
            Back to dashboard
          </Link>
        </div>

        {isOwner && (
          <Link to="/system-administration" className="text-xs text-primary hover:underline">
            Manage all modules
          </Link>
        )}
      </div>
    </div>
  );
};

export default ModuleGuard;
