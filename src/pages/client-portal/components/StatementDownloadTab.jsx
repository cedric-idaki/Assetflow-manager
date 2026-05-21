import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const fmt     = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const StatementDownloadTab = ({ payments, installmentPlans, clientProfile, companyProfile }) => {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split('T')[0];
  });
  const [toDate,   setToDate]   = useState(new Date().toISOString().split('T')[0]);
  const [type,     setType]     = useState('account');
  const [generating, setGenerating] = useState(false);

  const filteredPayments = (payments || []).filter(p => {
    const d = new Date(p.payment_date || p.created_at);
    return d >= new Date(fromDate) && d <= new Date(toDate);
  });

  const totalPaid     = filteredPayments.filter(p => p.payment_status === 'completed').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const totalPending  = filteredPayments.filter(p => p.payment_status !== 'completed').reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  const generateStatement = () => {
    setGenerating(true);
    setTimeout(() => {
      const co = companyProfile || {};
      const cl = clientProfile  || {};

      const rows = filteredPayments.map(p => `
        <tr>
          <td>${fmtDate(p.payment_date || p.created_at)}</td>
          <td>${p.transaction_id || '—'}</td>
          <td>${p.payment_method?.replace(/_/g, ' ') || '—'}</td>
          <td style="text-align:right; color: ${p.payment_status === 'completed' ? '#059669' : '#dc2626'}">${fmt(p.amount)}</td>
          <td style="text-align:center"><span style="background:${p.payment_status === 'completed' ? '#d1fae5' : '#fee2e2'}; color:${p.payment_status === 'completed' ? '#065f46' : '#991b1b'}; padding:2px 8px; border-radius:999px; font-size:11px; text-transform:capitalize">${p.payment_status}</span></td>
        </tr>
      `).join('');

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Account Statement — ${cl.full_name}</title>
          <style>
            * { margin:0; padding:0; box-sizing:border-box; }
            body { font-family: Arial, sans-serif; padding: 40px; color: #111; font-size: 13px; }
            .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:30px; padding-bottom:20px; border-bottom:2px solid #1A56DB; }
            .company-name { font-size:20px; font-weight:bold; color:#1A56DB; }
            .title { font-size:22px; font-weight:900; color:#111; margin-bottom:4px; }
            .grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:24px; }
            .card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px; }
            .card-label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
            .card-value { font-size:16px; font-weight:bold; }
            .green { color:#059669; }
            .red { color:#dc2626; }
            table { width:100%; border-collapse:collapse; margin-top:16px; }
            th { background:#1A56DB; color:white; padding:10px 12px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
            td { padding:9px 12px; border-bottom:1px solid #e2e8f0; }
            tr:hover td { background:#f8fafc; }
            tfoot td { background:#f1f5f9; font-weight:bold; border-top:2px solid #1A56DB; }
            .footer { margin-top:30px; padding-top:16px; border-top:1px solid #e2e8f0; font-size:11px; color:#64748b; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="company-name">${co.company_name || 'AssetFlow'}</div>
              <div style="font-size:11px; color:#64748b; margin-top:4px">${co.physical_address || ''}</div>
              <div style="font-size:11px; color:#64748b">KRA PIN: ${co.kra_pin || 'N/A'}</div>
            </div>
            <div style="text-align:right">
              <div class="title">Account Statement</div>
              <div style="color:#64748b; font-size:12px">Period: ${fmtDate(fromDate)} — ${fmtDate(toDate)}</div>
              <div style="color:#64748b; font-size:12px">Generated: ${fmtDate(new Date().toISOString())}</div>
            </div>
          </div>

          <div class="grid">
            <div class="card">
              <div class="card-label">Account Holder</div>
              <div class="card-value">${cl.full_name || '—'}</div>
              <div style="color:#64748b; font-size:12px; margin-top:4px">Account: ${cl.account_number || '—'}</div>
              <div style="color:#64748b; font-size:12px">${cl.email || ''}</div>
            </div>
            <div class="card">
              <div class="card-label">Outstanding Balance</div>
              <div class="card-value red">${fmt(cl.outstanding_balance)}</div>
            </div>
            <div class="card">
              <div class="card-label">Total Paid (Period)</div>
              <div class="card-value green">${fmt(totalPaid)}</div>
            </div>
            <div class="card">
              <div class="card-label">Transactions (Period)</div>
              <div class="card-value">${filteredPayments.length}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Transaction ID</th>
                <th>Method</th>
                <th style="text-align:right">Amount</th>
                <th style="text-align:center">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#64748b">No transactions in this period</td></tr>'}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3">TOTAL PAID</td>
                <td style="text-align:right; color:#059669">${fmt(totalPaid)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          <div class="footer">
            <p>This is a computer-generated statement and does not require a signature.</p>
            <p style="margin-top:4px">For queries, contact us at ${co.email || ''} | ${co.phone || ''}</p>
          </div>
        </body>
        </html>
      `;

      const w = window.open('', '_blank');
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
      setGenerating(false);
    }, 600);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Account Statement</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Download your payment history as a PDF statement
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Controls */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-foreground">Statement Options</h3>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Statement Type</label>
            <select className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={type} onChange={e => setType(e.target.value)}>
              <option value="account">Account Statement</option>
              <option value="installment">Installment Summary</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">From Date</label>
            <input type="date" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">To Date</label>
            <input type="date" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>

          <button onClick={generateStatement} disabled={generating}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
            {generating ? (
              <><Icon name="Loader" size={14} color="currentColor" className="animate-spin" /> Generating...</>
            ) : (
              <><Icon name="Download" size={14} color="currentColor" /> Download PDF</>
            )}
          </button>
        </div>

        {/* Preview */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Preview</h3>
            <span className="text-xs text-muted-foreground">{filteredPayments.length} transactions</span>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { label: 'Total Paid',      value: fmt(totalPaid),    color: 'text-emerald-600' },
              { label: 'Total Pending',   value: fmt(totalPending), color: 'text-amber-600'   },
              { label: 'Transactions',    value: filteredPayments.length, color: 'text-foreground' },
              { label: 'Outstanding',     value: fmt(clientProfile?.outstanding_balance), color: 'text-red-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-muted/30 rounded-xl p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-2xl font-bold font-mono mt-0.5 ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Transaction preview */}
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/40">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Date</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Method</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Amount</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-sm text-muted-foreground">No transactions in selected period</td></tr>
                ) : filteredPayments.slice(0, 8).map(p => (
                  <tr key={p.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(p.payment_date || p.created_at)}</td>
                    <td className="px-3 py-2 text-xs text-foreground capitalize">{(p.payment_method || '—').replace(/_/g, ' ')}</td>
                    <td className={`px-3 py-2 text-xs font-mono font-semibold text-right ${p.payment_status === 'completed' ? 'text-emerald-600' : 'text-amber-600'}`}>{fmt(p.amount)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${p.payment_status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {p.payment_status}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredPayments.length > 8 && (
                  <tr className="border-t border-border">
                    <td colSpan={4} className="px-3 py-2 text-xs text-center text-muted-foreground">
                      +{filteredPayments.length - 8} more transactions in the full PDF
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatementDownloadTab;
