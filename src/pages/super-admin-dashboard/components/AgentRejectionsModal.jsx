import React, { useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { DECLINE_REASONS, declineReasonLabel, helpTypeLabel } from '../../../utils/assistReasons';

// One gold agent's refusals, opened from the Rejections count in the agents
// table. The count on its own says "this agent turns work down"; only the list
// says whether that is a region problem, a briefing problem, or an agent
// problem — which is the difference between retraining them and replacing them.

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—';

const AgentRejectionsModal = ({ agent, rejections = [], onClose, onExport }) => {
  const [reasonFilter, setReasonFilter] = useState('all');

  // How the refusals break down. A gold agent with eight "out of region" is a
  // routing problem; eight "not available" is a capacity or commitment one.
  const byReason = useMemo(() => {
    const counts = {};
    rejections.forEach(r => {
      const code = r.decline_reason_code || 'other';
      counts[code] = (counts[code] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [rejections]);

  const shown = reasonFilter === 'all'
    ? rejections
    : rejections.filter(r => (r.decline_reason_code || 'other') === reasonFilter);

  const exportRows = () => onExport?.(
    rejections.map(r => ({
      declined_on:   r.responded_at || r.updated_at || r.created_at,
      gold_agent:    agent?.full_name,
      gold_code:     agent?.agent_code,
      asked_by:      r.bronze?.full_name || '',
      asked_by_code: r.bronze?.agent_code || '',
      admin_company: r.admin_name || '',
      help_needed:   helpTypeLabel(r.help_type),
      reason:        declineReasonLabel(r.decline_reason_code),
      reason_detail: r.decline_reason || '',
      requested_on:  r.created_at,
    })),
    `rejections_${(agent?.agent_code || 'agent').replace(/\W+/g, '_')}`
  );

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-3xl shadow-2xl my-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-6 py-4 border-b border-border">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <Icon name="XCircle" size={19} color="#dc2626" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground truncate">
              {agent?.full_name || 'Agent'} — assist rejections
            </h3>
            <p className="text-xs text-muted-foreground">
              {agent?.agent_code ? `${agent.agent_code} · ` : ''}
              {agent?.region ? `${agent.region} · ` : ''}
              {rejections.length} request{rejections.length !== 1 ? 's' : ''} turned down
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {onExport && rejections.length > 0 && (
              <button
                onClick={exportRows}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                <Icon name="Download" size={13} color="currentColor" />
                Export
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <Icon name="X" size={18} color="var(--color-muted-foreground)" />
            </button>
          </div>
        </div>

        {rejections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <Icon name="CheckCircle" size={30} color="#059669" />
            <p className="text-sm font-medium text-foreground mt-2">No rejections</p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xs">
              This agent has not turned down an assist request.
            </p>
          </div>
        ) : (
          <>
            {/* Reason breakdown — doubles as the filter */}
            <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-border bg-muted/30">
              <button
                onClick={() => setReasonFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  reasonFilter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card border border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                All · {rejections.length}
              </button>
              {byReason.map(([code, count]) => (
                <button
                  key={code}
                  onClick={() => setReasonFilter(code)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    reasonFilter === code
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {declineReasonLabel(code)} · {count}
                </button>
              ))}
            </div>

            {/* The individual rejections */}
            <div className="max-h-[480px] overflow-y-auto scrollbar-custom divide-y divide-border">
              {shown.map(r => (
                <div key={r.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {r.admin_name || 'Unspecified admin / company'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Asked by {r.bronze?.full_name || 'a bronze agent'}
                        {r.bronze?.agent_code ? ` (${r.bronze.agent_code})` : ''}
                        {r.bronze?.region ? ` · ${r.bronze.region}` : ''}
                      </p>
                    </div>
                    <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                      {declineReasonLabel(r.decline_reason_code)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Icon name="LifeBuoy" size={11} color="currentColor" />
                      {helpTypeLabel(r.help_type) || 'Unspecified help'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Icon name="Send" size={11} color="currentColor" />
                      Asked {fmtDate(r.created_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Icon name="XCircle" size={11} color="currentColor" />
                      Declined {fmtDate(r.responded_at || r.updated_at)}
                    </span>
                  </div>

                  {/* What the bronze agent asked for, then what they were told. */}
                  {r.note && (
                    <p className="text-xs text-foreground mt-2 bg-muted rounded-lg px-2.5 py-1.5">
                      <span className="text-muted-foreground">They asked: </span>{r.note}
                    </p>
                  )}
                  {r.decline_reason && (
                    <p className="text-xs text-red-700 mt-1.5 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
                      <span className="font-semibold">Reason given: </span>{r.decline_reason}
                    </p>
                  )}
                </div>
              ))}

              {shown.length === 0 && (
                <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No rejections with that reason.
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {DECLINE_REASONS.length} reasons are available to gold agents; one is required to decline.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentRejectionsModal;
