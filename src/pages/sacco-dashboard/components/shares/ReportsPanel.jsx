import React, { useMemo, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import { Card, Table, PrimaryButton, GhostButton, EmptyState, KES, fmtDate } from '../_shared';
import { KESshort, pct, int, num, memberPosition, TXN_LABELS } from './_util';

/**
 * The reporting pack a registrar or auditor actually asks for. Each report is
 * built from the same share ledger the market runs on, previewed on screen and
 * exported as CSV.
 */
const ReportsPanel = ({ ctx, ov }) => {
  const {
    shares = [], members = [], transfers = [], shareTxns = [], treasury,
    dividends = [], dividendAllocations = [], certificates = [], sharePrices = [],
    exportCSV,
  } = ctx;
  const toast = useToast();
  const [active, setActive] = useState('register');

  const memberOf = (id) => members.find((m) => m.id === id) || {};
  const memberName = (id) => memberOf(id).full_name || '—';
  const partyName = (id, t) => (t ? 'SACCO Treasury' : memberName(id));

  const settled = transfers.filter((t) => t.status === 'settled');

  const reports = useMemo(() => ({
    // ── Share register ──────────────────────────────────────────────────────
    register: {
      title: 'Share register',
      hint: 'The statutory list of every shareholder and what they hold.',
      icon: 'BookUser',
      columns: ['Member no.', 'Member', 'Shares', 'Avg cost', 'Market value', 'Ownership', 'Certificate'],
      rows: [...shares]
        .filter((r) => int(r.shares_held) > 0)
        .sort((a, b) => int(b.shares_held) - int(a.shares_held))
        .map((r) => {
          const m = r.member || memberOf(r.member_id);
          const p = memberPosition(r, ov.effective, ov.totalIssued);
          const cert = certificates.find((c) => c.member_id === r.member_id && c.status === 'active');
          return {
            cells: [m.member_no || '—', m.full_name || '—', p.held.toLocaleString(),
              KES(p.avg), KES(p.value), pct(p.ownership, 3), cert?.certificate_no || '—'],
            csv: {
              member_no: m.member_no || '', member: m.full_name || '', shares: p.held,
              avg_cost: p.avg.toFixed(2), market_value: p.value.toFixed(2),
              ownership_percent: p.ownership.toFixed(3), certificate_no: cert?.certificate_no || '',
            },
          };
        }),
    },

    // ── Treasury ────────────────────────────────────────────────────────────
    treasury: {
      title: 'Treasury report',
      hint: 'Every share the society issued, sold, bought back, retired or corrected.',
      icon: 'Landmark',
      columns: ['Date', 'Ref', 'Movement', 'Shares', 'Price', 'Pool after', 'Note'],
      rows: shareTxns.filter((t) => t.is_treasury).map((t) => ({
        cells: [fmtDate(t.created_at), t.txn_no, TXN_LABELS[t.txn_type] || t.txn_type,
          `${int(t.shares) > 0 ? '+' : ''}${int(t.shares).toLocaleString()}`,
          num(t.price_per_share) > 0 ? KES(t.price_per_share) : '—',
          int(t.balance_after).toLocaleString(), t.notes || '—'],
        csv: {
          date: String(t.created_at).slice(0, 10), ref: t.txn_no, movement: t.txn_type,
          shares: t.shares, price: t.price_per_share, pool_after: t.balance_after, note: t.notes || '',
        },
      })),
    },

    // ── Top shareholders ────────────────────────────────────────────────────
    top: {
      title: 'Top shareholders',
      hint: 'Ownership concentration, largest first.',
      icon: 'Crown',
      columns: ['#', 'Member', 'Shares', 'Value', 'Ownership', 'Cumulative'],
      rows: (() => {
        const sorted = [...shares].filter((r) => int(r.shares_held) > 0)
          .sort((a, b) => int(b.shares_held) - int(a.shares_held));
        let cum = 0;
        return sorted.map((r, i) => {
          const m = r.member || memberOf(r.member_id);
          const own = ov.totalIssued > 0 ? (int(r.shares_held) / ov.totalIssued) * 100 : 0;
          cum += own;
          return {
            cells: [i + 1, m.full_name || '—', int(r.shares_held).toLocaleString(),
              KES(int(r.shares_held) * ov.effective), pct(own, 3), pct(cum, 2)],
            csv: {
              rank: i + 1, member: m.full_name || '', shares: r.shares_held,
              value: (int(r.shares_held) * ov.effective).toFixed(2),
              ownership_percent: own.toFixed(3), cumulative_percent: cum.toFixed(2),
            },
          };
        });
      })(),
    },

    // ── Trading ─────────────────────────────────────────────────────────────
    trading: {
      title: 'Trading report',
      hint: 'Every settled trade, with the fees it generated.',
      icon: 'ArrowLeftRight',
      columns: ['Settled', 'Seller', 'Buyer', 'Shares', 'Price/share', 'Total', 'Fees', 'Type'],
      rows: settled.map((t) => ({
        cells: [fmtDate(t.settled_at || t.created_at),
          partyName(t.seller_member_id, t.seller_is_treasury),
          partyName(t.buyer_member_id, t.buyer_is_treasury),
          int(t.shares).toLocaleString(), KES(t.price_per_share), KES(t.price),
          KES(num(t.buyer_fee) + num(t.seller_fee)), t.trade_type || 'market'],
        csv: {
          settled: String(t.settled_at || t.created_at).slice(0, 10),
          seller: partyName(t.seller_member_id, t.seller_is_treasury),
          buyer: partyName(t.buyer_member_id, t.buyer_is_treasury),
          shares: t.shares, price_per_share: t.price_per_share, total: t.price,
          buyer_fee: t.buyer_fee, seller_fee: t.seller_fee, type: t.trade_type || 'market',
        },
      })),
    },

    // ── Transfers (non-market movements) ────────────────────────────────────
    transfers: {
      title: 'Transfer report',
      hint: 'Allotments, buy-backs, gifts and forced transfers — everything off the order book.',
      icon: 'Send',
      columns: ['Date', 'From', 'To', 'Shares', 'Value', 'Type', 'Reason'],
      rows: settled.filter((t) => t.trade_type && t.trade_type !== 'market').map((t) => ({
        cells: [fmtDate(t.settled_at || t.created_at),
          partyName(t.seller_member_id, t.seller_is_treasury),
          partyName(t.buyer_member_id, t.buyer_is_treasury),
          int(t.shares).toLocaleString(), KES(t.price), t.trade_type, t.reason || '—'],
        csv: {
          date: String(t.settled_at || t.created_at).slice(0, 10),
          from: partyName(t.seller_member_id, t.seller_is_treasury),
          to: partyName(t.buyer_member_id, t.buyer_is_treasury),
          shares: t.shares, value: t.price, type: t.trade_type, reason: t.reason || '',
        },
      })),
    },

    // ── Capital growth ──────────────────────────────────────────────────────
    capital: {
      title: 'Capital growth',
      hint: 'How the share price and the society\'s capitalisation have moved.',
      icon: 'TrendingUp',
      columns: ['Effective date', 'Share price', 'Change', 'Shares in issue', 'Market cap', 'Note'],
      rows: sharePrices.map((p, i) => {
        const prev = num(sharePrices[i + 1]?.market_value);
        const delta = num(p.market_value) - prev;
        return {
          cells: [fmtDate(p.effective_date), KES(p.market_value),
            i === sharePrices.length - 1 ? '—' : `${delta >= 0 ? '+' : ''}${KES(delta)}`,
            ov.totalIssued.toLocaleString(), KES(num(p.market_value) * ov.totalIssued), p.note || '—'],
          csv: {
            effective_date: p.effective_date, share_price: p.market_value,
            change: i === sharePrices.length - 1 ? '' : delta.toFixed(2),
            shares_in_issue: ov.totalIssued,
            market_cap: (num(p.market_value) * ov.totalIssued).toFixed(2),
            note: p.note || '',
          },
        };
      }),
    },

    // ── Dividends ───────────────────────────────────────────────────────────
    dividends: {
      title: 'Dividend report',
      hint: 'Every declaration and what it cost the society.',
      icon: 'Coins',
      columns: ['Period', 'Record date', 'Per share', 'Members', 'Gross', 'Tax', 'Net paid', 'Status'],
      rows: dividends.map((d) => {
        const allocs = dividendAllocations.filter((a) => a.declaration_id === d.id);
        const net = allocs.reduce((s, a) => s + num(a.net_amount), 0);
        return {
          cells: [d.period_label, fmtDate(d.record_date), KES(d.dividend_per_share),
            d.members_count || allocs.length, KES(d.total_payable), KES(d.total_tax),
            KES(net), d.status],
          csv: {
            period: d.period_label, record_date: d.record_date, payment_date: d.payment_date || '',
            per_share: d.dividend_per_share, members: d.members_count,
            gross: d.total_payable, tax: d.total_tax, net: net.toFixed(2),
            payout_method: d.payout_method, status: d.status,
          },
        };
      }),
    },

    // ── Member holdings (with P&L) ──────────────────────────────────────────
    holdings: {
      title: 'Member holdings',
      hint: 'Every holder\'s position, cost basis and return.',
      icon: 'PieChart',
      columns: ['Member', 'Shares', 'Invested', 'Value', 'Unrealised', 'Realised', 'Dividends', 'Total return'],
      rows: [...shares].filter((r) => int(r.shares_held) > 0 || num(r.dividends_earned) > 0)
        .sort((a, b) => int(b.shares_held) - int(a.shares_held))
        .map((r) => {
          const m = r.member || memberOf(r.member_id);
          const p = memberPosition(r, ov.effective, ov.totalIssued);
          const total = p.unrealized + p.realized + p.dividends;
          return {
            cells: [m.full_name || '—', p.held.toLocaleString(), KES(p.invested), KES(p.value),
              KES(p.unrealized), KES(p.realized), KES(p.dividends), KES(total)],
            csv: {
              member: m.full_name || '', member_no: m.member_no || '', shares: p.held,
              invested: p.invested.toFixed(2), market_value: p.value.toFixed(2),
              unrealized_gain: p.unrealized.toFixed(2), realized_gain: p.realized.toFixed(2),
              dividends_earned: p.dividends.toFixed(2), total_return: total.toFixed(2),
            },
          };
        }),
    },

    // ── Inactive shareholders ───────────────────────────────────────────────
    inactive: {
      title: 'Inactive shareholders',
      hint: 'Holders who have not traded in the last twelve months.',
      icon: 'MoonStar',
      columns: ['Member', 'Shares', 'Value', 'Last trade', 'First purchase', 'Status'],
      rows: (() => {
        const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
        const iso = cutoff.toISOString().slice(0, 10);
        return [...shares]
          .filter((r) => int(r.shares_held) > 0 && (!r.last_trade_date || r.last_trade_date < iso))
          .sort((a, b) => int(b.shares_held) - int(a.shares_held))
          .map((r) => {
            const m = r.member || memberOf(r.member_id);
            return {
              cells: [m.full_name || '—', int(r.shares_held).toLocaleString(),
                KES(int(r.shares_held) * ov.effective),
                r.last_trade_date ? fmtDate(r.last_trade_date) : 'Never',
                fmtDate(r.first_purchase_date), r.is_frozen ? 'Frozen' : (m.status || 'active')],
              csv: {
                member: m.full_name || '', member_no: m.member_no || '', shares: r.shares_held,
                value: (int(r.shares_held) * ov.effective).toFixed(2),
                last_trade: r.last_trade_date || '', first_purchase: r.first_purchase_date || '',
                status: r.is_frozen ? 'frozen' : (m.status || 'active'),
              },
            };
          });
      })(),
    },

    // ── Tax ─────────────────────────────────────────────────────────────────
    tax: {
      title: 'Tax report',
      hint: 'Withholding tax on dividends, and realised gains per member.',
      icon: 'Receipt',
      columns: ['Member', 'Dividends gross', 'Tax withheld', 'Dividends net', 'Realised gain'],
      rows: (() => {
        const map = new Map();
        dividendAllocations.filter((a) => a.status === 'paid').forEach((a) => {
          const row = map.get(a.member_id) || { gross: 0, tax: 0, net: 0 };
          row.gross += num(a.gross_amount); row.tax += num(a.tax_amount); row.net += num(a.net_amount);
          map.set(a.member_id, row);
        });
        shares.forEach((r) => {
          if (num(r.realized_gain) === 0) return;
          const row = map.get(r.member_id) || { gross: 0, tax: 0, net: 0 };
          row.realized = num(r.realized_gain);
          map.set(r.member_id, row);
        });
        return [...map.entries()].map(([id, v]) => {
          const m = memberOf(id);
          return {
            cells: [m.full_name || '—', KES(v.gross), KES(v.tax), KES(v.net), KES(v.realized || 0)],
            csv: {
              member: m.full_name || '', member_no: m.member_no || '',
              dividends_gross: v.gross.toFixed(2), tax_withheld: v.tax.toFixed(2),
              dividends_net: v.net.toFixed(2), realized_gain: (v.realized || 0).toFixed(2),
            },
          };
        });
      })(),
    },
  }), [shares, members, transfers, shareTxns, dividends, dividendAllocations, certificates, sharePrices, ov]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = reports[active];

  const download = () => {
    if (report.rows.length === 0) { toast.error('Nothing to export in this report.'); return; }
    exportCSV(report.rows.map((r) => r.csv), `sacco_${active}_report`);
    toast.success(`${report.title} exported.`);
  };

  return (
    <div className="space-y-6">
      <Card title="Reports" subtitle="Built from the share ledger — preview on screen, export as CSV">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(reports).map(([id, r]) => (
            <button key={id} onClick={() => setActive(id)}
              className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all ${
                active === id ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted'}`}>
              <Icon name={r.icon} size={16} color={active === id ? '#1da8c5' : 'var(--color-muted-foreground)'} />
              <span>
                <span className={`block text-sm font-semibold ${active === id ? 'text-primary' : 'text-foreground'}`}>{r.title}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{r.rows.length} row{r.rows.length === 1 ? '' : 's'}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={report.title}
        subtitle={report.hint}
        actions={(
          <div className="flex items-center gap-2">
            <GhostButton icon="Printer" onClick={() => window.print()}>Print</GhostButton>
            <PrimaryButton icon="Download" onClick={download} disabled={report.rows.length === 0}>Export CSV</PrimaryButton>
          </div>
        )}
      >
        {report.rows.length === 0 ? (
          <EmptyState icon={report.icon} title="Nothing to report yet"
            hint="This report fills in as the market is used." />
        ) : (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-2 mb-4 text-sm">
              <span className="text-muted-foreground">Rows <strong className="text-foreground">{report.rows.length.toLocaleString()}</strong></span>
              <span className="text-muted-foreground">Shares in issue <strong className="text-foreground">{ov.totalIssued.toLocaleString()}</strong></span>
              <span className="text-muted-foreground">Share price <strong className="text-foreground">{ov.price > 0 ? KES(ov.price) : '—'}</strong></span>
              <span className="text-muted-foreground">Market cap <strong className="text-foreground">{KESshort(ov.marketCap)}</strong></span>
              <span className="text-muted-foreground">Generated <strong className="text-foreground">{new Date().toLocaleString('en-KE')}</strong></span>
            </div>
            <Table columns={report.columns}>
              {report.rows.slice(0, 200).map((r, i) => (
                <tr key={i} className="border-b border-border/60">
                  {r.cells.map((c, j) => (
                    <td key={j} className={`py-2.5 pr-4 ${j === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'} whitespace-nowrap`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
            {report.rows.length > 200 && (
              <p className="text-xs text-muted-foreground mt-3">
                Showing the first 200 rows — the CSV export contains all {report.rows.length.toLocaleString()}.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
};

export default ReportsPanel;
