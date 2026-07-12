import React, { useState, useMemo } from 'react';
import { useToast } from '../../../components/Toast';
import { generateSchedule } from '../../../utils/saccoAmortization';
import {
  Card, StatCard, Badge, Table, EmptyState, PrimaryButton, GhostButton,
  Modal, Field, TextInput, NumberInput, Select, KES, fmtDate,
} from '../../sacco-dashboard/components/_shared';

const METHOD_LABELS = {
  reducing_balance: 'Reducing balance (EMI)',
  equal_principal:  'Equal principal',
  flat_rate:        'Flat rate',
  interest_only:    'Interest only',
  balloon:          'Balloon payment',
};

const emptyForm = { product_id: '', principal: '', term_months: '12', purpose: '' };

const LoansTab = ({ ctx }) => {
  const { loans, schedules, loanProducts, applyLoan, exportCSV } = ctx;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null); // loan id whose schedule is shown

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const product = loanProducts.find((p) => p.id === form.product_id);

  // Live repayment preview (BRS FR3.1) driven by the real amortization engine.
  const preview = useMemo(() => {
    const principal = parseFloat(form.principal);
    const term = parseInt(form.term_months, 10);
    if (!product || !principal || principal <= 0 || !term || term <= 0) return null;
    try {
      const { schedule } = generateSchedule(product.amortization_method, {
        principal,
        annualRate: parseFloat(product.annual_interest_rate) || 12,
        termMonths: term,
        balloonAmount: 0,
        startDate: new Date().toISOString().slice(0, 10),
      });
      const totalPayment = schedule.reduce((s, r) => s + r.payment, 0);
      const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
      return { firstPayment: schedule[0]?.payment || 0, totalPayment, totalInterest };
    } catch (_) { return null; }
  }, [product, form.principal, form.term_months]);

  const submit = async () => {
    if (!product) { toast.error('Select a loan product.'); return; }
    if (!(parseFloat(form.principal) > 0)) { toast.error('Enter the loan amount.'); return; }
    const term = parseInt(form.term_months, 10) || 0;
    if (term <= 0) { toast.error('Enter the term in months.'); return; }
    if (product.max_term_months && term > product.max_term_months) {
      toast.error(`Maximum term for ${product.name} is ${product.max_term_months} months.`); return;
    }
    setSaving(true);
    try {
      await applyLoan({
        product_id: product.id,
        principal: form.principal,
        annual_interest_rate: product.annual_interest_rate,
        term_months: term,
        method: product.amortization_method,
        purpose: form.purpose,
      });
      toast.success('Loan application submitted for review.');
      setOpen(false);
      setForm(emptyForm);
    } catch (e) {
      toast.error(e.message || 'Could not submit the application.');
    } finally {
      setSaving(false);
    }
  };

  const activeLoans = loans.filter((l) => l.status === 'active');
  const outstanding = schedules.filter((s) => !s.paid).reduce((s, r) => s + parseFloat(r.payment || 0), 0);
  const today = new Date().toISOString().slice(0, 10);

  // Overdue rows red, next upcoming amber (BRS AM1.5).
  const rowTone = (r, nextDueId) => {
    if (r.paid) return '';
    if (r.due_date && r.due_date < today) return 'bg-red-50';
    if (r.id === nextDueId) return 'bg-amber-50';
    return '';
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Loans" value={activeLoans.length} icon="Banknote" tone="primary" />
        <StatCard label="Outstanding" value={KES(outstanding)} icon="TrendingDown" tone="warning" />
        <StatCard label="Applications" value={loans.filter((l) => l.status === 'pending').length} icon="Clock" tone="muted" />
        <StatCard label="Closed" value={loans.filter((l) => l.status === 'closed').length} icon="CheckCircle2" tone="success" />
      </div>

      <Card
        title="My loans"
        subtitle="Applications, active loans and repayment schedules"
        actions={<PrimaryButton icon="Plus" onClick={() => setOpen(true)}>Apply for a loan</PrimaryButton>}
      >
        {loans.length === 0 ? (
          <EmptyState icon="Banknote" title="No loans yet" hint="Apply for your first loan — you'll see a live repayment preview before you submit." />
        ) : (
          <div className="space-y-3">
            {loans.map((l) => {
              const rows = schedules.filter((s) => s.loan_id === l.id);
              const nextDueId = rows.filter((r) => !r.paid && r.due_date >= today)
                .sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0]?.id;
              const isOpen = expanded === l.id;
              return (
                <div key={l.id} className="border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpanded(isOpen ? null : l.id)}
                    className="w-full flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-muted transition-all text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {KES(l.principal)} · {l.product?.name || METHOD_LABELS[l.method] || l.method}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {l.term_months} months · {l.annual_interest_rate}% p.a. · applied {fmtDate(l.created_at)}
                        {l.purpose ? ` · ${l.purpose}` : ''}
                      </p>
                    </div>
                    <Badge status={l.status} />
                  </button>
                  {isOpen && (
                    <div className="p-4 border-t border-border">
                      {rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {l.status === 'pending' ? 'Your schedule appears here once the loan is approved and disbursed.' : 'No schedule found for this loan.'}
                        </p>
                      ) : (
                        <>
                          <div className="flex justify-end mb-2">
                            <GhostButton icon="Download" onClick={() => exportCSV(rows, `loan_schedule_${l.id.slice(0, 8)}`)}>Export schedule</GhostButton>
                          </div>
                          <Table columns={['#', 'Due', 'Opening', 'Interest', 'Principal', 'Payment', 'Closing', 'Status']}>
                            {rows.map((r) => (
                              <tr key={r.id} className={`border-b border-border/60 ${rowTone(r, nextDueId)}`}>
                                <td className="py-2 pr-4 text-muted-foreground">{r.period_no}</td>
                                <td className="py-2 pr-4 text-muted-foreground">{fmtDate(r.due_date)}</td>
                                <td className="py-2 pr-4 text-foreground">{KES(r.opening_balance)}</td>
                                <td className="py-2 pr-4 text-foreground">{KES(r.interest)}</td>
                                <td className="py-2 pr-4 text-foreground">{KES(r.principal)}</td>
                                <td className="py-2 pr-4 font-medium text-foreground">{KES(r.payment)}</td>
                                <td className="py-2 pr-4 text-foreground">{KES(r.closing_balance)}</td>
                                <td className="py-2 pr-4">
                                  <Badge status={r.paid ? 'paid' : (r.due_date && r.due_date < today ? 'overdue' : 'pending')} />
                                </td>
                              </tr>
                            ))}
                          </Table>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Apply modal with live repayment preview */}
      <Modal
        open={open} onClose={() => setOpen(false)} wide
        title="Apply for a loan"
        footer={<>
          <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Send" onClick={submit} disabled={saving}>{saving ? 'Submitting…' : 'Submit application'}</PrimaryButton>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Loan product *">
            <Select value={form.product_id} onChange={(e) => set('product_id', e.target.value)}>
              <option value="">Select a product…</option>
              {loanProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.annual_interest_rate}% p.a. ({METHOD_LABELS[p.amortization_method] || p.amortization_method})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (KES) *"><NumberInput value={form.principal} onChange={(e) => set('principal', e.target.value)} placeholder="50000" /></Field>
          <Field label={`Term in months *${product?.max_term_months ? ` (max ${product.max_term_months})` : ''}`}>
            <NumberInput value={form.term_months} onChange={(e) => set('term_months', e.target.value)} />
          </Field>
          <Field label="Purpose"><TextInput value={form.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="School fees, business stock…" /></Field>
        </div>

        {preview && (
          <div className="mt-5 p-4 rounded-xl border border-border bg-muted/50">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Repayment preview</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div><p className="text-muted-foreground text-xs">First payment</p><p className="font-bold text-foreground">{KES(preview.firstPayment)}</p></div>
              <div><p className="text-muted-foreground text-xs">Total interest</p><p className="font-bold text-foreground">{KES(preview.totalInterest)}</p></div>
              <div><p className="text-muted-foreground text-xs">Total repayable</p><p className="font-bold text-foreground">{KES(preview.totalPayment)}</p></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default LoansTab;
