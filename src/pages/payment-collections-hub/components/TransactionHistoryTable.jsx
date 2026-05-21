import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';

const TransactionHistoryTable = ({ transactions }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMethod, setFilterMethod] = useState('all');
  const [filterDateRange, setFilterDateRange] = useState('all');

  const paymentMethodOptions = [
    { value: 'all', label: 'All Methods' },
    { value: 'cash', label: 'Cash' },
    { value: 'bank_deposit', label: 'Bank Deposit' },
    { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'mpesa', label: 'M-Pesa' },
    { value: 'card', label: 'Credit/Debit Card' },
  ];

  const dateRangeOptions = [
    { value: 'all', label: 'All Time' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: 'quarter', label: 'This Quarter' },
  ];

  const filteredTransactions = transactions?.filter((txn) => {
    const matchesSearch =
      txn?.clientName?.toLowerCase()?.includes(searchTerm?.toLowerCase()) ||
      txn?.transactionId?.toLowerCase()?.includes(searchTerm?.toLowerCase());
    const matchesMethod = filterMethod === 'all' || txn?.paymentMethod === filterMethod;
    return matchesSearch && matchesMethod;
  });

  const getMethodIcon = (method) => {
    const icons = {
      cash: 'Banknote',
      bank_deposit: 'Building2',
      bank_transfer: 'ArrowRightLeft',
      mpesa: 'Smartphone',
      card: 'CreditCard',
    };
    return icons?.[method] || 'DollarSign';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'text-success bg-success bg-opacity-10';
      case 'pending':
        return 'text-warning bg-warning bg-opacity-10';
      case 'failed':
        return 'text-error bg-error bg-opacity-10';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-base md:text-xl font-heading font-semibold text-foreground mb-4 md:mb-6">
        Transaction History
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6">
        <Input
          type="search"
          placeholder="Search by client or transaction ID"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e?.target?.value)}
        />
        <Select
          options={paymentMethodOptions}
          value={filterMethod}
          onChange={setFilterMethod}
          placeholder="Filter by method"
        />
        <Select
          options={dateRangeOptions}
          value={filterDateRange}
          onChange={setFilterDateRange}
          placeholder="Filter by date"
        />
      </div>
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Transaction ID
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Client
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Method
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Amount
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Date
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Status
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredTransactions?.map((txn) => (
              <tr
                key={txn?.id}
                className="border-b border-border hover:bg-muted hover:bg-opacity-50 transition-smooth"
              >
                <td className="py-3 px-4">
                  <p className="text-sm font-medium text-foreground data-text">
                    {txn?.transactionId}
                  </p>
                </td>
                <td className="py-3 px-4">
                  <p className="text-sm font-medium text-foreground">
                    {txn?.clientName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {txn?.accountNumber}
                  </p>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center space-x-2">
                    <Icon
                      name={getMethodIcon(txn?.paymentMethod)}
                      size={16}
                      color="var(--color-muted-foreground)"
                    />
                    <span className="text-sm text-foreground capitalize">
                      {txn?.paymentMethod?.replace('_', ' ')}
                    </span>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <p className="text-sm font-semibold text-foreground data-text whitespace-nowrap">
                    ${txn?.amount?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </td>
                <td className="py-3 px-4">
                  <p className="text-sm text-foreground whitespace-nowrap">
                    {txn?.date}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {txn?.time}
                  </p>
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium capitalize ${getStatusColor(
                      txn?.status
                    )}`}
                  >
                    {txn?.status}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    iconName="Eye"
                    iconPosition="left"
                  >
                    View
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lg:hidden space-y-3">
        {filteredTransactions?.map((txn) => (
          <div
            key={txn?.id}
            className="p-4 rounded-xl bg-background border border-border"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-foreground data-text">
                {txn?.transactionId}
              </p>
              <span
                className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium capitalize ${getStatusColor(
                  txn?.status
                )}`}
              >
                {txn?.status}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Client</span>
                <span className="text-sm font-medium text-foreground">
                  {txn?.clientName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Method</span>
                <div className="flex items-center space-x-2">
                  <Icon
                    name={getMethodIcon(txn?.paymentMethod)}
                    size={14}
                    color="var(--color-muted-foreground)"
                  />
                  <span className="text-sm text-foreground capitalize">
                    {txn?.paymentMethod?.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Amount</span>
                <span className="text-sm font-semibold text-foreground data-text">
                  ${txn?.amount?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Date</span>
                <span className="text-sm text-foreground">
                  {txn?.date} {txn?.time}
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              iconName="Eye"
              iconPosition="left"
              fullWidth
              className="mt-3"
            >
              View Details
            </Button>
          </div>
        ))}
      </div>
      {filteredTransactions?.length === 0 && (
        <div className="text-center py-12">
          <Icon
            name="Search"
            size={48}
            color="var(--color-muted-foreground)"
            className="mx-auto mb-4"
          />
          <p className="text-base md:text-lg font-medium text-foreground">
            No transactions found
          </p>
          <p className="text-sm md:text-base text-muted-foreground mt-2">
            Try adjusting your search or filters
          </p>
        </div>
      )}
    </div>
  );
};

export default TransactionHistoryTable;