/**
 * CLIENTS — who the Finance Hub can bill, and what each of them owes.
 *
 * The hub could raise an invoice against a client since the day it shipped, but
 * it could not create one, and it could not tell you what any of them owed: the
 * bill-to selector was a dropdown fed by whatever rows happened to exist, and
 * the balance lived nowhere. This tab is the other half — the record itself,
 * the money against it, and the history that explains the money.
 *
 * EVERY FIGURE ON SCREEN COMES FROM POSTGRES. The rows are a page; the totals
 * are not computed from that page. Reducing over a capped list is how a book of
 * 600 customers shows the balance of the 50 that fitted, with nothing on screen
 * to say so.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { S, Sk, Empty, toast, fmt } from './_shared';
import { useClientRecords } from '../../../hooks/useClientRecords';
import ClientRecordModal from '../../../components/clients/ClientRecordModal';

const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';

const TypeBadge = ({ type }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
    type === 'cash'
      ? 'bg-muted text-muted-foreground'
      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  }`}>
    {type === 'cash' ? 'Cash' : 'Account'}
  </span>
);

/**
 * One client's money, opened over the table.
 *
 * Invoices and receipts on one timeline, because "what do they owe and how did
 * it get there" is one question and answering it from two tables is what makes
 * people keep a spreadsheet beside the system.
 */
