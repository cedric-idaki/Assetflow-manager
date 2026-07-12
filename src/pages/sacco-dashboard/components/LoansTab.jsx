import React, { useState, useMemo } from 'react';
import { useToast } from '../../../components/Toast';
import { generateSchedule, AMORTIZATION_METHODS } from '../../../utils/saccoAmortization';
import {
  Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field,
  TextInput, NumberInput, Select, EmptyState, KES, fmtDate,
} from './_shared';

const methodLabel = (id) => AMORTIZATION_METHODS.find((m) => m.id === id)?.label || id;

// Renders an amortization schedule table with overdue (red) / upcoming (amber)
// highlighting per BRS AM1.5. Works for both a live preview and a saved loan.
const ScheduleTable = ({ rows, onPay }) => {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Table columns={['#', 'Due', 'Opening', 'Interest', 'Principal', 'Payment', 'Closing', onPay ? 'Status' : '']}>
      {rows.map((r) => {
        const due = r.due_date || r.dueDate;
        const paid = r.paid;
        const overdue = !paid && due && due < today;
        const upcoming = !paid && due && due >= today;
        const rowBg = paid ? 'bg-emerald-50/40' : overdue ? 'bg-red-50/50' : upcoming ? 'bg-amber-50/40' : '';
        return (
          <tr key={r.period_no || r.periodNo} className={`border-b border-border/60 ${rowBg}`}>
            <td className="py-2 pr-4 text-muted-foreground">{r.period_no || r.periodNo}</td>
            <td className="py-2 pr-4 text-muted-foreground">{fmtDate(due)}</td>
            <td className="py-2 pr-4 text-foreground">{KES(r.opening_balance ?? r.openingBalance)}</td>
            <td className="py-2 pr-4 text-foreground">{KES(r.interest)}</td>
            <td className="py-2 pr-4 text-foreground">{KES(r.principal)}</td>
            <td className="py-2 pr-4 font-semibold text-foreground">{KES(r.payment)}</td>
            <td className="py-2 pr-4 text-foreground">{KES(r.closing_balance ?? r.closingBalance)}</td>
            {onPay && (
              <td className="py-2 pr-0">
                {paid ? <Badge status="paid" />
                  : <button onClick={() => onPay(r)} className="text-xs text-primary font-semibold hover:underline">Mark paid</button>}
              </td>
            )}
          </tr>
        );
      })}
    </Table>
  );
};

