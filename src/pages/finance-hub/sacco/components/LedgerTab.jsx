/**
 * Ledger tab — §10.3 trial balance, §8 member sub-ledger, and the two integrity
 * checks that sit between them:
 *
 *   • control-account reconciliation — each member sub-ledger column (shares,
 *     savings, loans) must roll up to its own GL control account;
 *   • §9.2 loanable-funds ceiling for a BOSA-only society.
 */
import React, { useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import {
  Card, StatCard, EmptyState, Table,
} from '../../../sacco-dashboard/components/_shared';
import { ACCOUNT_CLASSES } from '../../../../config/saccoAccountingConfig';
import {
  indexTrialBalance, classTotal, netSurplusOf, fmtPlain,
  buildMemberSubLedger, reconcileControlAccounts, loanableFundsCheck, round2,
} from '../../../../utils/saccoAccounting';

const CheckRow = ({ ok, label, detail }) => (
  <div className={`flex items-start gap-3 p-3 rounded-lg border ${ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
    <Icon name={ok ? 'CheckCircle2' : 'AlertTriangle'} size={16} color={ok ? '#059669' : '#ca8a04'} />
    <div className="min-w-0">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
    </div>
  </div>
);

const LedgerTab = ({ fin, ops, trialBalanceRows, asAt }) => {
  const { config } = fin;
  const cur = config?.base_currency || 'KES';

  const tb = useMemo(() => indexTrialBalance(trialBalanceRows || []), [trialBalanceRows]);

  const rows = useMemo(
    () => (trialBalanceRows || []).filter((r) => Number(r.total_debit) !== 0 || Number(r.total_credit) !== 0),
    [trialBalanceRows]);

  const totals = useMemo(() => ({
    debit:  round2(rows.reduce((s, r) => s + (Number(r.total_debit) || 0), 0)),
    credit: round2(rows.reduce((s, r) => s + (Number(r.total_credit) || 0), 0)),
  }), [rows]);

  const assets      = classTotal(tb, 'asset');
  const liabilities = classTotal(tb, 'liability');
  const equity      = classTotal(tb, 'equity');
  const surplus     = netSurplusOf(tb);
  const accountingDiff = round2(assets - liabilities - equity - surplus);

  const subLedger = useMemo(() => buildMemberSubLedger({
    members: ops.members, contributions: ops.contributions,
    shares: ops.shares, loans: ops.loans, schedules: ops.schedules,
  }), [ops]);

  const controls = useMemo(() => reconcileControlAccounts(subLedger.totals, tb), [subLedger.totals, tb]);

  const funds = useMemo(() => loanableFundsCheck({
    shareCapital: subLedger.totals.shareCapital,
    savings: subLedger.totals.savings,
    loansOut: subLedger.totals.loanBalance,
    multiple: config?.loanable_funds_multiple || 0,
  }), [subLedger.totals, config?.loanable_funds_multiple]);

  const grouped = useMemo(() => {
    const g = {};
    rows.forEach((r) => { (g[r.account_class] = g[r.account_class] || []).push(r); });
    return g;
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total assets"      value={fmtPlain(assets)}      icon="Wallet"    hint={`as at ${asAt}`} />
        <StatCard label="Total liabilities" value={fmtPlain(liabilities)} icon="Landmark"  tone="warning" hint="member savings are a liability" />
        <StatCard label="Total equity"      value={fmtPlain(equity)}      icon="PieChart"  tone="success" hint="share capital + reserves" />
        <StatCard label="Surplus to date"   value={fmtPlain(surplus)}     icon="TrendingUp" tone="primary" hint="income less expenses, unappropriated" />
      </div>

      {/* Integrity checks */}
      <Card title="Integrity checks" subtitle="Run automatically off the trial balance — §6 and §8.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <CheckRow
            ok={Math.abs(totals.debit - totals.credit) < 0.01}
            label="Trial balance is in balance"
            detail={`Debits ${cur} ${fmtPlain(totals.debit)} · Credits ${cur} ${fmtPlain(totals.credit)}`}
          />
          <CheckRow
            ok={Math.abs(accountingDiff) < 0.01}
            label="Assets = Liabilities + Equity + unappropriated surplus"
            detail={Math.abs(accountingDiff) < 0.01
              ? 'The accounting equation holds at this date.'
              : `Out by ${cur} ${fmtPlain(accountingDiff)} — review for a suspense or misposted entry.`}
          />
          {controls.map((c) => (
            <CheckRow key={c.label} ok={c.ok}
              label={`${c.label} control account (${c.codes.join(', ')})`}
              detail={`Member sub-ledger ${cur} ${fmtPlain(c.subledger)} · General ledger ${cur} ${fmtPlain(c.gl)}${
                c.ok ? '' : ` · difference ${cur} ${fmtPlain(c.difference)} — run Sync from operations on the Journal tab`}`}
            />
          ))}
          {config?.loan_book_enabled && Number(config?.loanable_funds_multiple) > 0 && (
            <CheckRow
              ok={!funds.breached}
              label={`Loanable-funds ceiling (${config.loanable_funds_multiple}× shares + savings)`}
              detail={`Loans out ${cur} ${fmtPlain(funds.loansOut)} against a ceiling of ${cur} ${fmtPlain(funds.ceiling)} · ${funds.utilisation}% used`}
            />
          )}
        </div>
      </Card>

      {/* Trial balance */}
      <Card title="Trial balance" subtitle={`§10.3 — the single source of truth every statement is built from. Cumulative to ${asAt}.`}>
        {rows.length === 0 ? (
          <EmptyState icon="Scale" title="Nothing posted yet" hint="Post a transaction or sync sacco operations from the Journal tab." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-medium w-20">Code</th>
                  <th className="py-2 pr-4 font-medium">Account</th>
                  <th className="py-2 pr-4 font-medium text-right w-36">Debit</th>
                  <th className="py-2 pr-4 font-medium text-right w-36">Credit</th>
                  <th className="py-2 font-medium text-right w-36">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ACCOUNT_CLASSES.filter((c) => grouped[c.id]?.length).map((c) => (
                  <React.Fragment key={c.id}>
                    <tr className="bg-muted/40">
                      <td colSpan={5} className="py-1.5 px-2 text-xs font-bold text-foreground uppercase tracking-wide">{c.label}</td>
                    </tr>
                    {grouped[c.id].map((r) => (
                      <tr key={r.account_code} className="border-b border-border">
                        <td className="py-2 pr-4 font-mono text-xs text-foreground">{r.account_code}</td>
                        <td className="py-2 pr-4 text-foreground">{r.account_name}</td>
                        <td className="py-2 pr-4 text-right font-mono text-xs">{fmtPlain(r.total_debit)}</td>
                        <td className="py-2 pr-4 text-right font-mono text-xs">{fmtPlain(r.total_credit)}</td>
                        <td className="py-2 text-right font-mono text-xs font-semibold">{fmtPlain(r.balance)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-foreground/20 font-bold text-sm">
                  <td colSpan={2} className="py-2 pr-4 text-foreground">TOTALS</td>
                  <td className="py-2 pr-4 text-right font-mono">{fmtPlain(totals.debit)}</td>
                  <td className="py-2 pr-4 text-right font-mono">{fmtPlain(totals.credit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Member sub-ledger */}
      <Card
        title="Member sub-ledger"
        subtitle="§8 — a member is owner, depositor and borrower at once. Each column rolls up to its own control account: shares → 3010 (equity), savings → 2010 (liability), loans → 1100 (asset)."
      >
        {subLedger.rows.length === 0 ? (
          <EmptyState icon="Users" title="No members yet" hint="Register members on the sacco dashboard first." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-medium">Member</th>
                  <th className="py-2 pr-4 font-medium w-24">No.</th>
                  <th className="py-2 pr-4 font-medium text-right w-36">Share capital<br /><span className="font-normal">3010 · equity</span></th>
                  <th className="py-2 pr-4 font-medium text-right w-36">Savings<br /><span className="font-normal">2010 · liability</span></th>
                  <th className="py-2 pr-4 font-medium text-right w-36">Loan balance<br /><span className="font-normal">1100 · asset</span></th>
                  <th className="py-2 font-medium text-right w-36">Net position</th>
                </tr>
              </thead>
              <tbody>
                {subLedger.rows.map((r) => (
                  <tr key={r.memberId} className="border-b border-border">
                    <td className="py-2 pr-4 text-foreground">{r.name}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{r.memberNo || '—'}</td>
                    <td className="py-2 pr-4 text-right font-mono text-xs">{fmtPlain(r.shareCapital)}</td>
                    <td className="py-2 pr-4 text-right font-mono text-xs">{fmtPlain(r.savings)}</td>
                    <td className="py-2 pr-4 text-right font-mono text-xs">{fmtPlain(r.loanBalance)}</td>
                    <td className={`py-2 text-right font-mono text-xs font-semibold ${r.netPosition < 0 ? 'text-red-600' : 'text-foreground'}`}>
                      {fmtPlain(r.netPosition)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-foreground/20 font-bold text-sm">
                  <td colSpan={2} className="py-2 pr-4 text-foreground">TOTALS</td>
                  <td className="py-2 pr-4 text-right font-mono">{fmtPlain(subLedger.totals.shareCapital)}</td>
                  <td className="py-2 pr-4 text-right font-mono">{fmtPlain(subLedger.totals.savings)}</td>
                  <td className="py-2 pr-4 text-right font-mono">{fmtPlain(subLedger.totals.loanBalance)}</td>
                  <td className="py-2 text-right font-mono">
                    {fmtPlain(subLedger.totals.shareCapital + subLedger.totals.savings - subLedger.totals.loanBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Loan classification history */}
      {fin.classifications.length > 0 && (
        <Card title="Latest loan classification run" subtitle="§2.5 — produced by the provisioning batch job on the Period Close tab.">
          <Table columns={['Member', 'Outstanding', 'Days in arrears', 'Classification', 'Provision %', 'Provision']}>
            {fin.classifications.slice(0, 40).map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="py-2 pr-4 text-foreground">{c.member?.full_name || '—'}</td>
                <td className="py-2 pr-4 font-mono text-xs">{fmtPlain(c.outstanding)}</td>
                <td className="py-2 pr-4 font-mono text-xs">{c.days_in_arrears}</td>
                <td className="py-2 pr-4 capitalize">{c.classification}</td>
                <td className="py-2 pr-4 font-mono text-xs">{Number(c.provision_pct)}%</td>
                <td className="py-2 pr-4 font-mono text-xs font-semibold">{fmtPlain(c.provision_amount)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
};

export default LedgerTab;
