import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useToast } from '../../../components/Toast';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { fetchAllRows } from '../../../lib/fetchAllRows';
import Pagination from '../../../components/ui/Pagination';
import { usePagedQuery, sanitizeSearchTerm } from '../../../hooks/usePagedQuery';
import {
  Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field,
  TextInput, NumberInput, Select, EmptyState, ProgressBar, ContributionChart,
  KES, fmtDate, fmtDateTime, isSettled, sumAmount, accountLabel, monthKey, monthLabel,
  PAYMENT_METHODS, CONTRIB_ACCOUNTS,
} from './_shared';

const TYPES = ['monthly', 'weekly', 'daily', 'one-time', 'project', 'other'];
const RECORD_STATUSES = ['completed', 'pending', 'overdue', 'waived'];
const FREQUENCIES = ['one-off', 'weekly', 'monthly'];

const EMPTY_TYPE_FORM = { name: '', description: '', suggested_amount: '', frequency: 'monthly', due_date: '' };

const todayStr = () => new Date().toISOString().slice(0, 10);
const emptyRecordForm = () => ({
  member_id: '', amount: '', contribution_type: 'monthly', account: 'deposits',
  payment_method: 'cash', due_date: '', paid_date: todayStr(),
  status: 'completed', penalty_amount: '', reference: '', notes: '',
});

/** Rows per page in the contributions ledger. */
const PAGE_SIZE = 25;

// Same shape the context fetched, so a row renders identically from either.
const CONTRIBUTION_COLUMNS = '*, member:sacco_members(id, full_name, member_no)';

/**
 * Columns the free-text box searches. Top-level only, and mirrored exactly by
 * sacco_contributions_filtered_summary — if the two ever diverge, the table
 * and the summary line above it would describe different sets of rows.
 * Member name is not here on purpose: the member dropdown does that exactly.
 */
const LEDGER_SEARCH_COLUMNS = ['txn_no', 'reference', 'notes', 'contribution_type', 'received_by_name'];

const SUBTABS = [
  { id: 'ledger',  label: 'Ledger',  icon: 'List' },
  { id: 'reports', label: 'Reports', icon: 'BarChart3' },
  { id: 'audit',   label: 'Audit log', icon: 'ShieldCheck' },
];

