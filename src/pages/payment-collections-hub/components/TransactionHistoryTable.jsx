import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import { sendPaymentConfirmation, sendInvoiceEmail } from '../../../services/emailService';
import { html, rawHtml } from '../../../utils/htmlEscape';

const fmtKES = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const isPaidStatus = (s) => s === 'completed' || s === 'successful';

// Printable receipt / invoice — opens a clean, print-ready window generated on
// the fly from the live transaction record. Completed payments print as a
// RECEIPT, everything else as an INVOICE (amount due).
const printTxnReceipt = (txn, company) => {
  const w = window.open('', '_blank');
  if (!w) { window.alert('Please allow pop-ups to print this document.'); return; }
  const paid = isPaidStatus(txn?.status);
  const docTitle = paid ? 'RECEIPT' : 'INVOICE';
  const coName = company?.company_name || 'Ararat Company';
  const amount = Number(txn?.amount || 0);
  const when = [txn?.date, txn?.time].filter(Boolean).join(' ');
  const lineDesc = txn?.assetName || (paid ? 'Payment received' : 'Amount due');
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  // Escaped by default; the rawHtml() calls below mark the only substitutions
  // that are intentionally markup. See src/utils/htmlEscape.js.
  w.document.write(html`
    <html><head><title>${docTitle} — ${txn?.transactionId || ''} — ${txn?.clientName || 'Client'}</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 680px; margin: 32px auto; color: #111; }
      .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1A56DB; padding-bottom: 16px; margin-bottom: 20px; }
      .co { font-size: 18px; font-weight: 700; }
      .muted { color: #666; font-size: 12px; margin-top: 2px; }
      .mono { font-family: monospace; }
      .title { font-size: 26px; font-weight: 800; color: #1A56DB; text-align: right; letter-spacing: 1px; }
      .badge { display: inline-block; margin-top: 6px; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
      .badge.ok  { background: #d1fae5; color: #065f46; }
      .badge.due { background: #fef3c7; color: #92400e; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; font-size: 13px; }
      .meta .right { text-align: right; }
      .lbl { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: .05em; margin-bottom: 4px; }
      table.items { width: 100%; border-collapse: collapse; margin: 8px 0 4px; }
      table.items th { text-align: left; font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: .05em; border-bottom: 1px solid #ddd; padding: 8px 6px; }
      table.items th.r, table.items td.r { text-align: right; }
      table.items td { font-size: 13px; padding: 10px 6px; border-bottom: 1px solid #f0f0f0; }
      table.items td.r { font-family: monospace; }
      .total { display: flex; justify-content: space-between; align-items: center; background: #1A56DB; color: #fff; padding: 14px 18px; border-radius: 8px; margin-top: 14px; }
      .total .amt { font-family: monospace; font-size: 20px; font-weight: 800; }
      .note { margin-top: 16px; font-size: 12px; color: #666; font-style: italic; }
      .foot { margin-top: 28px; font-size: 11px; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 12px; }
    </style></head><body>
      <div class="head">
        <div>
          <div class="co">${coName}</div>
          ${company?.kra_pin ? rawHtml(html`<div class="muted">KRA PIN: ${company.kra_pin}</div>`) : ''}
          ${company?.physical_address ? rawHtml(html`<div class="muted">${company.physical_address}</div>`) : ''}
        </div>
        <div>
          <div class="title">${docTitle}</div>
          <div class="muted mono">${txn?.transactionId || ''}</div>
          <div class="badge ${paid ? 'ok' : 'due'}">${paid ? 'PAID' : String(txn?.status || 'PENDING').toUpperCase()}</div>
        </div>
      </div>
      <div class="meta">
        <div>
          <div class="lbl">Billed To</div>
          <div><strong>${txn?.clientName || '—'}</strong></div>
          ${txn?.accountNumber && txn.accountNumber !== '-' ? rawHtml(html`<div class="muted">${txn.accountNumber}</div>`) : ''}
          ${txn?.clientEmail ? rawHtml(html`<div class="muted">${txn.clientEmail}</div>`) : ''}
          ${txn?.clientPhone ? rawHtml(html`<div class="muted">${txn.clientPhone}</div>`) : ''}
        </div>
        <div class="right">
          <div class="lbl">Details</div>
          <div><strong>Date:</strong> ${when || '—'}</div>
          <div><strong>Method:</strong> ${String(txn?.paymentMethod || '—').replace('_', ' ')}</div>
          <div><strong>Ref:</strong> ${txn?.reference || '—'}</div>
        </div>
      </div>
      <table class="items">
        <thead><tr><th>Description</th><th class="r">Amount (KES)</th></tr></thead>
        <tbody>
          <tr>
            <td>${lineDesc}${txn?.assetCode ? rawHtml(html`<div class="muted">${txn.assetCode}</div>`) : ''}</td>
            <td class="r">${amount.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</td>
          </tr>
        </tbody>
      </table>
      <div class="total">
        <span style="font-weight:700;">${paid ? 'AMOUNT PAID' : 'TOTAL DUE'}</span>
        <span class="amt">${fmtKES(amount)}</span>
      </div>
      ${txn?.notes ? rawHtml(html`<div class="note">Note: ${txn.notes}</div>`) : ''}
      <div class="foot">${paid ? 'Official payment receipt — no signature required.' : 'Please settle this invoice by the agreed due date.'} Generated by ${coName} on ${today}.</div>
    </body></html>
  `);
  w.document.close();
  w.focus();
  w.print();
};

