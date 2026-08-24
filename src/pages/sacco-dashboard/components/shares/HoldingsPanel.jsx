import React, { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import { supabase } from '../../../../lib/supabase';
import { fetchAllRows } from '../../../../lib/fetchAllRows';
import Pagination from '../../../../components/ui/Pagination';
import { useClientPager } from '../../../../hooks/useClientPager';
import {
  Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field,
  TextInput, NumberInput, Select, EmptyState, KES, fmtDate,
} from '../_shared';
import {
  KESshort, pct, int, num, gainTone, gainSign, memberPosition, TXN_LABELS,
  withDefaults, printCertificate,
} from './_util';

/** Holders per page in the register. */
const PAGE_SIZE = 25;

const SORTS = {
  shares: (a, b) => int(b.shares_held) - int(a.shares_held),
  name: (a, b) => String(a.member?.full_name || '').localeCompare(String(b.member?.full_name || '')),
  gain: (a, b) => (int(b.shares_held) - num(b.total_invested)) - (int(a.shares_held) - num(a.total_invested)),
  dividends: (a, b) => num(b.dividends_earned) - num(a.dividends_earned),
};

/**
 * The share register, plus a full portfolio drill-down per member: current
 * position, cost basis, every purchase and sale, transfers, dividends,
 * certificates and voting weight.
 */
const HoldingsPanel = ({ ctx, ov }) => {
  const {
    shares = [], sharesTruncated = false, members = [], certificates = [],
    dividendAllocations = [], dividends = [], listings = [], transfers = [],
    shareSettings, sacco, saveShares, freezeMember, reissueCertificate, exportCSV,
  } = ctx;
  const toast = useToast();
  const s = withDefaults(shareSettings);

  const [q, setQ] = useState('');
  const [sort, setSort] = useState('shares');
  const [openMember, setOpenMember] = useState(null);   // holding row
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({ member_id: '', shares_held: '', par_value: '' });
  const setEF = (k, v) => setEditForm((p) => ({ ...p, [k]: v }));

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || '—';
  const memberOf = (id) => members.find((m) => m.id === id);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return shares
      .filter((r) => int(r.shares_held) > 0 || r.is_frozen || num(r.dividends_earned) > 0)
      .filter((r) => {
        if (!term) return true;
        const m = r.member || memberOf(r.member_id) || {};
        return `${m.full_name || ''} ${m.member_no || ''}`.toLowerCase().includes(term);
      })
      .sort(SORTS[sort] || SORTS.shares);
  }, [shares, q, sort, members]); // eslint-disable-line react-hooks/exhaustive-deps

  // The register is the whole book now, so it is paged for rendering only —
  // `totals` and the export below still run over every row.
  const pager = useClientPager(rows, PAGE_SIZE, `${q.trim().toLowerCase()}|${sort}`);

  /**
   * One member's own trading history, read completely when their portfolio
   * opens.
   *
   * These lists used to be filtered out of the dashboard's capped arrays, so a
   * long-standing holder's portfolio silently omitted their older purchases,
   * sales and transfers — the same failure as a short member statement, on the
   * screen a member is most likely to check against their certificate.
   */
  const [portfolio, setPortfolio] = useState(null);
  const [portfolioError, setPortfolioError] = useState(null);
  const openMemberId = openMember?.member_id || null;

  useEffect(() => {
    if (!openMemberId) { setPortfolio(null); setPortfolioError(null); return undefined; }
    let cancelled = false;
    setPortfolio(null);
    setPortfolioError(null);

    (async () => {
      try {
        const [txns, orders, trades] = await Promise.all([
          fetchAllRows(() => supabase.from('sacco_share_transactions').select('*')
            .eq('member_id', openMemberId).order('created_at', { ascending: false })),
          fetchAllRows(() => supabase.from('sacco_share_listings').select('*')
            .or(`seller_member_id.eq.${openMemberId},buyer_member_id.eq.${openMemberId}`)
            .order('created_at', { ascending: false })),
          fetchAllRows(() => supabase.from('sacco_share_transfers').select('*')
            .or(`seller_member_id.eq.${openMemberId},buyer_member_id.eq.${openMemberId}`)
            .order('created_at', { ascending: false })),
        ]);
        if (!cancelled) setPortfolio({ txns, orders, trades });
      } catch (e) {
        if (!cancelled) { setPortfolio(null); setPortfolioError(e?.message || 'Could not load this portfolio.'); }
      }
    })();

    return () => { cancelled = true; };
  }, [openMemberId]);

  const totals = rows.reduce((acc, r) => {
    const p = memberPosition(r, ov.effective, ov.totalIssued);
    acc.held += p.held; acc.invested += p.invested; acc.value += p.value;
    acc.unrealized += p.unrealized; acc.dividends += p.dividends;
    return acc;
  }, { held: 0, invested: 0, value: 0, unrealized: 0, dividends: 0 });

  const saveHolding = async () => {
    if (!editForm.member_id) { toast.error('Choose a member.'); return; }
    setSaving(true);
    try {
      await saveShares(editForm);
      toast.success('Holding recorded. Trades from here on maintain the cost basis automatically.');
      setEditOpen(false);
      setEditForm({ member_id: '', shares_held: '', par_value: '' });
    } catch (e) { toast.error(e.message || 'Could not save.'); } finally { setSaving(false); }
  };

  const exportRegister = () => exportCSV(rows.map((r) => {
    const p = memberPosition(r, ov.effective, ov.totalIssued);
    const m = r.member || memberOf(r.member_id) || {};
    return {
      member_no: m.member_no || '', member: m.full_name || '', kyc: m.kyc_status || '',
      shares: p.held, locked: p.locked, avg_buy_price: p.avg.toFixed(2),
      total_invested: p.invested.toFixed(2), market_value: p.value.toFixed(2),
      unrealized_gain: p.unrealized.toFixed(2), realized_gain: p.realized.toFixed(2),
      dividends_earned: p.dividends.toFixed(2), ownership_percent: p.ownership.toFixed(3),
      status: r.is_frozen ? 'frozen' : 'active',
    };
  }), 'share_register');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Shareholders" value={ov.shareholders.toLocaleString()} icon="Users" tone="primary" />
        <StatCard label="Member-owned shares" value={totals.held.toLocaleString()} icon="PieChart" tone="muted" />
        <StatCard label="Total invested" value={KESshort(totals.invested)} icon="Wallet" tone="muted" hint={KES(totals.invested)} />
        <StatCard label="Market value" value={KESshort(totals.value)} icon="TrendingUp" tone="success" hint={KES(totals.value)} />
        <StatCard label="Unrealised gain" value={`${gainSign(totals.unrealized)}${KESshort(totals.unrealized)}`}
          icon={totals.unrealized >= 0 ? 'ArrowUpRight' : 'ArrowDownRight'}
          tone={totals.unrealized >= 0 ? 'success' : 'warning'}
          hint={totals.invested > 0 ? pct((totals.unrealized / totals.invested) * 100, 1) : '—'} />
      </div>

      <Card
        title="Share register"
        subtitle={`${rows.length} holder${rows.length === 1 ? '' : 's'} · click a member for their full portfolio`}
        actions={(
          <div className="flex items-center gap-2">
            {rows.length > 0 && <GhostButton icon="Download" onClick={exportRegister}>Export</GhostButton>}
            <PrimaryButton icon="Plus" onClick={() => setEditOpen(true)}>Record holding</PrimaryButton>
          </div>
        )}
      >
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <Icon name="Search" size={15} color="var(--color-muted-foreground)" />
            </span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or member number"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary" />
          </div>
          <div className="w-full sm:w-52">
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="shares">Largest holding</option>
              <option value="name">Name (A–Z)</option>
              <option value="gain">Biggest gain</option>
              <option value="dividends">Most dividends</option>
            </Select>
          </div>
        </div>

        {sharesTruncated && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-warning/30 bg-warning/10">
            <Icon name="AlertTriangle" size={15} color="#ca8a04" className="mt-0.5 shrink-0" />
            <p className="text-xs text-foreground">
              This register is unusually large and is not fully loaded, so totals below may be short.
              Contact support before relying on these figures.
            </p>
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState icon="PieChart" title={q ? 'No holder matches that search' : 'No share holdings yet'}
            hint={q ? 'Try a different name or member number.' : 'Record an opening holding, or allot shares from the treasury — trades from then on keep themselves up to date.'} />
        ) : (
          <>
          <Table columns={['Member', 'Shares', 'Avg buy price', 'Current value', 'Unrealised gain', 'Dividends earned', 'Status', '']}>
            {pager.rows.map((r) => {
              const p = memberPosition(r, ov.effective, ov.totalIssued);
              const m = r.member || memberOf(r.member_id) || {};
              return (
                <tr key={r.id} className="border-b border-border/60 hover:bg-muted/50 cursor-pointer"
                  onClick={() => setOpenMember(r)}>
                  <td className="py-2.5 pr-4">
                    <p className="font-medium text-foreground">{m.full_name || memberName(r.member_id)}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.member_no || '—'} · {pct(p.ownership, 2)} ownership
                    </p>
                  </td>
                  <td className="py-2.5 pr-4 text-foreground">
                    {p.held.toLocaleString()}
                    {p.locked > 0 && <span className="block text-xs text-amber-600">{p.locked.toLocaleString()} listed</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{p.avg > 0 ? KES(p.avg) : '—'}</td>
                  <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(p.value)}</td>
                  <td className={`py-2.5 pr-4 font-semibold ${gainTone(p.unrealized)}`}>
                    {gainSign(p.unrealized)}{KES(p.unrealized)}
                    {p.invested > 0 && <span className="block text-xs font-normal">{gainSign(p.unrealizedPct)}{pct(p.unrealizedPct, 1)}</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-foreground">{p.dividends > 0 ? KES(p.dividends) : '—'}</td>
                  <td className="py-2.5 pr-4">
                    {r.is_frozen
                      ? <Badge status="suspended" />
                      : m.kyc_status === 'verified' ? <Badge status="active" /> : <Badge status="pending" />}
                  </td>
                  <td className="py-2.5 pr-0 text-right">
                    <Icon name="ChevronRight" size={16} color="var(--color-muted-foreground)" />
                  </td>
                </tr>
              );
            })}
          </Table>
          <Pagination
            page={pager.page}
            pageCount={pager.pageCount}
            from={pager.from}
            to={pager.to}
            total={pager.total}
            onPageChange={pager.setPage}
            noun={q.trim() ? 'matching holders' : 'holders'}
          />
          </>
        )}
      </Card>

      {openMember && (
        <MemberPortfolio
          holding={openMember}
          member={openMember.member || memberOf(openMember.member_id) || {}}
          ov={ov}
          settings={s}
          saccoName={sacco?.name}
          // Read for this member specifically, so the history is complete
          // rather than whatever survived the dashboard's display caps.
          txns={portfolio?.txns || []}
          orders={portfolio?.orders || []}
          trades={portfolio?.trades || []}
          loading={!portfolio && !portfolioError}
          loadError={portfolioError}
          certificates={certificates.filter((c) => c.member_id === openMember.member_id)}
          allocations={dividendAllocations.filter((a) => a.member_id === openMember.member_id)}
          dividends={dividends}
          onClose={() => setOpenMember(null)}
          onFreeze={async (frozen, reason) => {
            await freezeMember(openMember.member_id, frozen, reason);
            toast.success(frozen ? 'Holding frozen.' : 'Holding unfrozen.');
            setOpenMember(null);
          }}
          onReissue={async () => {
            await reissueCertificate(openMember.member_id);
            toast.success('Certificate reissued.');
          }}
          exportCSV={exportCSV}
        />
      )}

      {/* Opening holding — for members whose shares predate the engine */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Record an opening holding"
        footer={<>
          <GhostButton onClick={() => setEditOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={saveHolding} disabled={saving}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          Use this once, to bring an existing shareholder onto the register. Afterwards let the market do the work —
          allot from the treasury or let members trade, and the cost basis, certificates and ledger keep themselves right.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Field label="Member *">
              <Select value={editForm.member_id} onChange={(e) => setEF('member_id', e.target.value)}>
                <option value="">Select member</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Shares held"><NumberInput value={editForm.shares_held} onChange={(e) => setEF('shares_held', e.target.value)} placeholder="100" /></Field>
          <Field label="Par value (KES)"><NumberInput value={editForm.par_value} onChange={(e) => setEF('par_value', e.target.value)} placeholder={String(s.par_value)} /></Field>
        </div>
      </Modal>
    </div>
  );
};

/* ── Member portfolio ─────────────────────────────────────────────────────── */

const TABS = [
  { id: 'position', label: 'Position', icon: 'PieChart' },
  { id: 'history',  label: 'History',  icon: 'History' },
  { id: 'orders',   label: 'Orders',   icon: 'Store' },
  { id: 'dividends', label: 'Dividends', icon: 'Coins' },
  { id: 'certs',    label: 'Certificates', icon: 'Award' },
];

const MemberPortfolio = ({
  holding, member, ov, settings, saccoName, txns, certificates, allocations,
  dividends, orders, trades, loading, loadError, onClose, onFreeze, onReissue, exportCSV,
}) => {
  const toast = useToast();
  const [tab, setTab] = useState('position');
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const p = memberPosition(holding, ov.effective, ov.totalIssued);
  const purchases = txns.filter((t) => ['purchase', 'allotment', 'transfer_in'].includes(t.txn_type));
  const sales = txns.filter((t) => ['sale', 'transfer_out', 'buyback'].includes(t.txn_type));
  const votes = num(settings.votes_per_share) > 0
    ? Math.floor(p.held * num(settings.votes_per_share))
    : 1;

  const doFreeze = async () => {
    setBusy(true);
    try { await onFreeze(!holding.is_frozen, reason); }
    catch (e) { toast.error(e.message || 'Could not change the freeze.'); }
    finally { setBusy(false); setFreezeOpen(false); }
  };

  const printCert = (c) => {
    const ok = printCertificate(c, {
      saccoName, memberName: member.full_name, memberNo: member.member_no, marketValue: ov.price,
    });
    if (!ok) toast.error('Allow pop-ups to print the certificate.');
  };

  return (
    <Modal open wide onClose={onClose} title={`${member.full_name || 'Member'} — share portfolio`}
      footer={<>
        <GhostButton icon={holding.is_frozen ? 'Unlock' : 'Snowflake'} onClick={() => { setReason(''); setFreezeOpen(true); }}>
          {holding.is_frozen ? 'Unfreeze' : 'Freeze holding'}
        </GhostButton>
        <GhostButton icon="RefreshCw" onClick={async () => {
          setBusy(true);
          try { await onReissue(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
        }} disabled={busy}>Reissue certificate</GhostButton>
        <PrimaryButton icon="X" onClick={onClose}>Close</PrimaryButton>
      </>}>
      <div className="space-y-4">
        {/* A history still loading must not look like a member who has never
            traded — that is the reading the old capped filter produced. */}
        {loading && (
          <p className="text-sm text-muted-foreground">Loading this member's full trading history…</p>
        )}
        {loadError && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/10">
            <Icon name="AlertTriangle" size={15} color="#dc2626" className="mt-0.5 shrink-0" />
            <p className="text-xs text-foreground">
              This history could not be loaded in full, so the lists below may be incomplete. {loadError}
            </p>
          </div>
        )}

        {holding.is_frozen && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
            <Icon name="Snowflake" size={16} color="#dc2626" />
            <p className="text-sm text-foreground">
              <strong>Holding frozen.</strong> {holding.freeze_reason || 'Trading is blocked for this member.'}
            </p>
          </div>
        )}

        <div className="flex gap-1 flex-wrap border-b border-border pb-3">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tab === t.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
              <Icon name={t.icon} size={13} color="currentColor" />{t.label}
            </button>
          ))}
        </div>

        {tab === 'position' && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Current shares" value={p.held.toLocaleString()} icon="PieChart" tone="primary" />
              <StatCard label="Market value" value={KES(p.value)} icon="TrendingUp" tone="success" />
              <StatCard label="Average buy price" value={p.avg > 0 ? KES(p.avg) : '—'} icon="Tag" tone="muted" />
              <StatCard label="Ownership" value={pct(p.ownership, 3)} icon="Percent" tone="muted" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl border border-border">
                <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wide">Profit &amp; loss</p>
                <dl className="space-y-1.5 text-sm">
                  <Row k="Total invested" v={KES(p.invested)} />
                  <Row k="Current value" v={KES(p.value)} />
                  <Row k="Unrealised gain" v={`${gainSign(p.unrealized)}${KES(p.unrealized)}`} tone={gainTone(p.unrealized)} />
                  <Row k="Realised gain" v={`${gainSign(p.realized)}${KES(p.realized)}`} tone={gainTone(p.realized)} />
                  <Row k="Dividends earned" v={KES(p.dividends)} />
                  <Row k="Total return" v={`${gainSign(p.unrealized + p.realized + p.dividends)}${KES(p.unrealized + p.realized + p.dividends)}`}
                    tone={gainTone(p.unrealized + p.realized + p.dividends)} bold />
                </dl>
              </div>
              <div className="p-4 rounded-xl border border-border">
                <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wide">Register</p>
                <dl className="space-y-1.5 text-sm">
                  <Row k="Member no." v={member.member_no || '—'} />
                  <Row k="KYC status" v={member.kyc_status || 'pending'} />
                  <Row k="Free to trade" v={`${p.free.toLocaleString()} shares`} />
                  <Row k="Locked in open orders" v={`${p.locked.toLocaleString()} shares`} />
                  <Row k="Voting rights" v={num(settings.votes_per_share) > 0
                    ? `${votes.toLocaleString()} vote${votes === 1 ? '' : 's'} (${settings.votes_per_share}/share)`
                    : 'One member, one vote'} />
                  <Row k="First purchase" v={fmtDate(holding.first_purchase_date)} />
                  <Row k="Last trade" v={fmtDate(holding.last_trade_date)} />
                </dl>
              </div>
            </div>
          </>
        )}

        {tab === 'history' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Purchases" value={purchases.length} icon="ArrowDownLeft" tone="success"
                hint={`${purchases.reduce((s, t) => s + int(t.shares), 0).toLocaleString()} shares`} />
              <StatCard label="Sales" value={sales.length} icon="ArrowUpRight" tone="warning"
                hint={`${Math.abs(sales.reduce((s, t) => s + int(t.shares), 0)).toLocaleString()} shares`} />
              <StatCard label="Total bought" value={KESshort(purchases.reduce((s, t) => s + num(t.amount), 0))} icon="Wallet" tone="muted" />
              <StatCard label="Total sold" value={KESshort(sales.reduce((s, t) => s + num(t.amount), 0))} icon="Banknote" tone="muted" />
            </div>
            {txns.length === 0 ? (
              <EmptyState icon="History" title="No share movements recorded"
                hint="Every trade, transfer and dividend from here on is listed here." />
            ) : (
              <>
                <div className="flex justify-end">
                  <GhostButton icon="Download" onClick={() => exportCSV(txns.map((t) => ({
                    date: String(t.created_at).slice(0, 10), ref: t.txn_no, type: t.txn_type,
                    shares: t.shares, price: t.price_per_share, amount: t.amount,
                    balance_after: t.balance_after, realized_gain: t.realized_gain,
                  })), `share_history_${member.member_no || 'member'}`)}>Export</GhostButton>
                </div>
                <Table columns={['Date', 'Ref', 'Movement', 'Shares', 'Price', 'Amount', 'Balance']}>
                  {txns.map((t) => (
                    <tr key={t.id} className="border-b border-border/60">
                      <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(t.created_at)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground font-mono text-xs">{t.txn_no}</td>
                      <td className="py-2.5 pr-4 text-foreground">{TXN_LABELS[t.txn_type] || t.txn_type}</td>
                      <td className={`py-2.5 pr-4 font-semibold ${int(t.shares) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {int(t.shares) > 0 ? '+' : ''}{int(t.shares).toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{num(t.price_per_share) > 0 ? KES(t.price_per_share) : '—'}</td>
                      <td className="py-2.5 pr-4 text-foreground">{num(t.amount) > 0 ? KES(t.amount) : '—'}</td>
                      <td className="py-2.5 pr-4 text-foreground">{int(t.balance_after).toLocaleString()}</td>
                    </tr>
                  ))}
                </Table>
              </>
            )}
          </div>
        )}

        {tab === 'orders' && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Orders on the book</p>
              {orders.length === 0 ? (
                <EmptyState icon="Store" title="No orders" hint="This member has never placed a buy or sell order." />
              ) : (
                <Table columns={['Placed', 'Side', 'Shares', 'Price', 'Filled', 'Status']}>
                  {orders.map((l) => (
                    <tr key={l.id} className="border-b border-border/60">
                      <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(l.created_at)}</td>
                      <td className="py-2.5 pr-4 font-medium text-foreground capitalize">{l.side || 'sell'}</td>
                      <td className="py-2.5 pr-4 text-foreground">{int(l.shares).toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{KES(l.price_per_share)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{int(l.filled_shares).toLocaleString()}</td>
                      <td className="py-2.5 pr-4"><Badge status={l.status} /></td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Trades</p>
              {trades.length === 0 ? (
                <EmptyState icon="ArrowLeftRight" title="No trades" />
              ) : (
                <Table columns={['Date', 'Direction', 'Shares', 'Price', 'Fee', 'Status']}>
                  {trades.map((t) => (
                    <tr key={t.id} className="border-b border-border/60">
                      <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(t.settled_at || t.created_at)}</td>
                      <td className="py-2.5 pr-4 text-foreground">
                        {t.buyer_member_id === holding.member_id ? 'Bought' : 'Sold'}
                      </td>
                      <td className="py-2.5 pr-4 text-foreground">{int(t.shares).toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-foreground">{KES(t.price)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {KES(t.buyer_member_id === holding.member_id ? t.buyer_fee : t.seller_fee)}
                      </td>
                      <td className="py-2.5 pr-4"><Badge status={t.status} /></td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          </div>
        )}

        {tab === 'dividends' && (
          allocations.length === 0 ? (
            <EmptyState icon="Coins" title="No dividends allocated"
              hint="Once a declared dividend is calculated, this member's share of it appears here." />
          ) : (
            <Table columns={['Period', 'Shares at record', 'Gross', 'Tax', 'Net', 'Status', 'Paid']}>
              {allocations.map((a) => {
                const d = dividends.find((x) => x.id === a.declaration_id);
                return (
                  <tr key={a.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-4 font-medium text-foreground">{d?.period_label || '—'}</td>
                    <td className="py-2.5 pr-4 text-foreground">{int(a.shares_at_record).toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{KES(a.gross_amount)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{num(a.tax_amount) > 0 ? KES(a.tax_amount) : '—'}</td>
                    <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(a.net_amount)}</td>
                    <td className="py-2.5 pr-4"><Badge status={a.status} /></td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(a.paid_at)}</td>
                  </tr>
                );
              })}
            </Table>
          )
        )}

        {tab === 'certs' && (
          certificates.length === 0 ? (
            <EmptyState icon="Award" title="No certificates issued"
              hint="A certificate is issued automatically the first time this member acquires shares." />
          ) : (
            <Table columns={['Certificate no.', 'Shares', 'Par value', 'Issued', 'Status', '']}>
              {certificates.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 font-mono text-xs text-foreground">{c.certificate_no}</td>
                  <td className="py-2.5 pr-4 text-foreground">{int(c.shares).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{KES(c.par_value)}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(c.issue_date || c.created_at)}</td>
                  <td className="py-2.5 pr-4"><Badge status={c.status === 'active' ? 'active' : 'closed'} /></td>
                  <td className="py-2.5 pr-0 text-right">
                    <button onClick={() => printCert(c)} className="text-xs text-primary font-semibold hover:underline">Download</button>
                  </td>
                </tr>
              ))}
            </Table>
          )
        )}
      </div>

      <Modal open={freezeOpen} onClose={() => setFreezeOpen(false)}
        title={holding.is_frozen ? 'Unfreeze holding' : 'Freeze holding'}
        footer={<>
          <GhostButton onClick={() => setFreezeOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={doFreeze} disabled={busy}>{busy ? 'Working…' : 'Confirm'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          {holding.is_frozen
            ? `${member.full_name} will be able to trade again immediately.`
            : `${member.full_name} will not be able to buy, sell or transfer, and their open sell orders will be withdrawn.`}
        </p>
        {!holding.is_frozen && (
          <Field label="Reason *">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. ownership disputed" />
          </Field>
        )}
      </Modal>
    </Modal>
  );
};

const Row = ({ k, v, tone = 'text-foreground', bold }) => (
  <div className="flex items-baseline justify-between gap-4">
    <dt className="text-muted-foreground">{k}</dt>
    <dd className={`${tone} ${bold ? 'font-bold' : 'font-medium'} text-right`}>{v}</dd>
  </div>
);

export default HoldingsPanel;
