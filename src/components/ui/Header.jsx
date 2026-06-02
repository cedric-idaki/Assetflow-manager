import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatKEPhone } from '../../utils/phoneUtils';

// Module-level counter — increments across ALL renders/remounts including StrictMode
// double-invoke, ensuring every channel subscription gets a truly unique name.
let _headerChannelSeq = 0;

/* Brand tokens */
const B = {
  dark:   '#0c2037',
  accent: '#34c1dd',
  border: '#d0dce6',
  text:   '#0c2037',
  muted:  '#5a7185',
  bg:     '#ffffff',
};

const NOTIF_ICONS = {
  payment:  { icon: 'CreditCard',    color: '#0b7a4e', bg: '#dcfce7' },
  overdue:  { icon: 'AlertTriangle', color: '#b91c1c', bg: '#fee2e2' },
  approval: { icon: 'CheckSquare',   color: '#1d4ed8', bg: '#dbeafe' },
  kyc:      { icon: 'ShieldCheck',   color: '#7c3aed', bg: '#ede9fe' },
  system:   { icon: 'Bell',          color: '#1d4ed8', bg: '#dbeafe' },
  info:     { icon: 'Info',          color: '#6b7280', bg: '#f3f4f6' },
};

const mapAuditToNotif = (row) => {
  const action = row.action || '';
  let type = 'info';
  if (action.includes('payment'))                           type = 'payment';
  else if (action.includes('overdue'))                      type = 'overdue';
  else if (action.includes('approve') || action.includes('reject')) type = 'approval';
  else if (action.includes('kyc'))                          type = 'kyc';

  const diffMin = Math.floor((Date.now() - new Date(row.created_at)) / 60000);
  const time =
    diffMin < 1    ? 'Just now'
    : diffMin < 60   ? `${diffMin}m ago`
    : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago`
    :                  `${Math.floor(diffMin / 1440)}d ago`;

  const cfg = NOTIF_ICONS[type] || NOTIF_ICONS.info;

  return {
    id:        row.id,
    type,
    icon:      cfg.icon,
    iconColor: cfg.color,
    iconBg:    cfg.bg,
    title:     action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    message:   row.description || 'System activity recorded',
    time,
    read:      false,
  };
};

const RoleBadge = ({ role }) => {
  const styles = {
    super_admin:         { bg: '#fef2f2', color: '#b91c1c', label: 'Super Admin' },
    admin:               { bg: '#eff6ff', color: '#1d4ed8', label: 'Admin' },
    director:            { bg: '#eef2ff', color: '#4338ca', label: 'Director' },
    accountant:          { bg: '#ecfeff', color: '#0891b2', label: 'Accountant' },
    collections_officer: { bg: '#fff7ed', color: '#c2410c', label: 'Collections' },
    manager:             { bg: '#f0fdfa', color: '#0d9488', label: 'Manager' },
    finance:             { bg: '#f0fdf4', color: '#15803d', label: 'Finance' },
    operations:          { bg: '#fefce8', color: '#a16207', label: 'Operations' },
    sales_agent:         { bg: '#ecfdf5', color: '#059669', label: 'Sales Agent' },
    client:              { bg: '#f5f3ff', color: '#7c3aed', label: 'Client' },
  };

  const s = styles[role] || {
    bg:    '#f3f4f6',
    color: '#6b7280',
    label: (role || 'Staff').replace(/_/g, ' '),
  };

  return (
    <span style={{
      background:    s.bg,
      color:         s.color,
      fontSize:      '10px',
      fontWeight:    700,
      padding:       '2px 7px',
      borderRadius:  '999px',
      textTransform: 'uppercase',
    }}>
      {s.label}
    </span>
  );
};

/* ─────────────────────────────────────────────────────────
   STALE-THRESHOLD (ms): only re-fetch on tab-return when
   data is older than this value.  Adjust to taste.
───────────────────────────────────────────────────────── */
const STALE_MS = 5 * 60 * 1000; // 5 minutes

const Header = function (props) {
  const { onThemeToggle, isDarkMode = false, onMobileMenuToggle, isMobileMenuOpen = false } = props;

  const navigate              = useNavigate();
  const { user, userProfile, signOut } = useAuth();

  const [showNotif,      setShowNotif]      = useState(false);
  const [notifications,  setNotifications]  = useState([]);
  const [loadingNotif,   setLoadingNotif]   = useState(true);
  const [showUserMenu,   setShowUserMenu]   = useState(false);

  const notifRef   = useRef(null);
  const userRef    = useRef(null);
  const lastFetch  = useRef(0);
  const channelRef = useRef(null);

  // ✅ Use primitive — avoids user-object identity causing dep churn
  const userId = user?.id;

  const unread = notifications.filter(n => !n.read).length;

  /* ── fetchNotifs ──────────────────────────────────────── */
  const fetchNotifs = useCallback(async function () {
    if (!userId) return;
    setLoadingNotif(true);
    try {
      const { data } = await supabase
        .from('audit_logs')
        .select('id, action, description, severity, created_at')
        .order('created_at', { ascending: false })
        .limit(15);

      setNotifications((data || []).map(mapAuditToNotif));
      lastFetch.current = Date.now();
    } catch (_) {
      // silently swallow – non-critical
    } finally {
      setLoadingNotif(false);
    }
  }, [userId]);

  // Keep a ref to fetchNotifs so the realtime callback always calls the latest version
  // without needing to recreate the channel subscription
  const fetchNotifsRef = useRef(fetchNotifs);
  useEffect(() => { fetchNotifsRef.current = fetchNotifs; }, [fetchNotifs]);

  /* ── Realtime subscription + initial fetch ─────────────── */
  useEffect(function () {
    if (!userId) return;

    // Initial load
    fetchNotifsRef.current();

    // Use a globally unique channel name — module-level counter ensures
    // StrictMode's double-invoke never reuses the same name on a still-subscribed channel
    const channelName = `hdr_notifs_${userId}_${++_headerChannelSeq}`;

    const channel = supabase
      .channel(channelName, { config: { broadcast: { self: false } } })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_logs' },
        () => fetchNotifsRef.current()
      )
      .subscribe();

    channelRef.current = channel;

    /* ── Visibility guard ──────────────────────────────────
       Only re-fetch when the tab becomes visible AND the
       cached data is older than STALE_MS.
    ─────────────────────────────────────────────────────── */
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastFetch.current > STALE_MS
      ) {
        fetchNotifsRef.current();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return function () {
      supabase.removeChannel(channel);
      channelRef.current = null;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [userId]); // only re-run when the user changes (login/logout)

  /* ── Click-outside handler for dropdowns ──────────────── */
  useEffect(function () {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotif(false);
      if (userRef.current  && !userRef.current.contains(e.target))  setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── Notification helpers ─────────────────────────────── */
  const markAllRead = () =>
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  const markRead = (id) =>
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );

  /* ── Sign-out ─────────────────────────────────────────── */
  const handleSignOut = async () => {
    setShowUserMenu(false);
    await signOut();
    navigate('/login');
  };

  /* ── Derived display values ───────────────────────────── */
  const userName = userProfile?.full_name || user?.email?.split('@')[0] || 'User';
  const userRole = userProfile?.role || '';
  const initials = userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  /* ── Render ───────────────────────────────────────────── */
  return (
    <header style={{
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'space-between',
      padding:         '0 24px',
      height:          '64px',
      background:      B.bg,
      borderBottom:    `1px solid ${B.border}`,
      position:        'sticky',
      top:             0,
      
    }}>

      {/* ── Left: mobile hamburger + brand ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={onMobileMenuToggle}
          style={{
            display:    'flex',
            alignItems: 'center',
            background: 'none',
            border:     'none',
            cursor:     'pointer',
            padding:    '6px',
            color:      B.muted,
          }}
          aria-label="Toggle menu"
        >
          <Icon name={isMobileMenuOpen ? 'X' : 'Menu'} size={20} />
        </button>

        <span style={{ fontWeight: 700, fontSize: '18px', color: B.dark, letterSpacing: '-0.3px' }}>
          Dashboard
        </span>
      </div>

      {/* ── Right: notifications + user menu ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>

        {/* Theme toggle */}
        <button
          onClick={onThemeToggle}
          style={{
            background: 'none',
            border:     'none',
            cursor:     'pointer',
            padding:    '8px',
            color:      B.muted,
            borderRadius: '8px',
          }}
          aria-label="Toggle theme"
        >
          <Icon name={isDarkMode ? 'Sun' : 'Moon'} size={18} />
        </button>

        {/* ── Notifications bell ── */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowNotif(v => !v)}
            style={{
              position:     'relative',
              background:   'none',
              border:       'none',
              cursor:       'pointer',
              padding:      '8px',
              color:        B.muted,
              borderRadius: '8px',
            }}
            aria-label="Notifications"
          >
            <Icon name="Bell" size={18} />
            {unread > 0 && (
              <span style={{
                position:   'absolute',
                top:        '4px',
                right:      '4px',
                background: '#ef4444',
                color:      '#fff',
                fontSize:   '9px',
                fontWeight: 700,
                minWidth:   '16px',
                height:     '16px',
                borderRadius: '999px',
                display:    'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding:    '0 3px',
              }}>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {/* Notifications dropdown */}
          {showNotif && (
            <div style={{
              position:     'absolute',
              top:          'calc(100% + 8px)',
              right:        0,
              width:        '360px',
              background:   B.bg,
              border:       `1px solid ${B.border}`,
              borderRadius: '12px',
              boxShadow:    '0 8px 32px rgba(12,32,55,0.12)',
              zIndex:       200,
              overflow:     'hidden',
            }}>
              {/* Header */}
              <div style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
                padding:        '14px 16px',
                borderBottom:   `1px solid ${B.border}`,
              }}>
                <span style={{ fontWeight: 700, fontSize: '14px', color: B.text }}>
                  Notifications {unread > 0 && (
                    <span style={{
                      background: '#ef4444',
                      color: '#fff',
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '999px',
                      marginLeft: '6px',
                    }}>{unread}</span>
                  )}
                </span>
                {unread > 0 && (
                  <button
                    onClick={markAllRead}
                    style={{
                      background: 'none',
                      border:     'none',
                      cursor:     'pointer',
                      fontSize:   '12px',
                      color:      B.accent,
                      fontWeight: 600,
                    }}
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {/* List */}
              <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                {loadingNotif ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: B.muted, fontSize: '13px' }}>
                    Loading…
                  </div>
                ) : notifications.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: B.muted, fontSize: '13px' }}>
                    No notifications yet
                  </div>
                ) : (
                  notifications.map(n => (
                    <div
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      style={{
                        display:    'flex',
                        gap:        '12px',
                        padding:    '12px 16px',
                        cursor:     'pointer',
                        background: n.read ? 'transparent' : '#f0f9ff',
                        borderBottom: `1px solid ${B.border}`,
                        transition: 'background 0.15s',
                      }}
                    >
                      <div style={{
                        width:        '36px',
                        height:       '36px',
                        borderRadius: '8px',
                        background:   n.iconBg,
                        display:      'flex',
                        alignItems:   'center',
                        justifyContent: 'center',
                        flexShrink:   0,
                      }}>
                        <Icon name={n.icon} size={16} color={n.iconColor} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: B.text }}>{n.title}</div>
                        <div style={{
                          fontSize:     '12px',
                          color:        B.muted,
                          marginTop:    '2px',
                          whiteSpace:   'nowrap',
                          overflow:     'hidden',
                          textOverflow: 'ellipsis',
                        }}>{n.message}</div>
                        <div style={{ fontSize: '11px', color: B.accent, marginTop: '4px' }}>{n.time}</div>
                      </div>
                      {!n.read && (
                        <div style={{
                          width:        '8px',
                          height:       '8px',
                          borderRadius: '50%',
                          background:   B.accent,
                          flexShrink:   0,
                          marginTop:    '4px',
                        }} />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── User menu ── */}
        <div ref={userRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowUserMenu(v => !v)}
            style={{
              display:      'flex',
              alignItems:   'center',
              gap:          '8px',
              background:   'none',
              border:       `1px solid ${B.border}`,
              borderRadius: '8px',
              cursor:       'pointer',
              padding:      '6px 10px',
            }}
          >
            {/* Avatar */}
            <div style={{
              width:          '30px',
              height:         '30px',
              borderRadius:   '50%',
              background:     B.dark,
              color:          '#fff',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              fontSize:       '11px',
              fontWeight:     700,
              letterSpacing:  '0.5px',
            }}>
              {initials}
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: B.text, lineHeight: 1.2 }}>{userName}</div>
              <RoleBadge role={userRole} />
            </div>
            <Icon name="ChevronDown" size={14} color={B.muted} />
          </button>

          {/* User dropdown */}
          {showUserMenu && (
            <div style={{
              position:     'absolute',
              top:          'calc(100% + 8px)',
              right:        0,
              width:        '220px',
              background:   B.bg,
              border:       `1px solid ${B.border}`,
              borderRadius: '10px',
              boxShadow:    '0 8px 24px rgba(12,32,55,0.10)',
              zIndex:       200,
              overflow:     'hidden',
            }}>
              {/* Profile info */}
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${B.border}` }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: B.text }}>{userName}</div>
                <div style={{ fontSize: '12px', color: B.muted, marginTop: '2px' }}>{user?.email}</div>
                {userProfile?.phone && (
                  <div style={{ fontSize: '12px', color: B.muted, marginTop: '2px' }}>
                    {formatKEPhone(userProfile.phone)}
                  </div>
                )}
              </div>

              {/* Menu items */}
              {[
                { icon: 'User',     label: 'My Profile',   action: () => { setShowUserMenu(false); navigate('/profile'); } },
                { icon: 'Settings', label: 'Settings',     action: () => { setShowUserMenu(false); navigate('/settings'); } },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.action}
                  style={{
                    display:    'flex',
                    alignItems: 'center',
                    gap:        '10px',
                    width:      '100%',
                    padding:    '11px 16px',
                    background: 'none',
                    border:     'none',
                    cursor:     'pointer',
                    fontSize:   '13px',
                    color:      B.text,
                    textAlign:  'left',
                  }}
                >
                  <Icon name={item.icon} size={15} color={B.muted} />
                  {item.label}
                </button>
              ))}

              <div style={{ borderTop: `1px solid ${B.border}` }}>
                <button
                  onClick={handleSignOut}
                  style={{
                    display:    'flex',
                    alignItems: 'center',
                    gap:        '10px',
                    width:      '100%',
                    padding:    '11px 16px',
                    background: 'none',
                    border:     'none',
                    cursor:     'pointer',
                    fontSize:   '13px',
                    color:      '#ef4444',
                    textAlign:  'left',
                  }}
                >
                  <Icon name="LogOut" size={15} color="#ef4444" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
