import React, { useState, useMemo } from 'react';
import { useToast } from '../../../components/Toast';
import Icon from '../../../components/AppIcon';
import { generateSchedule } from '../../../utils/saccoAmortization';
import { buildLoanRepaymentReceipt, downloadAccountingDocument } from '../../../utils/accountingDocument';
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

/**
 * The society's borrowing multiple, as it applies to me
 * (20260905180000_sacco_borrowing_multiple).
 *
 * Every figure here is the server's — sacco_member_borrowing_capacity() is the
 * same function the insert trigger judges an application by, so what this
 * panel promises and what the sacco will accept cannot drift apart. Nothing on
 * this screen recomputes a ceiling of its own.
 *
 * `limit_enforced` off is the interesting case: the society has set a multiple
 * but has not switched enforcement on, so this is guidance and an application
 * above it still reaches the loans officer. Saying otherwise would be a lie
 * the server would not back up.
 */
const num = (v) => parseFloat(v || 0) || 0;

// 3.00 -> "3", 2.50 -> "2.5". A whole multiple should not read as a decimal.
const fmtMultiple = (v) => String(num(v)).replace(/\.0+$/, '');

const Figure = ({ label, value, strong }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`${strong ? 'font-bold text-foreground' : 'font-medium text-foreground'} text-sm`}>{value}</p>
  </div>
);

