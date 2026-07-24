/**
 * Chama tab — §9.4 and §9.5.
 *
 *   Merry-go-round : the Statement of Contributions and Payouts. Columns are
 *                    members, rows are cycles, and every cycle carries the
 *                    running reconciliation that total contributions collected
 *                    equal the payout made that cycle.
 *   Welfare        : the Claims Register. Claims post against the Welfare Fund
 *                    liability (2310), not through a P&L expense line, because
 *                    the fund is a ring-fenced pool rather than an operating cost.
 */
import React, { useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { useToast } from '../../../../components/Toast';
import {
  Card, StatCard, Badge, PrimaryButton, GhostButton, Modal, Field,
  TextInput, NumberInput, Select, EmptyState, Table, fmtDate,
} from '../../../sacco-dashboard/components/_shared';
import {
  buildMgrStatement, buildWelfarePosition, indexTrialBalance, fmtPlain, round2,
} from '../../../../utils/saccoAccounting';

// ── Merry-go-round ──────────────────────────────────────────────────────────
const CycleModal = ({ open, onClose, fin, members, onDone }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    label: '', cycle_date: new Date().toISOString().slice(0, 10),
    contribution_per_member: '', beneficiary_member_id: '', notes: '',
  });

  const submit = async () => {
    if (!(round2(f.contribution_per_member) > 0)) { toast.error('Set the contribution each member owes this cycle.'); return; }
    setBusy(true);
    try {
      await fin.addMgrCycle(f);
      toast.success('Cycle created.');
      setF({ ...f, label: '', contribution_per_member: '', beneficiary_member_id: '' });
      onClose(); onDone?.();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New merry-go-round cycle"
      footer={<>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton icon="Plus" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create cycle'}</PrimaryButton>
      </>}>
      <div className="space-y-3">
        <Field label="Label (optional)"><TextInput value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. March round" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cycle date"><TextInput type="date" value={f.cycle_date} onChange={(e) => setF({ ...f, cycle_date: e.target.value })} /></Field>
          <Field label="Contribution per member"><NumberInput step="0.01" value={f.contribution_per_member} onChange={(e) => setF({ ...f, contribution_per_member: e.target.value })} /></Field>
        </div>
        <Field label="Beneficiary (whose turn it is)">
          <Select value={f.beneficiary_member_id} onChange={(e) => setF({ ...f, beneficiary_member_id: e.target.value })}>
            <option value="">Decide later</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
};

const CollectModal = ({ cycle, onClose, fin, members, statement, onDone }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  if (!cycle) return null;

  const row = statement.rows.find((r) => r.cycleId === cycle.id);

  const collect = async (member) => {
    setBusy(member.id);
    try {
      await fin.recordMgrContribution({
        cycle, memberId: member.id, amount: cycle.contribution_per_member,
      });
      toast.success(`${member.full_name}'s contribution recorded and posted.`);
      onDone?.();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  return (
    <Modal open={!!cycle} onClose={onClose} title={`Collect — ${cycle.label || `Cycle ${cycle.cycle_no}`}`} wide
      footer={<GhostButton onClick={onClose}>Done</GhostButton>}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {[['Expected', row?.expected], ['Collected', row?.collected], ['Outstanding', row?.outstanding]].map(([l, v]) => (
            <div key={l} className="p-3 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">{l}</p>
              <p className="text-sm font-bold text-foreground font-mono">{fmtPlain(v || 0)}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Each collection posts Dr Bank / Cr 2320 Members' Contribution Payable — the money is owed to this
          cycle's beneficiary, so it is a liability until it is paid out.
        </p>
        <div className="border border-border rounded-lg max-h-80 overflow-y-auto">
          {members.map((m) => {
            const cell = row?.cells?.[m.id];
            return (
              <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border last:border-0">
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{m.full_name}</p>
                  <p className="text-xs text-muted-foreground">{m.member_no || '—'}</p>
                </div>
                {cell?.paid ? (
                  <span className="text-xs font-semibold text-emerald-600 whitespace-nowrap">
                    ✓ {fmtPlain(cell.amount)}
                  </span>
                ) : (
                  <GhostButton icon="Plus" disabled={busy === m.id} onClick={() => collect(m)}>
                    {busy === m.id ? 'Posting…' : `Collect ${fmtPlain(cycle.contribution_per_member)}`}
                  </GhostButton>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

const MerryGoRound = ({ fin, members, onLedgerChange }) => {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [collecting, setCollecting] = useState(null);

  const statement = useMemo(() => buildMgrStatement({
    cycles: fin.mgrCycles, mgrContributions: fin.mgrContributions, members,
  }), [fin.mgrCycles, fin.mgrContributions, members]);

  const pay = async (row) => {
    const cycle = fin.mgrCycles.find((c) => c.id === row.cycleId);
    try {
      const amount = await fin.payMgrCycle(cycle);
      toast.success(`Paid ${fmtPlain(amount)} to ${row.beneficiaryName}.`, 'Payout posted');
      onLedgerChange?.();
    } catch (e) { toast.error(e.message, 'Could not pay out'); }
  };

  const allReconcile = statement.rows.filter((r) => r.status === 'paid').every((r) => r.reconciles);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Cycles"            value={statement.rows.length} icon="RefreshCw" />
        <StatCard label="Total contributed" value={fmtPlain(statement.totalContributed)} icon="PiggyBank" tone="success" />
        <StatCard label="Total paid out"    value={fmtPlain(statement.totalPaidOut)} icon="HandCoins" tone="warning" />
        <StatCard label="Held for beneficiaries" value={fmtPlain(statement.totalContributed - statement.totalPaidOut)} icon="Wallet" tone="muted" hint="carried on 2320" />
      </div>

      <Card
        title="Statement of Contributions and Payouts"
        subtitle="§9.4 — columns are members, rows are cycles. A merry-go-round produces this instead of an Income Statement."
        actions={<PrimaryButton icon="Plus" onClick={() => setModal(true)}>New cycle</PrimaryButton>}
      >
        {statement.rows.length === 0 ? (
          <EmptyState icon="RefreshCw" title="No cycles yet"
            hint="Create a cycle, collect each member's contribution, then pay the beneficiary whose turn it is." />
        ) : (
          <>
            {!allReconcile && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50/50 mb-4">
                <Icon name="AlertTriangle" size={16} color="#ca8a04" />
                <p className="text-xs text-amber-800">
                  One or more paid cycles do not reconcile — what was collected does not equal what was paid out.
                  Check the variance column.
                </p>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3 font-medium sticky left-0 bg-card">Cycle</th>
                    <th className="py-2 pr-3 font-medium">Beneficiary</th>
                    {statement.members.map((m) => (
                      <th key={m.id} className="py-2 px-2 font-medium text-right whitespace-nowrap">{m.full_name.split(' ')[0]}</th>
                    ))}
                    <th className="py-2 px-2 font-medium text-right">Collected</th>
                    <th className="py-2 px-2 font-medium text-right">Payout</th>
                    <th className="py-2 px-2 font-medium text-right">Variance</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((r) => (
                    <tr key={r.cycleId} className="border-b border-border">
                      <td className="py-2 pr-3 sticky left-0 bg-card">
                        <span className="text-foreground font-medium">{r.label}</span>
                        <span className="block text-xs text-muted-foreground">{fmtDate(r.date)}</span>
                      </td>
                      <td className="py-2 pr-3 text-foreground">{r.beneficiaryName}</td>
                      {statement.members.map((m) => {
                        const cell = r.cells[m.id];
                        const isBeneficiary = r.beneficiaryId === m.id;
                        return (
                          <td key={m.id} className={`py-2 px-2 text-right font-mono text-xs ${isBeneficiary ? 'bg-emerald-50' : ''}`}>
                            {cell?.paid ? fmtPlain(cell.amount) : <span className="text-muted-foreground">—</span>}
                          </td>
                        );
                      })}
                      <td className="py-2 px-2 text-right font-mono text-xs font-semibold">{fmtPlain(r.collected)}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs font-semibold">{fmtPlain(r.payout)}</td>
                      <td className={`py-2 px-2 text-right font-mono text-xs ${r.status === 'paid' && !r.reconciles ? 'text-red-600 font-bold' : 'text-muted-foreground'}`}>
                        {r.status === 'paid' ? fmtPlain(r.variance) : '—'}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <div className="flex gap-1 justify-end">
                          {r.status !== 'paid' && (
                            <>
                              <GhostButton icon="Plus" onClick={() => setCollecting(fin.mgrCycles.find((c) => c.id === r.cycleId))}>Collect</GhostButton>
                              <GhostButton icon="HandCoins" onClick={() => pay(r)}>Pay out</GhostButton>
                            </>
                          )}
                          {r.status === 'paid' && <Badge status="paid" />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {statement.perMember.length > 0 && (
        <Card title="Per-member position" subtitle="What each member has put in against what they have received.">
          <Table columns={['Member', 'No.', 'Contributed', 'Received', 'Net']}>
            {statement.perMember.map((p) => (
              <tr key={p.memberId} className="border-b border-border last:border-0">
                <td className="py-2 pr-4 text-foreground">{p.name}</td>
                <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{p.memberNo || '—'}</td>
                <td className="py-2 pr-4 font-mono text-xs">{fmtPlain(p.contributed)}</td>
                <td className="py-2 pr-4 font-mono text-xs">{fmtPlain(p.received)}</td>
                <td className={`py-2 font-mono text-xs font-semibold ${p.net < 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{fmtPlain(p.net)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <CycleModal open={modal} onClose={() => setModal(false)} fin={fin} members={members} onDone={onLedgerChange} />
      <CollectModal cycle={collecting} onClose={() => setCollecting(null)} fin={fin}
        members={statement.members} statement={statement} onDone={onLedgerChange} />
    </div>
  );
};

// ── Welfare claims register ─────────────────────────────────────────────────
const ClaimModal = ({ open, onClose, fin, members, onDone }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    member_id: '', claim_date: new Date().toISOString().slice(0, 10),
    category: 'bereavement', reason: '', amount_requested: '',
  });

  const submit = async () => {
    if (!f.member_id) { toast.error('Choose the member claiming.'); return; }
    if (!(round2(f.amount_requested) > 0)) { toast.error('Enter the amount claimed.'); return; }
    setBusy(true);
    try {
      await fin.addWelfareClaim(f);
      toast.success('Claim logged in the register.');
      setF({ ...f, member_id: '', reason: '', amount_requested: '' });
      onClose(); onDone?.();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log a welfare claim"
      footer={<>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton icon="Plus" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Log claim'}</PrimaryButton>
      </>}>
      <div className="space-y-3">
        <Field label="Member">
          <Select value={f.member_id} onChange={(e) => setF({ ...f, member_id: e.target.value })}>
            <option value="">Choose a member…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Claim date"><TextInput type="date" value={f.claim_date} onChange={(e) => setF({ ...f, claim_date: e.target.value })} /></Field>
          <Field label="Category">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              <option value="bereavement">Bereavement</option>
              <option value="medical">Medical</option>
              <option value="education">Education</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>
        <Field label="Amount claimed"><NumberInput step="0.01" value={f.amount_requested} onChange={(e) => setF({ ...f, amount_requested: e.target.value })} /></Field>
        <Field label="Reason"><TextInput value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
};

const WelfareRegister = ({ fin, members, trialBalanceRows, onLedgerChange }) => {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const cur = fin.config?.base_currency || 'KES';

  const tb = useMemo(() => indexTrialBalance(trialBalanceRows || []), [trialBalanceRows]);
  const position = useMemo(() => buildWelfarePosition({ claims: fin.welfareClaims, tbMap: tb }), [fin.welfareClaims, tb]);

  const decide = async (claim, approve) => {
    const amount = approve
      ? Number(window.prompt(`Approve how much of ${cur} ${fmtPlain(claim.amount_requested)}?`, claim.amount_requested))
      : 0;
    if (approve && !(amount > 0)) return;
    try {
      await fin.decideWelfareClaim(claim, { approve, amount });
      toast.success(approve ? `Approved ${cur} ${fmtPlain(amount)}.` : 'Claim rejected.');
    } catch (e) { toast.error(e.message); }
  };

  const pay = async (claim) => {
    try {
      await fin.payWelfareClaim(claim);
      toast.success('Claim paid and posted against the welfare fund.', 'Paid');
      onLedgerChange?.();
    } catch (e) { toast.error(e.message, 'Could not pay the claim'); }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Welfare fund balance" value={fmtPlain(position.fundBalance)} icon="HeartHandshake" hint="accounts 2310 + 3320" />
        <StatCard label="Pending claims"  value={fmtPlain(position.pending)} icon="Clock" tone="warning" hint={`${position.counts.pending} awaiting decision`} />
        <StatCard label="Approved, unpaid" value={fmtPlain(position.approvedUnpaid)} icon="CheckCircle2" tone="primary" hint={`${position.counts.approved} to pay`} />
        <StatCard label="Available"       value={fmtPlain(position.available)} icon="Wallet" tone="success" hint="fund less approved claims" />
      </div>

      <Card
        title="Claims register"
        subtitle="§9.5 — claims post against the Welfare Fund liability (2310), not through a P&L expense line, because the fund is a ring-fenced pool."
        actions={<PrimaryButton icon="Plus" onClick={() => setModal(true)}>Log a claim</PrimaryButton>}
      >
        {fin.welfareClaims.length === 0 ? (
          <EmptyState icon="HeartHandshake" title="No claims logged"
            hint="Log a bereavement, medical or education claim to start the register." />
        ) : (
          <Table columns={['Claim', 'Member', 'Date', 'Category', 'Requested', 'Approved', 'Status', '']}>
            {fin.welfareClaims.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="py-2 pr-4 font-mono text-xs text-foreground">{c.claim_no}</td>
                <td className="py-2 pr-4 text-foreground">{c.member?.full_name || '—'}</td>
                <td className="py-2 pr-4 text-xs">{fmtDate(c.claim_date)}</td>
                <td className="py-2 pr-4 text-xs capitalize">{c.category}</td>
                <td className="py-2 pr-4 font-mono text-xs">{fmtPlain(c.amount_requested)}</td>
                <td className="py-2 pr-4 font-mono text-xs font-semibold">{fmtPlain(c.amount_approved)}</td>
                <td className="py-2 pr-4"><Badge status={c.status} /></td>
                <td className="py-2">
                  <div className="flex gap-1 justify-end">
                    {c.status === 'pending' && (
                      <>
                        <GhostButton icon="Check" onClick={() => decide(c, true)}>Approve</GhostButton>
                        <GhostButton icon="X" onClick={() => decide(c, false)}>Reject</GhostButton>
                      </>
                    )}
                    {c.status === 'approved' && <GhostButton icon="HandCoins" onClick={() => pay(c)}>Pay</GhostButton>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <ClaimModal open={modal} onClose={() => setModal(false)} fin={fin} members={members} onDone={onLedgerChange} />
    </div>
  );
};

// ── Tab shell ───────────────────────────────────────────────────────────────
const ChamaTab = ({ fin, ops, trialBalanceRows, onLedgerChange }) => {
  const { config } = fin;
  const showMgr     = !!config?.mgr_enabled;
  const showWelfare = !!config?.welfare_fund_enabled;

  const [view, setView] = useState(showMgr ? 'mgr' : 'welfare');
  const activeMembers = useMemo(() => ops.members.filter((m) => m.status === 'active'), [ops.members]);

  if (!showMgr && !showWelfare) {
    return (
      <Card title="Chama modules">
        <EmptyState icon="Users" title="No chama modules are switched on"
          hint="Turn on the merry-go-round cycles or the welfare fund on the Setup tab to use these registers." />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {showMgr && showWelfare && (
        <div className="flex gap-2">
          {[
            { id: 'mgr', label: 'Merry-go-round', icon: 'RefreshCw' },
            { id: 'welfare', label: 'Welfare claims', icon: 'HeartHandshake' },
          ].map((v) => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                view === v.id ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
              <Icon name={v.icon} size={14} color="currentColor" />{v.label}
            </button>
          ))}
        </div>
      )}

      {showMgr && (!showWelfare || view === 'mgr') && (
        <MerryGoRound fin={fin} members={activeMembers} onLedgerChange={onLedgerChange} />
      )}
      {showWelfare && (!showMgr || view === 'welfare') && (
        <WelfareRegister fin={fin} members={activeMembers} trialBalanceRows={trialBalanceRows} onLedgerChange={onLedgerChange} />
      )}
    </div>
  );
};

export default ChamaTab;
