import React from 'react';
import Icon from '../../../components/AppIcon';

const DetailRow = ({ icon, label, value, valueClass = '' }) => (
  <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon name={icon} size={15} color="currentColor" />
      <span className="text-sm">{label}</span>
    </div>
    <span className={`text-sm font-semibold text-foreground ${valueClass}`}>{value}</span>
  </div>
);

const TransactionDetails = ({ transaction }) => {
  const methodIcons = {
    'Credit/Debit Card': 'CreditCard',
    'Bank Transfer': 'Building2',
    'Cash': 'Banknote',
    'Cheque': 'FileText',
    'Mobile Money': 'Smartphone',
  };

  const methodIcon = methodIcons?.[transaction?.paymentMethod] || 'CreditCard';

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon name="Receipt" size={16} color="var(--color-primary)" />
        </div>
        <h2 className="text-base font-semibold text-foreground">Transaction Details</h2>
      </div>
      <DetailRow
        icon="Hash"
        label="Transaction ID"
        value={transaction?.transactionId || 'TXN-000000'}
        valueClass="font-mono text-primary"
      />
      <DetailRow
        icon="Calendar"
        label="Date &amp; Time"
        value={transaction?.timestamp || new Date()?.toLocaleString()}
      />
      <DetailRow
        icon="DollarSign"
        label="Total Amount"
        value={`$${parseFloat(transaction?.amount || 0)?.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
        valueClass="text-emerald-600 dark:text-emerald-400 text-base"
      />
      <DetailRow
        icon={methodIcon}
        label="Payment Method"
        value={transaction?.paymentMethod || 'Bank Transfer'}
      />
      <DetailRow
        icon="FileCheck"
        label="Reference Number"
        value={transaction?.referenceNumber || '-'}
      />
      <DetailRow
        icon="ShieldCheck"
        label="Status"
        value="Successful"
        valueClass="text-emerald-600 dark:text-emerald-400"
      />
    </div>
  );
};

export default TransactionDetails;
