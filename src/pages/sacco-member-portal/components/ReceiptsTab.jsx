import React, { useState } from 'react';
import { useToast } from '../../../components/Toast';
import Icon from '../../../components/AppIcon';
import Pagination from '../../../components/ui/Pagination';
import { usePagedQuery } from '../../../hooks/usePagedQuery';
import { methodLabel, isReceiptBookMissing } from '../../../utils/saccoReceipts';
import { money } from '../../../utils/accountingDocument';
import ReceiptViewer, { TypePill } from '../../sacco-dashboard/components/receipts/ReceiptViewer';
import { downloadSaccoReceipt } from '../../sacco-dashboard/components/receipts/receiptActions';
import { Card, Table, EmptyState, TextInput, fmtDate } from '../../sacco-dashboard/components/_shared';

/**
 * The member's own receipts — every loan repayment and share purchase the
 * society has taken from them, exactly as the office issued it. RLS already
 * limits the rows to this member; the filter says so explicitly as well.
 */
const ReceiptsTab = ({ ctx }) => {
  const { me, sacco } = ctx;
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState(null);
  const [downloading, setDownloading] = useState(null);

  const page = usePagedQuery({
    table: 'sacco_receipts',
    columns: '*',
    enabled: !!me?.id,
    applyFilters: (q) => q.eq('member_id', me?.id),
    order: { column: 'created_at', ascending: false },
    searchColumns: ['receipt_no', 'payment_reference', 'description'],
    search,
    pageSize: 20,
    deps: [me?.id],
  });

  const download = async (r) => {
    setDownloading(r.id);
    try {
      toast.success(await downloadSaccoReceipt(r.id, sacco), 'Downloaded');
    } catch (e) {
      toast.error(e.message, 'Could not generate the receipt');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Card title="My receipts" subtitle="Official receipts for your loan repayments and share purchases">
      <div className="mb-4 max-w-sm">
        <TextInput value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Receipt no. or reference" aria-label="Search my receipts" />
      </div>

      {page.error ? (
        isReceiptBookMissing(page.error)
          ? <EmptyState icon="Receipt" title="Receipts are not available yet" hint="Your society's receipt book is still being set up." />
          : <EmptyState icon="AlertTriangle" title="Could not load your receipts" hint={page.error} />
      ) : page.rows.length === 0 ? (
        <EmptyState
          icon="Receipt"
          title={page.loading ? 'Loading your receipts…' : 'No receipts yet'}
          hint={page.loading ? undefined : 'When the society receives a loan repayment or a payment for shares from you, the receipt appears here.'}
        />
      ) : (
        <>
          <Table columns={['Receipt no.', 'Paid on', 'For', 'Method', 'Amount', '']}>
            {page.rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 font-mono text-xs text-foreground whitespace-nowrap">{r.receipt_no}</td>
                <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(r.paid_on)}</td>
                <td className="py-2.5 pr-4 text-foreground">
                  <TypePill type={r.receipt_type} />
                  <span className="block text-xs text-muted-foreground mt-1 max-w-xs">{r.description}</span>
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">
                  {methodLabel(r.payment_method)}
                  {r.payment_reference && <span className="block text-xs font-mono">{r.payment_reference}</span>}
                </td>
                <td className="py-2.5 pr-4 font-semibold text-foreground whitespace-nowrap">{money(r.amount)}</td>
                <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                  <button onClick={() => setViewing(r.id)} className="text-xs text-primary font-semibold hover:underline mr-3">View</button>
                  <button
                    onClick={() => download(r)}
                    disabled={downloading === r.id}
                    title={`Download receipt ${r.receipt_no}`}
                    aria-label={`Download receipt ${r.receipt_no}`}
                    className="align-middle text-muted-foreground hover:text-foreground disabled:opacity-60"
                  >
                    <Icon name={downloading === r.id ? 'Loader' : 'Download'} size={14} color="currentColor"
                      className={downloading === r.id ? 'animate-spin' : ''} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination
            page={page.page}
            pageCount={page.pageCount}
            from={page.from}
            to={page.to}
            total={page.total}
            onPageChange={page.setPage}
            loading={page.loading}
            noun="receipts"
          />
        </>
      )}

      <ReceiptViewer receiptId={viewing} sacco={sacco} onClose={() => setViewing(null)} />
    </Card>
  );
};

export default ReceiptsTab;
