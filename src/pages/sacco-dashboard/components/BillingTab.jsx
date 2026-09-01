import React from 'react';
import Icon from '../../../components/AppIcon';
import { Card, StatCard, Table, Badge, KES, fmtDate } from './_shared';
import { html, rawHtml } from '../../../utils/htmlEscape';
import { invoiceForSaccoInvoice } from '../../../utils/systemInvoice';

// ── Invoice download ─────────────────────────────────────────────────────────
const invoiceNo = (row) => {
  const ym    = (row.period ? new Date(row.period) : new Date(row.created_at)).toISOString().slice(0, 7).replace('-', '');
  const short = (row.id || '').replace(/-/g, '').slice(0, 6).toUpperCase();
  return `INV-${ym}-${short}`;
};

const fmtPeriod = (d) => (d ? new Date(d).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }) : '—');

// Invoice money keeps its cents — backing VAT out of a gross rarely lands on a
// whole shilling, and a tax invoice whose lines do not add up to its total is
// the one document that must never be approximated.
const KES2 = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Exported so the printed document itself is testable — a tax invoice whose
// columns do not add up is the one page a customer always checks.
export const buildInvoiceHtml = (row, sacco) => {
  const statusColor = row.status === 'paid' ? '#15803d' : row.status === 'overdue' ? '#b91c1c' : '#b45309';
  const tierLabel = String(row.tier || '—');
  // Itemised by src/config/systemBilling.js: base system price, active members,
  // storage excess, additional modules, installation, then VAT. Rows raised
  // before the breakdown columns existed have the tax backed out of the total
  // they already carry, so the amount billed is disclosed, never changed.
  const bill = invoiceForSaccoInvoice(row);
  // Escaped by default — the sacco name / reg no / email / phone below are
  // tenant-entered and land in a print window that shares this app's origin.
  return html`<!doctype html><html><head><meta charset="utf-8"><title>${invoiceNo(row)}</title>
<style>
  *{box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif;}
  body{margin:0;padding:40px;color:#0c2037;}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1da8c5;padding-bottom:20px;}
  .brand{font-family:Georgia,serif;font-size:24px;font-weight:700;letter-spacing:-0.01em;color:#0c2037;}
  .muted{color:#5a7185;font-size:12px;}
  .grid{display:flex;justify-content:space-between;margin:24px 0;}
  .grid div{font-size:13px;line-height:1.7;}
  table{width:100%;border-collapse:collapse;margin-top:16px;}
  th{background:#f3f6fb;text-align:left;padding:10px 12px;font-size:12px;color:#5a7185;text-transform:uppercase;}
  td{padding:12px;border-bottom:1px solid #e5ebf1;font-size:13px;}
  .right{text-align:right;}
  .total{font-size:18px;font-weight:800;color:#1da8c5;}
  .badge{display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;text-transform:uppercase;color:${statusColor};background:${statusColor}1a;}
  .tier{text-transform:capitalize;}
  .totals{width:300px;margin-left:auto;margin-top:16px;}
  .totals tr td{border:0;padding:6px 12px;}
  .totals .lbl{color:#5a7185;}
  .totals .sum td{border-top:2px solid #1da8c5;padding-top:10px;}
  .foot{margin-top:40px;font-size:11px;color:#9aa7b4;text-align:center;border-top:1px solid #e5ebf1;padding-top:16px;}
</style></head><body>
  <div class="head">
    <div><div class="brand">Ararat</div><div class="muted">Sacco Platform Subscription — Tax Invoice</div></div>
    <div class="right"><div style="font-size:20px;font-weight:800;">INVOICE</div><div class="muted">${invoiceNo(row)}</div></div>
  </div>
  <div class="grid">
    <div>
      <strong>Billed to</strong><br>${sacco?.name || '—'}<br>
      ${sacco?.registration_no ? rawHtml(html`Reg. No. ${sacco.registration_no}<br>`) : ''}
      ${sacco?.email || ''}${sacco?.email ? rawHtml('<br>') : ''}
      ${sacco?.phone || ''}
    </div>
    <div class="right">
      <strong>Issued</strong> ${fmtDate(row.created_at || row.period)}<br>
      <strong>Period</strong> ${fmtPeriod(row.period)}<br>
      <strong>Tier</strong> <span class="tier">${tierLabel}</span><br>
      <strong>Status</strong> <span class="badge">${row.status || '—'}</span>
    </div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Amount</th></tr></thead>
    <tbody>
      ${rawHtml(bill.lines.map((l) => html`<tr>
        <td>${l.label}</td>
        <td class="right">${l.qty || '—'}</td>
        <td class="right">${l.unit ? KES2(l.unit) : '—'}</td>
        <td class="right">${KES2(l.gross)}</td>
      </tr>`).join(''))}
    </tbody>
  </table>
  <table class="totals">
    <tr><td class="lbl">Taxable value (excl. VAT)</td><td class="right">${KES2(bill.subtotal)}</td></tr>
    <tr><td class="lbl">VAT @ ${bill.vatRate}%</td><td class="right">${KES2(bill.vatAmount)}</td></tr>
    <tr class="sum"><td class="lbl"><strong>Total (incl. VAT)</strong></td><td class="right"><span class="total">${KES2(bill.total)}</span></td></tr>
  </table>
  <div class="foot">Thank you for using Ararat. Generated on ${new Date().toLocaleDateString('en-GB')}.</div>
  <script>window.onload=function(){window.print();}</script>
</body></html>`;
};

const BillingTab = ({ ctx }) => {
  const { stats, invoices, sacco } = ctx;
  const bill = stats.billing;

  const download = (row) => {
    const w = window.open('', '_blank', 'width=820,height=920');
    if (!w) return;
    w.document.write(buildInvoiceHtml(row, sacco));
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Current tier" value={stats.tier?.name} hint={stats.tier?.memberRange} icon="Layers" />
        <StatCard label="Active members" value={stats.activeMembers} hint="Billed members" icon="Users" />
        <StatCard label="Estimated monthly bill" value={KES(bill.total)} hint="Base + members + storage, VAT inclusive" icon="Receipt" tone="success" />
      </div>

      {/* Invoices */}
      <Card title="Invoices" subtitle={`${invoices.length} on record — download any as a printable invoice`}>
        {invoices.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No invoices generated yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Monthly invoices run on the 1st (automated billing is a Phase 2 enhancement).</p>
          </div>
        ) : (
          <Table columns={['Invoice', 'Period', 'Tier', 'Members', 'Base', 'Member fee', 'Storage', 'Modules', 'Install', 'VAT', 'Total', 'Status', '']}>
            {invoices.map((inv) => {
              const bill = invoiceForSaccoInvoice(inv);
              return (
              <tr key={inv.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 font-medium text-foreground whitespace-nowrap">{invoiceNo(inv)}</td>
                <td className="py-2.5 pr-4 text-foreground">{fmtDate(inv.period)}</td>
                <td className="py-2.5 pr-4 capitalize text-muted-foreground">{inv.tier}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{inv.active_members}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(inv.base_fee)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(inv.per_member_fee_total)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(inv.storage_fee)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(inv.module_fee)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(inv.installation_fee)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(bill.vatAmount)}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(bill.total)}</td>
                <td className="py-2.5 pr-4"><Badge status={inv.status} /></td>
                <td className="py-2.5 pr-0 text-right">
                  <button
                    onClick={() => download(inv)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all whitespace-nowrap"
                  >
                    <Icon name="Download" size={13} color="currentColor" />
                    Download
                  </button>
                </td>
              </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
};

export default BillingTab;