const BorrowingLimitPanel = ({ capacity, principal }) => {
  if (!capacity) return null;

  const security  = num(capacity.security);
  const available = num(capacity.available);
  const ceiling   = num(capacity.ceiling);
  const committed = num(capacity.existing_exposure);
  const enforced  = !!capacity.limit_enforced;
  const basis     = capacity.counts_deposits ? 'shares and savings' : 'shares';
  const asked     = num(principal);
  const over      = asked > 0 && asked > available;

  // Nothing on the register: there is no entitlement to quote, and "you may
  // borrow KES 0" reads as a refusal rather than as "we have no record of your
  // shares yet".
  if (security <= 0) {
    return (
      <div className="p-4 rounded-xl border border-amber-200 bg-amber-50">
        <div className="flex items-start gap-2">
          <Icon name="AlertTriangle" size={15} color="#ca8a04" />
          <p className="text-xs text-amber-800 leading-relaxed">
            Your sacco lends up to <strong>{fmtMultiple(capacity.multiple)}x</strong> a member&apos;s {basis},
            but none are recorded against your membership yet, so no limit can be worked out.
            {enforced
              ? ' Applications are held to this rule, so speak to your sacco before applying.'
              : ' Your application will still be reviewed in the usual way.'}
          </p>
        </div>
      </div>
    );
  }

  const tone = over
    ? (enforced ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')
    : 'border-border bg-muted/50';

  return (
    <div className={`p-4 rounded-xl border ${tone}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          What you may borrow
        </p>
        <span className="text-xs text-muted-foreground">
          {fmtMultiple(capacity.multiple)}x your {basis}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Figure label={capacity.counts_deposits ? 'Shares and savings' : 'Your shares'} value={KES(security)} />
        <Figure label="Entitles you to" value={KES(ceiling)} />
        <Figure
          label={capacity.nets_off_loans ? 'Already borrowed' : 'Currently owed'}
          value={KES(committed)}
        />
        <Figure label="Maximum eligible" value={KES(available)} strong />
      </div>

      {capacity.nets_off_loans && committed > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          {KES(committed)} of your {KES(ceiling)} entitlement is committed to loans you already hold.
        </p>
      )}

      {over && (
        <div className="flex items-start gap-2 mt-3 pt-3 border-t border-border/60">
          <Icon name={enforced ? 'XCircle' : 'AlertTriangle'} size={14} color={enforced ? '#dc2626' : '#ca8a04'} />
          <p className={`text-xs leading-relaxed ${enforced ? 'text-red-700' : 'text-amber-700'}`}>
            {enforced
              ? `You have asked for ${KES(asked)}, which is ${KES(asked - available)} above your limit. Reduce the amount to apply.`
              : `You have asked for ${KES(asked)}, which is ${KES(asked - available)} above the usual limit. You can still apply — your sacco will decide.`}
          </p>
        </div>
      )}

      {!enforced && !over && (
        <p className="text-xs text-muted-foreground mt-3">
          This is your sacco&apos;s guide, not a hard limit — every application is reviewed.
        </p>
      )}
    </div>
  );
};

const emptyForm = { product_id: '', principal: '', term_months: '12', purpose: '' };

const LoansTab = ({ ctx }) => {
  const { me, sacco, loans, schedules, loanProducts, borrowingCapacity, applyLoan, exportCSV } = ctx;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null); // loan id whose schedule is shown
  const [receipting, setReceipting] = useState(null);

  /**
   * The borrower's own copy of an installment, with the interest/principal
   * split that explains why a payment moved the balance as little as it did.
   * A paid row downloads as a receipt, an unpaid one as an installment notice —
   * the builder decides, so this can never hand out proof of a payment that
   * has not happened.
   *
   * The loan row carries no member join here (every loan on this page is mine),
   * so `me` is attached for the borrower block.
   */
  const downloadReceipt = async (loan, row) => {
    setReceipting(row.id);
    try {
      const filename = await downloadAccountingDocument(buildLoanRepaymentReceipt({
        installment: row,
        loan: { ...loan, member: loan.member || me },
        sacco,
      }));
      toast.success(filename, 'Downloaded');
    } catch (e) {
      toast.error(e.message, 'Could not generate the receipt');
    } finally {
      setReceipting(null);
    }
  };

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const product = loanProducts.find((p) => p.id === form.product_id);

  // The society's ceiling as the server computes it. `overLimit` only bites
  // when the society actually enforces it — otherwise the panel advises and
  // the application still goes through, which is what the trigger does too.
  const maxEligible = borrowingCapacity ? parseFloat(borrowingCapacity.available || 0) || 0 : null;
  const limitEnforced = !!borrowingCapacity?.limit_enforced;
  const overLimit = limitEnforced && maxEligible !== null
    && (parseFloat(form.principal) || 0) > maxEligible;

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
    if (overLimit) {
      toast.error(`Your sacco lends you up to ${KES(maxEligible)}. Reduce the amount to apply.`);
      return;
    }
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
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${maxEligible === null ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
        <StatCard label="Active Loans" value={activeLoans.length} icon="Banknote" tone="primary" />
        <StatCard label="Outstanding" value={KES(outstanding)} icon="TrendingDown" tone="warning" />
        <StatCard label="Applications" value={loans.filter((l) => l.status === 'pending').length} icon="Clock" tone="muted" />
        <StatCard label="Closed" value={loans.filter((l) => l.status === 'closed').length} icon="CheckCircle2" tone="success" />
        {maxEligible !== null && (
          <StatCard
            label="Maximum eligible" value={KES(maxEligible)} icon="Gauge" tone="success"
            hint={`${fmtMultiple(borrowingCapacity.multiple)}x your ${borrowingCapacity.counts_deposits ? 'shares and savings' : 'shares'}${limitEnforced ? '' : ' (guide)'}`}
          />
        )}
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
                          <Table columns={['#', 'Due', 'Opening', 'Interest', 'Principal', 'Payment', 'Closing', 'Status', '']}>
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
                                <td className="py-2 pr-0 text-right">
                                  <button
                                    onClick={() => downloadReceipt(l, r)}
                                    disabled={receipting === r.id}
                                    title={r.paid
                                      ? `Download the receipt for installment ${r.period_no}`
                                      : `Download the notice for installment ${r.period_no}`}
                                    className="align-middle text-muted-foreground hover:text-foreground disabled:opacity-60"
                                  >
                                    <Icon name={receipting === r.id ? 'Loader' : 'Download'} size={13} color="currentColor"
                                      className={receipting === r.id ? 'animate-spin' : ''} />
                                  </button>
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
          <PrimaryButton icon="Send" onClick={submit} disabled={saving || overLimit}>
            {saving ? 'Submitting…' : 'Submit application'}
          </PrimaryButton>
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

        {/* What the society will lend this member, before they fill the rest in */}
        <div className="mt-5">
          <BorrowingLimitPanel capacity={borrowingCapacity} principal={form.principal} />
        </div>

        {preview && (
          <div className="mt-4 p-4 rounded-xl border border-border bg-muted/50">
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
