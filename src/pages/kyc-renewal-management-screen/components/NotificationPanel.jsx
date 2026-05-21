import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';

const notificationIcons = {
  approved:     { icon: 'CheckCircle2', color: '#22c55e' },
  rejected:     { icon: 'XCircle',      color: '#ef4444' },
  submitted:    { icon: 'Upload',        color: '#3b82f6' },
  under_review: { icon: 'Eye',           color: '#8b5cf6' },
  expiring:     { icon: 'Clock',         color: '#f59e0b' },
  message:      { icon: 'MessageSquare', color: '#06b6d4' },
  info:         { icon: 'Bell',          color: '#6b7280' },
};

const mapAuditToNotif = (row) => {
  const action = row.action || '';
  let type = 'info';
  if (action.includes('approved') || action === 'kyc_verification') type = 'approved';
  else if (action.includes('rejected')) type = 'rejected';
  else if (action.includes('submitted') || action === 'kyc_document_upload') type = 'submitted';
  else if (action.includes('under_review') || action === 'kyc_status_change') type = 'under_review';

  const created = new Date(row.created_at);
  const diffMin = Math.floor((Date.now() - created.getTime()) / 60000);
  const time =
    diffMin < 1     ? 'Just now' :
    diffMin < 60    ? `${diffMin} min ago` :
    diffMin < 1440  ? `${Math.floor(diffMin / 60)} hr ago` :
                      `${Math.floor(diffMin / 1440)} days ago`;

  const title = action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  return {
    id: row.id,
    type,
    title,
    message: row.description || 'KYC activity recorded',
    time,
    read: false,
  };
};

const NotificationPanel = () => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [inAppAlerts, setInAppAlerts] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, action, description, created_at')
        .in('action', ['kyc_document_upload', 'kyc_status_change', 'kyc_verification', 'kyc_renewal'])
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setNotifications((data || []).map(mapAuditToNotif));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();

    const channel = supabase
      .channel('kyc_notif_panel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, (payload) => {
        const action = payload?.new?.action || '';
        if (['kyc_document_upload', 'kyc_status_change', 'kyc_verification', 'kyc_renewal'].includes(action)) {
          setNotifications(prev => [mapAuditToNotif(payload.new), ...prev].slice(0, 20));
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [fetchNotifications]);

  const unread = notifications.filter(n => !n.read).length;

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  const markRead = (id) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">Notifications</h3>
          {unread > 0 && (
            <span className="flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-red-500 text-white">{unread}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button onClick={markAllRead} className="text-xs text-primary hover:underline">Mark all read</button>
          )}
          <button onClick={fetchNotifications} className="text-muted-foreground hover:text-foreground" title="Refresh">
            <Icon name="RefreshCw" size={13} color="currentColor" />
          </button>
        </div>
      </div>

      {/* Preferences */}
      <div className="p-3 bg-muted rounded-xl space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Alert Preferences</p>
        {[
          { label: 'Email Alerts', icon: 'Mail', state: emailAlerts, toggle: () => setEmailAlerts(v => !v) },
          { label: 'In-App Alerts', icon: 'Bell', state: inAppAlerts, toggle: () => setInAppAlerts(v => !v) },
        ].map(item => (
          <label key={item.label} className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-2">
              <Icon name={item.icon} size={14} color="var(--color-muted-foreground)" />
              <span className="text-sm text-foreground">{item.label}</span>
            </div>
            <button
              onClick={item.toggle}
              className={`relative w-10 h-5 rounded-full transition-colors ${item.state ? 'bg-primary' : 'bg-muted-foreground/30'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${item.state ? 'left-5' : 'left-0.5'}`} />
            </button>
          </label>
        ))}
      </div>

      {/* Notification list */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground gap-2 text-xs">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          Loading notifications...
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Icon name="Bell" size={28} color="currentColor" />
          <p className="text-sm mt-2">No KYC notifications yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Activity will appear here as KYC events happen</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(notif => {
            const cfg = notificationIcons[notif.type] || notificationIcons.info;
            return (
              <div
                key={notif.id}
                onClick={() => markRead(notif.id)}
                className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                  notif.read ? 'bg-card border border-border' : 'bg-primary/5 border border-primary/20'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <Icon name={cfg.icon} size={15} color={cfg.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground truncate">{notif.title}</p>
                    {!notif.read && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">{notif.time}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NotificationPanel;
