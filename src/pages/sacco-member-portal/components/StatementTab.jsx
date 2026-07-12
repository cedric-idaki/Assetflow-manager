import React, { useState, useMemo } from 'react';
import {
  Card, Badge, Table, EmptyState, GhostButton, PrimaryButton,
  Field, TextInput, Select, KES, fmtDate,
} from '../../sacco-dashboard/components/_shared';

const TYPES = [
  { id: 'contributions', label: 'Contribution statement' },
  { id: 'loans',         label: 'Loan statement' },
  { id: 'shares',        label: 'Share statement' },
  { id: 'combined',      label: 'Combined statement' },
];

// BRS 5.4 — self-service statements with a date-range filter, exportable.
const StatementTab = ({ ctx }) => {
  const { me, sacco, contributions, loans, schedules, shares, transfers, exportCSV } = ctx;
  const [type, setType] = useState('combined');
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');

  const inRange = (d) => {
    if (!d) return true;
    const day = String(d).slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  };

  const data = useMemo(() => {
    const contribRows = contributions
      .filter((c) => inRange(c.paid_date || c.due_date))
      .map((c) => ({
        date: c.paid_date || c.due_date, section: 'Contribution',
        detail: `${c.contribution_type} contribution${c.reference ? ` · ${c.reference}` : ''}`,
        amount: parseFloat(c.amount || 0), status: c.status,
      }));

    const loanRows = loans
      .filter((l) => inRange(l.created_at))
      .map((l) => ({
        date: l.created_at, section: 'Loan',
        detail: `${l.product?.name || l.method} — ${l.term_months} months @ ${l.annual_interest_rate}%`,
        amount: parseFloat(l.principal || 0), status: l.status,
      }));

    const repaymentRows = schedules
      .filter((s) => s.paid && inRange(s.paid_date))
      .map((s) => ({
        date: s.paid_date, section: 'Loan repayment',
        detail: `Instalment ${s.period_no}`,
        amount: parseFloat(s.payment || 0), status: 'paid',
      }));

    const shareRows = transfers
      .filter((t) => inRange(t.created_at))
      .map((t) => ({
        date: t.created_at, section: 'Share transfer',
        detail: `${t.shares} shares ${t.buyer_member_id === me?.id ? 'purchased' : 'sold'}`,
        amount: parseFloat(t.price || 0), status: t.status,
      }));

    let rows;
    if (type === 'contributions') rows = contribRows;
    else if (type === 'loans')    rows = [...loanRows, ...repaymentRows];
    else if (type === 'shares')   rows = shareRows;
    else rows = [...contribRows, ...loanRows, ...repaymentRows, ...shareRows];

    return rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [type, from, to, contributions, loans, schedules, transfers, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const held = parseInt(shares?.shares_held, 10) || 0;
  const ref = `ST-${(me?.member_no || 'M').replace(/\s+/g, '')}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

  const exportRows = () => exportCSV(
    data.map((r) => ({ date: String(r.date || '').slice(0, 10), section: r.section, detail: r.detail, amount: r.amount, status: r.status })),
    `statement_${type}`,
  );

  return (
    <Card
      title="My statement"
      subtitle={`${sacco?.name || 'Sacco'} · ${me?.full_name || ''} (${me?.member_no || '—'}) · Ref ${ref}`}
      actions={
        <div className="flex items-center gap-2">
          <GhostButton icon="Printer" onClick={() => window.print()}>Print / PDF</GhostButton>
          <PrimaryButton icon="Download" onClick={exportRows} disabled={data.length === 0}>Export CSV</PrimaryButton>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <Field label="Statement type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="From"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>

      {type === 'shares' && (
        <p className="text-sm text-muted-foreground mb-4">
          Current holding: <strong className="text-foreground">{held.toLocaleString()} shares</strong>
          {shares?.par_value ? <> at par value <strong className="text-foreground">{KES(shares.par_value)}</strong></> : null}.
        </p>
      )}

      {data.length === 0 ? (
        <EmptyState icon="FileSpreadsheet" title="Nothing in this period" hint="Adjust the date range or statement type." />
      ) : (
        <Table columns={['Date', 'Section', 'Detail', 'Amount', 'Status']}>
          {data.map((r, i) => (
            <tr key={i} className="border-b border-border/60">
              <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(r.date)}</td>
              <td className="py-2.5 pr-4 text-foreground">{r.section}</td>
              <td className="py-2.5 pr-4 text-muted-foreground">{r.detail}</td>
              <td className="py-2.5 pr-4 font-medium text-foreground">{KES(r.amount)}</td>
              <td className="py-2.5 pr-4"><Badge status={r.status} /></td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
};

export default StatementTab;
