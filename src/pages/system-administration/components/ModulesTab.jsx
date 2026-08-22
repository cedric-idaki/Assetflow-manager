import React, { useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { useAuth } from '../../../contexts/AuthContext';
import { useModules } from '../../../contexts/TenantModulesContext';
import { modulesForScope, moduleLabel } from '../../../config/modules';

/**
 * The tenant's own switchboard: which modules this organisation is running.
 *
 * Freezing a module hides it from navigation, closes its pages, and makes the
 * database refuse manual writes to its tables. It does NOT delete anything —
 * every record stays exactly where it is and comes back untouched when the
 * module is switched on again. That promise is the whole point of the feature,
 * so this tab says it out loud before anyone switches anything off.
 *
 * A freeze the PLATFORM applied ('plan' — outside the subscription, 'admin' —
 * suspended) is not the tenant's to lift; the row explains that instead of
 * offering a switch that would be refused by set_tenant_module() anyway.
 */

const fmtWhen = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const REASON_TEXT = {
  not_selected: 'Not selected at registration',
  self:         'Switched off by an administrator',
  plan:         'Not included in your subscription',
  admin:        'Suspended by the platform',
};

const ModulesTab = () => {
  const { userProfile } = useAuth();
  const {
    loading, loadError, isEnabled, statusOf, canSelfEnable,
    setModule, blockersFor, willAlsoEnable, reload,
  } = useModules();

  const [busyKey, setBusyKey]   = useState(null);
  const [confirmKey, setConfirm] = useState(null);
  const [error, setError]       = useState('');
  const [notice, setNotice]     = useState('');

  const role = userProfile?.role;
  const canSwitch = role === 'admin' || role === 'sacco_admin' || role === 'super_admin';

  const scope = role === 'sacco_admin' ? 'sacco'
              : role === 'super_admin' ? 'custom'   // the whole catalogue
              : 'company';
  const modules = useMemo(() => modulesForScope(scope), [scope]);

  const apply = async (key, status) => {
    setBusyKey(key);
    setConfirm(null);
    setError('');
    setNotice('');

    const { error: rpcError } = await setModule(key, status);
    setBusyKey(null);

    if (rpcError) {
      setError(rpcError.message || 'That change could not be applied.');
      return;
    }
    setNotice(
      status === 'enabled'
        ? `${moduleLabel(key)} is on. Anything already recorded in it is back exactly as it was.`
        : `${moduleLabel(key)} is switched off. Its data is preserved and returns whenever you switch it on.`
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-sm">Loading modules...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Modules</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Switch off what you don't use and it disappears from the menu for everyone
            on this account. <span className="text-foreground font-medium">Nothing is deleted.</span>{' '}
            Records stay exactly where they are and come straight back when you switch
            the module on again.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          icon={<Icon name="RefreshCw" size={14} />}
        >
          Refresh
        </Button>
      </div>

      {loadError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Your module settings could not be loaded, so everything is showing as on.
          Changes made here may not save until this clears.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600" role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {modules.map((mod) => {
          const on       = isEnabled(mod.key);
          const state    = statusOf(mod.key);
          const blockers = on ? blockersFor(mod.key) : [];
          const alsoOn   = !on ? willAlsoEnable(mod.key) : [];
          const platformLocked = !on && !canSelfEnable(mod.key);
          const frozenOn = fmtWhen(state.frozenAt);

          // Why this row's switch is unavailable, if it is.
          const blockedBecause =
            mod.core            ? 'Always on — other modules read this one.'
          : !canSwitch          ? 'Only an administrator can change this.'
          : platformLocked      ? 'Contact support to add this to your plan.'
          : on && blockers.length
              ? `Switch off ${blockers.map(moduleLabel).join(', ')} first — ${blockers.length > 1 ? 'they depend' : 'it depends'} on this.`
          : null;

          return (
            <div
              key={mod.key}
              className={`rounded-lg border p-4 flex flex-col gap-3 ${
                on ? 'border-border bg-card' : 'border-border/60 bg-muted/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  on ? 'bg-primary/10' : 'bg-muted'
                }`}>
                  <Icon
                    name={mod.icon}
                    size={18}
                    className={on ? 'text-primary' : 'text-muted-foreground'}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${on ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {mod.label}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
                      on ? 'bg-emerald-500/15 text-emerald-600' : 'bg-sky-500/15 text-sky-600'
                    }`}>
                      {on ? 'On' : 'Off'}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground mt-1">{mod.desc}</p>

                  {!on && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {REASON_TEXT[state.frozenReason] || 'Switched off'}
                      {frozenOn ? ` · ${frozenOn}` : ''} · data preserved
                    </p>
                  )}
                </div>
              </div>

              {/* Action */}
              {confirmKey === mod.key ? (
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <p className="text-xs text-foreground">
                    Switch <strong>{mod.label}</strong> off? It leaves the menu for
                    everyone on this account and new entries are refused. Everything
                    already recorded stays, and returns the moment you switch it on.
                  </p>
                  <div className="flex gap-2">
                    <Button size="xs" variant="destructive" onClick={() => apply(mod.key, 'frozen')}>
                      Switch off
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 mt-auto">
                  <span className="text-xs text-muted-foreground flex-1 min-w-0">
                    {blockedBecause}
                    {!blockedBecause && !on && alsoOn.length > 0 &&
                      `Also switches on ${alsoOn.map(moduleLabel).join(', ')}.`}
                  </span>

                  {!mod.core && canSwitch && !platformLocked && (
                    <Button
                      size="xs"
                      variant={on ? 'outline' : 'primary'}
                      loading={busyKey === mod.key}
                      disabled={busyKey === mod.key || (on && blockers.length > 0)}
                      onClick={() => (on ? setConfirm(mod.key) : apply(mod.key, 'enabled'))}
                    >
                      {on ? 'Switch off' : 'Switch on'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ModulesTab;
