import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatKEPhone } from '../../utils/phoneUtils';

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
  if (action.includes('payment'))                        type = 'payment';
  else if (action.includes('overdue'))                   type = 'overdue';
  else if (action.includes('approve') || action.includes('reject')) type = 'approval';
  else if (action.includes('kyc'))                       type = 'kyc';

  const diffMin = Math.floor((Date.now() - new Date(row.created_at)) / 60000);
  const time = diffMin < 1 ? 'Just now' : diffMin < 60 ? `${diffMin}m ago` : diffMin < 1440 ? `${Math.floor(diffMin/60)}h ago` : `${Math.floor(diffMin/1440)}d ago`;

  const cfg = NOTIF_ICONS[type] || NOTIF_ICONS.info;
  return {
    id: row.id, type, icon: cfg.icon, iconColor: cfg.color, iconBg: cfg.bg,
    title: action.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()),
    message: row.description || 'System activity recorded',
    time, read: false,
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
  const s = styles[role] || { bg: '#f3f4f6', color: '#6b7280', label: (role || 'Staff').replace(/_/g,' ') };
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: '10px', fontWeight: 700,
      padding: '2px 7px', borderRadius: '999px',
      fontFamily: 'Open Sans, sans-serif',
      textTransform: 'uppercase', letterSpacing: '0.04em',
      display: 'inline-block', marginTop: '2px',
    }}>
      {s.label}
    </span>
  );
};

