import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const FLAG_REASONS = {
  low_quality:  { label: 'Low Quality Score',    icon: 'AlertTriangle', color: '#f59e0b', bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400' },
  high_risk:    { label: 'High Risk Client',      icon: 'ShieldAlert',   color: '#ef4444', bg: 'bg-red-100 dark:bg-red-900/30',    text: 'text-red-700 dark:text-red-400' },
  authenticity: { label: 'Authenticity Concern',  icon: 'ScanLine',      color: '#ef4444', bg: 'bg-red-100 dark:bg-red-900/30',    text: 'text-red-700 dark:text-red-400' },
  completeness: { label: 'Incomplete Document',   icon: 'FileX',         color: '#f97316', bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' },
  manual_flag:  { label: 'Manually Flagged',      icon: 'Flag',          color: '#1A56DB', bg: 'bg-blue-100 dark:bg-blue-900/30',  text: 'text-blue-700 dark:text-blue-400' },
};

const PRIORITY_CONFIG = {
  critical: { label: 'Critical', color: 'text-red-700 dark:text-red-400',    bg: 'bg-red-100 dark:bg-red-900/30',    dot: 'bg-red-500' },
  high:     { label: 'High',     color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/30', dot: 'bg-orange-500' },
  medium:   { label: 'Medium',   color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900/30', dot: 'bg-yellow-500' },
  low:      { label: 'Low',      color: 'text-blue-700 dark:text-blue-400',  bg: 'bg-blue-100 dark:bg-blue-900/30',  dot: 'bg-blue-500' },
};

const STATUS_CONFIG = {
  pending_review:     { label: 'Pending Review',       color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
  under_investigation:{ label: 'Under Investigation',  color: 'text-red-700 dark:text-red-400',    bg: 'bg-red-100 dark:bg-red-900/30' },
  resolved:           { label: 'Resolved',             color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' },
  escalated:          { label: 'Escalated',            color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/30' },
};

// No hardcoded MOCK_FLAGGED — derives everything from the renewals prop
const FlaggedDocumentsQueue = ({ renewals = [], externalScores = {}, flagThreshold = 60, onResolve, onEscalate }) => {
  // manualFlags holds items the user has manually flagged in this session
  const [manualFlags, setManualFlags] = useState([]);
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [manualFlagId, setManualFlagId] = useState(null);
  const [manualFlagNote, setManualFlagNote] = useState('');
  const [processing, setProcessing] = useState(null);
  // Local status overrides so resolve/escalate actions reflect immediately
  const [statusOverrides, setStatusOverrides] = useState({});

  // Auto-detect from renewals where quality score is below threshold
  const autoFlagged = renewals
    .filter(r => {
      const score = externalScores?.[r?.id];
      return score !== undefined && score < flagThreshold;
    })
    .map(r => ({
      id: 'AUTO-' + r?.id,
      renewalId: r?.id,
      clientId: r?.clientId,
      clientName: r?.clientName,
      documentType: r?.documentType || 'Document',
      qualityScore: externalScores?.[r?.id],
      flagReasons: ['low_quality'],
      flaggedAt: new Date().toISOString(),
      status: 'pending_review',
      priority: (externalScores?.[r?.id] ?? 100) < 40 ? 'critical' : 'high',
      docUrl: r?.newDocUrl || r?.existingDocUrl || null,
      notes: `Auto-flagged: quality score ${externalScores?.[r?.id]} below threshold of ${flagThreshold}`,
      riskProfile: r?.riskProfile || 'unknown',
    }));

  const allFlagged = [
    ...autoFlagged,
    ...manualFlags.filter(f => !autoFlagged.find(a => a.renewalId === f.renewalId)),
  ].map(f => ({ ...f, status: statusOverrides[f.id] ?? f.status }));

  const filtered = allFlagged.filter(f => {
    if (filterPriority !== 'all' && f.priority !== filterPriority) return false;
    if (filterStatus !== 'all' && f.status !== filterStatus) return false;
    return true;
  });

  const stats = {
    total: allFlagged.length,
    critical: allFlagged.filter(f => f.priority === 'critical').length,
    pendingReview: allFlagged.filter(f => f.status === 'pending_review').length,
    resolved: allFlagged.filter(f => f.status === 'resolved').length,
  };

  const handleResolve = async (flagId) => {
    setProcessing(flagId);
    await new Promise(r => setTimeout(r, 600));
    setStatusOverrides(prev => ({ ...prev, [flagId]: 'resolved' }));
    onResolve?.(flagId);
    setProcessing(null);
  };

  const handleEscalate = async (flagId) => {
    setProcessing(flagId + '-esc');
    await new Promise(r => setTimeout(r, 600));
    setStatusOverrides(prev => ({ ...prev, [flagId]: 'escalated' }));
    onEscalate?.(flagId);
    setProcessing(null);
  };

  const handleManualFlag = (renewalId) => {
    if (!manualFlagNote?.trim()) return;
    const renewal = renewals.find(r => r?.id === renewalId);
    if (!renewal) return;
    const newFlag = {
      id: 'MANUAL-' + renewalId + '-' + Date.now(),
      renewalId,
      clientId: renewal.clientId,
      clientName: renewal.clientName,
      documentType: renewal.documentType || 'Document',
      qualityScore: externalScores?.[renewalId] ?? null,
      flagReasons: ['manual_flag'],
      flaggedAt: new Date().toISOString(),
      status: 'pending_review',
      priority: 'medium',
      docUrl: renewal.newDocUrl || renewal.existingDocUrl || null,
      notes: manualFlagNote.trim(),
      riskProfile: renewal.riskProfile || 'unknown',
    };
    setManualFlags(prev => [...prev, newFlag]);
    setManualFlagId(null);
    setManualFlagNote('');
  };

  const fmt = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Flagged',   value: stats.total,       bg: 'bg-red-50 dark:bg-red-950/30',    ic: '#ef4444', icon: 'Flag' },
          { label: 'Critical',        value: stats.critical,    bg: 'bg-orange-50 dark:bg-orange-950/30', ic: '#f97316', icon: 'ShieldAlert' },
          { label: 'Pending Review',  value: stats.pendingReview, bg: 'bg-yellow-50 dark:bg-yellow-950/30', ic: '#ca8a04', icon: 'Clock' },
          { label: 'Resolved',        value: stats.resolved,    bg: 'bg-green-50 dark:bg-green-950/30', ic: '#16a34a', icon: 'CheckCircle2' },
        ].map((s, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.bg}`}>
              <Icon name={s.icon} size={16} color={s.ic} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="text-xs px-3 py-1.5 border border-border rounded-lg bg-background text-foreground focus:outline-none">
          <option value="all">All Priority</option>
          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-xs px-3 py-1.5 border border-border rounded-lg bg-background text-foreground focus:outline-none">
          <option value="all">All Status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Empty state */}
      {allFlagged.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground bg-card border border-border rounded-xl">
          <Icon name="CheckCircle2" size={36} color="#16a34a" />
          <p className="text-sm font-medium mt-3 text-foreground">No flagged documents</p>
          <p className="text-xs mt-1">All renewals are within the quality threshold of {flagThreshold}</p>
        </div>
      )}

      {/* Flag list */}
      <div className="space-y-3">
        {filtered.map(flag => {
          const priorityCfg = PRIORITY_CONFIG[flag.priority] || PRIORITY_CONFIG.medium;
          const statusCfg   = STATUS_CONFIG[flag.status]    || STATUS_CONFIG.pending_review;
          const isExpanded  = expandedId === flag.id;

          return (
            <div key={flag.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : flag.id)}
              >
                <span className={`flex-shrink-0 w-2 h-2 rounded-full ${priorityCfg.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{flag.clientName}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityCfg.bg} ${priorityCfg.color}`}>{priorityCfg.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.bg} ${statusCfg.color}`}>{statusCfg.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{flag.documentType} · Flagged {fmt(flag.flaggedAt)}</p>
                </div>
                {flag.qualityScore !== null && flag.qualityScore !== undefined && (
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-bold ${flag.qualityScore < 40 ? 'text-red-500' : flag.qualityScore < 60 ? 'text-orange-500' : 'text-yellow-500'}`}>
                      {flag.qualityScore}
                    </p>
                    <p className="text-xs text-muted-foreground">Score</p>
                  </div>
                )}
                <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={15} color="var(--color-muted-foreground)" />
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                  {/* Reasons */}
                  <div className="flex flex-wrap gap-1.5">
                    {flag.flagReasons.map(r => {
                      const cfg = FLAG_REASONS[r] || FLAG_REASONS.manual_flag;
                      return (
                        <span key={r} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                          <Icon name={cfg.icon} size={11} color={cfg.color} />
                          {cfg.label}
                        </span>
                      );
                    })}
                  </div>

                  {flag.notes && (
                    <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">{flag.notes}</p>
                  )}

                  {/* Actions */}
                  {flag.status !== 'resolved' && (
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => handleResolve(flag.id)}
                        disabled={!!processing}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {processing === flag.id ? <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg> : <Icon name="CheckCircle2" size={12} color="white" />}
                        Resolve
                      </button>
                      {flag.status !== 'escalated' && (
                        <button
                          onClick={() => handleEscalate(flag.id)}
                          disabled={!!processing}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50"
                        >
                          {processing === flag.id + '-esc' ? <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg> : <Icon name="ArrowUpCircle" size={12} color="white" />}
                          Escalate
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Manual flag panel for renewals not yet auto-flagged */}
      {renewals.filter(r => !allFlagged.find(f => f.renewalId === r.id)).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <p className="text-sm font-semibold text-foreground">Manually flag a renewal</p>
          <select
            value={manualFlagId || ''}
            onChange={e => setManualFlagId(e.target.value)}
            className="w-full text-sm px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none"
          >
            <option value="">Select a renewal to flag…</option>
            {renewals
              .filter(r => !allFlagged.find(f => f.renewalId === r.id))
              .map(r => (
                <option key={r.id} value={r.id}>{r.clientName} — {r.documentType || 'Document'}</option>
              ))
            }
          </select>
          {manualFlagId && (
            <>
              <textarea
                value={manualFlagNote}
                onChange={e => setManualFlagNote(e.target.value)}
                placeholder="Reason for flagging…"
                rows={2}
                className="w-full text-xs px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none resize-none"
              />
              <button
                onClick={() => handleManualFlag(manualFlagId)}
                disabled={!manualFlagNote.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <Icon name="Flag" size={12} color="white" /> Flag Renewal
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default FlaggedDocumentsQueue;
