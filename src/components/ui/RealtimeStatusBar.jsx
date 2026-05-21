import React from 'react';
import Icon from '../AppIcon';
import { formatKEPhone } from '../../utils/phoneUtils';

/**
 * RealtimeStatusBar
 * A slim top bar showing global real-time connection status.
 * Props:
 *   connectionStatus: 'connected' | 'connecting' | 'disconnected'
 *   lastUpdated: Date | null
 *   syncing: boolean
 *   label: string (optional, e.g. 'Dashboard' or 'Payments')
 */
const RealtimeStatusBar = ({ connectionStatus = 'connecting', lastUpdated, syncing, label }) => {
  const config = {
    connected: {
      bar: 'bg-emerald-500/8 border-emerald-500/15',
      dot: 'bg-emerald-500',
      text: 'text-emerald-600',
      icon: 'Wifi',
      label: 'Live',
      pulse: true,
    },
    connecting: {
      bar: 'bg-amber-500/8 border-amber-500/15',
      dot: 'bg-amber-500',
      text: 'text-amber-600',
      icon: 'WifiOff',
      label: 'Connecting...',
      pulse: true,
    },
    disconnected: {
      bar: 'bg-red-500/8 border-red-500/15',
      dot: 'bg-red-500',
      text: 'text-red-600',
      icon: 'WifiOff',
      label: 'Disconnected',
      pulse: false,
    },
  };

  const c = config?.[connectionStatus] || config?.connecting;

  const formatTime = (date) => {
    if (!date) return null;
    return date?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className={`flex items-center justify-between px-4 py-2 rounded-xl border ${c?.bar} mb-4`}>
      <div className="flex items-center gap-2">
        {/* Animated pulse dot */}
        <span className="relative flex h-2.5 w-2.5">
          {c?.pulse && connectionStatus === 'connected' && (
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c?.dot} opacity-50`} />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${c?.dot} ${connectionStatus === 'connecting' ? 'animate-pulse' : ''}`} />
        </span>
        <Icon name={c?.icon} size={13} color="currentColor" className={c?.text} />
        <span className={`text-xs font-semibold ${c?.text}`}>
          {label ? `${label} · ` : ''}{c?.label}
        </span>
        {syncing && (
          <span className="flex items-center gap-1 text-xs text-blue-500 font-medium">
            <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Syncing...
          </span>
        )}
      </div>
      {lastUpdated && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="Clock" size={11} color="currentColor" />
          <span>Updated {formatTime(lastUpdated)}</span>
        </div>
      )}
    </div>
  );
};

export default RealtimeStatusBar;
