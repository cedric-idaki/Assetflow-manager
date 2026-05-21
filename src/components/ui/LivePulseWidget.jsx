import React from 'react';
import { formatKEPhone } from '../../utils/phoneUtils';

/**
 * LivePulseWidget
 * Wraps any content with a live pulse indicator and last-updated timestamp.
 * Props:
 *   lastUpdated: Date | null
 *   syncing: boolean
 *   label: string (optional widget label)
 *   children: React.ReactNode
 *   className: string (optional)
 *   compact: boolean (show minimal indicator)
 */
const LivePulseWidget = ({ lastUpdated, syncing, label, children, className = '', compact = false }) => {
  const formatTime = (date) => {
    if (!date) return 'Never';
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 5) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    return date?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`relative ${className}`}>
      {children}
      {/* Live indicator overlay */}
      <div className={`absolute ${compact ? 'top-2 right-2' : 'bottom-2 right-2'} flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-card/90 border border-border/60 backdrop-blur-sm shadow-sm`}>
        {syncing ? (
          <>
            <svg className="animate-spin text-blue-500" width="9" height="9" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-[10px] font-medium text-blue-500">Updating</span>
          </>
        ) : (
          <>
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">
              {label ? `${label} · ` : ''}{formatTime(lastUpdated)}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export default LivePulseWidget;
