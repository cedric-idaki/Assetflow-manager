import React, { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import Pagination from '../../../../components/ui/Pagination';
import { useClientPager } from '../../../../hooks/useClientPager';
import {
  Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field,
  TextInput, NumberInput, Select, EmptyState, KES, fmtDate,
} from '../_shared';
import {
  KESshort, pct, int, num, today, withDefaults,
  WITHHOLDING_REASONS, WITHHOLDING_EVENTS, WITHHOLDING_STATUS_HINT,
  reasonLabel, outstanding, onMarket, heldBack, isLiveWithholding,
  withholdingOverview,
} from './_util';

const PAGE_SIZE = 20;

const FILTERS = [
  { id: 'live',     label: 'Currently withheld' },
  { id: 'for_sale', label: 'On the market' },
  { id: 'closed',   label: 'Closed' },
  { id: 'all',      label: 'All' },
];

/**
 * The share withholding & sale register.
 *
 * Shares a society has held back from a member — loan security, an exit, a
 * court order, a disciplinary case — and what became of them: given back, or
 * sold on the society's own market to recover what was owed.
 *
 * Two rules shape this screen:
 *
 *   • The quantity and value on the stat cards come from the database
 *     (sacco_share_withholding_summary), never from a reduction over a fetched
 *     array — see the note on `totals` below. A withheld share is counted once,
 *     in one of exactly two places: held back, or on the market.
 *   • Nothing here moves a share. Withholding, releasing and listing all go
 *     through the engine's RPCs, which own the escrow and the ledger.
 */
const WithholdingPanel = ({ ctx, ov }) => {
  const {
    withholdings = [], withholdingEvents = [], withholdingsTruncated = false,
    shares = [], members = [], listings = [], shareSettings,
    withholdShares, releaseWithholding, listWithheldShares, getWithholdingSummary,
    exportCSV,
  } = ctx;
  const toast = useToast();
  const s = withDefaults(shareSettings);

  const [filter, setFilter] = useState('live');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);       // withholding being viewed
  const [withholdOpen, setWithholdOpen] = useState(false);

  const local = useMemo(
    () => withholdingOverview(withholdings, ov.effective, ov.totalIssued),
    [withholdings, ov.effective, ov.totalIssued]
  );

  /**
   * The headline figures come from the database, not from the array above.
   *
   * `withholdings` is fetched whole but Supabase still caps a select, so
   * reducing over it would understate the position on a society with a long
   * register — and understating how many shares are out of circulation is the
   * one number here that must not be wrong. sacco_share_withholding_summary()
   * counts every row.
   *
   * The local reduction stays as the fallback: on a database where the
   * migration has not been applied the RPC does not exist, and a register that
   * renders from what it has beats one that renders nothing.
   */
  const [totals, setTotals] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await getWithholdingSummary?.();
        if (!cancelled && row) setTotals(row);
      } catch (_) { /* RPC absent — the local reduction already covers it */ }
    })();
    return () => { cancelled = true; };
  }, [getWithholdingSummary, withholdings]);

  const wo = totals ? {
    ...local,
    heldBack: int(totals.withheld_shares),
    onMarket: int(totals.listed_shares),
    outstanding: int(totals.outstanding_shares),
    value: num(totals.withheld_value),
    bookValue: num(totals.book_value),
    members: int(totals.members_affected),
    count: int(totals.live_count),
    releasedShares: int(totals.released_shares),
    soldShares: int(totals.sold_shares),
    proceeds: num(totals.proceeds),
    ownership: num(totals.ownership_pct),
  } : local;

  const memberOf = (id) => members.find((m) => m.id === id);
  const nameOf = (w) => w.member?.full_name || memberOf(w.member_id)?.full_name || '—';
  const noOf = (w) => w.member?.member_no || memberOf(w.member_id)?.member_no || '';

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return withholdings
      .filter((w) => {
        if (filter === 'all') return true;
        if (filter === 'closed') return !isLiveWithholding(w);
        if (filter === 'for_sale') return isLiveWithholding(w) && onMarket(w) > 0;
        return isLiveWithholding(w);
      })
      .filter((w) => {
        if (!term) return true;
        return `${nameOf(w)} ${noOf(w)} ${w.ref_no || ''} ${w.reference || ''}`
          .toLowerCase().includes(term);
      });
  }, [withholdings, filter, q, members]); // eslint-disable-line react-hooks/exhaustive-deps

  const pager = useClientPager(rows, PAGE_SIZE, `${filter}|${q.trim().toLowerCase()}`);

  // The live record the modal shows: re-resolved from the array each render, so
  // a release or a sale refreshes it in place instead of freezing the snapshot
  // the row was clicked with.
  const current = open ? withholdings.find((w) => w.id === open) || null : null;

  const exportRegister = () => {
    if (rows.length === 0) { toast.info('Nothing to export.'); return; }
    exportCSV(rows.map((w) => ({
      reference: w.ref_no,
      member_no: noOf(w),
      member: nameOf(w),
      withheld_on: w.withheld_on || '',
      reason: reasonLabel(w.reason_type),
      detail: w.reason || '',
      linked_reference: w.reference || '',
      shares_withheld: int(w.shares),
      still_held: heldBack(w),
      on_the_market: onMarket(w),
      released: int(w.released_shares),
      sold: int(w.sold_shares),
      outstanding: outstanding(w),
      value_when_withheld: (outstanding(w) * num(w.unit_value)).toFixed(2),
      value_today: (outstanding(w) * ov.effective).toFixed(2),
      proceeds_recovered: num(w.proceeds).toFixed(2),
      status: w.status,
      closed_on: w.closed_on || '',
    })), 'share_withholding_register');
  };

  return (
    <div className="space-y-6">
      {/* ── The position, continuously ──────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Shares withheld"
          value={wo.outstanding.toLocaleString()}
          icon="Lock"
          tone={wo.outstanding > 0 ? 'warning' : 'muted'}
          hint={wo.outstanding > 0
            ? `${wo.heldBack.toLocaleString()} held · ${wo.onMarket.toLocaleString()} on the market`
            : 'Nothing is being held back'}
        />
        <StatCard
          label="Value withheld"
          value={KESshort(wo.value)}
          icon="Wallet"
          tone={wo.outstanding > 0 ? 'warning' : 'muted'}
          hint={ov.effective > 0
            ? `At ${KES(ov.effective)} per share`
            : 'No market value published yet'}
        />
        <StatCard
          label="Members affected"
          value={wo.members.toLocaleString()}
          icon="Users"
          tone="primary"
          hint={`${wo.count} open record${wo.count === 1 ? '' : 's'} · ${pct(wo.ownership, 2)} of shares in issue`}
        />
        <StatCard
          label="Recovered by sale"
          value={KESshort(wo.proceeds)}
          icon="HandCoins"
          tone="success"
          hint={`${wo.soldShares.toLocaleString()} sold · ${wo.releasedShares.toLocaleString()} released back`}
        />
      </div>

      {/* Book value vs today's value: what holding rather than selling has
          cost or earned the society so far. Only worth showing once the two
          can actually differ. */}
      {wo.outstanding > 0 && wo.bookValue > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Valued when withheld</p>
              <p className="text-lg font-bold text-foreground">{KES(wo.bookValue)}</p>
            </div>
            <Icon name="ArrowRight" size={16} color="var(--color-muted-foreground)" />
            <div>
              <p className="text-xs text-muted-foreground">Valued today</p>
              <p className="text-lg font-bold text-foreground">{KES(wo.value)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Movement while held</p>
              <p className={`text-lg font-bold ${
                wo.value > wo.bookValue ? 'text-emerald-600'
                : wo.value < wo.bookValue ? 'text-red-600' : 'text-foreground'}`}>
                {wo.value >= wo.bookValue ? '+' : ''}{KES(wo.value - wo.bookValue)}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── The register ────────────────────────────────────────────────── */}
      <Card
        title="Withholding register"
        subtitle="Every share the society has held back, and what became of it"
        actions={(
          <div className="flex items-center gap-2">
            <GhostButton icon="Download" onClick={exportRegister}>Export</GhostButton>
            <PrimaryButton icon="Lock" onClick={() => setWithholdOpen(true)}>Withhold shares</PrimaryButton>
          </div>
        )}
      >
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                filter === f.id
                  ? 'border-primary/40 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              style={filter === f.id ? { background: 'rgba(52,193,221,0.10)' } : {}}
            >
              {f.label}
            </button>
          ))}
          <div className="flex-1 min-w-[180px]">
            <TextInput
              placeholder="Search member, reference or WH number…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {withholdingsTruncated && (
          <p className="text-xs text-amber-600 mb-3">
            This register is longer than the browser holds — the totals above count every
            record, but the table below shows the most recent ones. Export for the full list.
          </p>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon="Lock"
            title={filter === 'live' ? 'No shares are being withheld' : 'Nothing matches that'}
            hint={filter === 'live'
              ? 'Withhold shares when the society needs to hold a member’s stake back — as loan security, on exit, or under a court order.'
              : 'Try another filter or clear the search.'}
          />
        ) : (
          <>
            <Table columns={['Reference', 'Member', 'Withheld', 'On the market', 'Value today', 'Reason', 'Status', '']}>
              {pager.rows.map((w) => {
                const out = outstanding(w);
                return (
                  <tr
                    key={w.id}
                    className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer"
                    onClick={() => setOpen(w.id)}
                  >
                    <td className="py-3 pr-4">
                      <span className="font-mono text-xs font-semibold text-foreground">{w.ref_no}</span>
                      <span className="block text-xs text-muted-foreground">{fmtDate(w.withheld_on)}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-medium text-foreground">{nameOf(w)}</span>
                      {noOf(w) && <span className="block text-xs text-muted-foreground">{noOf(w)}</span>}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-semibold text-foreground">{heldBack(w).toLocaleString()}</span>
                      {int(w.shares) !== out && (
                        <span className="block text-xs text-muted-foreground">of {int(w.shares).toLocaleString()} taken</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {onMarket(w) > 0
                        ? <span className="font-medium text-amber-600">{onMarket(w).toLocaleString()}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 pr-4 font-medium text-foreground">
                      {out > 0 ? KES(out * ov.effective) : '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-foreground">{reasonLabel(w.reason_type)}</span>
                      {w.reference && <span className="block text-xs text-muted-foreground">{w.reference}</span>}
                    </td>
                    <td className="py-3 pr-4"><Badge status={w.status} /></td>
                    <td className="py-3 text-right">
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
              noun="withholding records"
            />
          </>
        )}
      </Card>

      {withholdOpen && (
        <WithholdModal
          shares={shares}
          members={members}
          withholdings={withholdings}
          effective={ov.effective}
          onClose={() => setWithholdOpen(false)}
          onSubmit={async (form) => {
            await withholdShares(form);
            toast.success('Shares withheld. They are out of circulation until the society releases or sells them.');
            setWithholdOpen(false);
          }}
        />
      )}

      {current && (
        <WithholdingRecord
          w={current}
          memberName={nameOf(current)}
          memberNo={noOf(current)}
          effective={ov.effective}
          settings={s}
          events={withholdingEvents.filter((e) => e.withholding_id === current.id)}
          orders={listings.filter((l) => l.withholding_id === current.id)}
          onClose={() => setOpen(null)}
          onRelease={releaseWithholding}
          onList={listWithheldShares}
        />
      )}
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Take shares out of circulation.
 *
 * The free figure shown per member is the one the engine enforces:
 * held − escrowed against open orders − already withheld. Showing anything
 * else would let a treasurer key in a number the database will refuse.
 */
const WithholdModal = ({ shares, members, withholdings, effective, onClose, onSubmit }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    member_id: '', shares: '', reason_type: 'loan_security',
    reason: '', reference: '', notes: '',
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Only members who actually have something to withhold.
  const holders = useMemo(() => shares
    .map((h) => {
      const m = h.member || members.find((x) => x.id === h.member_id) || {};
      const free = Math.max(0, int(h.shares_held) - int(h.locked_shares) - int(h.withheld_shares));
      return { id: h.member_id, name: m.full_name || '—', no: m.member_no || '', held: int(h.shares_held), free };
    })
    .filter((h) => h.held > 0)
    .sort((a, b) => b.free - a.free), [shares, members]);

  const picked = holders.find((h) => h.id === form.member_id);
  const qty = int(form.shares);
  const already = withholdings
    .filter((w) => w.member_id === form.member_id && isLiveWithholding(w))
    .reduce((s, w) => s + outstanding(w), 0);

  const tooMany = !!picked && qty > picked.free;

  const submit = async () => {
    if (!form.member_id) { toast.error('Choose the member whose shares are being withheld.'); return; }
    if (qty <= 0) { toast.error('Enter how many shares to withhold.'); return; }
    if (tooMany) { toast.error(`That member has only ${picked.free.toLocaleString()} shares free.`); return; }
    if (!form.reason.trim()) { toast.error('Record why the shares are being withheld.'); return; }
    setBusy(true);
    try { await onSubmit(form); }
    catch (e) { toast.error(e.message || 'Could not withhold those shares.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Withhold shares"
      footer={(
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton icon="Lock" onClick={submit} disabled={busy}>
            {busy ? 'Working…' : 'Withhold'}
          </PrimaryButton>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Withheld shares stay in the member’s name and keep earning dividends, but cannot be
          sold or transferred by them. The society can later release them or place them for sale.
        </p>

        <Field label="Member">
          <Select value={form.member_id} onChange={(e) => set('member_id', e.target.value)}>
            <option value="">Choose a member…</option>
            {holders.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}{h.no ? ` (${h.no})` : ''} — {h.free.toLocaleString()} free of {h.held.toLocaleString()}
              </option>
            ))}
          </Select>
        </Field>

        {picked && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shares held</span>
              <span className="font-semibold text-foreground">{picked.held.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Free to withhold</span>
              <span className="font-semibold text-foreground">{picked.free.toLocaleString()}</span>
            </div>
            {already > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already withheld</span>
                <span className="font-semibold text-amber-600">{already.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Shares to withhold">
            <NumberInput
              min="1"
              value={form.shares}
              onChange={(e) => set('shares', e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Value at today’s price">
            <div className="px-3 py-2 text-sm rounded-lg border border-border bg-muted/40 text-foreground">
              {qty > 0 && effective > 0 ? KES(qty * effective) : '—'}
            </div>
          </Field>
        </div>

        {tooMany && (
          <p className="text-xs text-red-600">
            Only {picked.free.toLocaleString()} of this member’s shares are free — the rest are
            already listed or withheld.
          </p>
        )}

        <Field label="Why">
          <Select value={form.reason_type} onChange={(e) => set('reason_type', e.target.value)}>
            {WITHHOLDING_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground -mt-2">
          {WITHHOLDING_REASONS.find((r) => r.value === form.reason_type)?.hint}
        </p>

        <Field label="Reason (recorded against the member)">
          <TextInput
            value={form.reason}
            onChange={(e) => set('reason', e.target.value)}
            placeholder="e.g. Security for loan LN-0042, board minute 14/2026"
          />
        </Field>

        <Field label="Linked reference (optional)">
          <TextInput
            value={form.reference}
            onChange={(e) => set('reference', e.target.value)}
            placeholder="Loan no., case no., minute ref."
          />
        </Field>

        <Field label="Notes (optional)">
          <TextInput value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
};

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * One withholding, in full: where its shares stand right now, and the complete
 * history of everything that has happened to them.
 */
const WithholdingRecord = ({
  w, memberName, memberNo, effective, settings, events, orders, onClose, onRelease, onList,
}) => {
  const toast = useToast();
  const [mode, setMode] = useState(null);         // 'release' | 'list'
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [price, setPrice] = useState('');
  const [expiry, setExpiry] = useState('');

  const out = outstanding(w);
  const held = heldBack(w);
  const listed = onMarket(w);
  const liveOrders = orders.filter((l) => ['open', 'pending_approval'].includes(l.status));

  const startRelease = () => { setQty(''); setReason(''); setMode('release'); };
  const startList = () => {
    setQty(String(held));
    setPrice(effective > 0 ? String(effective) : '');
    setExpiry('');
    setMode('list');
  };

  const doRelease = async () => {
    setBusy(true);
    try {
      await onRelease(w, { shares: qty, reason });
      toast.success('Released. The shares are the member’s to trade again.');
      setMode(null);
    } catch (e) { toast.error(e.message || 'Could not release those shares.'); }
    finally { setBusy(false); }
  };

  const doList = async () => {
    setBusy(true);
    try {
      await onList(w, { shares: qty, price, expiry_date: expiry });
      toast.success('Placed for sale. It settles through the marketplace like any other order.');
      setMode(null);
    } catch (e) { toast.error(e.message || 'Could not place those shares for sale.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${w.ref_no} — ${memberName}`}
      footer={(
        <>
          <GhostButton onClick={onClose}>Close</GhostButton>
          {held > 0 && (
            <GhostButton icon="Store" onClick={startList}>Place for sale</GhostButton>
          )}
          {held > 0 && (
            <PrimaryButton icon="Unlock" onClick={startRelease}>Release</PrimaryButton>
          )}
        </>
      )}
    >
      <div className="space-y-5">
        {/* Where the shares stand */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat k="Still held" v={held.toLocaleString()} tone={held > 0 ? 'text-amber-600' : ''} />
          <Stat k="On the market" v={listed.toLocaleString()} tone={listed > 0 ? 'text-sky-600' : ''} />
          <Stat k="Released back" v={int(w.released_shares).toLocaleString()} />
          <Stat k="Sold" v={int(w.sold_shares).toLocaleString()} />
        </div>

        <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
          <Row k="Member" v={`${memberName}${memberNo ? ` (${memberNo})` : ''}`} />
          <Row k="Withheld on" v={fmtDate(w.withheld_on)} />
          <Row k="Shares taken" v={int(w.shares).toLocaleString()} />
          <Row k="Reason" v={`${reasonLabel(w.reason_type)}${w.reason ? ` — ${w.reason}` : ''}`} />
          {w.reference && <Row k="Linked reference" v={w.reference} />}
          <Row k="Value when withheld" v={KES(int(w.shares) * num(w.unit_value))} />
          <Row k="Outstanding value today" v={KES(out * effective)} bold />
          {num(w.proceeds) > 0 && (
            <Row k="Recovered by sale" v={KES(w.proceeds)} tone="text-emerald-600" bold />
          )}
          {w.notes && <Row k="Notes" v={w.notes} />}
          <Row k="Status" v={WITHHOLDING_STATUS_HINT[w.status] || w.status} />
          {w.closed_on && <Row k="Closed on" v={fmtDate(w.closed_on)} />}
        </div>

        {liveOrders.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">On the market now</h4>
            <Table columns={['Shares', 'Price', 'Filled', 'Expires', 'Status']}>
              {liveOrders.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-medium text-foreground">{int(l.shares).toLocaleString()}</td>
                  <td className="py-2 pr-4">{KES(l.price_per_share)}</td>
                  <td className="py-2 pr-4">{int(l.filled_shares).toLocaleString()}</td>
                  <td className="py-2 pr-4">{l.expiry_date ? fmtDate(l.expiry_date) : 'No expiry'}</td>
                  <td className="py-2 pr-4"><Badge status={l.status} /></td>
                </tr>
              ))}
            </Table>
            <p className="text-xs text-muted-foreground mt-2">
              Cancel a sale order from the Marketplace tab — its shares come straight back under
              this withholding rather than falling free.
            </p>
          </div>
        )}

        {/* The complete history */}
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">History</h4>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-3">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(52,193,221,0.10)' }}>
                    <Icon name={EVENT_ICONS[e.event_type] || 'Dot'} size={14} color="#1da8c5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{WITHHOLDING_EVENTS[e.event_type] || e.event_type}</span>
                      {int(e.shares) > 0 && ` — ${int(e.shares).toLocaleString()} share${int(e.shares) === 1 ? '' : 's'}`}
                      {num(e.amount) > 0 && ` · ${KES(e.amount)}`}
                    </p>
                    {e.reason && <p className="text-xs text-muted-foreground">{e.reason}</p>}
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString('en-KE')}
                      {e.actor_name ? ` · ${e.actor_name}` : ''}
                      {' · '}{int(e.outstanding_after).toLocaleString()} left withheld
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* ── Release ─────────────────────────────────────────────────────── */}
      <Modal
        open={mode === 'release'}
        onClose={() => setMode(null)}
        title="Release withheld shares"
        footer={(
          <>
            <GhostButton onClick={() => setMode(null)}>Cancel</GhostButton>
            <PrimaryButton icon="Unlock" onClick={doRelease} disabled={busy}>
              {busy ? 'Working…' : 'Release'}
            </PrimaryButton>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {held.toLocaleString()} share{held === 1 ? ' is' : 's are'} still held under {w.ref_no}.
            Leave the quantity blank to release all of them.
          </p>
          <Field label="Shares to release">
            <NumberInput
              min="1"
              max={held}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={`All ${held.toLocaleString()}`}
            />
          </Field>
          <Field label="Reason (optional)">
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Loan LN-0042 cleared"
            />
          </Field>
        </div>
      </Modal>

      {/* ── Place for sale ──────────────────────────────────────────────── */}
      <Modal
        open={mode === 'list'}
        onClose={() => setMode(null)}
        title="Place withheld shares for sale"
        footer={(
          <>
            <GhostButton onClick={() => setMode(null)}>Cancel</GhostButton>
            <PrimaryButton icon="Store" onClick={doList} disabled={busy}>
              {busy ? 'Working…' : 'Place for sale'}
            </PrimaryButton>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            The shares go onto the society’s internal market as a sell order. When a buyer takes it,
            settlement discharges this withholding and the proceeds are recorded against it.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Shares to offer">
              <NumberInput min="1" max={held} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Price per share">
              <NumberInput
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={effective > 0 ? String(effective) : '0.00'}
              />
            </Field>
          </div>
          {settings.price_floor_is_par && (
            <p className="text-xs text-muted-foreground -mt-2">
              This society does not allow a price below par ({KES(settings.par_value)}).
            </p>
          )}
          <Field label="Expires (optional)">
            <TextInput type="date" min={today()} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
          {int(qty) > 0 && num(price) > 0 && (
            <p className="text-sm text-foreground">
              Offering <strong>{int(qty).toLocaleString()}</strong> shares at{' '}
              <strong>{KES(price)}</strong> — <strong>{KES(int(qty) * num(price))}</strong> if fully taken.
            </p>
          )}
        </div>
      </Modal>
    </Modal>
  );
};

const EVENT_ICONS = {
  withheld: 'Lock',
  listed: 'Store',
  unlisted: 'Undo2',
  sold: 'HandCoins',
  released: 'Unlock',
  reversed: 'RotateCcw',
};

const Stat = ({ k, v, tone = 'text-foreground' }) => (
  <div className="rounded-lg border border-border p-3">
    <p className="text-xs text-muted-foreground">{k}</p>
    <p className={`text-lg font-bold mt-0.5 ${tone || 'text-foreground'}`}>{v}</p>
  </div>
);

const Row = ({ k, v, tone = 'text-foreground', bold }) => (
  <div className="flex items-start justify-between gap-4">
    <span className="text-muted-foreground shrink-0">{k}</span>
    <span className={`text-right ${tone} ${bold ? 'font-bold' : 'font-medium'}`}>{v}</span>
  </div>
);

export default WithholdingPanel;
