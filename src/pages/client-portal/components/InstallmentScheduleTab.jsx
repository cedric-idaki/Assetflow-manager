import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt    = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtPct  = (a, b) => b > 0 ? `${Math.round((a / b) * 100)}%` : '0%';

const StatusBadge = ({ status }) => {
  const map = {
    active:     'bg-emerald-100 text-emerald-700',
    completed:  'bg-blue-100   text-blue-700',
    overdue:    'bg-red-100    text-red-700',
    paused:     'bg-amber-100  text-amber-700',
    cancelled:  'bg-gray-100   text-gray-500',
    paid:       'bg-emerald-100 text-emerald-700',
    pending:    'bg-amber-100  text-amber-700',
    missed:     'bg-red-100    text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${map[status] || 'bg-gray-100 text-gray-500'}`}>
      {status || '—'}
    </span>
  );
};

// Generate a projected schedule from plan data
const generateSchedule = (plan) => {
  const rows = [];
  const total      = plan.total_installments || 1;
  const paid       = plan.installments_paid  || 0;
  const amount     = parseFloat(plan.installment_amount || 0);
  const startDate  = plan.start_date ? new Date(plan.start_date) : new Date();
  const freq       = plan.frequency || 'monthly';

  const addPeriod = (date, i) => {
    const d = new Date(date);
    if (freq === 'weekly')      d.setDate(d.getDate() + 7 * i);
    else if (freq === 'monthly') d.setMonth(d.getMonth() + i);
    else if (freq === 'quarterly') d.setMonth(d.getMonth() + 3 * i);
    else                          d.setMonth(d.getMonth() + i);
    return d;
  };

  for (let i = 0; i < total; i++) {
    const dueDate    = addPeriod(startDate, i);
    const isPaid     = i < paid;
    const isOverdue  = !isPaid && dueDate < new Date();
    const isCurrent  = !isPaid && !isOverdue && i === paid;
    const status     = isPaid ? 'paid' : isOverdue ? 'missed' : isCurrent ? 'pending' : 'upcoming';

    rows.push({
      no:        i + 1,
      due_date:  dueDate.toISOString(),
      amount,
      status,
      is_current: isCurrent,
    });
  }
  return rows;
};

// ── Schedule Modal ────────────────────────────────────────────────────────────
const ScheduleModal = ({ plan, onClose }) => {
  const schedule    = generateSchedule(plan);
  const paid        = plan.installments_paid || 0;
  const total       = plan.total_installments || 1;
  const totalPaid   = paid * parseFloat(plan.installment_amount || 0);
  const totalOwed   = parseFloat(plan.total_amount || 0);
  const remaining   = totalOwed - totalPaid;
  const progress    = Math.round((paid / total) * 100);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-foreground">{plan.plan_name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {plan.asset?.description || '—'} · {plan.asset?.asset_code || '—'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--muted-foreground)" />
          </button>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-4 px-6 py-4 border-b border-border bg-muted/20">
          <div>
            <p className="text-xs text-muted-foreground">Total Amount</p>
            <p className="text-2xl font-bold text-foreground">{fmt(totalOwed)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Amount Paid</p>
            <p className="text-2xl font-bold text-emerald-600">{fmt(totalPaid)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Balance</p>
            <p className="text-2xl font-bold text-red-500">{fmt(remaining)}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-6 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">{paid} of {total} installments paid</span>
            <span className="text-xs font-bold text-primary">{progress}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Schedule table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full">
            <thead className="sticky top-0 bg-muted/40">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Due Date</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Amount</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map(row => (
                <tr key={row.no}
                  className={`border-t border-border transition-colors ${
                    row.is_current ? 'bg-primary/5' : 'hover:bg-muted/30'
                  }`}>
                  <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{String(row.no).padStart(2, '0')}</td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {fmtDate(row.due_date)}
                    {row.is_current && (
                      <span className="ml-2 text-xs font-semibold text-primary">← Current</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono font-semibold text-foreground text-right">{fmt(row.amount)}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/20">
                <td colSpan={2} className="px-4 py-3 text-sm font-bold text-foreground">TOTAL</td>
                <td className="px-4 py-3 text-sm font-bold font-mono text-foreground text-right">{fmt(totalOwed)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Next payment: <span className="font-semibold text-foreground">{fmtDate(plan.next_charge_date)}</span>
            {plan.end_date && (
              <> · End date: <span className="font-semibold text-foreground">{fmtDate(plan.end_date)}</span></>
            )}
          </div>
          <button onClick={onClose}
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const InstallmentScheduleTab = ({ installmentPlans }) => {
  const [selected, setSelected] = useState(null);

  if (!installmentPlans || installmentPlans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
          <Icon name="Calendar" size={24} color="var(--muted-foreground)" />
        </div>
        <p className="text-base font-semibold text-foreground">No installment plans</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          Your payment schedules will appear here once a hire purchase agreement is set up
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">Installment Schedule</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          View your payment plans and track progress
        </p>
      </div>

      {installmentPlans.map(plan => {
        const paid      = plan.installments_paid  || 0;
        const total     = plan.total_installments || 1;
        const totalPaid = paid * parseFloat(plan.installment_amount || 0);
        const totalOwed = parseFloat(plan.total_amount || 0);
        const remaining = totalOwed - totalPaid;
        const progress  = Math.round((paid / total) * 100);

        return (
          <div key={plan.id} className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/30 transition-all">
            {/* Plan header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Icon name="Calendar" size={18} color="var(--primary)" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">{plan.plan_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {plan.asset?.description || '—'} · {plan.frequency}
                  </p>
                </div>
              </div>
              <StatusBadge status={plan.plan_status} />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
              {[
                { label: 'Total Amount',       value: fmt(totalOwed),                       color: 'text-foreground' },
                { label: 'Amount Paid',        value: fmt(totalPaid),                       color: 'text-emerald-600' },
                { label: 'Balance Remaining',  value: fmt(remaining),                       color: 'text-red-500' },
                { label: 'Installments',       value: `${paid} / ${total}`,                 color: 'text-primary' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-card px-4 py-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-sm font-bold font-mono mt-0.5 ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div className="px-5 py-3 border-t border-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">Payment Progress</span>
                <span className="text-xs font-bold text-primary">{progress}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/20">
              <div className="text-xs text-muted-foreground">
                Next payment: <span className="font-semibold text-foreground">{fmtDate(plan.next_charge_date)}</span>
                {plan.installment_amount && (
                  <> · <span className="font-semibold text-foreground">{fmt(plan.installment_amount)}</span></>
                )}
              </div>
              <button
                onClick={() => setSelected(plan)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                <Icon name="List" size={12} color="currentColor" />
                View Full Schedule
              </button>
            </div>
          </div>
        );
      })}

      {/* Schedule modal */}
      {selected && (
        <ScheduleModal plan={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
};

export default InstallmentScheduleTab;
