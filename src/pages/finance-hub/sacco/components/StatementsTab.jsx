/**
 * Financial Statements tab — §5, §6, §7.
 *
 * All three statements are derived from the trial balance through the
 * ReportDefinition mappings in src/config/saccoAccountingConfig.js. Nothing on
 * this screen is hand-entered, which is exactly what §7 requires of the Cash
 * Flow Statement, and both integrity checks (§6 Assets = Liabilities + Equity,
 * §7 reconciliation to the cash accounts) are shown rather than hidden.
 */
import React, { useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { Card, GhostButton, EmptyState, Badge } from '../../../sacco-dashboard/components/_shared';
import { html, rawHtml } from '../../../../utils/htmlEscape';
import {
  buildIncomeStatement, buildBalanceSheet, buildCashFlow, buildAppropriation,
  fmtPlain,
} from '../../../../utils/saccoAccounting';
import { societyType } from '../../../../config/saccoAccountingConfig';

const StatementRow = ({ label, value, prior, emphasis, strong, indent, currency }) => (
  <tr className={`${strong ? 'border-t-2 border-foreground/20' : 'border-b border-border'} ${emphasis ? 'font-semibold' : ''}`}>
    <td className={`py-2 pr-4 ${indent ? 'pl-6' : ''} ${strong ? 'text-foreground font-bold' : 'text-foreground'}`}>{label}</td>
    <td className={`py-2 pr-4 text-right font-mono text-sm ${strong ? 'font-bold' : ''} ${value < 0 ? 'text-red-600' : 'text-foreground'}`}>
      {fmtPlain(value)}
    </td>
    {prior !== undefined && prior !== null && (
      <td className="py-2 text-right font-mono text-sm text-muted-foreground">{fmtPlain(prior)}</td>
    )}
  </tr>
);

const IntegrityBanner = ({ ok, okText, badText }) => (
  <div className={`flex items-start gap-3 p-3 rounded-lg border mb-4 ${ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
    <Icon name={ok ? 'ShieldCheck' : 'AlertTriangle'} size={16} color={ok ? '#059669' : '#ca8a04'} />
    <p className={`text-xs ${ok ? 'text-emerald-800' : 'text-amber-800'}`}>{ok ? okText : badText}</p>
  </div>
);

/** Opens a clean, print-ready window for whichever statement is on screen. */
const printStatement = ({ title, saccoName, subtitle, sections, currency }) => {
  // Account labels and headings come from the tenant's own chart of accounts,
  // so they are escaped; only the assembled row fragments are marked raw.
  const rowsHtml = sections.map((sec) => html`
    ${sec.heading ? rawHtml(html`<tr class="head"><td colspan="2">${sec.heading}</td></tr>`) : ''}
    ${rawHtml(sec.rows.map((r) => html`
      <tr class="${r.strong ? 'strong' : ''}${r.emphasis ? ' emph' : ''}">
        <td>${r.label}</td>
        <td class="r">${fmtPlain(r.value)}</td>
      </tr>`).join(''))}
  `).join('');

  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return;
  w.document.write(html`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; color:#111; padding:40px; max-width:760px; margin:0 auto; }
      h1 { font-size:20px; margin:0 0 2px; }
      h2 { font-size:14px; margin:0 0 4px; font-weight:normal; color:#555; }
      p.sub { font-size:12px; color:#777; margin:0 0 24px; }
      table { width:100%; border-collapse:collapse; }
      td { padding:7px 6px; font-size:13px; border-bottom:1px solid #eee; }
      td.r { text-align:right; font-family:'Courier New',monospace; white-space:nowrap; }
      tr.head td { font-weight:bold; text-transform:uppercase; font-size:11px; letter-spacing:.06em;
                   color:#555; border-bottom:1px solid #999; padding-top:20px; }
      tr.emph td { font-weight:bold; }
      tr.strong td { font-weight:bold; border-top:2px solid #333; border-bottom:2px solid #333; }
      footer { margin-top:36px; font-size:10px; color:#999; border-top:1px solid #eee; padding-top:10px; }
    </style></head><body>
      <h1>${saccoName}</h1>
      <h2>${title}</h2>
      <p class="sub">${subtitle} · all amounts in ${currency}</p>
      <table>${rawHtml(rowsHtml)}</table>
      <footer>Generated ${new Date().toLocaleString()} from the general ledger. Prepared on the double-entry
      records of the society; subject to audit.</footer>
      <script>window.onload=function(){window.print();}</script>
    </body></html>`);
  w.document.close();
};

const StatementsTab = ({ fin, periodTb, openingTb, closingTb, priorTb, range, saccoName }) => {
  const { config, appropriationRules } = fin;
  const cur = config?.base_currency || 'KES';
  const type = societyType(config?.society_type);

  const [view, setView] = useState('income');

  const income  = useMemo(() => buildIncomeStatement(periodTb, priorTb), [periodTb, priorTb]);
  const balance = useMemo(() => buildBalanceSheet(closingTb), [closingTb]);
  const cash    = useMemo(
    () => buildCashFlow(periodTb, openingTb, closingTb, income.netSurplus),
    [periodTb, openingTb, closingTb, income.netSurplus]);
  const approp  = useMemo(
    () => buildAppropriation(income.netSurplus, appropriationRules),
    [income.netSurplus, appropriationRules]);

  const subtitle = view === 'balance'
    ? `As at ${range.to}`
    : `For the period ${range.from} to ${range.to}`;

  const doPrint = () => {
    if (view === 'income') {
      printStatement({
        title: 'Income Statement (Statement of Comprehensive Income)', saccoName, subtitle, currency: cur,
        sections: [
          { rows: income.rows },
          { heading: 'Appropriation of net surplus',
            rows: [
              ...approp.lines.filter((l) => l.amount > 0).map((l) => ({ label: `Less: ${l.name} (${l.percent}%)`, value: -l.amount })),
              { label: 'Surplus Available for Distribution', value: approp.availableForDistribution, strong: true },
            ] },
        ],
      });
    } else if (view === 'balance') {
      printStatement({
        title: 'Balance Sheet (Statement of Financial Position)', saccoName, subtitle, currency: cur,
        sections: [
          { heading: 'Assets', rows: balance.assets },
          { heading: 'Liabilities', rows: balance.liabilities },
          { heading: 'Equity', rows: balance.equity },
          { rows: [{ label: 'TOTAL LIABILITIES + EQUITY', value: balance.totalLiabilities + balance.totalEquity, strong: true }] },
        ],
      });
    } else {
      printStatement({
        title: 'Cash Flow Statement (Indirect Method)', saccoName, subtitle, currency: cur,
        sections: [
          { heading: 'Operating activities', rows: [...cash.operating.rows, { label: 'Net Cash from Operating Activities', value: cash.operating.total, emphasis: true }] },
          { heading: 'Investing activities', rows: [...cash.investing.rows, { label: 'Net Cash used in Investing Activities', value: cash.investing.total, emphasis: true }] },
          { heading: 'Financing activities', rows: [...cash.financing.rows, { label: 'Net Cash from Financing Activities', value: cash.financing.total, emphasis: true }] },
          { rows: [
            { label: 'Net Increase/(Decrease) in Cash', value: cash.netChange, strong: true },
            { label: 'Cash and Cash Equivalents at Start of Period', value: cash.openingCash },
            { label: 'Cash and Cash Equivalents at End of Period', value: cash.closingCash, emphasis: true },
          ] },
        ],
      });
    }
  };

  const views = [
    { id: 'income',  label: 'Income Statement', icon: 'TrendingUp',  available: type.statements.includes('income') },
    { id: 'balance', label: 'Balance Sheet',    icon: 'Scale',       available: type.statements.includes('balance') },
    { id: 'cash',    label: 'Cash Flow',        icon: 'ArrowLeftRight', available: type.statements.includes('cashflow') },
  ];

  const noStatements = views.every((v) => !v.available);
  if (noStatements) {
    return (
      <Card title="Statements">
        <EmptyState icon="FileText" title={`${type.short} does not produce these statements`}
          hint="A merry-go-round reports a Statement of Contributions and Payouts instead — see the Chama tab." />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {views.filter((v) => v.available).map((v) => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                view === v.id ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
              <Icon name={v.icon} size={14} color="currentColor" />{v.label}
            </button>
          ))}
        </div>
        <GhostButton icon="Printer" onClick={doPrint}>Print / save as PDF</GhostButton>
      </div>

      {/* ── INCOME STATEMENT ─────────────────────────────────────────────── */}
      {view === 'income' && (
        <Card title="Income Statement" subtitle={`§5 · ${subtitle} · all amounts in ${cur}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b-2 border-border">
                  <th className="py-2 pr-4 font-medium">Line item</th>
                  <th className="py-2 pr-4 font-medium text-right w-40">Current period</th>
                  {priorTb && <th className="py-2 font-medium text-right w-40">Prior period</th>}
                </tr>
              </thead>
              <tbody>
                {income.rows.map((r) => (
                  <StatementRow key={r.id} label={r.label} value={r.value}
                    prior={priorTb ? r.prior : undefined} emphasis={r.emphasis} strong={r.strong} />
                ))}
              </tbody>
            </table>
          </div>

          {/* §5 appropriation tail */}
          {config?.statutory_reserve_enabled && (
            <div className="mt-6">
              <h4 className="text-sm font-bold text-foreground mb-2">Appropriation of net surplus</h4>
              <p className="text-xs text-muted-foreground mb-3">
                §2.4 — the statutory reserve is taken before any dividend or interest-on-deposits payout is legally permitted.
                This is a projection off the current waterfall; it is only posted when you run the year-end appropriation job.
              </p>
              <table className="w-full text-sm">
                <tbody>
                  {approp.lines.map((l) => (
                    <StatementRow key={l.ruleType} label={`Less: ${l.name} (${l.percent}%)`} value={-l.amount} />
                  ))}
                  <StatementRow label="Surplus Available for Distribution" value={approp.availableForDistribution} strong emphasis />
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── BALANCE SHEET ────────────────────────────────────────────────── */}
      {view === 'balance' && (
        <Card title="Balance Sheet" subtitle={`§6 · Statement of Financial Position · ${subtitle} · all amounts in ${cur}`}>
          <IntegrityBanner
            ok={balance.balances}
            okText={`Assets equal Liabilities plus Equity — ${cur} ${fmtPlain(balance.totalAssets)}. The core integrity check passes.`}
            badText={`Out of balance by ${cur} ${fmtPlain(balance.difference)}. Review the trial balance on the Ledger tab for a suspense or one-sided entry.`}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wide mb-2 pb-1 border-b border-border">Assets</h4>
              <table className="w-full text-sm">
                <tbody>
                  {balance.assets.map((r) => (
                    <StatementRow key={r.id} label={r.label} value={r.value} emphasis={r.emphasis} strong={r.strong} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-6">
              <div>
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wide mb-2 pb-1 border-b border-border">Liabilities</h4>
                <p className="text-[11px] text-muted-foreground mb-1">
                  §2.3 — member savings and deposits sit here, not in equity. Members can demand withdrawal, so the society owes them.
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {balance.liabilities.map((r) => (
                      <StatementRow key={r.id} label={r.label} value={r.value} emphasis={r.emphasis} strong={r.strong} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wide mb-2 pb-1 border-b border-border">Equity</h4>
                <p className="text-[11px] text-muted-foreground mb-1">
                  Only share capital and reserves are equity — the permanent, non-withdrawable member stake.
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {balance.equity.map((r) => (
                      <StatementRow key={r.id} label={r.label} value={r.value} emphasis={r.emphasis} strong={r.strong} />
                    ))}
                    <StatementRow label="TOTAL LIABILITIES + EQUITY"
                      value={balance.totalLiabilities + balance.totalEquity} strong emphasis />
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── CASH FLOW ────────────────────────────────────────────────────── */}
      {view === 'cash' && (
        <Card title="Cash Flow Statement" subtitle={`§7 · Indirect method · ${subtitle} · all amounts in ${cur}`}>
          <IntegrityBanner
            ok={cash.reconciles}
            okText={`Net movement of ${cur} ${fmtPlain(cash.netChange)} reconciles exactly to the movement in cash and bank accounts (1010, 1011, 1020, 1021).`}
            badText={`Computed movement ${cur} ${fmtPlain(cash.netChange)} against an actual cash movement of ${cur} ${fmtPlain(cash.actualChange)} — a variance of ${cur} ${fmtPlain(cash.variance)}.`}
          />
          <table className="w-full text-sm">
            <tbody>
              <tr><td colSpan={2} className="pt-2 pb-1 text-xs font-bold text-foreground uppercase tracking-wide">Operating activities</td></tr>
              {cash.operating.rows.map((r) => <StatementRow key={r.id} label={r.label} value={r.value} />)}
              <StatementRow label="Net Cash from Operating Activities" value={cash.operating.total} emphasis />

              <tr><td colSpan={2} className="pt-5 pb-1 text-xs font-bold text-foreground uppercase tracking-wide">Investing activities</td></tr>
              {cash.investing.rows.map((r) => <StatementRow key={r.id} label={r.label} value={r.value} />)}
              <StatementRow label="Net Cash used in Investing Activities" value={cash.investing.total} emphasis />

              <tr><td colSpan={2} className="pt-5 pb-1 text-xs font-bold text-foreground uppercase tracking-wide">Financing activities</td></tr>
              {cash.financing.rows.map((r) => <StatementRow key={r.id} label={r.label} value={r.value} />)}
              <StatementRow label="Net Cash from Financing Activities" value={cash.financing.total} emphasis />

              <tr><td colSpan={2} className="pt-5" /></tr>
              <StatementRow label="Net Increase/(Decrease) in Cash" value={cash.netChange} strong emphasis />
              <StatementRow label="Cash and Cash Equivalents at Start of Period" value={cash.openingCash} />
              <StatementRow label="Cash and Cash Equivalents at End of Period" value={cash.closingCash} emphasis />
            </tbody>
          </table>
        </Card>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge status={balance.balances && cash.reconciles ? 'passed' : 'pending'} />
        Statements are generated from the trial balance every time this tab loads — nothing here is stored or hand-keyed.
      </div>
    </div>
  );
};

export default StatementsTab;
