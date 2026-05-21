import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';

const URGENCY_CONFIG = {
  critical: {
    label: '≤ 30 Days',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    text: 'text-red-600',
    badge: 'bg-red-500',
    icon: 'AlertTriangle',
  },
  warning: {
    label: '31–60 Days',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    text: 'text-amber-600',
    badge: 'bg-amber-500',
    icon: 'Clock',
  },
  notice: {
    label: '61–90 Days',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    text: 'text-blue-600',
    badge: 'bg-blue-500',
    icon: 'Info',
  },
};

const DOC_TYPE_LABELS = {
  national_id: 'National ID',
  passport: 'Passport',
  kra_pin: 'KRA PIN',
  drivers_license: "Driver's License",
  other: 'Other',
};

const getDaysUntilExpiry = (expiryDate) => {
  if (!expiryDate) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
};

const getUrgencyLevel = (days) => {
  if (days === null) return null;
  if (days <= 30) return 'critical';
  if (days <= 60) return 'warning';
  if (days <= 90) return 'notice';
  return null;
};

const UrgencyBucket = ({ level, items, onRenew }) => {
  const config = URGENCY_CONFIG[level];
  const [expanded, setExpanded] = useState(level === 'critical');
  if (items.length === 0) return null;

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <Icon name={config.icon} size={15} color="currentColor" className={config.text} />
          <span className={`text-sm font-semibold ${config.text}`}>{config.label}</span>
          <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${config.badge}`}>
            {items.length}
          </span>
        </div>
        <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={14} color="currentColor" className={config.text} />
      </button>

      {expanded && (
        <div className="border-t border-inherit divide-y divide-border/50">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between px-4 py-2.5 bg-card/60">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{item.clientName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {DOC_TYPE_LABELS[item.docType] || item.docType}
                  </span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-xs text-muted-foreground">
                    Expires {new Date(item.expiryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                <span className={`text-xs font-bold ${config.text}`}>
                  {item.daysLeft === 0 ? 'Today' : item.daysLeft < 0 ? `${Math.abs(item.daysLeft)}d overdue` : `${item.daysLeft}d`}
                </span>
                {item.renewalInitiated ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    <Icon name="CheckCircle" size={10} color="currentColor" /> Renewal Started
                  </span>
                ) : (
                  <button
                    onClick={() => onRenew(item)}
                    className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${config.border} ${config.text} hover:opacity-80 transition-opacity`}
                  >
                    Renew
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const KYCComplianceWidget = () => {
  const navigate = useNavigate();
  const [expiringDocs, setExpiringDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [renewalTracking, setRenewalTracking] = useState({});

  const fetchExpiringDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ninetyDaysFromNow = new Date();
      ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

      const { data: documents, error: fetchError } = await supabase
        .from('kyc_documents')
        .select(`
          id,
          client_id,
          document_type,
          expiry_date,
          status,
          client:clients(id, full_name, account_number, kyc_status)
        `)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', ninetyDaysFromNow.toISOString().split('T')[0])
        .order('expiry_date', { ascending: true });

      if (fetchError) throw fetchError;

      const docs = (documents || [])
        .map((doc) => {
          const daysLeft = getDaysUntilExpiry(doc.expiry_date);
          const urgency = getUrgencyLevel(daysLeft);
          if (!urgency) return null;
          return {
            id: doc.id,
            clientId: doc.client_id,
            clientName: doc.client?.full_name || 'Unknown Client',
            accountNumber: doc.client?.account_number || '—',
            docType: doc.document_type || 'other',
            expiryDate: doc.expiry_date,
            daysLeft,
            urgency,
          };
        })
        .filter(Boolean);

      setExpiringDocs(docs);
    } catch (err) {
      console.error('KYC widget fetch error:', err);
      setError(err.message || 'Failed to load KYC data');
      setExpiringDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExpiringDocuments(); }, [fetchExpiringDocuments]);

  const handleRenew = (item) => {
    // Mark as initiated locally, then navigate to KYC renewal screen
    setRenewalTracking(prev => ({ ...prev, [item.clientId + item.docType]: true }));
    navigate('/kyc-renewal-management-screen');
  };

  const enrichedDocs = expiringDocs.map(doc => ({
    ...doc,
    renewalInitiated: !!renewalTracking[doc.clientId + doc.docType],
  }));

  const critical = enrichedDocs.filter(d => d.urgency === 'critical');
  const warning  = enrichedDocs.filter(d => d.urgency === 'warning');
  const notice   = enrichedDocs.filter(d => d.urgency === 'notice');
  const total = enrichedDocs.length;
  const renewedCount = Object.keys(renewalTracking).length;

  const docTypeBreakdown = enrichedDocs.reduce((acc, doc) => {
    const label = DOC_TYPE_LABELS[doc.docType] || doc.docType;
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Icon name="ShieldCheck" size={16} color="var(--color-primary)" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">KYC Document Expiry</h3>
            <p className="text-xs text-muted-foreground">Next 30 / 60 / 90 days</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/kyc-management-screen')}
          className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
        >
          View All <Icon name="ArrowRight" size={12} color="currentColor" />
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <svg className="animate-spin text-muted-foreground" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Icon name="WifiOff" size={24} color="var(--color-muted-foreground)" />
          <p className="text-xs text-muted-foreground mt-2">{error}</p>
          <button onClick={fetchExpiringDocuments}
            className="mt-3 text-xs text-primary hover:underline flex items-center gap-1">
            <Icon name="RefreshCw" size={11} color="currentColor" /> Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && total === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-2">
            <Icon name="CheckCircle" size={22} color="#059669" />
          </div>
          <p className="text-sm font-medium text-emerald-600">All documents are up to date</p>
          <p className="text-xs text-muted-foreground mt-0.5">No expirations in the next 90 days</p>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && total > 0 && (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { level: 'critical', count: critical.length, label: '≤30d' },
              { level: 'warning',  count: warning.length,  label: '31–60d' },
              { level: 'notice',   count: notice.length,   label: '61–90d' },
            ].map(({ level, count, label }) => {
              const cfg = URGENCY_CONFIG[level];
              return (
                <div key={level} className={`rounded-lg border ${cfg.border} ${cfg.bg} p-2.5 text-center`}>
                  <p className={`text-xl font-bold ${cfg.text}`}>{count}</p>
                  <p className={`text-xs font-medium ${cfg.text} opacity-80`}>{label}</p>
                </div>
              );
            })}
          </div>

          {/* Doc type tags */}
          {Object.keys(docTypeBreakdown).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(docTypeBreakdown).map(([type, count]) => (
                <span key={type} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                  {type}: <span className="font-semibold text-foreground">{count}</span>
                </span>
              ))}
            </div>
          )}

          {/* Renewal progress bar */}
          {renewedCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Icon name="TrendingUp" size={14} color="#059669" />
              <span className="text-xs text-emerald-700 font-medium">
                {renewedCount} of {total} renewal{renewedCount !== 1 ? 's' : ''} initiated
              </span>
              <div className="flex-1 h-1.5 bg-emerald-200 rounded-full overflow-hidden ml-1">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((renewedCount / total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Urgency buckets */}
          <div className="space-y-2">
            <UrgencyBucket level="critical" items={critical} onRenew={handleRenew} />
            <UrgencyBucket level="warning"  items={warning}  onRenew={handleRenew} />
            <UrgencyBucket level="notice"   items={notice}   onRenew={handleRenew} />
          </div>

          {/* Footer actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => navigate('/kyc-renewal-management-screen')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
            >
              <Icon name="RefreshCw" size={13} color="currentColor" /> Start Renewals
            </button>
            <button
              onClick={() => navigate('/kyc-management-screen')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-muted border border-border text-muted-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
            >
              <Icon name="FileSearch" size={13} color="currentColor" /> Manage KYC
            </button>
            <button
              onClick={fetchExpiringDocuments}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-muted border border-border text-muted-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
            >
              <Icon name="RefreshCw" size={13} color="currentColor" />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default KYCComplianceWidget;
