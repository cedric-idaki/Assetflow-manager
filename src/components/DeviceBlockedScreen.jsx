import React, { useState } from 'react';
import Icon from './AppIcon';
import { SLOT_LABELS, DEVICE_TYPE_LABELS, DEVICE_TYPE_ICONS } from '../utils/deviceIdentity';

/**
 * Shown instead of the app when the signed-in account has already used up the
 * slot this device would occupy (one mobile phone + one laptop/tablet).
 *
 * The session stays alive behind this screen on purpose: taking over the slot
 * and signing out are both authenticated actions, and a user whose phone was
 * lost or whose browser storage was cleared needs a way through that does not
 * involve waiting for an administrator.
 */
const fmtWhen = (iso) => {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const DeviceBlockedScreen = ({ deviceCheck, onClaim, onSignOut }) => {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const slotLabel  = SLOT_LABELS[deviceCheck?.slot] || 'device';
  const typeLabel  = DEVICE_TYPE_LABELS[deviceCheck?.deviceType] || 'device';
  const occupant   = deviceCheck?.occupiedBy;
  const remaining  = deviceCheck?.changesRemaining;
  const outOfSwaps = deviceCheck?.reason === 'change_limit_reached' || remaining === 0;

  const claim = async () => {
    setBusy(true);
    setError('');
    try {
      const verdict = await onClaim?.();
      // A rejection re-renders this screen with a fresh reason, so the only
      // thing to say here is the case where nothing came back at all.
      if (!verdict) setError('Could not switch devices. Please try again.');
    } catch (err) {
      setError(err?.message || 'Could not switch devices. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-card border border-border rounded-2xl overflow-hidden">

        <div className="px-6 py-5 border-b border-border flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <Icon name="ShieldAlert" size={22} color="#b45309" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">This device isn't registered</h1>
            <p className="text-xs text-muted-foreground">
              Your account allows one mobile phone and one laptop or tablet.
            </p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-sm text-muted-foreground">
            You're signing in from a <span className="font-medium text-foreground">{typeLabel.toLowerCase()}</span>,
            and the <span className="font-medium text-foreground">{slotLabel}</span> slot on your account is already taken.
          </p>

          {occupant && (
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-background border border-border flex items-center justify-center flex-shrink-0">
                <Icon name={DEVICE_TYPE_ICONS[occupant.deviceType] || 'Monitor'} size={17} color="#5a7185" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {occupant.deviceName || DEVICE_TYPE_LABELS[occupant.deviceType] || 'Registered device'}
                </p>
                <p className="text-xs text-muted-foreground">Last used {fmtWhen(occupant.lastSeenAt)}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium"
              style={{ background: '#fee2e2', color: '#b91c1c' }}>
              <Icon name="AlertTriangle" size={14} color="#b91c1c" />
              <span>{error}</span>
            </div>
          )}

          {outOfSwaps ? (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium"
              style={{ background: '#fef3c7', color: '#b45309' }}>
              <Icon name="Clock" size={14} color="#b45309" />
              <span>
                You've used all your device changes for the past 30 days. Ask your administrator
                to remove the old device from your account.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={claim}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon name="RefreshCw" size={15} color="currentColor" />
                {busy ? 'Switching…' : 'Use this device instead'}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                The device above will be signed out
                {typeof remaining === 'number' ? ` · ${remaining} device change${remaining === 1 ? '' : 's'} left this month` : ''}.
              </p>
            </div>
          )}

          <button
            onClick={onSignOut}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 bg-muted text-foreground px-4 py-2.5 rounded-lg text-sm font-medium border border-border hover:bg-muted/70 transition-colors disabled:opacity-50"
          >
            <Icon name="LogOut" size={15} color="currentColor" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeviceBlockedScreen;
