import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const methodIcons = {
  cash: 'Banknote',
  bank_deposit: 'Building2',
  bank_transfer: 'ArrowRightLeft',
  mpesa: 'Smartphone',
  card: 'CreditCard',
  cheque: 'FileText',
};

const statusConfig = {
  completed: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  reversed: { label: 'Reversed', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

const PaymentHistory = ({ payments }) => {
  const [search, setSearch] = useState('');
  const [filterMethod, setFilterMethod] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [expanded, setExpanded] = useState(null);

  const formatCurrency = (val) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(val || 0);

  const formatDate = (d) =>
    d ? new Date(d)?.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const completedPayments = payments?.filter(p => p?.payment_status === 'completed');

  const filtered = completedPayments?.filter(p => {
    const matchSearch = !search ||
      p?.transaction_id?.toLowerCase()?.includes(search?.toLowerCase()) ||
      p?.reference_number?.toLowerCase()?.includes(search?.toLowerCase()) ||
      p?.asset?.description?.toLowerCase()?.includes(search?.toLowerCase());
    const matchMethod = filterMethod === 'all' || p?.payment_method === filterMethod;
    const matchStatus = filterStatus === 'all' || p?.payment_status === filterStatus;
    return matchSearch && matchMethod && matchStatus;
  });

  const methods = ['all', 'cash', 'bank_transfer', 'mpesa', 'card', 'cheque'];

  return (
    <div>
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <div className="bg-muted rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Total Payments</p>
          <p className="text-2xl font-bold text-foreground">{completedPayments?.length || 0}</p>
        </div>
        <div className="bg-muted rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Total Paid</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(completedPayments?.reduce((s, p) => s + Number(p?.amount || 0), 0))}
          </p>
        </div>
        <div className="bg-muted rounded-xl p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-muted-foreground">Last Payment</p>
          <p className="text-sm font-bold text-foreground">
            {completedPayments?.[0] ? formatDate(completedPayments?.[0]?.payment_date) : '—'}
          </p>
        </div>
      </div>
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input
            type="text"
            placeholder="Search by transaction ID, reference, or asset..."
            value={search}
            onChange={e => setSearch(e?.target?.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={filterMethod}
          onChange={e => setFilterMethod(e?.target?.value)}
          className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
        >
          {methods?.map(m => (
            <option key={m} value={m}>{m === 'all' ? 'All Methods' : m?.replace('_', ' ')?.replace(/\b\w/g, c => c?.toUpperCase())}</option>
          ))}
        </select>
      </div>
      {/* Table */}
      {filtered?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Icon name="Receipt" size={22} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-medium text-foreground">No payment records found</p>
          <p className="text-xs text-muted-foreground mt-1">Completed payments will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered?.map((payment, idx) => {
            const cfg = statusConfig?.[payment?.payment_status] || statusConfig?.pending;
            const isExpanded = expanded === payment?.id;
            return (
              <div key={payment?.id || idx} className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(isExpanded ? null : payment?.id)}
                  className="w-full flex items-center gap-3 p-3.5 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon name={methodIcons?.[payment?.payment_method] || 'DollarSign'} size={16} color="var(--color-primary)" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{formatCurrency(payment?.amount)}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg?.cls}`}>{cfg?.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {payment?.transaction_id} · {formatDate(payment?.payment_date)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-muted-foreground capitalize">{payment?.payment_method?.replace('_', ' ')}</p>
                    <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={14} color="var(--color-muted-foreground)" />
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border pt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Reference No.</p>
                      <p className="text-xs font-medium text-foreground">{payment?.reference_number || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Asset</p>
                      <p className="text-xs font-medium text-foreground truncate">{payment?.asset?.description || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Asset Code</p>
                      <p className="text-xs font-medium text-foreground">{payment?.asset?.asset_code || '—'}</p>
                    </div>
                    {payment?.notes && (
                      <div className="col-span-2 sm:col-span-3">
                        <p className="text-xs text-muted-foreground">Notes</p>
                        <p className="text-xs font-medium text-foreground">{payment?.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PaymentHistory;