const AccountDrawer = ({ client, loadAccount, onClose }) => {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadAccount(client.id)
      .then(res => { if (live) { setAccount(res); setError(''); } })
      .catch(err => { if (live) setError(err?.message || 'Could not load this account'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [client.id, loadAccount]);

  const s = account?.summary;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <h3 className="text-base font-bold text-foreground">{client.full_name}</h3>
            <p className="text-xs text-muted-foreground">
              {client.account_number || 'No account number'}
              {client.phone ? ` · ${client.phone}` : ''}
              {client.email ? ` · ${client.email}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg" aria-label="Close account">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {loading && <Sk className="h-24 w-full" />}
          {!loading && error && (
            <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-900/15 p-3 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {!loading && !error && s && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Invoiced',      value: fmt(s.invoiced) },
                  { label: 'Received',      value: fmt(s.paid) },
                  { label: 'Balance',       value: fmt(s.balance), accent: s.balance > 0 },
                  { label: 'Last payment',  value: fmtDate(s.last_payment_at) },
                ].map(k => (
                  <div key={k.label} className="rounded-xl border border-border p-3">
                    <p className="text-xs text-muted-foreground">{k.label}</p>
                    <p className={`text-lg font-bold mt-1 ${k.accent ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                      {k.value}
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                {s.invoice_count} invoice{s.invoice_count === 1 ? '' : 's'} ·{' '}
                {s.unpaid_count} unpaid ·{' '}
                {s.overdue_count} overdue ·{' '}
                {s.payment_count} payment{s.payment_count === 1 ? '' : 's'} received
                {s.hire_purchase_due > 0 && (
                  <>
                    {' '}· hire-purchase arrears of {fmt(s.hire_purchase_due)} are tracked separately
                    in the collections hub
                  </>
                )}
              </p>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Payment history
                </p>
                {account.statement.length === 0 ? (
                  <Empty icon="Receipt" text="Nothing billed yet"
                    sub="Invoices and receipts for this client will appear here." />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[640px]">
                      <thead>
                        <tr>
                          <th className={S.th}>Date</th>
                          <th className={S.th}>Entry</th>
                          <th className={S.th}>Reference</th>
                          <th className={`${S.th} text-right`}>Charged</th>
                          <th className={`${S.th} text-right`}>Received</th>
                          <th className={`${S.th} text-right`}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.statement.map(row => (
                          <tr key={`${row.kind}-${row.source_id}`} className={S.row}>
                            <td className={S.td}>{fmtDate(row.entry_at)}</td>
                            <td className={S.tdFirst}>
                              <span className="flex items-center gap-2">
                                <Icon name={row.kind === 'payment' ? 'ArrowDownCircle' : 'FileText'} size={13}
                                  color={row.kind === 'payment' ? '#10b981' : 'var(--color-muted-foreground)'} />
                                {row.description}
                              </span>
                            </td>
                            <td className={S.td}>{row.reference || '—'}</td>
                            <td className={`${S.td} text-right`}>{row.charged > 0 ? fmt(row.charged) : '—'}</td>
                            <td className={`${S.td} text-right text-emerald-600 dark:text-emerald-400`}>
                              {row.received > 0 ? fmt(row.received) : '—'}
                            </td>
                            <td className={`${S.td} text-right font-medium text-foreground`}>{fmt(row.running_balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const ClientsTab = ({ onInvoiceClient, onClientCreated }) => {
  const {
    clients, total, page, loading, error, pageSize, pageCount,
    goToPage, applySearch, refetch, loadAccount,
  } = useClientRecords();

  const [term,    setTerm]    = useState('');
  const [showNew, setShowNew] = useState(false);
  const [open,    setOpen]    = useState(null);

  // The search box is local so typing stays responsive; the query only moves
  // when the user commits it, which is also what keeps the page count honest.
  const commitSearch = useCallback((e) => {
    e?.preventDefault?.();
    applySearch(term);
  }, [term, applySearch]);

  const created = (client, { linked }) => {
    toast(linked
      ? `${client.full_name} is now linked — no second record was created`
      : `${client.full_name} added · ${client.account_number}`, 'success');
    // A new record belongs at the top of the first page. Moving the page is
    // enough to fetch it; asking for both would issue the query twice.
    if (page === 0) refetch({ page: 0 }); else goToPage(0);
    onClientCreated?.(client);
  };

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to   = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <form onSubmit={commitSearch} className="flex items-center gap-2">
          <input
            className={`${S.input} w-64`}
            placeholder="Search name, account no., phone, PIN…"
            value={term}
            onChange={e => setTerm(e.target.value)}
          />
          <button type="submit" className={S.btnSec}>
            <Icon name="Search" size={14} color="currentColor" /> Search
          </button>
          {term && (
            <button type="button" className={S.btnGhost}
              onClick={() => { setTerm(''); applySearch(''); }}>
              Clear
            </button>
          )}
        </form>
        <button className={S.btnPri} onClick={() => setShowNew(true)}>
          <Icon name="UserPlus" size={14} color="currentColor" /> New Client Record
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-900/15 p-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className={S.panel}>
        <div className={S.header}>
          <span className="font-semibold text-foreground flex items-center gap-2">
            <Icon name="Users" size={15} color="var(--color-primary)" /> Client Records
          </span>
          <span className="text-xs text-muted-foreground">
            {total === 0 ? 'No records' : `Showing ${from}–${to} of ${total}`}
          </span>
        </div>

        {loading && clients.length === 0 ? (
          <div className={`${S.body} space-y-2`}>
            {[0, 1, 2, 3, 4].map(i => <Sk key={i} className="h-10 w-full" />)}
          </div>
        ) : clients.length === 0 ? (
          <Empty icon="Users" text="No client records yet"
            sub="Create one to raise invoices, issue receipts and track a balance." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead>
                <tr>
                  <th className={S.th}>Client</th>
                  <th className={S.th}>Contact</th>
                  <th className={S.th}>Type</th>
                  <th className={`${S.th} text-right`}>Invoiced</th>
                  <th className={`${S.th} text-right`}>Received</th>
                  <th className={`${S.th} text-right`}>Balance</th>
                  <th className={S.th}>Last payment</th>
                  <th className={`${S.th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id} className={S.row}>
                    <td className={S.tdFirst}>
                      <span className="flex items-center gap-2">
                        {c.full_name}
                        {c.lead_id && (
                          <span title="Created from a lead — linked, so it cannot be duplicated">
                            <Icon name="GitBranch" size={12} color="var(--color-muted-foreground)" />
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">{c.account_number || '—'}</span>
                    </td>
                    <td className={S.td}>
                      {c.phone || '—'}
                      <span className="block text-xs">{c.email || ''}</span>
                    </td>
                    <td className={S.td}><TypeBadge type={c.customer_type} /></td>
                    <td className={`${S.td} text-right`}>{fmt(c.invoiced)}</td>
                    <td className={`${S.td} text-right`}>{fmt(c.paid)}</td>
                    <td className={`${S.td} text-right font-semibold ${
                      c.balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
                    }`}>
                      {fmt(c.balance)}
                      {c.overdue_count > 0 && (
                        <span className="block text-xs font-normal text-red-600 dark:text-red-400">
                          {c.overdue_count} overdue
                        </span>
                      )}
                    </td>
                    <td className={S.td}>{fmtDate(c.last_payment_at)}</td>
                    <td className={`${S.td} text-right whitespace-nowrap`}>
                      <button className={S.btnGhost} onClick={() => setOpen(c)}
                        title="Balance and payment history">
                        <Icon name="Receipt" size={13} color="currentColor" /> Statement
                      </button>
                      <button className={S.btnGhost} onClick={() => onInvoiceClient?.(c)}
                        title="Raise an invoice for this client">
                        <Icon name="FilePlus" size={13} color="currentColor" /> Invoice
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border">
            <button className={S.btnGhost} disabled={page === 0} onClick={() => goToPage(page - 1)}>
              <Icon name="ChevronLeft" size={14} color="currentColor" /> Previous
            </button>
            <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
            <button className={S.btnGhost} disabled={page + 1 >= pageCount} onClick={() => goToPage(page + 1)}>
              Next <Icon name="ChevronRight" size={14} color="currentColor" />
            </button>
          </div>
        )}
      </div>

      <ClientRecordModal
        isOpen={showNew}
        onClose={() => setShowNew(false)}
        onCreated={created}
      />

      {open && (
        <AccountDrawer client={open} loadAccount={loadAccount} onClose={() => setOpen(null)} />
      )}
    </div>
  );
};

export default ClientsTab;
