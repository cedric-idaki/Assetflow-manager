import React from 'react';
import Icon from '../../../components/AppIcon';

const BalanceSummary = ({ assets, payments }) => {
  const totalOutstanding = assets?.reduce((sum, a) => sum + (a?.current_value || 0), 0);
  const totalPaid = payments?.filter(p => p?.payment_status === 'completed')?.reduce((sum, p) => sum + (p?.amount || 0), 0);
  const overdue = payments?.filter(p => p?.payment_status === 'pending' && new Date(p?.payment_date) < new Date());
  const overdueAmount = overdue?.reduce((sum, p) => sum + (p?.amount || 0), 0);

  const upcoming = payments
    ?.filter(p => p?.payment_status === 'pending' && new Date(p?.payment_date) >= new Date())
    ?.sort((a, b) => new Date(a?.payment_date) - new Date(b?.payment_date))?.[0];

  const formatCurrency = (val) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(val || 0);

  const formatDate = (d) => d ? new Date(d)?.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const daysUntil = (d) => {
    if (!d) return null;
    const diff = Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const nextDays = daysUntil(upcoming?.payment_date);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* Total Outstanding */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Outstanding</span>
          <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Icon name="Wallet" size={16} color="var(--color-primary)" />
          </div>
        </div>
        <p className="text-2xl font-bold text-foreground">{formatCurrency(totalOutstanding)}</p>
        <p className="text-xs text-muted-foreground mt-1">{assets?.length || 0} asset(s) in portfolio</p>
      </div>

      {/* Total Paid */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Paid</span>
          <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Icon name="CheckCircle" size={16} color="var(--color-success)" />
          </div>
        </div>
        <p className="text-2xl font-bold text-foreground">{formatCurrency(totalPaid)}</p>
        <p className="text-xs text-success mt-1">{payments?.filter(p => p?.payment_status === 'completed')?.length || 0} completed payments</p>
      </div>

      {/* Next Payment Due */}
      <div className={`bg-card border rounded-xl p-5 shadow-sm ${
        nextDays !== null && nextDays <= 7 ? 'border-amber-300 dark:border-amber-700' : 'border-border'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Next Payment</span>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
            nextDays !== null && nextDays <= 7 ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-blue-100 dark:bg-blue-900/30'
          }`}>
            <Icon name="Calendar" size={16} color={nextDays !== null && nextDays <= 7 ? 'var(--color-warning)' : '#3B82F6'} />
          </div>
        </div>
        <p className="text-2xl font-bold text-foreground">{upcoming ? formatCurrency(upcoming?.amount) : '—'}</p>
        <p className={`text-xs mt-1 ${
          nextDays !== null && nextDays <= 3 ? 'text-error' : nextDays !== null && nextDays <= 7 ? 'text-warning' : 'text-muted-foreground'
        }`}>
          {upcoming ? `Due ${formatDate(upcoming?.payment_date)}${nextDays !== null ? ` (${nextDays}d)` : ''}` : 'No upcoming payments'}
        </p>
      </div>

      {/* Overdue */}
      <div className={`bg-card border rounded-xl p-5 shadow-sm ${
        overdueAmount > 0 ? 'border-red-300 dark:border-red-700' : 'border-border'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Overdue</span>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
            overdueAmount > 0 ? 'bg-red-100 dark:bg-red-900/30' : 'bg-muted'
          }`}>
            <Icon name="AlertTriangle" size={16} color={overdueAmount > 0 ? 'var(--color-error)' : 'var(--color-muted-foreground)'} />
          </div>
        </div>
        <p className={`text-2xl font-bold ${ overdueAmount > 0 ? 'text-error' : 'text-foreground'}`}>{formatCurrency(overdueAmount)}</p>
        <p className="text-xs text-muted-foreground mt-1">{overdue?.length || 0} overdue payment(s)</p>
      </div>
    </div>
  );
};

export default BalanceSummary;