const TransactionHistoryTable = ({ transactions, companyProfile }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMethod, setFilterMethod] = useState('all');
  const [filterDateRange, setFilterDateRange] = useState('all');
  const [selected, setSelected] = useState(null);
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState(null);

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
      case 'successful':
        return 'text-success bg-success bg-opacity-10';
      case 'pending':
        return 'text-warning bg-warning bg-opacity-10';
      case 'failed':
        return 'text-error bg-error bg-opacity-10';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  const openDetail = (txn) => { setEmailMsg(null); setSelected(txn); };
  const closeDetail = () => { setEmailMsg(null); setSelected(null); };

  const handleEmail = async (txn) => {
    if (!txn?.clientEmail) {
      setEmailMsg({ type: 'error', text: 'This client has no email address on file.' });
      return;
    }
    setEmailing(true);
    setEmailMsg(null);
    try {
      const paid = isPaidStatus(txn?.status);
      const client = {
        full_name: txn.clientName, name: txn.clientName,
        account_number: txn.accountNumber, accountNumber: txn.accountNumber,
        email: txn.clientEmail, phone: txn.clientPhone,
      };
      const asset = (txn.assetName || txn.assetCode)
        ? { description: txn.assetName, name: txn.assetName, asset_code: txn.assetCode, id: txn.assetCode }
        : null;

      if (paid) {
        await sendPaymentConfirmation(txn.clientEmail, {
          transaction: {
            transactionId: txn.transactionId, transaction_id: txn.transactionId,
            timestamp: [txn.date, txn.time].filter(Boolean).join(' '),
            amount: txn.amount,
            paymentMethod: txn.paymentMethod, payment_method: txn.paymentMethod,
            referenceNumber: txn.reference, reference_number: txn.reference,
          },
          client, asset, allocations: [],
        });
      } else {
        await sendInvoiceEmail(txn.clientEmail, {
          invoice: { invoiceNumber: txn.transactionId, issueDate: txn.rawDate, dueDate: txn.rawDate, total: txn.amount },
          client, asset,
          lineItems: [{ description: txn.assetName || 'Amount due', quantity: 1, unitPrice: txn.amount, amount: txn.amount }],
        });
      }
      setEmailMsg({ type: 'success', text: `${paid ? 'Receipt' : 'Invoice'} emailed to ${txn.clientEmail}` });
    } catch (e) {
      setEmailMsg({ type: 'error', text: e?.message || 'Failed to send email' });
    } finally {
      setEmailing(false);
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
                    {fmtKES(txn?.amount)}
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
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Icon name="Eye" size={14} color="currentColor" />}
                      iconPosition="left"
                      onClick={() => openDetail(txn)}
                    >
                      View
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => printTxnReceipt(txn, companyProfile)}
                      title="Print receipt / invoice"
                      icon={<Icon name="Printer" size={15} color="currentColor" />}
                    />
                  </div>
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
                  {fmtKES(txn?.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Date</span>
                <span className="text-sm text-foreground">
                  {txn?.date} {txn?.time}
                </span>
              </div>
            </div>

            <div className="flex gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                icon={<Icon name="Eye" size={14} color="currentColor" />}
                iconPosition="left"
                fullWidth
                onClick={() => openDetail(txn)}
              >
                View Details
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<Icon name="Printer" size={14} color="currentColor" />}
                iconPosition="left"
                onClick={() => printTxnReceipt(txn, companyProfile)}
              >
                Print
              </Button>
            </div>
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

      {/* Transaction detail — a real receipt / invoice with Print + Email */}
      {selected && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          onClick={closeDetail}
        >
          <div
            className="bg-card border border-border rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b-2 border-primary">
              <div>
                <p className="text-base font-semibold text-foreground">
                  {companyProfile?.company_name || 'Ararat Company'}
                </p>
                {companyProfile?.kra_pin && (
                  <p className="text-xs text-muted-foreground mt-0.5">KRA PIN: {companyProfile.kra_pin}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xl font-black text-primary">
                  {isPaidStatus(selected.status) ? 'RECEIPT' : 'INVOICE'}
                </p>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">{selected.transactionId}</p>
              </div>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Billed To</p>
                  <p className="font-medium text-foreground">{selected.clientName}</p>
                  {selected.accountNumber && selected.accountNumber !== '-' && (
                    <p className="text-muted-foreground">{selected.accountNumber}</p>
                  )}
                  {selected.clientEmail && <p className="text-muted-foreground break-all">{selected.clientEmail}</p>}
                  {selected.clientPhone && <p className="text-muted-foreground">{selected.clientPhone}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Details</p>
                  <p className="text-muted-foreground"><span className="text-foreground font-medium">Date:</span> {[selected.date, selected.time].filter(Boolean).join(' ')}</p>
                  <p className="text-muted-foreground capitalize"><span className="text-foreground font-medium">Method:</span> {selected.paymentMethod?.replace('_', ' ') || '—'}</p>
                  <p className="text-muted-foreground"><span className="text-foreground font-medium">Ref:</span> {selected.reference || '—'}</p>
                  <span className={`inline-flex mt-1.5 items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${getStatusColor(selected.status)}`}>
                    {selected.status}
                  </span>
                </div>
              </div>

              {/* Line item */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex justify-between px-4 py-2 bg-muted text-xs font-semibold text-muted-foreground uppercase">
                  <span>Description</span><span>Amount (KES)</span>
                </div>
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-foreground">
                    {selected.assetName || (isPaidStatus(selected.status) ? 'Payment received' : 'Amount due')}
                    {selected.assetCode && <span className="block text-xs text-muted-foreground">{selected.assetCode}</span>}
                  </span>
                  <span className="font-mono text-foreground">{Number(selected.amount || 0).toLocaleString('en-KE')}</span>
                </div>
              </div>

              {/* Total */}
              <div className="flex justify-between items-center bg-primary text-primary-foreground px-4 py-3 rounded-lg">
                <span className="font-bold text-sm">{isPaidStatus(selected.status) ? 'AMOUNT PAID' : 'TOTAL DUE'}</span>
                <span className="font-black text-lg font-mono">{fmtKES(selected.amount)}</span>
              </div>

              {selected.notes && <p className="text-xs text-muted-foreground italic">Note: {selected.notes}</p>}

              {emailMsg && (
                <div className={`text-xs px-3 py-2 rounded-lg ${
                  emailMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-600' :
                  emailMsg.type === 'error' ? 'bg-red-500/10 text-red-600' : 'bg-blue-500/10 text-blue-600'
                }`}>
                  {emailMsg.text}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 p-5 border-t border-border">
              <Button
                variant="primary"
                size="sm"
                icon={<Icon name="Printer" size={14} color="currentColor" />}
                iconPosition="left"
                onClick={() => printTxnReceipt(selected, companyProfile)}
              >
                Print
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={emailing}
                disabled={emailing || !selected.clientEmail}
                icon={<Icon name="Mail" size={14} color="currentColor" />}
                iconPosition="left"
                onClick={() => handleEmail(selected)}
                title={selected.clientEmail ? `Email to ${selected.clientEmail}` : 'No client email on file'}
              >
                {emailing ? 'Sending…' : (isPaidStatus(selected.status) ? 'Email Receipt' : 'Email Invoice')}
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={closeDetail}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionHistoryTable;