var Header = function(props) {
  var onThemeToggle      = props.onThemeToggle;
  var isDarkMode         = props.isDarkMode || false;
  var onMobileMenuToggle = props.onMobileMenuToggle;
  var isMobileMenuOpen   = props.isMobileMenuOpen || false;

  var navigate    = useNavigate();
  var authContext = useAuth();
  var user        = authContext.user;
  var userProfile = authContext.userProfile;
  var signOut     = authContext.signOut;

  var [showNotif,    setShowNotif]    = useState(false);
  var [notifications, setNotifications] = useState([]);
  var [loadingNotif, setLoadingNotif] = useState(true);
  var [showUserMenu, setShowUserMenu] = useState(false);

  var notifRef   = useRef(null);
  var userRef    = useRef(null);
  var unread     = notifications.filter(n => !n.read).length;

  var fetchNotifs = useCallback(async function() {
    if (!user) return;
    setLoadingNotif(true);
    try {
      var r = await supabase
        .from('audit_logs')
        .select('id, action, description, severity, created_at')
        .order('created_at', { ascending: false })
        .limit(15);
      setNotifications((r.data || []).map(mapAuditToNotif));
    } catch (_) {}
    setLoadingNotif(false);
  }, [user]);

  useEffect(function() {
    fetchNotifs();
    var ch = supabase.channel('hdr_notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, fetchNotifs)
      .subscribe();
    return function() { supabase.removeChannel(ch); };
  }, [fetchNotifs]);

  useEffect(function() {
    var handler = function(e) {
      if (notifRef.current && !notifRef.current.contains(e.target))  setShowNotif(false);
      if (userRef.current  && !userRef.current.contains(e.target))   setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return function() { document.removeEventListener('mousedown', handler); };
  }, []);

  var markAllRead = function() { setNotifications(prev => prev.map(n => ({ ...n, read: true }))); };
  var markRead    = function(id) { setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n)); };

  var handleSignOut = async function() {
    setShowUserMenu(false);
    await signOut();
    navigate('/login');
  };

  var userName = userProfile?.full_name || user?.email?.split('@')[0] || 'User';
  var userRole = userProfile?.role || '';
  var initials = userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: '60px', zIndex: 30,
      background: B.bg,
      borderBottom: `1px solid ${B.border}`,
      boxShadow: '0 1px 4px rgba(12,32,55,0.07)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 12px',
    }}>
      {/* Left — hamburger + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={onMobileMenuToggle}
          className="lg:hidden"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '36px', height: '36px', borderRadius: '7px',
            border: `1px solid ${B.border}`, background: 'none', cursor: 'pointer',
            color: B.dark,
          }}
        >
          <Icon name={isMobileMenuOpen ? 'X' : 'Menu'} size={17} color="currentColor" />
        </button>

        <div className="hidden sm:flex items-center gap-2">
          <div style={{
            width: '28px', height: '28px', borderRadius: '6px',
            background: B.dark, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="Building2" size={14} color={B.accent} />
          </div>
          <span style={{
            fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '15px',
            color: B.dark, letterSpacing: '-0.01em',
          }}>
            AssetFlow
          </span>
          <span style={{ width: '1px', height: '14px', background: B.border, margin: '0 4px' }} />
          <span style={{ fontSize: '12px', color: B.muted, fontFamily: 'Open Sans, sans-serif' }}>
            Management Platform
          </span>
        </div>
      </div>

      {/* Right — actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>

        {/* Notification bell */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            onClick={function() { setShowNotif(!showNotif); setShowUserMenu(false); if (!showNotif) fetchNotifs(); }}
            style={{
              position: 'relative', width: '36px', height: '36px', borderRadius: '7px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: B.muted,
            }}
          >
            <Icon name="Bell" size={18} color="currentColor" />
            {unread > 0 && (
              <span style={{
                position: 'absolute', top: '5px', right: '5px',
                width: '16px', height: '16px', borderRadius: '50%',
                background: '#ef4444', color: '#fff',
                fontSize: '9px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {showNotif && (
            <div style={{
              position: 'absolute', right: 0, top: '46px',
              width: 'min(340px, calc(100vw - 24px))',
              background: B.bg, border: `1px solid ${B.border}`,
              borderRadius: '12px', boxShadow: '0 8px 24px rgba(12,32,55,0.14)',
              zIndex: 50, overflow: 'hidden',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${B.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: B.dark, fontFamily: 'Georgia, serif' }}>Notifications</span>
                  {unread > 0 && (
                    <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#ef4444', color: '#fff', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {unread}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {unread > 0 && (
                    <button onClick={markAllRead} style={{ fontSize: '11px', fontWeight: 600, color: B.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Open Sans, sans-serif' }}>
                      Mark all read
                    </button>
                  )}
                  <button onClick={fetchNotifs} style={{ background: 'none', border: 'none', cursor: 'pointer', color: B.muted, display: 'flex' }}>
                    <Icon name="RefreshCw" size={12} color="currentColor" />
                  </button>
                </div>
              </div>

              {/* List */}
              <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                {loadingNotif ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', gap: '8px', color: B.muted, fontSize: '13px', fontFamily: 'Open Sans, sans-serif' }}>
                    <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                    </svg>
                    Loading…
                  </div>
                ) : notifications.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px', color: B.muted }}>
                    <Icon name="Bell" size={24} color="currentColor" />
                    <p style={{ fontSize: '13px', marginTop: '8px', fontFamily: 'Open Sans, sans-serif' }}>No notifications yet</p>
                  </div>
                ) : notifications.map(function(n) {
                  return (
                    <button
                      key={n.id}
                      onClick={function() { markRead(n.id); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'flex-start', gap: '10px',
                        padding: '10px 16px', background: n.read ? 'transparent' : 'rgba(52,193,221,0.05)',
                        borderBottom: `1px solid ${B.border}`, cursor: 'pointer', border: 'none',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: n.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name={n.icon} size={14} color={n.iconColor} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <p style={{ fontSize: '12px', fontWeight: 600, color: B.dark, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'Open Sans, sans-serif' }}>{n.title}</p>
                          {!n.read && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: B.accent, flexShrink: 0 }} />}
                        </div>
                        <p style={{ fontSize: '11px', color: B.muted, marginTop: '2px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontFamily: 'Open Sans, sans-serif' }}>{n.message}</p>
                        <p style={{ fontSize: '10px', color: '#94a3b8', marginTop: '3px', fontFamily: 'Open Sans, sans-serif' }}>{n.time}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Footer */}
              <div style={{ padding: '10px 16px', borderTop: `1px solid ${B.border}`, textAlign: 'center' }}>
                <button style={{ fontSize: '12px', fontWeight: 600, color: B.dark, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Open Sans, sans-serif' }}>
                  View all activity
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <button
          onClick={onThemeToggle}
          className="hidden sm:flex"
          style={{
            width: '36px', height: '36px', borderRadius: '7px',
            alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer', color: B.muted,
          }}
        >
          <Icon name={isDarkMode ? 'Sun' : 'Moon'} size={17} color="currentColor" />
        </button>

        <div className="hidden sm:block" style={{ width: '1px', height: '20px', background: B.border, margin: '0 4px' }} />

        {/* User menu */}
        <div ref={userRef} style={{ position: 'relative' }}>
          <button
            onClick={function() { setShowUserMenu(!showUserMenu); setShowNotif(false); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '5px 8px', borderRadius: '8px',
              background: 'none', border: 'none', cursor: 'pointer',
            }}
          >
            {/* Avatar */}
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%',
              background: B.dark, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '13px', color: B.accent }}>
                {initials}
              </span>
            </div>
            <div className="hidden md:block" style={{ textAlign: 'left' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: B.dark, lineHeight: 1.2, fontFamily: 'Open Sans, sans-serif' }}>
                {userName}
              </p>
              <RoleBadge role={userRole} />
            </div>
            <Icon name="ChevronDown" size={13} color={B.muted} className="hidden md:block" />
          </button>

          {showUserMenu && (
            <div style={{
              position: 'absolute', right: 0, top: '46px',
              width: '200px', background: B.bg,
              border: `1px solid ${B.border}`, borderRadius: '10px',
              boxShadow: '0 8px 24px rgba(12,32,55,0.12)', zIndex: 50, overflow: 'hidden', paddingTop: '4px',
            }}>
              <div style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${B.border}` }}>
                <p style={{ fontSize: '13px', fontWeight: 700, color: B.dark, fontFamily: 'Georgia, serif' }}>{userName}</p>
                <p style={{ fontSize: '11px', color: B.muted, marginTop: '2px', fontFamily: 'Open Sans, sans-serif' }}>{user?.email}</p>
              </div>
              <button
                onClick={handleSignOut}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  width: '100%', padding: '10px 14px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#b91c1c', fontSize: '13px', fontFamily: 'Open Sans, sans-serif', fontWeight: 500,
                }}
              >
                <Icon name="LogOut" size={14} color="currentColor" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
