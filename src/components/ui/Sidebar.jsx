import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatKEPhone } from '../../utils/phoneUtils';

let _sidebarChannelSeq = 0;

/* Brand tokens */
const B = {
  dark:    '#0c2037',
  darkMid: '#112844',
  darkNav: '#0e2540',
  accent:  '#34c1dd',
  accentHover: '#20a8c5',
  textDim: '#6a8faa',
  textMid: '#a0c0d5',
  textBright: '#e2eef4',
  borderSubtle: 'rgba(52,193,221,0.15)',
  activeBg: 'rgba(52,193,221,0.12)',
  activeText: '#34c1dd',
};

var Sidebar = function(props) {
  var isCollapsed    = props.isCollapsed    || false;
  var onToggleCollapse = props.onToggleCollapse;
  var isMobileOpen   = props.isMobileOpen   || false;
  var onMobileClose  = props.onMobileClose;

  var location = useLocation();
  var authContext = useAuth();
  var user        = authContext.user;
  var userProfile = authContext.userProfile;
  var signOut     = authContext.signOut;

  var [pendingCount, setPendingCount] = useState(0);

  useEffect(function() {
    fetchPendingCount();
    var ch = supabase
      .channel(`sidebar_mcq_${++_sidebarChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maker_checker_queue' }, fetchPendingCount)
      .subscribe();
    return function() { supabase.removeChannel(ch); };
  }, []);

  var fetchPendingCount = async function() {
    try {
      var r = await supabase
        .from('maker_checker_queue')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'escalated']);
      setPendingCount(r.count || 0);
    } catch (_) {}
  };

  var role = userProfile ? userProfile.role : '';

  /* ── Navigation items per role ──────────────────────────────────────── */
  var superAdminItems = [
    { label: 'SA Dashboard',   path: '/super-admin-dashboard',         icon: 'Crown' },
    { label: 'Finance Hub',    path: '/finance-hub',                   icon: 'Landmark' },
    { label: 'POS / New Sale', path: '/pos',                           icon: 'ShoppingCart' },
    { label: 'E-Signature',    path: '/e-signature',                   icon: 'PenTool' },
    { label: 'Payments',       path: '/payment-collections-hub',       icon: 'CreditCard' },
    { label: 'KYC Management', path: '/kyc-management-screen',         icon: 'ShieldCheck' },
    { label: 'Reports',        path: '/reports-analytics-center',      icon: 'BarChart3' },
    { label: 'HR Management',  path: '/hr-management',                 icon: 'Users' },
    { label: 'Administration', path: '/system-administration',         icon: 'Settings', badge: pendingCount || null },
  ];

  var adminItems = [
    { label: 'Dashboard',        path: '/admin-dashboard',               icon: 'LayoutDashboard' },
    { label: 'Assets & Clients', path: '/asset-client-management',       icon: 'Briefcase' },
    { label: 'POS / New Sale',   path: '/pos',                           icon: 'ShoppingCart' },
    { label: 'E-Signature',       path: '/e-signature',                   icon: 'PenTool' },
    { label: 'Payments',         path: '/payment-collections-hub',       icon: 'CreditCard' },
    { label: 'KYC Management',   path: '/kyc-management-screen',         icon: 'ShieldCheck' },
    { label: 'Reports',          path: '/reports-analytics-center',      icon: 'BarChart3' },
    { label: 'HR Management',     path: '/hr-management',                 icon: 'Users' },
    { label: 'Staff & System',   path: '/system-administration',         icon: 'Settings', badge: pendingCount || null },
  ];

  var staffItems = [
    { label: 'Dashboard',        path: '/role-based-dashboard',    icon: 'LayoutDashboard' },
    { label: 'Assets & Clients', path: '/asset-client-management', icon: 'Briefcase' },
    { label: 'Payments',         path: '/payment-collections-hub', icon: 'CreditCard' },
    { label: 'KYC Management',   path: '/kyc-management-screen',   icon: 'ShieldCheck' },
    { label: 'Reports',          path: '/reports-analytics-center',icon: 'BarChart3' },
  ];

  // HR role: access is limited to the HR segment only.
  var hrItems = [
    { label: 'HR Management', path: '/hr-management', icon: 'Users' },
  ];

  var clientItems     = [
    { label: 'Overview',         path: '/client-portal',  icon: 'LayoutDashboard', tab: 'overview'   },
    { label: 'My Assets',        path: '/client-portal',  icon: 'Package',         tab: 'myassets'   },
    { label: 'Browse Assets',    path: '/client-portal',  icon: 'ShoppingBag',     tab: 'browse'     },
    { label: 'Payments',         path: '/client-portal',  icon: 'CreditCard',      tab: 'payments'   },
    { label: 'KYC Documents',    path: '/client-portal',  icon: 'Shield',          tab: 'kyc'        },
    { label: 'Document Centre',  path: '/client-portal',  icon: 'FolderOpen',      tab: 'documents'  },
    { label: 'Payment Schedule', path: '/client-portal',  icon: 'Calendar',        tab: 'schedule'   },
    { label: 'Settlement Quote', path: '/client-portal',  icon: 'Calculator',      tab: 'settlement' },
    { label: 'My Statement',     path: '/client-portal',  icon: 'FileText',        tab: 'statement'  },
    { label: 'Item Enquiry',     path: '/client-portal',  icon: 'Search',          tab: 'enquiry'    },
  ];
  var salesAgentItems = [
    { label: 'Sales Portal', path: '/sales-agent-portal', icon: 'TrendingUp' },
    { label: 'POS / New Sale', path: '/pos', icon: 'ShoppingCart' },
  ];

  // Sacco / Chama admin — the dashboard page carries its own tab bar
  // (Members, Contributions, Loans, Shares, Voting, Governance, Contracts,
  // Billing), so the sidebar only links to the dashboard itself.
  var saccoAdminItems = [
    { label: 'Dashboard',     path: '/sacco-dashboard', icon: 'LayoutDashboard' },
    // Shared back-office modules (same pages as a company admin; data stays
    // tenant-isolated). Sales agents are created under Staff & System.
    { label: 'E-Signature',   path: '/e-signature',           icon: 'PenTool' },
    { label: 'Finance Hub',   path: '/finance-hub',           icon: 'Landmark' },
    { label: 'HR Management', path: '/hr-management',         icon: 'UserCog' },
    { label: 'Staff & System', path: '/system-administration', icon: 'Settings', badge: pendingCount || null },
  ];

  // Sacco member — the portal page carries its own tab bar (contributions,
  // loans, shares, voting, contracts, documents, statement, profile).
  var saccoMemberItems = [
    { label: 'Member Portal', path: '/sacco-member-portal', icon: 'LayoutDashboard' },
  ];

  var navItems =
    role === 'super_admin'       ? superAdminItems :
    role === 'admin'             ? adminItems :
    role === 'hr'                ? hrItems :
    role === 'client'            ? clientItems :
    role === 'sacco_admin'       ? saccoAdminItems :
    role === 'sacco_member'      ? saccoMemberItems :
    (role === 'sales_agent' || role === 'sales') ? salesAgentItems :
    (role === 'director' || role === 'accountant' || role === 'collections_officer' ||
     role === 'manager'  || role === 'finance'    || role === 'operations')
                                 ? staffItems : adminItems;

  var isActive = function(path, tab) {
    if (!tab) return location.pathname === path;
    var params = new URLSearchParams(location.search);
    return location.pathname === path && (params.get('tab') === tab || (!params.get('tab') && tab === 'overview'));
  };
  var close    = function() { if (onMobileClose) onMobileClose(); };
  var signout  = async function() { close(); await signOut(); };

  var roleLabel = function(r) {
    return ({
      super_admin: 'System Owner', admin: 'Administrator',
      director: 'Director', accountant: 'Accountant',
      collections_officer: 'Collections', manager: 'Manager',
      finance: 'Finance', operations: 'Operations', hr: 'Human Resources',
      sales_agent: 'Sales Agent', sales: 'Sales Agent', client: 'Client',
      sacco_admin: 'Sacco Admin', sacco_member: 'Sacco Member',
    })[r] || (r || 'Staff').replace(/_/g, ' ');
  };

  var userName = userProfile?.full_name || user?.email?.split('@')[0] || 'User';

  return (
    <aside
      className={isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      style={{
        background: B.dark,
        borderRight: `1px solid ${B.borderSubtle}`,
        position: 'fixed', top: 0, left: 0, height: '100%', zIndex: 50,
        display: 'flex', flexDirection: 'column',
        width: isCollapsed ? '68px' : '240px',
        transition: 'transform 0.3s ease, width 0.3s ease',
      }}
    >
      {/* Top accent stripe */}
      <div style={{ height: '3px', background: `linear-gradient(90deg, ${B.accent}, ${B.accentHover}, ${B.accent})`, flexShrink: 0 }} />

      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', height: '64px', padding: '0 16px',
        borderBottom: `1px solid ${B.borderSubtle}`, flexShrink: 0,
        gap: isCollapsed ? 0 : '12px',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
      }}>
        {/* Icon mark */}
        <div style={{
          width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
          background: B.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="Building2" size={18} color={B.dark} />
        </div>

        {!isCollapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '16px', color: B.textBright, letterSpacing: '-0.01em' }}>
              AssetFlow
            </span>
            <p style={{ fontSize: '11px', color: B.accent, lineHeight: 1, marginTop: '2px', fontFamily: 'Open Sans, Arial, sans-serif' }}>
              {roleLabel(role)}
            </p>
          </div>
        )}

        {/* Mobile close */}
        {!isCollapsed && (
          <button onClick={close} className="ml-auto lg:hidden" style={{ color: B.textDim, background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="X" size={18} color="currentColor" />
          </button>
        )}
      </div>

      {/* Role badge — admin / super_admin */}
      {!isCollapsed && (role === 'super_admin' || role === 'admin') && (
        <div style={{
          margin: '10px 12px 0',
          padding: '5px 10px',
          borderRadius: '6px',
          background: 'rgba(52,193,221,0.1)',
          border: `1px solid ${B.borderSubtle}`,
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <Icon name={role === 'super_admin' ? 'Crown' : 'Building2'} size={12} color={B.accent} />
          <span style={{ fontSize: '11px', fontWeight: 600, color: B.accent, fontFamily: 'Open Sans, sans-serif', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {role === 'super_admin' ? 'Super Admin' : 'Admin'}
          </span>
        </div>
      )}

      {/* Navigation */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {navItems.map(function(item) {
          var active = isActive(item.path, item.tab);
          return (
            <Link
              key={item.path + (item.tab || '')}
              to={item.tab ? item.path + '?tab=' + item.tab : item.path}
              onClick={close}
              title={isCollapsed ? item.label : ''}
              style={{
                display: 'flex',
                alignItems: 'center',
                height: '40px',
                padding: '0 10px',
                borderRadius: '7px',
                textDecoration: 'none',
                gap: isCollapsed ? 0 : '10px',
                justifyContent: isCollapsed ? 'center' : 'flex-start',
                position: 'relative',
                transition: 'background 150ms ease',
                background: active ? B.activeBg : 'transparent',
                border: active ? `1px solid ${B.borderSubtle}` : '1px solid transparent',
              }}
            >
              <Icon name={item.icon} size={17} color={active ? B.accent : B.textDim} />
              {!isCollapsed && (
                <span style={{
                  fontSize: '13.5px',
                  fontWeight: active ? 600 : 400,
                  color: active ? B.accent : B.textMid,
                  flex: 1,
                  fontFamily: 'Open Sans, Arial, sans-serif',
                }}>
                  {item.label}
                </span>
              )}
              {/* Badge */}
              {!isCollapsed && item.badge > 0 && (
                <span style={{
                  minWidth: '18px', height: '18px', borderRadius: '9px',
                  background: '#ef4444', color: '#fff',
                  fontSize: '10px', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                }}>
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
              {isCollapsed && item.badge > 0 && (
                <span style={{
                  position: 'absolute', top: '4px', right: '4px',
                  width: '7px', height: '7px', borderRadius: '50%', background: '#ef4444',
                }} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom — user + signout */}
      <div style={{ padding: '10px 8px', borderTop: `1px solid ${B.borderSubtle}`, display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
        {!isCollapsed && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 10px', borderRadius: '7px',
            background: 'rgba(255,255,255,0.04)',
          }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
              background: B.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '13px', color: B.dark }}>
                {userName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '12px', fontWeight: 600, color: B.textBright, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'Open Sans, sans-serif' }}>
                {userName}
              </p>
              <p style={{ fontSize: '11px', color: B.accent, textTransform: 'capitalize', fontFamily: 'Open Sans, sans-serif' }}>
                {roleLabel(role)}
              </p>
            </div>
          </div>
        )}

        <button
          onClick={signout}
          title={isCollapsed ? 'Sign Out' : ''}
          style={{
            display: 'flex', alignItems: 'center', height: '36px',
            padding: '0 10px', borderRadius: '7px', width: '100%',
            gap: isCollapsed ? 0 : '10px',
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            color: B.textDim, background: 'none', border: 'none', cursor: 'pointer',
            transition: 'color 150ms ease',
            fontFamily: 'Open Sans, Arial, sans-serif', fontSize: '13px',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = B.textDim; e.currentTarget.style.background = 'none'; }}
        >
          <Icon name="LogOut" size={16} color="currentColor" />
          {!isCollapsed && <span>Sign Out</span>}
        </button>

        <button
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden lg:flex"
          style={{
            alignItems: 'center', height: '36px',
            padding: '0 10px', borderRadius: '7px', width: '100%',
            gap: isCollapsed ? 0 : '10px',
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            color: B.textDim, background: 'none', border: 'none', cursor: 'pointer',
            transition: 'color 150ms ease',
            fontFamily: 'Open Sans, Arial, sans-serif', fontSize: '13px',
          }}
        >
          <Icon name={isCollapsed ? 'ChevronRight' : 'ChevronLeft'} size={16} color="currentColor" />
          {!isCollapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
