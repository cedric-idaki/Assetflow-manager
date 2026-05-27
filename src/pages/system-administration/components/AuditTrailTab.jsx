import React, { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { auditLogsService } from '../../../services/supabaseService';
import { supabase } from '../../../lib/supabase';

let _auditTrailChannelSeq = 0;

// ── Action type → badge config ──────────────────────────────────────────────
const ACTION_BADGE = {
  // User management
  user_created:         { label: 'User Added',    bg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  user_updated:         { label: 'User Edited',   bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  user_deactivated:     { label: 'Deactivated',   bg: 'bg-red-500/15 text-red-400 border-red-500/30' },
  user_activated:       { label: 'Activated',     bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  user_deleted:         { label: 'User Deleted',  bg: 'bg-red-500/15 text-red-400 border-red-500/30' },
  // Data actions
  restored:             { label: 'Restored',      bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  amended:              { label: 'Amended',       bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  // KYC
  kyc_document_upload:  { label: 'KYC Upload',   bg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  kyc_status_change:    { label: 'KYC Status',   bg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  kyc_renewal:          { label: 'KYC Renewal',  bg: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  kyc_verification:     { label: 'KYC Verify',   bg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  // Payment
  payment_created:      { label: 'Payment',      bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  payment_updated:      { label: 'Payment',      bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  payment_failed:       { label: 'Payment Fail', bg: 'bg-red-500/15 text-red-400 border-red-500/30' },
  // Approval
  approve:              { label: 'Approval',     bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  reject:               { label: 'Rejection',    bg: 'bg-red-500/15 text-red-400 border-red-500/30' },
  // Role
  role_change:          { label: 'Role Change',  bg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  create:               { label: 'Create',       bg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  update:               { label: 'Update',       bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  delete:               { label: 'Delete',       bg: 'bg-red-500/15 text-red-400 border-red-500/30' },
  // Debt
  debt_adjustment:      { label: 'Debt Adj.',    bg: 'bg-pink-500/15 text-pink-400 border-pink-500/30' },
  // Auth
  login:                { label: 'Login',        bg: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  logout:               { label: 'Logout',       bg: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
};

const getActionBadge = (action) =>
  ACTION_BADGE?.[action] || { label: action, bg: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };

// ── Icon map ─────────────────────────────────────────────────────────────────
const actionIconMap = {
  // User management
  user_created:         { icon: 'UserPlus',     color: 'bg-blue-500/10 text-blue-500' },
  user_updated:         { icon: 'UserCog',      color: 'bg-amber-500/10 text-amber-500' },
  user_deactivated:     { icon: 'UserX',        color: 'bg-red-500/10 text-red-500' },
  user_activated:       { icon: 'UserCheck',    color: 'bg-emerald-500/10 text-emerald-500' },
  user_deleted:         { icon: 'Trash2',       color: 'bg-red-500/10 text-red-500' },
  restored:             { icon: 'RotateCcw',    color: 'bg-emerald-500/10 text-emerald-500' },
  amended:              { icon: 'FilePen',      color: 'bg-amber-500/10 text-amber-500' },
  // General
  login:                { icon: 'LogIn',        color: 'bg-emerald-500/10 text-emerald-500' },
  logout:               { icon: 'LogOut',       color: 'bg-slate-500/10 text-slate-500' },
  create:               { icon: 'Plus',         color: 'bg-blue-500/10 text-blue-500' },
  update:               { icon: 'Edit',         color: 'bg-amber-500/10 text-amber-500' },
  delete:               { icon: 'Trash2',       color: 'bg-red-500/10 text-red-500' },
  approve:              { icon: 'CheckCircle',  color: 'bg-emerald-500/10 text-emerald-500' },
  reject:               { icon: 'XCircle',      color: 'bg-red-500/10 text-red-500' },
  view:                 { icon: 'Eye',          color: 'bg-blue-500/10 text-blue-500' },
  kyc_document_upload:  { icon: 'Upload',       color: 'bg-blue-500/10 text-blue-500' },
  kyc_status_change:    { icon: 'RefreshCw',    color: 'bg-amber-500/10 text-amber-500' },
  kyc_renewal:          { icon: 'RotateCcw',    color: 'bg-orange-500/10 text-orange-500' },
  kyc_verification:     { icon: 'ShieldCheck',  color: 'bg-emerald-500/10 text-emerald-500' },
  payment_created:      { icon: 'CreditCard',   color: 'bg-emerald-500/10 text-emerald-500' },
  payment_updated:      { icon: 'CreditCard',   color: 'bg-amber-500/10 text-amber-500' },
  payment_failed:       { icon: 'AlertCircle',  color: 'bg-red-500/10 text-red-500' },
  role_change:          { icon: 'UserCog',      color: 'bg-blue-500/10 text-blue-500' },
  debt_adjustment:      { icon: 'TrendingDown', color: 'bg-pink-500/10 text-pink-500' },
};

const kycActions = ['kyc_document_upload', 'kyc_status_change', 'kyc_renewal', 'kyc_verification'];

const actionOptions = [
  { value: 'all',              label: 'All Actions' },
  { value: 'user_created',     label: 'User Added' },
  { value: 'user_updated',     label: 'User Edited' },
  { value: 'user_deactivated', label: 'User Deactivated' },
  { value: 'user_activated',   label: 'User Activated' },
  { value: 'user_deleted',     label: 'User Deleted' },
  { value: 'restored',         label: 'Restored' },
  { value: 'amended',          label: 'Amended' },
  { value: 'create',           label: 'Create' },
  { value: 'update',           label: 'Update' },
  { value: 'delete',           label: 'Delete' },
  { value: 'login',            label: 'Login' },
  { value: 'logout',           label: 'Logout' },
  { value: 'approve',          label: 'Approve' },
  { value: 'reject',           label: 'Reject' },
  { value: 'kyc_document_upload', label: 'KYC Document Upload' },
  { value: 'kyc_status_change',   label: 'KYC Status Change' },
  { value: 'kyc_renewal',         label: 'KYC Renewal' },
  { value: 'kyc_verification',    label: 'KYC Verification' },
];

// ── Severity badge ────────────────────────────────────────────────────────────
const getSeverityBadge = (severity) => {
  const map = {
    info:     'bg-blue-500/10 text-blue-500',
    warning:  'bg-amber-500/10 text-amber-500',
    error:    'bg-red-500/10 text-red-500',
    critical: 'bg-red-600/10 text-red-600',
  };
  return map?.[severity] || map?.info;
};

// ── Change diff renderer ──────────────────────────────────────────────────────
const renderDiff = (log) => {
  const old_v = log?.old_values;
  const new_v = log?.new_values;
  if (!old_v || !new_v) return null;

  const changes = Object.keys(new_v).filter(k => old_v[k] !== new_v[k]);
  if (changes.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      {changes.map(k => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground capitalize">{k.replace(/_/g, ' ')}:</span>
          <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 line-through">{String(old_v[k])}</span>
          <Icon name="ArrowRight" size={10} color="currentColor" />
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">{String(new_v[k])}</span>
        </div>
      ))}
    </div>
  );
};

// ── Metadata renderer ─────────────────────────────────────────────────────────
const renderMetadata = (log) => {
  const meta = log?.metadata;
  if (!meta) return null;
  const action = log?.action;

  if (action === 'kyc_document_upload') {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {meta?.document_type && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-medium">
            <Icon name="FileText" size={10} color="currentColor" />{meta.document_type}
          </span>
        )}
        {meta?.file_name && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            <Icon name="Paperclip" size={10} color="currentColor" />{meta.file_name}
          </span>
        )}
        {meta?.file_size && <span className="text-xs text-muted-foreground">{meta.file_size}</span>}
      </div>
    );
  }

  if (action === 'kyc_status_change' || action === 'kyc_verification') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {meta?.previous_status && (
          <>
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{meta.previous_status}</span>
            <Icon name="ArrowRight" size={12} color="var(--color-muted-foreground)" />
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
              meta?.new_status === 'verified' ? 'bg-emerald-500/10 text-emerald-500' :
              meta?.new_status === 'rejected' ? 'bg-red-500/10 text-red-500' :
              meta?.new_status === 'pending'  ? 'bg-amber-500/10 text-amber-500' : 'bg-muted text-muted-foreground'
            }`}>{meta.new_status}</span>
          </>
        )}
        {meta?.approver_notes && <span className="text-xs text-muted-foreground italic">· "{meta.approver_notes}"</span>}
        {meta?.reason && <span className="text-xs text-muted-foreground italic">· {meta.reason}</span>}
      </div>
    );
  }

  if (action === 'kyc_renewal') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {meta?.document_type && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-500 font-medium">
            <Icon name="FileText" size={10} color="currentColor" />{meta.document_type}
          </span>
        )}
        {meta?.expiry_date && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Icon name="Calendar" size={10} color="currentColor" />Expires: {meta.expiry_date}
          </span>
        )}
        {meta?.days_until_expiry !== undefined && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            meta.days_until_expiry <= 30 ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'
          }`}>{meta.days_until_expiry} days left</span>
        )}
      </div>
    );
  }

  return null;
};

// ── Main component ────────────────────────────────────────────────────────────
const AuditTrailTab = () => {
  const [searchQuery, setSearchQuery]     = useState('');
  const [filterAction, setFilterAction]   = useState('all');
  const [auditLogs, setAuditLogs]         = useState([]);
  const [loading, setLoading]             = useState(true);
  const [expandedLog, setExpandedLog]     = useState(null);

  const [liveEnabled, setLiveEnabled]     = useState(true);
  const [paused, setPaused]               = useState(false);
  const [autoScroll, setAutoScroll]       = useState(true);
  const [connStatus, setConnStatus]       = useState('connecting');
  const [newEntryIds, setNewEntryIds]     = useState(new Set());
  const [recentCount, setRecentCount]     = useState(0);
  const [pendingBuffer, setPendingBuffer] = useState([]);

  const listRef    = useRef(null);
  const channelRef = useRef(null);
  const recentRef  = useRef([]);

  // ── Load initial logs ───────────────────────────────────────────────────────
  const loadAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const filters = filterAction !== 'all' ? { action: filterAction } : {};
      const data = await auditLogsService?.getAll(filters);
      setAuditLogs(data || []);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [filterAction]);

  useEffect(() => { loadAuditLogs(); }, [loadAuditLogs]);

  // ── Live counter ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      recentRef.current = recentRef?.current?.filter(t => now - t < 60_000);
      setRecentCount(recentRef?.current?.length);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Flush pending buffer when unpaused ──────────────────────────────────────
  useEffect(() => {
    if (!paused && pendingBuffer?.length > 0) {
      setAuditLogs(prev => {
        const ids = new Set(prev.map(l => l.id));
        const fresh = pendingBuffer?.filter(l => !ids?.has(l?.id));
        return [...fresh, ...prev];
      });
      const ids = new Set(pendingBuffer.map(l => l.id));
      setNewEntryIds(prev => new Set([...prev, ...ids]));
      setPendingBuffer([]);
      setTimeout(() => setNewEntryIds(prev => {
        const next = new Set(prev);
        ids?.forEach(id => next?.delete(id));
        return next;
      }), 3000);
    }
  }, [paused, pendingBuffer]);

  // ── Realtime channel ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!liveEnabled) {
      if (channelRef?.current) {
        supabase?.removeChannel(channelRef?.current);
        channelRef.current = null;
      }
      setConnStatus('error');
      return;
    }

    setConnStatus('connecting');

    const channel = supabase
      ?.channel(`audit_trail_live_${++_auditTrailChannelSeq}`)
      ?.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_logs' },
        async (payload) => {
          let newLog = payload?.new;
          try {
            const { data } = await supabase
              ?.from('audit_logs')
              ?.select('*, user:user_profiles(full_name, email, role)')
              ?.eq('id', newLog?.id)
              ?.single();
            if (data) newLog = data;
          } catch (_) {}

          recentRef?.current?.push(Date.now());
          setRecentCount(recentRef?.current?.length);

          if (paused) {
            setPendingBuffer(prev => [newLog, ...prev]);
            return;
          }

          setAuditLogs(prev => {
            if (prev?.some(l => l?.id === newLog?.id)) return prev;
            return [newLog, ...prev];
          });

          setNewEntryIds(prev => new Set([...prev, newLog.id]));
          setTimeout(() => {
            setNewEntryIds(prev => {
              const next = new Set(prev);
              next?.delete(newLog?.id);
              return next;
            });
          }, 3000);

          if (autoScroll && listRef?.current) {
            listRef?.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }
      )
      ?.subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnStatus('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnStatus('error');
        else setConnStatus('connecting');
      });

    channelRef.current = channel;

    return () => {
      if (channelRef?.current) {
        supabase?.removeChannel(channelRef?.current);
        channelRef.current = null;
      }
    };
  }, [liveEnabled, autoScroll]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered logs ────────────────────────────────────────────────────────────
  const filteredLogs = auditLogs?.filter(log => {
    if (filterAction !== 'all' && log?.action !== filterAction) return false;
    if (!searchQuery) return true;
    const q = searchQuery?.toLowerCase();
    return (
      log?.description?.toLowerCase()?.includes(q) ||
      log?.user?.full_name?.toLowerCase()?.includes(q) ||
      log?.action?.toLowerCase()?.includes(q) ||
      log?.client_name?.toLowerCase()?.includes(q)
    );
  });

  const kycCount      = auditLogs?.filter(l => kycActions?.includes(l?.action))?.length;
  const userActCount  = auditLogs?.filter(l => l?.action?.startsWith('user_'))?.length;

  const connConfig = {
    connected:  { dot: 'bg-emerald-500 animate-pulse', text: 'Live',         textColor: 'text-emerald-500' },
    connecting: { dot: 'bg-amber-500 animate-pulse',   text: 'Connecting…',  textColor: 'text-amber-500' },
    error:      { dot: 'bg-red-500',                   text: 'Disconnected', textColor: 'text-red-500' },
  }?.[connStatus];

  return (
    <div className="space-y-4">

      {/* ── Live Feed Control Bar ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-card border border-border">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${connConfig?.dot}`} />
          <span className={`text-xs font-semibold ${connConfig?.textColor}`}>{connConfig?.text}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
            <Icon name="Zap" size={11} color="var(--color-primary)" />
          </div>
          <span className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{recentCount}</span> event{recentCount !== 1 ? 's' : ''} in last 60s
          </span>
        </div>
        {pendingBuffer?.length > 0 && (
          <>
            <div className="h-4 w-px bg-border" />
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-medium">
              {pendingBuffer?.length} buffered
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAutoScroll(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
              autoScroll ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name="ArrowDownToLine" size={12} color="currentColor" />Auto-scroll
          </button>
          <button
            onClick={() => setPaused(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
              paused ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'bg-muted border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name={paused ? 'Play' : 'Pause'} size={12} color="currentColor" />
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={() => setLiveEnabled(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
              liveEnabled ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-muted border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name={liveEnabled ? 'Radio' : 'RadioOff'} size={12} color="currentColor" />
            {liveEnabled ? 'Live On' : 'Live Off'}
          </button>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-48">
          <Input
            placeholder="Search by action, user, client…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e?.target?.value)}
            prefix={<Icon name="Search" size={14} color="currentColor" />}
          />
        </div>
        <Select
          value={filterAction}
          onChange={(e) => setFilterAction(e?.target?.value)}
          options={actionOptions}
          className="w-48"
        />
        <Button variant="outline" size="sm" onClick={loadAuditLogs} icon={<Icon name="RefreshCw" size={14} color="currentColor" />}>
          Refresh
        </Button>
      </div>

      {/* ── General Stats ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {['create', 'update', 'approve', 'reject']?.map(action => {
          const count = auditLogs?.filter(l => l?.action === action)?.length;
          const { icon, color } = actionIconMap?.[action] || { icon: 'Activity', color: 'bg-slate-500/10 text-slate-500' };
          return (
            <div key={action} className="flex items-center gap-3 p-3 rounded-xl bg-muted">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
                <Icon name={icon} size={16} color="currentColor" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{count}</p>
                <p className="text-xs text-muted-foreground capitalize">{action}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── User Management Stats ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { action: 'user_created',     label: 'Users Added' },
          { action: 'user_updated',     label: 'Users Edited' },
          { action: 'user_deactivated', label: 'Deactivated' },
          { action: 'user_activated',   label: 'Activated' },
        ].map(({ action, label }) => {
          const count = auditLogs?.filter(l => l?.action === action)?.length;
          const { icon, color } = actionIconMap?.[action] || { icon: 'Activity', color: 'bg-slate-500/10 text-slate-500' };
          return (
            <div key={action} className="flex items-center gap-3 p-3 rounded-xl bg-muted border border-border">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
                <Icon name={icon} size={16} color="currentColor" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{count}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── KYC Stats ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kycActions?.map(action => {
          const count = auditLogs?.filter(l => l?.action === action)?.length;
          const { icon, color } = actionIconMap?.[action];
          const labels = {
            kyc_document_upload: 'Doc Uploads',
            kyc_status_change:   'Status Changes',
            kyc_renewal:         'Renewals',
            kyc_verification:    'Verifications',
          };
          return (
            <div key={action} className="flex items-center gap-3 p-3 rounded-xl bg-muted border border-border">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
                <Icon name={icon} size={16} color="currentColor" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{count}</p>
                <p className="text-xs text-muted-foreground">{labels?.[action]}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Section labels */}
      {userActCount > 0 && (
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-blue-500/10 flex items-center justify-center">
            <Icon name="Users" size={12} color="#1A56DB" />
          </div>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">User Management Actions</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-medium">{userActCount} entries</span>
        </div>
      )}
      {kycCount > 0 && filterAction === 'all' && (
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-blue-500/10 flex items-center justify-center">
            <Icon name="ShieldCheck" size={12} color="#1A56DB" />
          </div>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">KYC Actions Tracked</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-medium">{kycCount} entries</span>
        </div>
      )}

      {/* ── Log List ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4,5]?.map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : filteredLogs?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Icon name="Shield" size={40} color="currentColor" />
          <p className="mt-3 font-medium">No audit logs found</p>
        </div>
      ) : (
        <div ref={listRef} className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          {filteredLogs?.map((log) => {
            const { icon, color } = actionIconMap?.[log?.action] || { icon: 'Activity', color: 'bg-slate-500/10 text-slate-500' };
            const isKYC      = kycActions?.includes(log?.action);
            const isUserAct  = log?.action?.startsWith('user_');
            const isExpanded = expandedLog === log?.id;
            const isNew      = newEntryIds?.has(log?.id);
            const badge      = getActionBadge(log?.action);
            const hasDiff    = log?.old_values && log?.new_values;

            return (
              <div
                key={log?.id}
                className={`flex items-start gap-3 p-3 rounded-xl border transition-all duration-500 ${
                  isNew
                    ? 'border-primary/50 bg-primary/5 shadow-sm shadow-primary/10 scale-[1.005]'
                    : isUserAct
                    ? 'border-blue-500/20 hover:bg-blue-500/5'
                    : isKYC
                    ? 'border-blue-500/20 hover:bg-blue-500/5'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color} ${
                  isNew ? 'ring-2 ring-primary/40' : ''
                }`}>
                  <Icon name={icon} size={16} color="currentColor" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{log?.description || log?.action}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${badge?.bg}`}>
                      {badge?.label}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getSeverityBadge(log?.severity)}`}>
                      {log?.severity || 'info'}
                    </span>
                    {isNew && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 font-semibold animate-pulse">
                        NEW
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {log?.user?.full_name || 'System'}
                      {log?.user?.role && (
                        <span className="ml-1 opacity-60">({log.user.role})</span>
                      )}
                    </span>
                    {log?.client_name && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Icon name="User" size={10} color="currentColor" />{log?.client_name}
                      </span>
                    )}
                    {log?.table_name && !isKYC && (
                      <span className="text-xs text-muted-foreground">· {log?.table_name}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      · {new Date(log.created_at)?.toLocaleString()}
                    </span>
                    {(hasDiff || (isKYC && log?.metadata)) && (
                      <button
                        onClick={() => setExpandedLog(isExpanded ? null : log?.id)}
                        className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={12} color="currentColor" />
                        {isExpanded ? 'Less' : 'Details'}
                      </button>
                    )}
                  </div>

                  {/* Show diff for user actions */}
                  {isUserAct && isExpanded && renderDiff(log)}

                  {/* Show metadata for KYC actions */}
                  {isKYC && isExpanded && renderMetadata(log)}
                  {isKYC && !isExpanded && log?.metadata && renderMetadata(log)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AuditTrailTab;
