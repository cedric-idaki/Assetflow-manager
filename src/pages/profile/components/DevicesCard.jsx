import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { listDevices, revokeDevice, getChangesRemaining } from '../../../services/deviceService';
import { getDeviceId, DEVICE_TYPE_LABELS, DEVICE_TYPE_ICONS } from '../../../utils/deviceIdentity';

/**
 * "My devices" — the self-service half of the two-device rule. An account gets
 * one mobile phone and one laptop/tablet; this card shows which device holds
 * each slot and lets the owner free one.
 *
 * Removals are rate-limited server-side (public.device_changes_remaining), so
 * the card shows the remaining allowance rather than pretending removal is
 * free — otherwise "remove and re-add" would be an unlimited device pass.
 */

const SLOTS = [
  { id: 'mobile',   label: 'Mobile phone',     hint: 'Your phone',              icon: 'Smartphone' },
  { id: 'computer', label: 'Laptop or tablet', hint: 'One or the other, not both', icon: 'Laptop' },
];

const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const DevicesCard = () => {
  const [devices, setDevices]     = useState([]);
  const [remaining, setRemaining] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [busyId, setBusyId]       = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [msg, setMsg]             = useState(null);

  const thisDeviceId = getDeviceId();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ devices: rows, error }, quota] = await Promise.all([
      listDevices(),
      getChangesRemaining(),
    ]);
    setDevices((rows || []).filter((d) => !d.revoked_at));
    setRemaining(quota.changesRemaining);
    if (error) setMsg({ kind: 'error', text: 'Could not load your devices.' });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (device) => {
    setBusyId(device.id);
    setConfirmId(null);
    setMsg(null);
    const { revoked, reason, error } = await revokeDevice(device.id);
    setBusyId(null);

    if (error) {
      setMsg({ kind: 'error', text: error.message || 'Could not remove the device.' });
      return;
    }
    if (!revoked && reason === 'change_limit_reached') {
      setMsg({
        kind: 'warn',
        text: 'You have used all your device changes for the past 30 days. Ask your administrator to remove a device for you.',
      });
      return;
    }
    setMsg({
      kind: 'success',
      text: device.device_id === thisDeviceId
        ? 'This device was removed. You will be signed out of it shortly.'
        : 'Device removed. The slot is now free for a new one.',
    });
    load();
  };

  const bySlot = (slot) => devices.find((d) => d.device_slot === slot);

  const banner = msg && (() => {
    const styles = {
      success: { bg: '#dcfce7', color: '#15803d', icon: 'CheckCircle2' },
      error:   { bg: '#fee2e2', color: '#b91c1c', icon: 'AlertTriangle' },
      warn:    { bg: '#fef3c7', color: '#b45309', icon: 'AlertTriangle' },
    }[msg.kind];
    return (
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium mb-4"
        style={{ background: styles.bg, color: styles.color }}>
        <Icon name={styles.icon} size={14} color={styles.color} />
        <span>{msg.text}</span>
      </div>
    );
  })();

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(124,58,237,0.1)' }}>
            <Icon name="MonitorSmartphone" size={17} color="#7c3aed" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">My devices</h3>
            <p className="text-xs text-muted-foreground">
              One mobile phone and one laptop or tablet per account
            </p>
          </div>
        </div>
        {typeof remaining === 'number' && (
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
            style={{ background: remaining > 0 ? '#e8f0fe' : '#fef3c7', color: remaining > 0 ? '#1A56DB' : '#b45309' }}>
            <Icon name="RefreshCw" size={11} color={remaining > 0 ? '#1A56DB' : '#b45309'} />
            {remaining} change{remaining === 1 ? '' : 's'} left
          </span>
        )}
      </div>

      <div className="p-5">
        {banner}

        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Icon name="Loader" size={20} color="#9ca3af" className="mx-auto mb-2 animate-spin" />
            Loading your devices…
          </div>
        ) : (
          <div className="space-y-3">
            {SLOTS.map((slot) => {
              const device    = bySlot(slot.id);
              const isCurrent = device?.device_id === thisDeviceId;

              return (
                <div key={slot.id} className="rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-2 bg-muted/40 flex items-center gap-2">
                    <Icon name={slot.icon} size={13} color="#5a7185" />
                    <span className="text-xs font-semibold text-foreground">{slot.label}</span>
                    <span className="text-xs text-muted-foreground">· {slot.hint}</span>
                  </div>

                  {device ? (
                    <div className="px-4 py-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-background border border-border flex items-center justify-center flex-shrink-0">
                        <Icon name={DEVICE_TYPE_ICONS[device.device_type] || 'Monitor'} size={17} color="#5a7185" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground truncate">
                            {device.device_name || DEVICE_TYPE_LABELS[device.device_type] || 'Registered device'}
                          </p>
                          {isCurrent && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0"
                              style={{ background: '#dcfce7', color: '#15803d' }}>
                              This device
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {DEVICE_TYPE_LABELS[device.device_type] || device.device_type} · added {fmtWhen(device.first_seen_at)} · last used {fmtWhen(device.last_seen_at)}
                        </p>
                      </div>

                      {confirmId === device.id ? (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => remove(device)}
                            disabled={busyId === device.id}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                            style={{ background: '#b91c1c' }}
                          >
                            {busyId === device.id ? 'Removing…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-foreground hover:bg-muted"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setMsg(null); setConfirmId(device.id); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-foreground hover:bg-muted flex-shrink-0"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      No device registered — the next {slot.label.toLowerCase()} you sign in from takes this slot.
                    </div>
                  )}

                  {confirmId === device?.id && (
                    <div className="px-4 pb-3 text-xs text-muted-foreground">
                      {isCurrent
                        ? 'Removing the device you are using will sign you out of it. It costs one of your device changes.'
                        : 'That device will be signed out and the slot freed. It costs one of your device changes.'}
                    </div>
                  )}
                </div>
              );
            })}

            <p className="text-xs text-muted-foreground pt-1">
              Removing a device counts as a device change; you get 3 in any 30-day period.
              Changes made by your administrator don't count against that.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DevicesCard;