const ContributionsTab = ({ ctx }) => {
  const {
    members, contributionTypes, contributionAudit, stats,
    recordContribution, approveContribution, reverseContribution, editContribution,
    createContributionType, updateContributionType, exportCSV,
    getCollections, getDefaulters, getMemberContributionStats,
  } = ctx;
  const toast = useToast();

  const [sub, setSub] = useState('ledger');

  // ── Record / edit ──────────────────────────────────────────────────────────
  const [open, setOpen]     = useState(false);
  const [editing, setEditing] = useState(null);   // row being corrected, or null
  const [saving, setSaving] = useState(false);
  const [form, setForm]     = useState(emptyRecordForm());
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // ── Reverse ────────────────────────────────────────────────────────────────
  const [reverseFor, setReverseFor] = useState(null);
  const [reason, setReason]         = useState('');
  const [reversing, setReversing]   = useState(false);

  // ── Approve ────────────────────────────────────────────────────────────────
  const [approveFor, setApproveFor] = useState(null);
  const [approveForm, setApproveForm] = useState({ payment_method: '', reference: '', paid_at: '' });
  const [approving, setApproving]   = useState(false);

  // ── Contribution types ─────────────────────────────────────────────────────
  const [typesOpen, setTypesOpen]   = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [typeForm, setTypeForm]     = useState(EMPTY_TYPE_FORM);
  const setT = (k, v) => setTypeForm((p) => ({ ...p, [k]: v }));

  // ── Member statement ───────────────────────────────────────────────────────
  const [statementFor, setStatementFor] = useState(null);
  const [statementStats, setStatementStats] = useState(null);

  // ── Search / filter (requirement 6) ────────────────────────────────────────
  const [q, setQ]               = useState('');
  const [fStatus, setFStatus]   = useState('');
  const [fMethod, setFMethod]   = useState('');
  const [fMember, setFMember]   = useState('');
  const [fFrom, setFFrom]       = useState('');
  const [fTo, setFTo]           = useState('');
  const [fMin, setFMin]         = useState('');
  const [fMax, setFMax]         = useState('');

  const clearFilters = () => {
    setQ(''); setFStatus(''); setFMethod(''); setFMember('');
    setFFrom(''); setFTo(''); setFMin(''); setFMax('');
  };
  const filtersActive = !!(q || fStatus || fMethod || fMember || fFrom || fTo || fMin || fMax);

  const customTypes = (contributionTypes || []).filter((t) => t.is_active);
  const typeOptions = [...TYPES, ...customTypes.map((t) => t.name).filter((n) => !TYPES.includes(n))];

  /**
   * The ledger is read a page at a time, filtered in Postgres.
   *
   * Every one of these filters used to run in the browser over the newest
   * LIST_CAP rows, so "all contributions in March" meant "the March rows that
   * happened to be among the newest 500" — an answer that silently shrank as
   * the sacco grew. Pushing them to the server makes the filter mean what it
   * says, and lets the table hold one page instead of the whole book.
   *
   * The free-text box covers the ledger's own columns. Searching BY MEMBER is
   * the dedicated dropdown beside it, which is exact rather than a name match.
   */
  const ledger = usePagedQuery({
    table: 'sacco_contributions',
    columns: CONTRIBUTION_COLUMNS,
    searchColumns: LEDGER_SEARCH_COLUMNS,
    search: q,
    order: { column: 'created_at', ascending: false },
    pageSize: PAGE_SIZE,
    applyFilters: (query) => {
      let out = query;
      if (fStatus) out = out.eq('status', fStatus);
      if (fMethod) out = out.eq('payment_method', fMethod);
      if (fMember) out = out.eq('member_id', fMember);
      if (fMin)    out = out.gte('amount', Number(fMin));
      if (fMax)    out = out.lte('amount', Number(fMax));
      // effective_date is generated as paid → due → created, the same
      // precedence the tab applied by hand when it filtered in the browser.
      if (fFrom)   out = out.gte('effective_date', fFrom);
      if (fTo)     out = out.lte('effective_date', fTo);
      return out;
    },
    deps: [fStatus, fMethod, fMember, fFrom, fTo, fMin, fMax],
  });
  const filtered = ledger.rows;

  // ── Headline figures ───────────────────────────────────────────────────────
  // All from the whole-book aggregate. These used to reduce over the capped
  // array, so a sacco past LIST_CAP was shown understated money with nothing
  // on screen to say so.
  const totalPaid    = stats?.totalSavings ?? 0;
  const settledCount = stats?.settledContributions ?? 0;
  const thisMonth    = stats?.contributionsThisMonth ?? 0;
  const pendingCount = stats?.pendingContributions ?? 0;
  const pendingSum   = stats?.pendingContribAmount ?? 0;
  const totalPenalty = stats?.totalPenalties ?? 0;
  const totalEntries = stats?.totalContributions ?? 0;

  /**
   * "Showing <amount> settled across <n> entries" for the CURRENT filters.
   *
   * The count rides along on the page request as an exact count, but the money
   * cannot come from the rows on screen once the table is paged. This asks
   * Postgres for it with the same filters the table sent, so the two can never
   * describe different sets. Falls back silently to hiding the amount if the
   * function is not deployed yet.
   */
  const [filteredSum, setFilteredSum] = useState(null);
  const filterKey = `${q}|${fStatus}|${fMethod}|${fMember}|${fFrom}|${fTo}|${fMin}|${fMax}`;

  useEffect(() => {
    let cancelled = false;
    if (!filtersActive) { setFilteredSum(null); return undefined; }

    (async () => {
      try {
        const { data, error } = await supabase.rpc('sacco_contributions_filtered_summary', {
          p_search: sanitizeSearchTerm(q) || null,
          p_member: fMember || null,
          p_method: fMethod || null,
          p_status: fStatus || null,
          p_from:   fFrom || null,
          p_to:     fTo || null,
          p_min:    fMin ? Number(fMin) : null,
          p_max:    fMax ? Number(fMax) : null,
        });
        if (error) throw error;
        if (!cancelled) setFilteredSum(data?.[0]?.settled_amount ?? null);
      } catch (_) {
        // Pre-migration databases do not have the function. Better to show the
        // count alone than to show a number computed from one page.
        if (!cancelled) setFilteredSum(null);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, filtersActive]);

  /**
   * Exports every row the current filters match, not the page on screen — a
   * file named sacco_contributions.csv holding 25 of 1,240 rows looks complete
   * and is not.
   */
  const [exporting, setExporting] = useState(false);
  const buildLedgerQuery = () => {
    let out = supabase.from('sacco_contributions').select(CONTRIBUTION_COLUMNS);
    if (fStatus) out = out.eq('status', fStatus);
    if (fMethod) out = out.eq('payment_method', fMethod);
    if (fMember) out = out.eq('member_id', fMember);
    if (fMin)    out = out.gte('amount', Number(fMin));
    if (fMax)    out = out.lte('amount', Number(fMax));
    if (fFrom)   out = out.gte('effective_date', fFrom);
    if (fTo)     out = out.lte('effective_date', fTo);
    const term = sanitizeSearchTerm(q);
    if (term) out = out.or(LEDGER_SEARCH_COLUMNS.map((c) => `${c}.ilike.%${term}%`).join(','));
    return out.order('created_at', { ascending: false });
  };

  // ── Save (record new / correct pending) ────────────────────────────────────
  const openNew = () => { setEditing(null); setForm(emptyRecordForm()); setOpen(true); };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      member_id: c.member_id || '', amount: String(c.amount ?? ''),
      contribution_type: c.contribution_type || 'monthly',
      account: c.account || 'deposits', payment_method: c.payment_method || 'cash',
      due_date: c.due_date || '', paid_date: c.paid_date || '',
      status: c.status, penalty_amount: String(c.penalty_amount ?? ''),
      reference: c.reference || '', notes: c.notes || '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.member_id) { toast.error('Choose a member.'); return; }
    if (!(parseFloat(form.amount) > 0)) { toast.error('Enter an amount greater than 0.'); return; }
    setSaving(true);
    try {
      if (editing) {
        await editContribution(editing.id, {
          member_id: form.member_id,
          amount: parseFloat(form.amount),
          contribution_type: form.contribution_type,
          account: form.account,
          payment_method: form.payment_method,
          due_date: form.due_date || null,
          paid_date: form.paid_date || null,
          penalty_amount: parseFloat(form.penalty_amount) || 0,
          reference: form.reference || null,
          notes: form.notes || null,
        });
        ledger.refresh();
        toast.success(`${editing.txn_no} corrected.`);
      } else {
        await recordContribution(form);
        ledger.refresh();
        toast.success('Contribution recorded.');
      }
      setOpen(false);
      setEditing(null);
    } catch (e) {
      toast.error(e.message || 'Could not save the contribution.');
    } finally { setSaving(false); }
  };

  const doApprove = async () => {
    setApproving(true);
    try {
      await approveContribution(approveFor.id, {
        payment_method: approveForm.payment_method || null,
        reference: approveForm.reference || null,
        paid_at: approveForm.paid_at ? new Date(approveForm.paid_at).toISOString() : null,
      });
      ledger.refresh();
      toast.success(`${approveFor.txn_no} approved.`);
      setApproveFor(null);
    } catch (e) {
      toast.error(e.message || 'Could not approve the contribution.');
    } finally { setApproving(false); }
  };

  const doReverse = async () => {
    if (!reason.trim()) { toast.error('Give a reason for the reversal.'); return; }
    setReversing(true);
    try {
      await reverseContribution(reverseFor.id, reason.trim());
      ledger.refresh();
      toast.success(`${reverseFor.txn_no} reversed.`);
      setReverseFor(null); setReason('');
    } catch (e) {
      toast.error(e.message || 'Could not reverse the contribution.');
    } finally { setReversing(false); }
  };

  const saveType = async () => {
    const name = typeForm.name.trim();
    if (!name) { toast.error('Give the contribution a name.'); return; }
    const taken = typeOptions.some((t) => t.toLowerCase() === name.toLowerCase())
      || (contributionTypes || []).some((t) => t.name.toLowerCase() === name.toLowerCase());
    if (taken) { toast.error('A contribution type with that name already exists.'); return; }
    setSavingType(true);
    try {
      await createContributionType(typeForm);
      toast.success(`"${name}" added. It's now available when recording contributions.`);
      setTypeForm(EMPTY_TYPE_FORM);
    } catch (e) {
      toast.error(e.message || 'Could not add contribution type.');
    } finally { setSavingType(false); }
  };

  const toggleType = async (t) => {
    try {
      await updateContributionType(t.id, { is_active: !t.is_active });
      toast.success(t.is_active ? `"${t.name}" deactivated.` : `"${t.name}" reactivated.`);
    } catch (e) {
      toast.error(e.message || 'Could not update contribution type.');
    }
  };

  const openStatement = async (member) => {
    setStatementFor(member);
    setStatementStats(null);
    try {
      setStatementStats(await getMemberContributionStats(member.id));
    } catch (e) {
      toast.error(e.message || 'Could not load the member summary.');
    }
  };

  // Export what is on screen, not the whole table — the filters ARE the report.
  const exportLedger = async () => {
    if (ledger.total === 0) { toast.error('Nothing to export with these filters.'); return; }
    setExporting(true);
    let all;
    try {
      all = await fetchAllRows(buildLedgerQuery);
    } catch (e) {
      toast.error(e.message || 'Could not build the export.');
      setExporting(false);
      return;
    }
    setExporting(false);
    exportCSV(all.map((c) => ({
      transaction_no: c.txn_no,
      member: c.member?.full_name || '',
      member_no: c.member?.member_no || '',
      paid_at: c.paid_at || '',
      period_month: c.period_month || '',
      type: c.contribution_type,
      account: accountLabel(c.account),
      payment_method: c.payment_method || '',
      reference: c.reference || '',
      received_by: c.received_by_name || '',
      amount: c.amount,
      penalty: c.penalty_amount || 0,
      status: c.status,
      notes: c.notes || '',
    })), 'sacco_contributions');
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total collected" value={KES(totalPaid)} icon="PiggyBank" tone="success" hint={`${settledCount.toLocaleString('en-KE')} settled entries`} />
        <StatCard label="This month" value={KES(thisMonth)} icon="CalendarCheck" tone="primary" />
        <StatCard label="Awaiting approval" value={pendingCount} icon="Clock" tone={pendingCount ? 'warning' : 'muted'} hint={pendingCount ? KES(pendingSum) : undefined} />
        <StatCard label="Penalties" value={KES(totalPenalty)} icon="AlertTriangle" tone="muted" />
      </div>

      <div className="flex gap-1 flex-wrap">
        {SUBTABS.map((t) => (
          <button
            key={t.id} onClick={() => setSub(t.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all border ${
              sub === t.id ? 'border-primary/40 text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            style={sub === t.id ? { background: 'rgba(52,193,221,0.10)' } : {}}
          >
            <Icon name={t.icon} size={14} color="currentColor" />
            {t.label}
            {t.id === 'ledger' && pendingCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {sub === 'ledger' && (
        <Card
          title="Contributions ledger"
          subtitle={filtersActive
            ? `${ledger.total.toLocaleString('en-KE')} of ${totalEntries.toLocaleString('en-KE')} entries`
            : `${totalEntries.toLocaleString('en-KE')} entries`}
          actions={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <GhostButton icon="Download" onClick={exportLedger} disabled={exporting}>
                {exporting ? 'Preparing…' : 'Export'}
              </GhostButton>
              <GhostButton icon="ListPlus" onClick={() => setTypesOpen(true)}>Contribution types</GhostButton>
              <PrimaryButton icon="Plus" onClick={openNew}>Record contribution</PrimaryButton>
            </div>
          }
        >
          {/* Requirement 6: search by member, date, amount or payment method */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="col-span-2 lg:col-span-2">
              {/* Names moved to the member dropdown beside this, which matches
                  exactly instead of by substring. */}
              <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transaction no, reference, officer, notes…" />
            </div>
            <Select value={fMember} onChange={(e) => setFMember(e.target.value)}>
              <option value="">All members</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </Select>
            <Select value={fMethod} onChange={(e) => setFMethod(e.target.value)}>
              <option value="">Any method</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
            <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Any status</option>
              {['pending', 'completed', 'failed', 'reversed', 'overdue', 'waived'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <TextInput type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} title="From date" />
            <TextInput type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} title="To date" />
            <div className="flex gap-2">
              <NumberInput value={fMin} onChange={(e) => setFMin(e.target.value)} placeholder="Min" />
              <NumberInput value={fMax} onChange={(e) => setFMax(e.target.value)} placeholder="Max" />
            </div>
          </div>

          {filtersActive && (
            <div className="flex items-center gap-3 mb-4 text-xs">
              <span className="text-muted-foreground">
                {filteredSum == null
                  ? <>Matched <strong className="text-foreground">{ledger.total.toLocaleString('en-KE')}</strong> entries</>
                  : <>Showing <strong className="text-foreground">{KES(filteredSum)}</strong> settled across {ledger.total.toLocaleString('en-KE')} entries</>}
              </span>
              <button onClick={clearFilters} className="text-primary font-semibold hover:underline">Clear filters</button>
            </div>
          )}

          {ledger.error ? (
            // Failed and empty look identical otherwise, and a treasurer acts
            // very differently on "nothing recorded" than on "did not load".
            <EmptyState icon="AlertTriangle" title="Could not load the ledger" hint={ledger.error} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="PiggyBank"
              title={filtersActive ? 'No contributions match these filters' : 'No contributions recorded'}
              hint={filtersActive ? 'Widen the date range or clear the filters.' : "Record a member's savings contribution to build their statement."}
            />
          ) : (
            <>
            <Table columns={['Transaction no', 'Member', 'Date & time', 'Type', 'Account', 'Method', 'Reference', 'Received by', 'Amount', 'Status', '']}>
              {filtered.map((c) => (
                <tr key={c.id} className={`border-b border-border/60 ${c.status === 'overdue' ? 'bg-red-50/40' : c.status === 'reversed' ? 'opacity-60' : ''}`}>
                  <td className="py-2.5 pr-4 font-mono text-xs text-foreground whitespace-nowrap">{c.txn_no || '—'}</td>
                  <td className="py-2.5 pr-4">
                    <button onClick={() => c.member && openStatement(c.member)} className="font-medium text-foreground hover:text-primary hover:underline text-left">
                      {c.member?.full_name || '—'}
                    </button>
                    <span className="block text-xs text-muted-foreground">{c.member?.member_no}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">
                    {c.paid_at ? fmtDateTime(c.paid_at) : fmtDate(c.due_date)}
                  </td>
                  <td className="py-2.5 pr-4 capitalize text-muted-foreground">{c.contribution_type}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{accountLabel(c.account)}</td>
                  <td className="py-2.5 pr-4 uppercase text-xs text-muted-foreground">{c.payment_method || '—'}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{c.reference || '—'}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">
                    {c.received_by_name || (c.channel === 'mpesa_auto' ? 'M-Pesa' : '—')}
                  </td>
                  <td className={`py-2.5 pr-4 font-semibold ${c.status === 'reversed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {KES(c.amount)}
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge status={c.status} />
                    {c.channel === 'member_portal' && c.status === 'pending' && (
                      <span className="block text-[10px] text-muted-foreground mt-0.5">member declared</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                    {c.status === 'pending' && (
                      <button
                        onClick={() => {
                          setApproveFor(c);
                          setApproveForm({ payment_method: c.payment_method || 'cash', reference: c.reference || '', paid_at: '' });
                        }}
                        className="text-xs text-emerald-600 font-semibold hover:underline"
                      >
                        Approve
                      </button>
                    )}
                    {['pending', 'overdue', 'waived'].includes(c.status) && (
                      <button onClick={() => openEdit(c)} className="ml-3 text-xs text-primary font-semibold hover:underline">Edit</button>
                    )}
                    {c.status !== 'reversed' && (
                      <button onClick={() => { setReverseFor(c); setReason(''); }} className="ml-3 text-xs text-red-600 font-semibold hover:underline">Reverse</button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination
              page={ledger.page}
              pageCount={ledger.pageCount}
              from={ledger.from}
              to={ledger.to}
              total={ledger.total}
              onPageChange={ledger.setPage}
              loading={ledger.loading}
              noun={filtersActive ? 'matching entries' : 'entries'}
            />
            </>
          )}
        </Card>
      )}

      {sub === 'reports' && (
        <ReportsPanel
          members={members}
          getCollections={getCollections}
          getDefaulters={getDefaulters}
          exportCSV={exportCSV}
          onOpenStatement={openStatement}
        />
      )}

      {sub === 'audit' && (
        <Card
          title="Audit log"
          subtitle="Every create, edit, approval and reversal — who, when, and what changed"
          actions={<GhostButton icon="Download" onClick={() => exportCSV(contributionAudit, 'contribution_audit')}>Export</GhostButton>}
        >
          {(contributionAudit || []).length === 0 ? (
            <EmptyState icon="ShieldCheck" title="Nothing logged yet" hint="Recording, editing or reversing a contribution writes an entry here." />
          ) : (
            <Table columns={['When', 'Transaction no', 'Action', 'By', 'Changed', 'Reason']}>
              {contributionAudit.map((a) => (
                <tr key={a.id} className="border-b border-border/60 align-top">
                  <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDateTime(a.created_at)}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-foreground">{a.txn_no || '—'}</td>
                  <td className="py-2.5 pr-4"><Badge status={a.action === 'created' ? 'completed' : a.action === 'deleted' ? 'failed' : a.action} /></td>
                  <td className="py-2.5 pr-4 text-foreground">
                    {a.actor_name || 'Unknown'}
                    {a.actor_role && <span className="block text-xs text-muted-foreground capitalize">{String(a.actor_role).replace(/_/g, ' ')}</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-muted-foreground max-w-md">
                    {(a.changed_fields || []).length === 0 ? '—' : (
                      <div className="space-y-0.5">
                        {a.changed_fields.map((f) => (
                          <div key={f}>
                            <span className="font-medium text-foreground">{f.replace(/_/g, ' ')}</span>:{' '}
                            <span className="line-through">{String(a.old_values?.[f] ?? '—')}</span>
                            {' → '}
                            <span className="text-foreground">{String(a.new_values?.[f] ?? '—')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-muted-foreground max-w-xs">{a.reason || '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ── Record / correct ───────────────────────────────────────────────── */}
      <Modal
        open={open} onClose={() => { setOpen(false); setEditing(null); }} wide
        title={editing ? `Correct ${editing.txn_no}` : 'Record contribution'}
        footer={<>
          <GhostButton onClick={() => { setOpen(false); setEditing(null); }}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save correction' : 'Record'}
          </PrimaryButton>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Member *">
            <Select value={form.member_id} onChange={(e) => set('member_id', e.target.value)}>
              <option value="">Select member</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.member_no ? ` · ${m.member_no}` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Amount (KES) *"><NumberInput value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="1000" /></Field>
          <Field label="Credit to">
            <Select value={form.account} onChange={(e) => set('account', e.target.value)}>
              {CONTRIB_ACCOUNTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={form.contribution_type} onChange={(e) => set('contribution_type', e.target.value)}>
              {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Payment method">
            <Select value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
          {!editing && (
            <Field label="Status">
              <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
                {RECORD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Due date"><TextInput type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>
          <Field label="Paid date"><TextInput type="date" value={form.paid_date} onChange={(e) => set('paid_date', e.target.value)} /></Field>
          <Field label="Penalty (KES)"><NumberInput value={form.penalty_amount} onChange={(e) => set('penalty_amount', e.target.value)} placeholder="0" /></Field>
          <Field label="Reference"><TextInput value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="M-Pesa code / slip no." /></Field>
          <div className="sm:col-span-2">
            <Field label="Notes"><TextInput value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          {editing
            ? 'Only entries that have not settled can be corrected. A completed contribution must be reversed instead — that keeps the original receipt intact.'
            : 'A transaction number, the exact time, and you as the receiving officer are stamped automatically.'}
        </p>
      </Modal>

      {/* ── Approve ────────────────────────────────────────────────────────── */}
      <Modal
        open={!!approveFor} onClose={() => setApproveFor(null)}
        title={`Approve ${approveFor?.txn_no || ''}`}
        footer={<>
          <GhostButton onClick={() => setApproveFor(null)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={doApprove} disabled={approving}>{approving ? 'Approving…' : 'Confirm received'}</PrimaryButton>
        </>}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <Icon name="CheckCircle2" size={18} color="#059669" />
            <p className="text-sm text-foreground">
              Confirming that <strong>{KES(approveFor?.amount)}</strong> from{' '}
              <strong>{approveFor?.member?.full_name}</strong> has actually arrived. It counts towards
              their savings from this moment, and you are recorded as the receiving officer.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Payment method">
              <Select value={approveForm.payment_method} onChange={(e) => setApproveForm((p) => ({ ...p, payment_method: e.target.value }))}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Reference">
              <TextInput value={approveForm.reference} onChange={(e) => setApproveForm((p) => ({ ...p, reference: e.target.value }))} placeholder="Receipt / slip no." />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Received at (leave blank for now)">
                <TextInput type="datetime-local" value={approveForm.paid_at} onChange={(e) => setApproveForm((p) => ({ ...p, paid_at: e.target.value }))} />
              </Field>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Reverse ────────────────────────────────────────────────────────── */}
      <Modal
        open={!!reverseFor} onClose={() => setReverseFor(null)}
        title={`Reverse ${reverseFor?.txn_no || ''}`}
        footer={<>
          <GhostButton onClick={() => setReverseFor(null)}>Cancel</GhostButton>
          <PrimaryButton
            icon="Undo2" onClick={doReverse} disabled={reversing}
            className="!bg-none" style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
          >{reversing ? 'Reversing…' : 'Reverse contribution'}</PrimaryButton>
        </>}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <Icon name="AlertTriangle" size={18} color="#ca8a04" />
            <p className="text-sm text-foreground">
              <strong>{KES(reverseFor?.amount)}</strong> for <strong>{reverseFor?.member?.full_name}</strong> stops
              counting towards their savings. The entry is <strong>kept, not deleted</strong> — it stays on the
              statement marked reversed, with this reason attached.
            </p>
          </div>
          <Field label="Reason *">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cheque bounced / posted to the wrong member" />
          </Field>
        </div>
      </Modal>

      {/* ── Member statement ───────────────────────────────────────────────── */}
      <MemberStatementModal
        member={statementFor}
        stats={statementStats}
        onClose={() => { setStatementFor(null); setStatementStats(null); }}
        exportCSV={exportCSV}
      />

      {/* ── Contribution types ─────────────────────────────────────────────── */}
      <Modal
        open={typesOpen} onClose={() => setTypesOpen(false)} title="Contribution types" wide
        footer={<GhostButton onClick={() => setTypesOpen(false)}>Done</GhostButton>}
      >
        <p className="text-xs text-muted-foreground mb-4">
          Create extra contributions — a building fund, holiday savings, a land project — for your members
          to engage in. Active types appear both in the Record contribution form and in the member portal,
          where members can pay them directly.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name *"><TextInput value={typeForm.name} onChange={(e) => setT('name', e.target.value)} placeholder="e.g. Building fund" /></Field>
          <Field label="Suggested amount (KES)"><NumberInput value={typeForm.suggested_amount} onChange={(e) => setT('suggested_amount', e.target.value)} placeholder="500" /></Field>
          <Field label="Frequency"><Select value={typeForm.frequency} onChange={(e) => setT('frequency', e.target.value)}>{FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}</Select></Field>
          <Field label="Due date"><TextInput type="date" value={typeForm.due_date} onChange={(e) => setT('due_date', e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Description"><TextInput value={typeForm.description} onChange={(e) => setT('description', e.target.value)} placeholder="What is this contribution for?" /></Field>
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <PrimaryButton icon="Plus" onClick={saveType} disabled={savingType}>{savingType ? 'Adding…' : 'Add type'}</PrimaryButton>
        </div>

        <div className="mt-5 pt-4 border-t border-border">
          <p className="text-xs font-semibold text-foreground mb-2">Your custom types</p>
          {(contributionTypes || []).length === 0 ? (
            <p className="text-xs text-muted-foreground">None yet. Add one above to make it available for member contributions.</p>
          ) : (
            <Table columns={['Name', 'Frequency', 'Suggested', 'Due', 'Status', '']}>
              {contributionTypes.map((t) => (
                <tr key={t.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 font-medium text-foreground">
                    {t.name}
                    {t.description ? <span className="block text-xs text-muted-foreground font-normal">{t.description}</span> : null}
                  </td>
                  <td className="py-2.5 pr-4 capitalize text-muted-foreground">{t.frequency}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{t.suggested_amount > 0 ? KES(t.suggested_amount) : '—'}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(t.due_date)}</td>
                  <td className="py-2.5 pr-4"><Badge status={t.is_active ? 'active' : 'inactive'} /></td>
                  <td className="py-2.5"><GhostButton onClick={() => toggleType(t)}>{t.is_active ? 'Deactivate' : 'Activate'}</GhostButton></td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </Modal>
    </div>
  );
};

// ── Reports (requirement 7) ──────────────────────────────────────────────────
const BUCKETS = [
  { id: 'day',   label: 'Daily' },
  { id: 'month', label: 'Monthly' },
  { id: 'year',  label: 'Annual' },
];

const defaultRange = (bucket) => {
  const to = new Date();
  const from = new Date();
  if (bucket === 'day')        from.setDate(to.getDate() - 30);
  else if (bucket === 'month') from.setMonth(to.getMonth() - 11);
  else                         from.setFullYear(to.getFullYear() - 4);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
};

const ReportsPanel = ({ members, getCollections, getDefaulters, exportCSV, onOpenStatement }) => {
  const toast = useToast();
  const [bucket, setBucket] = useState('day');
  const [range, setRange]   = useState(() => defaultRange('day'));
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(false);

  const [defaulters, setDefaulters] = useState([]);
  const [loadingDef, setLoadingDef] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getCollections({ from: range.from, to: range.to, bucket }));
    } catch (e) {
      toast.error(e.message || 'Could not load the collections report.');
    } finally { setLoading(false); }
  }, [getCollections, range.from, range.to, bucket, toast]);

  const loadDefaulters = useCallback(async () => {
    setLoadingDef(true);
    try {
      setDefaulters(await getDefaulters());
    } catch (e) {
      toast.error(e.message || 'Could not load the defaulters report.');
    } finally { setLoadingDef(false); }
  }, [getDefaulters, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDefaulters(); }, [loadDefaulters]);

  const onBucket = (b) => { setBucket(b); setRange(defaultRange(b)); };

  const totals = rows.reduce((acc, r) => ({
    total: acc.total + Number(r.total || 0),
    entries: acc.entries + Number(r.entries || 0),
    cash: acc.cash + Number(r.cash || 0),
    bank: acc.bank + Number(r.bank || 0),
    mpesa: acc.mpesa + Number(r.mpesa || 0),
    card: acc.card + Number(r.card || 0),
  }), { total: 0, entries: 0, cash: 0, bank: 0, mpesa: 0, card: 0 });

  const bucketLabel = (d) => (bucket === 'year'
    ? String(d).slice(0, 4)
    : bucket === 'month' ? monthLabel(d) : fmtDate(d));

  /**
   * What each purse actually collected, over the whole book.
   *
   * This was built in the browser from the capped contributions array, so both
   * the totals and the distinct-member counts were only ever the newest rows'
   * worth — and a Set of member ids over a truncated array undercounts in a
   * way nobody on screen can detect.
   */
  const [byType, setByType] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('sacco_contributions_by_type');
        if (error) throw error;
        if (cancelled) return;
        setByType((data || []).map((r) => ({
          type:    r.contribution_type,
          count:   Number(r.entry_count || 0),
          total:   Number(r.total || 0),
          members: Number(r.member_count || 0),
        })));
      } catch (_) {
        // Pre-migration databases do not have the function. An empty breakdown
        // reads as "nothing settled yet", which is better than a wrong split.
        if (!cancelled) setByType([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Settled-to-date per member, keyed by member id. Same reason as byType:
   * filtering a capped array per row understated a member's savings right
   * beside their own name.
   */
  const [settledByMember, setSettledByMember] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('sacco_contributions_by_member');
        if (error) throw error;
        if (cancelled) return;
        setSettledByMember(Object.fromEntries(
          (data || []).map((r) => [r.member_id, Number(r.settled_total || 0)])
        ));
      } catch (_) {
        // Pre-migration: show a dash rather than a number that may be short.
        if (!cancelled) setSettledByMember(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <Card
        title="Collections"
        subtitle="Daily, monthly and annual money in — split by the channels you reconcile against"
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {BUCKETS.map((b) => (
                <button
                  key={b.id} onClick={() => onBucket(b.id)}
                  className={`px-3 py-1.5 text-xs font-medium transition-all ${
                    bucket === b.id ? 'text-white' : 'text-muted-foreground hover:bg-muted'
                  }`}
                  style={bucket === b.id ? { background: 'linear-gradient(135deg, #34c1dd, #1da8c5)' } : {}}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <GhostButton icon="Download" onClick={() => rows.length ? exportCSV(rows, `collections_${bucket}`) : toast.error('Nothing to export.')}>Export</GhostButton>
          </div>
        }
      >
        <div className="flex items-end gap-3 flex-wrap mb-4">
          <Field label="From"><TextInput type="date" value={range.from} onChange={(e) => setRange((p) => ({ ...p, from: e.target.value }))} /></Field>
          <Field label="To"><TextInput type="date" value={range.to} onChange={(e) => setRange((p) => ({ ...p, to: e.target.value }))} /></Field>
          <GhostButton icon="RefreshCw" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Run'}</GhostButton>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon="BarChart3" title={loading ? 'Loading…' : 'No collections in this range'} hint="Adjust the dates and run again." />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
              {[
                ['Total', totals.total], ['Cash', totals.cash], ['Bank', totals.bank],
                ['M-Pesa', totals.mpesa], ['Card', totals.card],
              ].map(([label, v]) => (
                <div key={label} className="p-3 rounded-xl border border-border">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-bold text-foreground mt-0.5">{KES(v)}</p>
                </div>
              ))}
            </div>

            <ContributionChart
              data={[...rows].reverse().map((r) => ({ key: r.bucket, value: Number(r.total || 0), label: bucketLabel(r.bucket) }))}
              height={120}
            />

            <div className="mt-5">
              <Table columns={['Period', 'Entries', 'Members', 'Cash', 'Bank', 'M-Pesa', 'Card', 'Deposits', 'Share capital', 'Total']}>
                {rows.map((r) => (
                  <tr key={r.bucket} className="border-b border-border/60">
                    <td className="py-2.5 pr-4 font-medium text-foreground whitespace-nowrap">{bucketLabel(r.bucket)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{r.entries}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{r.members}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{KES(r.cash)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{KES(r.bank)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{KES(r.mpesa)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{KES(r.card)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{KES(r.deposits)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{KES(r.share_capital)}</td>
                    <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(r.total)}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card
          title="Contribution summary"
          subtitle="Settled money by contribution type"
          actions={<GhostButton icon="Download" onClick={() => byType.length ? exportCSV(byType, 'contribution_summary') : toast.error('Nothing to export.')}>Export</GhostButton>}
        >
          {byType.length === 0 ? (
            <EmptyState icon="ListChecks" title="Nothing settled yet" />
          ) : (
            <Table columns={['Type', 'Members', 'Entries', 'Total']}>
              {byType.map((r) => (
                <tr key={r.type} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 capitalize font-medium text-foreground">{r.type}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{r.members}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{r.count}</td>
                  <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(r.total)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card
          title="Member statements"
          subtitle="Open any member's contribution statement"
        >
          {members.length === 0 ? (
            <EmptyState icon="Users" title="No members yet" />
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <Table columns={['Member', 'Monthly', 'Settled to date', '']}>
                {members.map((m) => {
                  const settledToDate = settledByMember?.[m.id];
                  return (
                    <tr key={m.id} className="border-b border-border/60">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-foreground">{m.full_name}</p>
                        <p className="text-xs text-muted-foreground">{m.member_no}</p>
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {parseFloat(m.monthly_contribution) > 0 ? KES(m.monthly_contribution) : '—'}
                      </td>
                      <td className="py-2.5 pr-4 font-medium text-foreground">
                        {settledByMember == null ? '—' : KES(settledToDate || 0)}
                      </td>
                      <td className="py-2.5 pr-0 text-right">
                        <button onClick={() => onOpenStatement(m)} className="text-xs text-primary font-semibold hover:underline">Statement</button>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Defaulters"
        subtitle="Active members behind on their monthly contribution"
        actions={
          <div className="flex items-center gap-2">
            <GhostButton icon="RefreshCw" onClick={loadDefaulters} disabled={loadingDef}>{loadingDef ? 'Loading…' : 'Refresh'}</GhostButton>
            <GhostButton icon="Download" onClick={() => defaulters.length ? exportCSV(defaulters, 'defaulters') : toast.error('Nothing to export.')}>Export</GhostButton>
          </div>
        }
      >
        {defaulters.length === 0 ? (
          <EmptyState
            icon="CheckCircle2"
            title={loadingDef ? 'Loading…' : 'Nobody is behind'}
            hint="Members only appear here once a monthly contribution amount is set on their record."
          />
        ) : (
          <Table columns={['Member', 'Phone', 'Monthly', 'Expected', 'Contributed', 'Outstanding', 'Missed months', 'Last payment']}>
            {defaulters.map((d) => (
              <tr key={d.member_id} className="border-b border-border/60">
                <td className="py-2.5 pr-4">
                  <p className="font-medium text-foreground">{d.full_name}</p>
                  <p className="text-xs text-muted-foreground">{d.member_no}</p>
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{d.phone || '—'}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(d.monthly_contribution)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(d.expected)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(d.contributed)}</td>
                <td className="py-2.5 pr-4 font-semibold text-red-600">{KES(d.outstanding)}</td>
                <td className="py-2.5 pr-4">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                    {d.missed_months}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{d.last_paid_at ? fmtDate(d.last_paid_at) : 'Never'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
};

// ── Member statement ─────────────────────────────────────────────────────────
/**
 * A member's full contribution history.
 *
 * This used to be handed `contributions.filter(c => c.member_id === ...)` over
 * the capped context array, which meant a long-standing member's statement
 * silently omitted their older entries. A statement is the document a member
 * checks their own savings against — one that is quietly short is the single
 * worst output this tab can produce, so it reads the member's own rows
 * directly and completely.
 */
const MemberStatementModal = ({ member, stats, onClose, exportCSV }) => {
  const [contributions, setContributions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const memberId = member?.id || null;

  useEffect(() => {
    if (!memberId) { setContributions([]); return undefined; }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const rows = await fetchAllRows(() => supabase
          .from('sacco_contributions')
          .select(CONTRIBUTION_COLUMNS)
          .eq('member_id', memberId)
          .order('created_at', { ascending: false }));
        if (!cancelled) setContributions(rows);
      } catch (e) {
        if (!cancelled) { setContributions([]); setError(e?.message || 'Could not load this statement.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [memberId]);

  if (!member) return null;

  const settled = contributions.filter(isSettled);
  const chart = (() => {
    const buckets = new Map();
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
    }
    settled.forEach((c) => {
      const key = monthKey(c.period_month || c.paid_date);
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + (parseFloat(c.amount) || 0));
    });
    return [...buckets.entries()].map(([key, value]) => ({ key, value, label: monthLabel(key) }));
  })();

  return (
    <Modal
      open wide onClose={onClose}
      title={`Statement — ${member.full_name}`}
      footer={<>
        <GhostButton icon="Download" onClick={() => exportCSV(contributions, `statement_${member.member_no || member.id}`)}>Export</GhostButton>
        <PrimaryButton icon="Check" onClick={onClose}>Close</PrimaryButton>
      </>}
    >
      {/* A statement that is still loading must not read as a complete one
          that happens to be empty. */}
      {loading && (
        <p className="text-sm text-muted-foreground py-2 mb-3">Loading this member's full history…</p>
      )}
      {error && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/10">
          <Icon name="AlertTriangle" size={15} color="#dc2626" className="mt-0.5 shrink-0" />
          <p className="text-xs text-foreground">
            This statement could not be loaded in full, so the entries below may be incomplete. {error}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          ['Total contributions', KES(stats?.total_contributions ?? sumAmount(settled))],
          ['Deposits', KES(stats?.total_deposits ?? 0)],
          ['Share capital', KES(stats?.total_share_capital ?? 0)],
          ['Outstanding', KES(stats?.outstanding ?? 0)],
        ].map(([label, v]) => (
          <div key={label} className="p-3 rounded-xl border border-border">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-sm font-bold text-foreground mt-0.5">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 text-sm">
        <div className="p-3 rounded-xl border border-border">
          <p className="text-xs text-muted-foreground">Deposit account</p>
          <p className="font-mono text-foreground mt-0.5">{member.deposit_account_no || '—'}</p>
        </div>
        <div className="p-3 rounded-xl border border-border">
          <p className="text-xs text-muted-foreground">Share capital account</p>
          <p className="font-mono text-foreground mt-0.5">{member.share_capital_account_no || '—'}</p>
        </div>
      </div>

      {stats && (
        <div className="mb-5">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">
              Registered {fmtDate(member.joined_at)} · {stats.missed_months} missed {stats.missed_months === 1 ? 'month' : 'months'} · next due {fmtDate(stats.next_due_date)}
            </span>
            <span className="font-semibold text-foreground">
              {KES(stats.total_deposits)} / {KES(stats.expected_to_date)}
            </span>
          </div>
          <ProgressBar
            value={Number(stats.total_deposits || 0)} target={Number(stats.expected_to_date || 0)}
            tone={Number(stats.outstanding || 0) > 0 ? 'warning' : 'success'}
          />
        </div>
      )}

      <div className="mb-5">
        <p className="text-xs font-semibold text-foreground mb-2">Last 12 months</p>
        <ContributionChart data={chart} target={Number(stats?.monthly_contribution || member.monthly_contribution || 0)} height={110} />
      </div>

      {contributions.length === 0 ? (
        <EmptyState icon="PiggyBank" title="No contributions on record" />
      ) : (
        <Table columns={['Transaction no', 'Date', 'Type', 'Account', 'Method', 'Reference', 'Amount', 'Status']}>
          {contributions.map((c) => (
            <tr key={c.id} className="border-b border-border/60">
              <td className="py-2.5 pr-4 font-mono text-xs text-foreground">{c.txn_no || '—'}</td>
              <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{c.paid_at ? fmtDateTime(c.paid_at) : fmtDate(c.due_date)}</td>
              <td className="py-2.5 pr-4 capitalize text-muted-foreground">{c.contribution_type}</td>
              <td className="py-2.5 pr-4 text-muted-foreground">{accountLabel(c.account)}</td>
              <td className="py-2.5 pr-4 uppercase text-xs text-muted-foreground">{c.payment_method || '—'}</td>
              <td className="py-2.5 pr-4 text-muted-foreground">{c.reference || '—'}</td>
              <td className={`py-2.5 pr-4 font-medium ${c.status === 'reversed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{KES(c.amount)}</td>
              <td className="py-2.5 pr-4"><Badge status={c.status} /></td>
            </tr>
          ))}
        </Table>
      )}
    </Modal>
  );
};

export default ContributionsTab;
