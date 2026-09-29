import React, { useEffect, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import { fetchReceipt } from '../../../../services/saccoReceiptService';
import { describeReceiptError, methodLabel, receiptTypeLabel } from '../../../../utils/saccoReceipts';
import { money } from '../../../../utils/accountingDocument';
import { downloadSaccoReceipt, printSaccoReceipt } from './receiptActions';
import {
  Modal, Table, EmptyState, PrimaryButton, GhostButton, fmtDate, fmtDateTime,
} from '../_shared';

/** "Loan repayment" / "Share purchase", as a pill for registers. */
export const TypePill = ({ type }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
    type === 'loan_repayment' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
    {receiptTypeLabel(type)}
  </span>
);

const Detail = ({ label, children }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm font-medium text-foreground break-words">{children}</p>
  </div>
);

/**
 * One receipt, as issued. Shared by the treasurer's register and the member's
 * own Receipts tab — both read the same stored row, so the member sees exactly
 * what the office sees.
 */
const ReceiptViewer = ({ receiptId, sacco, onClose }) => {
  const toast = useToast();
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!receiptId) return undefined;
    let live = true;
    setReceipt(null);
    setError(null);
    fetchReceipt(receiptId)
      .then((r) => {
        if (!live) return;
        if (r) setReceipt(r); else setError('That receipt could not be found.');
      })
      .catch((e) => { if (live) setError(describeReceiptError(e)); });
    return () => { live = false; };
  }, [receiptId]);

  const act = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'print') {
        await printSaccoReceipt(receipt, sacco);
      } else {
        toast.success(await downloadSaccoReceipt(receipt, sacco), 'Downloaded');
      }
    } catch (e) {
      toast.error(e.message, kind === 'print' ? 'Could not print the receipt' : 'Could not generate the receipt');
    } finally {
      setBusy(null);
    }
  };

  const loan = receipt?.receipt_type === 'loan_repayment';
  const lines = receipt?.lines || [];

  return (
    <Modal
      open={!!receiptId}
      onClose={onClose}
      wide
      title={receipt ? `Receipt ${receipt.receipt_no}` : 'Receipt'}
      footer={<>
        <GhostButton onClick={onClose}>Close</GhostButton>
        <GhostButton icon="Printer" onClick={() => act('print')} disabled={!receipt || !!busy}>
          {busy === 'print' ? 'Preparing…' : 'Print'}
        </GhostButton>
        <PrimaryButton icon="Download" onClick={() => act('download')} disabled={!receipt || !!busy}>
          {busy === 'download' ? 'Preparing…' : 'Download PDF'}
        </PrimaryButton>
      </>}
    >
      {error ? (
        <EmptyState icon="AlertTriangle" title="Could not open this receipt" hint={error} />
      ) : !receipt ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading receipt…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 p-4 rounded-xl border border-border bg-muted/40">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {receiptTypeLabel(receipt.receipt_type)}
              </p>
              <p className="text-sm text-foreground mt-1">{receipt.description}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-foreground">{money(receipt.amount)}</p>
              <p className="text-xs text-muted-foreground">Paid {fmtDate(receipt.paid_on)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Detail label="Received from">
              {receipt.member_name}{receipt.member_no ? ` · ${receipt.member_no}` : ''}
            </Detail>
            <Detail label="Method">{methodLabel(receipt.payment_method)}</Detail>
            <Detail label="Reference">
              <span className="font-mono">{receipt.payment_reference || '—'}</span>
            </Detail>
            <Detail label="Received by">{receipt.received_by_name || '—'}</Detail>
            <Detail label="Issued">{fmtDateTime(receipt.created_at)}</Detail>
            {loan ? (
              <Detail label="Loan balance after this payment">
                {money(receipt.balance_after)}
                {receipt.instalments_left === 0 ? ' · loan cleared' : ` · ${receipt.instalments_left} instalment${receipt.instalments_left === 1 ? '' : 's'} to go`}
              </Detail>
            ) : (
              <Detail label="Shareholding after this purchase">
                {(parseInt(receipt.shares_after, 10) || 0).toLocaleString()} shares
              </Detail>
            )}
          </div>

          {loan ? (
            <Table columns={['Instalment', 'Due', 'Interest', 'Principal', 'Amount']}>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-border/60">
                  <td className="py-2 pr-4 text-foreground">{l.description}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{fmtDate(l.due_date)}</td>
                  <td className="py-2 pr-4 text-foreground">{money(l.interest)}</td>
                  <td className="py-2 pr-4 text-foreground">{money(l.principal)}</td>
                  <td className="py-2 pr-4 font-semibold text-foreground">{money(l.amount)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Table columns={['Purchase', 'Shares', 'Price', 'Fee', 'Amount']}>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-border/60">
                  <td className="py-2 pr-4 text-foreground">{l.description}</td>
                  <td className="py-2 pr-4 text-foreground">{(parseInt(l.shares, 10) || 0).toLocaleString()}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{money(l.price_per_share)}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{money(l.fee)}</td>
                  <td className="py-2 pr-4 font-semibold text-foreground">{money(l.amount)}</td>
                </tr>
              ))}
            </Table>
          )}

          {receipt.notes && (
            <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Notes:</span> {receipt.notes}</p>
          )}
        </div>
      )}
    </Modal>
  );
};

export default ReceiptViewer;