const LoansTab = ({ ctx }) => {
  const {
    loans, loanProducts, members, schedules,
    createLoan, createLoanProduct, approveLoan, rejectLoan, recordRepayment, exportCSV,
  } = ctx;
  const toast = useToast();

  const [loanOpen, setLoanOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [scheduleLoan, setScheduleLoan] = useState(null);
  const [saving, setSaving] = useState(false);

  const [loanForm, setLoanForm] = useState({
    member_id: '', product_id: '', principal: '', annual_interest_rate: '12',
    term_months: '12', method: 'reducing_balance', balloon_amount: '', purpose: '',
  });
  const [prodForm, setProdForm] = useState({
    name: '', amortization_method: 'reducing_balance', annual_interest_rate: '12',
    max_term_months: '12', penalty_rate: '0',
  });
  const setLF = (k, v) => setLoanForm((p) => ({ ...p, [k]: v }));
  const setPF = (k, v) => setProdForm((p) => ({ ...p, [k]: v }));

  // Live amortization preview for the loan being created.
  const preview = useMemo(() => {
    if (!(parseFloat(loanForm.principal) > 0) || !(parseInt(loanForm.term_months, 10) > 0)) return null;
    return generateSchedule(loanForm.method, {
      principal: loanForm.principal, annualRate: loanForm.annual_interest_rate,
      termMonths: loanForm.term_months, balloonAmount: loanForm.balloon_amount,
      startDate: new Date().toISOString().slice(0, 10),
    });
  }, [loanForm.principal, loanForm.term_months, loanForm.method, loanForm.annual_interest_rate, loanForm.balloon_amount]);

  // Selecting a product pre-fills its method/rate/term.
  const onSelectProduct = (id) => {
    const p = loanProducts.find((x) => x.id === id);
    setLoanForm((f) => ({
      ...f, product_id: id,
      ...(p ? { method: p.amortization_method, annual_interest_rate: String(p.annual_interest_rate), term_months: String(p.max_term_months) } : {}),
    }));
  };

  const saveLoan = async () => {
    if (!loanForm.member_id) { toast.error('Choose a borrower.'); return; }
    if (!(parseFloat(loanForm.principal) > 0)) { toast.error('Enter a principal greater than 0.'); return; }
    setSaving(true);
    try {
      await createLoan(loanForm);
      toast.success('Loan application created (pending approval).');
      setLoanOpen(false);
      setLoanForm((f) => ({ ...f, principal: '', purpose: '', balloon_amount: '' }));
    } catch (e) { toast.error(e.message || 'Could not create loan.'); }
    finally { setSaving(false); }
  };

  const saveProduct = async () => {
    if (!prodForm.name.trim()) { toast.error('Product name is required.'); return; }
    setSaving(true);
    try {
      await createLoanProduct(prodForm);
      toast.success('Loan product created.');
      setProdOpen(false);
      setProdForm((p) => ({ ...p, name: '' }));
    } catch (e) { toast.error(e.message || 'Could not create product.'); }
    finally { setSaving(false); }
  };

  const doApprove = async (loan) => {
    try { await approveLoan(loan); toast.success('Loan approved — amortization schedule generated.'); }
    catch (e) { toast.error(e.message || 'Approval failed.'); }
  };
  const doReject = async (loan) => {
    try { await rejectLoan(loan.id); toast.success('Loan rejected.'); }
    catch (e) { toast.error(e.message || 'Could not reject.'); }
  };
  const doPay = async (row) => {
    try { await recordRepayment(row); toast.success('Repayment recorded.'); }
    catch (e) { toast.error(e.message || 'Could not record repayment.'); }
  };

  const loanSchedule = scheduleLoan ? schedules.filter((s) => s.loan_id === scheduleLoan.id).sort((a, b) => a.period_no - b.period_no) : [];
  const outstanding = loans.filter((l) => l.status === 'active').reduce((s, l) => s + parseFloat(l.principal || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Active loans" value={loans.filter((l) => l.status === 'active').length} icon="Banknote" tone="warning" />
        <StatCard label="Disbursed principal" value={KES(outstanding)} icon="TrendingUp" />
        <StatCard label="Pending applications" value={loans.filter((l) => l.status === 'pending').length} icon="Clock" tone="muted" />
      </div>

      {/* Loan products */}
      <Card
        title="Loan products" subtitle="Define the amortization method, rate and term"
        actions={<PrimaryButton icon="Plus" onClick={() => setProdOpen(true)}>New product</PrimaryButton>}
      >
        {loanProducts.length === 0 ? (
          <EmptyState icon="Package" title="No loan products yet" hint="Create a product (e.g. Emergency Loan) to standardise how loans amortize." />
        ) : (
          <Table columns={['Product', 'Method', 'Rate p.a.', 'Max term', 'Penalty', 'Active']}>
            {loanProducts.map((p) => (
              <tr key={p.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 font-medium text-foreground">{p.name}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{methodLabel(p.amortization_method)}</td>
                <td className="py-2.5 pr-4 text-foreground">{p.annual_interest_rate}%</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{p.max_term_months} mo</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{p.penalty_rate}%</td>
                <td className="py-2.5 pr-4"><Badge status={p.is_active ? 'active' : 'inactive'} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Loans */}
      <Card
        title="Loans" subtitle={`${loans.length} total`}
        actions={
          <div className="flex items-center gap-2">
            <GhostButton icon="Download" onClick={() => exportCSV(loans, 'sacco_loans')}>Export</GhostButton>
            <PrimaryButton icon="Plus" onClick={() => setLoanOpen(true)}>New loan</PrimaryButton>
          </div>
        }
      >
        {loans.length === 0 ? (
          <EmptyState icon="Banknote" title="No loans yet" hint="Create a loan application; approving it generates the full amortization schedule." />
        ) : (
          <Table columns={['Borrower', 'Principal', 'Method', 'Rate', 'Term', 'Status', '']}>
            {loans.map((l) => (
              <tr key={l.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 font-medium text-foreground">{l.member?.full_name || '—'}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(l.principal)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{methodLabel(l.method)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{l.annual_interest_rate}%</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{l.term_months} mo</td>
                <td className="py-2.5 pr-4"><Badge status={l.status} /></td>
                <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                  {l.status === 'pending' && (
                    <>
                      <button onClick={() => doApprove(l)} className="text-xs text-emerald-600 font-semibold hover:underline mr-3">Approve</button>
                      <button onClick={() => doReject(l)} className="text-xs text-red-600 font-semibold hover:underline">Reject</button>
                    </>
                  )}
                  {(l.status === 'active' || l.status === 'closed') && (
                    <button onClick={() => setScheduleLoan(l)} className="text-xs text-primary font-semibold hover:underline">Schedule</button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* New product modal */}
      <Modal open={prodOpen} onClose={() => setProdOpen(false)} title="New loan product"
        footer={<>
          <GhostButton onClick={() => setProdOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={saveProduct} disabled={saving}>{saving ? 'Saving…' : 'Save product'}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name *"><TextInput value={prodForm.name} onChange={(e) => setPF('name', e.target.value)} placeholder="Emergency Loan" /></Field>
          <Field label="Amortization method"><Select value={prodForm.amortization_method} onChange={(e) => setPF('amortization_method', e.target.value)}>{AMORTIZATION_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
          <Field label="Annual interest rate (%)"><NumberInput value={prodForm.annual_interest_rate} onChange={(e) => setPF('annual_interest_rate', e.target.value)} /></Field>
          <Field label="Max term (months)"><NumberInput value={prodForm.max_term_months} onChange={(e) => setPF('max_term_months', e.target.value)} /></Field>
          <Field label="Penalty rate (%)"><NumberInput value={prodForm.penalty_rate} onChange={(e) => setPF('penalty_rate', e.target.value)} /></Field>
        </div>
      </Modal>

      {/* New loan modal (with live amortization preview) */}
      <Modal open={loanOpen} onClose={() => setLoanOpen(false)} wide title="New loan application"
        footer={<>
          <GhostButton onClick={() => setLoanOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={saveLoan} disabled={saving}>{saving ? 'Saving…' : 'Create application'}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Borrower *">
            <Select value={loanForm.member_id} onChange={(e) => setLF('member_id', e.target.value)}>
              <option value="">Select member</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Loan product">
            <Select value={loanForm.product_id} onChange={(e) => onSelectProduct(e.target.value)}>
              <option value="">— none / custom —</option>
              {loanProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Principal (KES) *"><NumberInput value={loanForm.principal} onChange={(e) => setLF('principal', e.target.value)} placeholder="50000" /></Field>
          <Field label="Amortization method"><Select value={loanForm.method} onChange={(e) => setLF('method', e.target.value)}>{AMORTIZATION_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
          <Field label="Annual interest rate (%)"><NumberInput value={loanForm.annual_interest_rate} onChange={(e) => setLF('annual_interest_rate', e.target.value)} /></Field>
          <Field label="Term (months)"><NumberInput value={loanForm.term_months} onChange={(e) => setLF('term_months', e.target.value)} /></Field>
          {loanForm.method === 'balloon' && (
            <Field label="Balloon amount (KES)"><NumberInput value={loanForm.balloon_amount} onChange={(e) => setLF('balloon_amount', e.target.value)} placeholder="20000" /></Field>
          )}
          <Field label="Purpose"><TextInput value={loanForm.purpose} onChange={(e) => setLF('purpose', e.target.value)} placeholder="e.g. school fees" /></Field>
        </div>

        {preview && (
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Repayment preview</p>
              <p className="text-xs text-muted-foreground">
                Total payable <span className="font-semibold text-foreground">{KES(preview.summary.totalPaid)}</span>
                {' · '}Interest <span className="font-semibold text-foreground">{KES(preview.summary.totalInterest)}</span>
              </p>
            </div>
            <div className="border border-border rounded-lg p-3 max-h-64 overflow-y-auto">
              <ScheduleTable rows={preview.schedule} />
            </div>
          </div>
        )}
      </Modal>

      {/* Schedule viewer */}
      <Modal open={!!scheduleLoan} onClose={() => setScheduleLoan(null)} wide
        title={scheduleLoan ? `Schedule · ${scheduleLoan.member?.full_name || 'Loan'} · ${KES(scheduleLoan.principal)}` : ''}>
        {loanSchedule.length === 0
          ? <EmptyState icon="CalendarX" title="No schedule rows" hint="This loan has no generated schedule." />
          : <ScheduleTable rows={loanSchedule} onPay={doPay} />}
      </Modal>
    </div>
  );
};

export default LoansTab;
