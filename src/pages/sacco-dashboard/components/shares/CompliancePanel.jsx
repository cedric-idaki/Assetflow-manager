import React, { useEffect, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import { Card, StatCard, Table, Badge, GhostButton, Select, EmptyState, KES, fmtDate } from '../_shared';
import { int, num, pct, withDefaults } from './_util';

const SEVERITY = {
  high:   { label: 'High',   cls: 'bg-red-100 text-red-700',       icon: 'AlertOctagon', color: '#dc2626' },
  medium: { label: 'Medium', cls: 'bg-amber-100 text-amber-700',   icon: 'AlertTriangle', color: '#ca8a04' },
  low:    { label: 'Low',    cls: 'bg-sky-100 text-sky-700',       icon: 'Info', color: '#0284c7' },
};

const ACTION_LABELS = {
  order_placed: 'Order placed', order_edited: 'Order edited', order_cancelled: 'Order withdrawn',
  order_matched: 'Order matched', settled: 'Trade settled', rejected: 'Trade rejected',
  reversed: 'Trade reversed', issue: 'Shares issued', retire: 'Shares retired',
  adjustment: 'Inventory adjusted', freeze: 'Holding frozen', unfreeze: 'Holding unfrozen',
  settings_updated: 'Settings changed', trading_suspended: 'Trading suspended',
  trading_resumed: 'Trading resumed', declared: 'Dividend declared',
  calculated: 'Dividend calculated', paid: 'Dividend paid', cancelled: 'Dividend cancelled',
};

/**
 * Compliance: the KYC gate, ownership limits, AML flags, and the audit trail of
 * every share action — who, when, old value, new value, reason.
 */
const CompliancePanel = ({ ctx, ov }) => {
  const { shareAudit = [], shares = [], members = [], shareSettings, getShareAlerts, exportCSV } = ctx;
  const toast = useToast();
  const s = withDefaults(shareSettings);

  const [alerts, setAlerts] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [days, setDays] = useState('90');
  const [entity, setEntity] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setLoadingAlerts(true);
    getShareAlerts(parseInt(days, 10))
      .then((rows) => { if (!cancelled) setAlerts(rows || []); })
      .catch(() => { if (!cancelled) setAlerts([]); })
      .finally(() => { if (!cancelled) setLoadingAlerts(false); });
    return () => { cancelled = true; };
  }, [days, getShareAlerts]);

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || '—';

  const unverifiedHolders = shares.filter((r) => {
    if (int(r.shares_held) <= 0) return false;
    const m = members.find((x) => x.id === r.member_id);
    return (m?.kyc_status || 'pending') !== 'verified';
  });

  const capShares = num(s.max_holding_percent) > 0 && ov.totalIssued > 0
    ? Math.floor(ov.totalIssued * num(s.max_holding_percent) / 100)
    : num(s.max_holding_shares);
  const nearCap = capShares > 0
    ? shares.filter((r) => int(r.shares_held) >= capShares * 0.9)
    : [];

  const audit = shareAudit.filter((a) => entity === 'all' || a.entity === entity);
  const bySeverity = (sev) => alerts.filter((a) => a.severity === sev).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="High-severity alerts" value={bySeverity('high')} icon="AlertOctagon"
          tone={bySeverity('high') ? 'warning' : 'success'} />
        <StatCard label="KYC gate" value={s.require_kyc_to_trade ? 'Enforced' : 'Off'}
          icon="ShieldCheck" tone={s.require_kyc_to_trade ? 'success' : 'muted'}
          hint={unverifiedHolders.length ? `${unverifiedHolders.length} holder(s) unverified` : 'All holders verified'} />
        <StatCard label="Ownership ceiling" value={capShares > 0 ? capShares.toLocaleString() : 'None'}
          icon="Crown" tone="muted"
          hint={num(s.max_holding_percent) > 0 ? `${s.max_holding_percent}% of the issue` : (capShares > 0 ? 'shares per member' : 'No limit set')} />
        <StatCard label="Audit entries" value={shareAudit.length} icon="ScrollText" tone="muted"
          hint="Most recent 400" />
      </div>

      {/* Alerts */}
      <Card
        title="Suspicious activity"
        subtitle="Large trades, off-market prices, rapid trading and ownership limits"
        actions={(
          <div className="w-40">
            <Select value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last 12 months</option>
            </Select>
          </div>
        )}
      >
        {loadingAlerts ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : alerts.length === 0 ? (
          <EmptyState icon="ShieldCheck" title="Nothing flagged"
            hint={num(s.large_trade_threshold) > 0
              ? 'No trade in this period tripped a monitoring rule.'
              : 'Set a large-trade review threshold in Settings to switch on AML flagging.'} />
        ) : (
          <Table columns={['Severity', 'When', 'Member', 'Shares', 'Amount', 'Why it was flagged']}>
            {alerts.map((a, i) => {
              const sev = SEVERITY[a.severity] || SEVERITY.low;
              return (
                <tr key={`${a.transfer_id || 'x'}-${i}`} className="border-b border-border/60">
                  <td className="py-2.5 pr-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${sev.cls}`}>
                      <Icon name={sev.icon} size={12} color="currentColor" />{sev.label}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(a.traded_at)}</td>
                  <td className="py-2.5 pr-4 text-foreground">{memberName(a.member_id)}</td>
                  <td className="py-2.5 pr-4 text-foreground">{int(a.shares).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{KES(a.amount)}</td>
                  <td className="py-2.5 pr-4 text-sm text-foreground">{a.reason}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card title="KYC before trading"
          subtitle={s.require_kyc_to_trade ? 'Unverified members are refused by the engine' : 'The KYC gate is switched off'}>
          {unverifiedHolders.length === 0 ? (
            <EmptyState icon="ShieldCheck" title="Every shareholder is verified" />
          ) : (
            <Table columns={['Member', 'Shares', 'KYC status', 'Can trade?']}>
              {unverifiedHolders.map((r) => {
                const m = members.find((x) => x.id === r.member_id) || {};
                return (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-4 font-medium text-foreground">{m.full_name || memberName(r.member_id)}</td>
                    <td className="py-2.5 pr-4 text-foreground">{int(r.shares_held).toLocaleString()}</td>
                    <td className="py-2.5 pr-4"><Badge status={m.kyc_status || 'pending'} /></td>
                    <td className="py-2.5 pr-4 text-sm">
                      {s.require_kyc_to_trade
                        ? <span className="text-red-600 font-semibold">Blocked</span>
                        : <span className="text-muted-foreground">Allowed</span>}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Ownership limits"
          subtitle={capShares > 0 ? `No member may hold more than ${capShares.toLocaleString()} shares` : 'No ownership ceiling is set'}>
          {capShares === 0 ? (
            <EmptyState icon="Crown" title="No ownership ceiling"
              hint="Set a maximum holding in Settings to stop any one member dominating the society." />
          ) : nearCap.length === 0 ? (
            <EmptyState icon="ShieldCheck" title="Everyone is comfortably inside the limit" />
          ) : (
            <Table columns={['Member', 'Shares', 'Ownership', 'Headroom']}>
              {nearCap.map((r) => {
                const m = members.find((x) => x.id === r.member_id) || {};
                const held = int(r.shares_held);
                return (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-4 font-medium text-foreground">{m.full_name || memberName(r.member_id)}</td>
                    <td className="py-2.5 pr-4 text-foreground">{held.toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-foreground">
                      {ov.totalIssued > 0 ? pct((held / ov.totalIssued) * 100, 2) : '—'}
                    </td>
                    <td className={`py-2.5 pr-4 font-semibold ${capShares - held <= 0 ? 'text-red-600' : 'text-amber-600'}`}>
                      {Math.max(0, capShares - held).toLocaleString()} shares
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>

      {/* Audit trail */}
      <Card
        title="Audit trail"
        subtitle="Every share action — who did it, when, what changed and why"
        actions={(
          <div className="flex items-center gap-2">
            <div className="w-40">
              <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
                <option value="all">Everything</option>
                <option value="transfer">Trades</option>
                <option value="listing">Orders</option>
                <option value="holding">Holdings</option>
                <option value="treasury">Treasury</option>
                <option value="dividend">Dividends</option>
                <option value="settings">Settings</option>
              </Select>
            </div>
            {audit.length > 0 && (
              <GhostButton icon="Download" onClick={() => exportCSV(audit.map((a) => ({
                at: a.created_at, entity: a.entity, action: a.action,
                actor: a.actor_name, role: a.actor_role,
                member: memberName(a.member_id),
                changed: (a.changed_fields || []).join(' '),
                old_values: JSON.stringify(a.old_values || {}),
                new_values: JSON.stringify(a.new_values || {}),
                reason: a.reason || '',
              })), 'share_audit_trail')}>Export</GhostButton>
            )}
          </div>
        )}
      >
        {audit.length === 0 ? (
          <EmptyState icon="ScrollText" title="No audit entries yet"
            hint="Every order, trade, treasury movement and settings change writes a line here." />
        ) : (
          <Table columns={['When', 'Action', 'Actor', 'Member', 'Changed', 'Reason']}>
            {audit.slice(0, 120).map((a) => (
              <tr key={a.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap text-xs">
                  {new Date(a.created_at).toLocaleString('en-KE', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </td>
                <td className="py-2.5 pr-4">
                  <p className="text-sm font-medium text-foreground">{ACTION_LABELS[a.action] || a.action}</p>
                  <p className="text-xs text-muted-foreground capitalize">{a.entity}</p>
                </td>
                <td className="py-2.5 pr-4">
                  <p className="text-sm text-foreground">{a.actor_name || 'System'}</p>
                  <p className="text-xs text-muted-foreground">{a.actor_role || '—'}</p>
                </td>
                <td className="py-2.5 pr-4 text-sm text-foreground">{a.member_id ? memberName(a.member_id) : '—'}</td>
                <td className="py-2.5 pr-4 text-xs text-muted-foreground max-w-[220px]">
                  {(a.changed_fields || []).length > 0
                    ? (a.changed_fields || []).slice(0, 4).join(', ') + ((a.changed_fields || []).length > 4 ? '…' : '')
                    : '—'}
                </td>
                <td className="py-2.5 pr-4 text-xs text-muted-foreground max-w-[220px] truncate">{a.reason || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
};

export default CompliancePanel;
