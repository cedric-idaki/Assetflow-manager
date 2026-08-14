import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { listManagedDevices, revokeDevice } from '../../../services/deviceService';
import { DEVICE_TYPE_LABELS, DEVICE_TYPE_ICONS } from '../../../utils/deviceIdentity';

/**
 * Registered devices across the users this administrator is responsible for.
 *
 * Everyone gets two slots — one mobile phone, one laptop/tablet — and the cap
 * itself is a unique index in the database. What this tab adds is the escape
 * hatch: a user who has spent their three self-service device changes, or who
 * has lost the phone holding a slot, needs someone with authority to free it.
 * A removal made here does not count against the user's own allowance.
 *
 * The rows come straight from user_devices under RLS, so an admin sees their
 * own tenant and a super_admin sees the platform — no filtering happens here.
 */

// Sentence-case for the table column; SLOT_LABELS reads mid-sentence elsewhere.
const SLOT_COLUMN = { mobile: 'Mobile phone', computer: 'Laptop or tablet' };

const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const UserDevicesTab = () => {
  const [devices, setDevices]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [notice, setNotice]     = useState('');
  const [search, setSearch]     = useState('');
  const [slotFilter, setSlot]   = useState('all');
  const [busyId, setBusyId]     = useState(null);
  const [confirmId, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { devices: rows, error: loadError } = await listManagedDevices();
    setDevices(rows || []);
    setError(loadError ? 'Could not load registered devices.' : '');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (row) => {
    setBusyId(row.id);
    setConfirm(null);
    setNotice('');
    const { revoked, error: revokeError } = await revokeDevice(row.id);
    setBusyId(null);

    if (revokeError || !revoked) {
      setError(revokeError?.message || 'Could not remove that device.');
      return;
    }
    setError('');
    setNotice(`${row.device_name || 'Device'} removed from ${row.user?.full_name || 'the account'}. The slot is free.`);
    load();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (slotFilter !== 'all' && d.device_slot !== slotFilter) return false;
      if (!q) return true;
      return [d.user?.full_name, d.user?.email, d.device_name, d.device_type]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [devices, search, slotFilter]);

  // A user holding both slots is at their limit; worth surfacing, since that is
  // exactly who ends up asking an administrator for help.
  const atLimit = useMemo(() => {
    const bySlotCount = devices.reduce((acc, d) => {
      acc[d.user_id] = (acc[d.user_id] || 0) + 1;
      return acc;
    }, {});
    return Object.values(bySlotCount).filter((n) => n >= 2).length;
  }, [devices]);

  const stats = [
    { label: 'Registered devices', value: devices.length,                                        icon: 'MonitorSmartphone' },
    { label: 'Phones',             value: devices.filter((d) => d.device_slot === 'mobile').length,   icon: 'Smartphone' },
    { label: 'Laptops & tablets',  value: devices.filter((d) => d.device_slot === 'computer').length, icon: 'Laptop' },
    { label: 'Users at the limit', value: atLimit,                                               icon: 'ShieldCheck' },
  ];

  return (
    <div className="space-y-5">

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Registered devices</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Each account may use one mobile phone and one laptop or tablet. Remove a device here
            to free its slot — this doesn't use up the user's own device changes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}
          icon={<Icon name="RefreshCw" size={14} color="currentColor" />}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Icon name={s.icon} size={13} color="currentColor" />
              {s.label}
            </div>
            <div className="text-xl font-bold text-foreground">{s.value}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: '#fee2e2', color: '#b91c1c' }}>
          <Icon name="AlertTriangle" size={14} color="#b91c1c" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: '#dcfce7', color: '#15803d' }}>
          <Icon name="CheckCircle2" size={14} color="#15803d" />
          <span>{notice}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            type="search"
            placeholder="Search by user, email or device"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {[
            { id: 'all',      label: 'All' },
            { id: 'mobile',   label: 'Phones' },
            { id: 'computer', label: 'Laptops & tablets' },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSlot(opt.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                slotFilter === opt.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Icon name="Loader" size={20} color="#9ca3af" className="mx-auto mb-2 animate-spin" />
            Loading devices…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Icon name="MonitorSmartphone" size={28} color="#9ca3af" className="mx-auto mb-2" />
            {devices.length === 0 ? 'No devices registered yet.' : 'No devices match that search.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">User</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Device</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Slot</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Registered</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Last used</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{row.user?.full_name || 'Unknown user'}</p>
                      <p className="text-xs text-muted-foreground">{row.user?.email || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Icon name={DEVICE_TYPE_ICONS[row.device_type] || 'Monitor'} size={15} color="#5a7185" />
                        <div>
                          <p className="text-foreground">{row.device_name || 'Unnamed device'}</p>
                          <p className="text-xs text-muted-foreground">
                            {DEVICE_TYPE_LABELS[row.device_type] || row.device_type}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {SLOT_COLUMN[row.device_slot] || row.device_slot}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtWhen(row.first_seen_at)}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtWhen(row.last_seen_at)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {confirmId === row.id ? (
                        <div className="inline-flex items-center gap-2">
                          <Button variant="destructive" size="xs" loading={busyId === row.id}
                            onClick={() => remove(row)}>
                            Confirm
                          </Button>
                          <Button variant="outline" size="xs" onClick={() => setConfirm(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button variant="outline" size="xs" onClick={() => { setNotice(''); setConfirm(row.id); }}
                          icon={<Icon name="Trash2" size={13} color="currentColor" />}>
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserDevicesTab;
