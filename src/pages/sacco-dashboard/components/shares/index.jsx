import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { marketOverview, withholdingOverview } from './_util';

import DashboardPanel from './DashboardPanel';
import TreasuryPanel from './TreasuryPanel';
import HoldingsPanel from './HoldingsPanel';
import MarketplacePanel from './MarketplacePanel';
import WithholdingPanel from './WithholdingPanel';
import DividendsPanel from './DividendsPanel';
import CertificatesPanel from './CertificatesPanel';
import AnalyticsPanel from './AnalyticsPanel';
import CompliancePanel from './CompliancePanel';
import ReportsPanel from './ReportsPanel';
import SettingsPanel from './SettingsPanel';

const SUB_TABS = [
  { id: 'overview',     label: 'Overview',     icon: 'LayoutDashboard' },
  { id: 'treasury',     label: 'Treasury',     icon: 'Landmark' },
  { id: 'holdings',     label: 'Holdings',     icon: 'PieChart' },
  { id: 'marketplace',  label: 'Marketplace',  icon: 'Store' },
  { id: 'withholding',  label: 'Withholding',  icon: 'Lock' },
  { id: 'dividends',    label: 'Dividends',    icon: 'Coins' },
  { id: 'certificates', label: 'Certificates', icon: 'Award' },
  { id: 'analytics',    label: 'Analytics',    icon: 'BarChart3' },
  { id: 'compliance',   label: 'Compliance',   icon: 'ShieldCheck' },
  { id: 'reports',      label: 'Reports',      icon: 'FileText' },
  { id: 'settings',     label: 'Settings',     icon: 'Settings' },
];

const SubTab = ({ active, label, icon, badge, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all border ${
      active ? 'border-primary/40 text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
    }`}
    style={active ? { background: 'rgba(52,193,221,0.10)' } : {}}
  >
    <Icon name={icon} size={14} color="currentColor" />
    {label}
    {badge > 0 && (
      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">
        {badge}
      </span>
    )}
  </button>
);

/**
 * The Shares tab: a full internal share market rather than four cards.
 *
 * All ten panels read one shared `marketOverview` snapshot, so the number on a
 * stat card, in a chart and in a report is always literally the same number.
 * Every action goes through the share engine's RPCs (see
 * 20260801200000_sacco_share_engine) — nothing here mutates ownership itself.
 */
const SharesTab = ({ ctx }) => {
  const [tab, setTab] = useState('overview');
  const { expireOrders } = ctx;

  const ov = useMemo(() => marketOverview(ctx), [
    ctx.shares, ctx.treasury, ctx.sharePrices, ctx.listings,
    ctx.transfers, ctx.dividends, ctx.dividendAllocations,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sweep expired orders once on entry so the book never shows a stale offer and
  // the escrow behind it is released.
  useEffect(() => { expireOrders?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // How many members currently have shares held back. A standing restriction
  // on the register, so it stays on the tab rather than waiting to be found.
  const wo = useMemo(
    () => withholdingOverview(ctx.withholdings || [], ov.effective, ov.totalIssued),
    [ctx.withholdings, ov.effective, ov.totalIssued]
  );

  const badges = {
    marketplace: ov.pendingTransfers.length,
    dividends: ov.liveDividend?.status === 'declared' ? 1 : 0,
    withholding: wo.count,
  };

  return (
    <div className="space-y-5">
      <div className="flex gap-1 flex-wrap border-b border-border pb-3">
        {SUB_TABS.map((t) => (
          <SubTab key={t.id} active={tab === t.id} label={t.label} icon={t.icon}
            badge={badges[t.id]} onClick={() => setTab(t.id)} />
        ))}
      </div>

      {tab === 'overview'     && <DashboardPanel ctx={ctx} ov={ov} onNavigate={setTab} />}
      {tab === 'treasury'     && <TreasuryPanel ctx={ctx} ov={ov} />}
      {tab === 'holdings'     && <HoldingsPanel ctx={ctx} ov={ov} />}
      {tab === 'marketplace'  && <MarketplacePanel ctx={ctx} ov={ov} />}
      {tab === 'withholding'  && <WithholdingPanel ctx={ctx} ov={ov} />}
      {tab === 'dividends'    && <DividendsPanel ctx={ctx} ov={ov} />}
      {tab === 'certificates' && <CertificatesPanel ctx={ctx} ov={ov} />}
      {tab === 'analytics'    && <AnalyticsPanel ctx={ctx} ov={ov} />}
      {tab === 'compliance'   && <CompliancePanel ctx={ctx} ov={ov} />}
      {tab === 'reports'      && <ReportsPanel ctx={ctx} ov={ov} />}
      {tab === 'settings'     && <SettingsPanel ctx={ctx} ov={ov} />}
    </div>
  );
};

export default SharesTab;
