/**
 * ElectionsTab (sacco admin) — the "polling station" control room.
 *
 * Runs candidate elections for office bearers end-to-end:
 * draft → nominations → vetting → voting (frozen register, secret final
 * ballots) → deterministic results with tie detection → published snapshot.
 * Every transition is a DB RPC; this tab can only ask, never tamper
 * (see 20260715120000_sacco_elections.sql).
 */
import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useToast } from '../../../components/Toast';
import {
  Card, Badge, PrimaryButton, GhostButton, Modal, Field, TextInput,
  NumberInput, Select, EmptyState, fmtDate,
} from './_shared';

const AUDIT_META = {
  created:             { icon: 'FilePlus',    label: 'Election created' },
  nominations_opened:  { icon: 'Megaphone',   label: 'Nominations opened' },
  candidate_nominated: { icon: 'UserPlus',    label: 'Candidate nominated' },
  candidate_added:     { icon: 'UserCheck',   label: 'Candidate added by admin' },
  candidate_approved:  { icon: 'BadgeCheck',  label: 'Candidate approved' },
  candidate_rejected:  { icon: 'UserX',       label: 'Candidate rejected' },
  candidate_withdrawn: { icon: 'UserMinus',   label: 'Candidate withdrew' },
  nominations_closed:  { icon: 'Lock',        label: 'Nominations closed' },
  voting_opened:       { icon: 'Vote',        label: 'Voting opened — register frozen' },
  voting_closed:       { icon: 'TimerOff',    label: 'Voting closed' },
  results_published:   { icon: 'Trophy',      label: 'Results published' },
  cancelled:           { icon: 'Ban',         label: 'Election cancelled' },
};

// Shared with the member portal tab: turnout bar with a quorum marker.
export const TurnoutBar = ({ registered, voted, quorum = 0 }) => {
  const pct = registered > 0 ? Math.round((voted * 1000) / registered) / 10 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>
          Turnout: <strong className="text-foreground">{voted}</strong> of {registered} registered ({pct}%)
        </span>
        {quorum > 0 && <span>Quorum {quorum}%</span>}
      </div>
      <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${Math.min(100, pct)}%`, background: 'linear-gradient(135deg, #34c1dd, #1da8c5)' }}
        />
        {quorum > 0 && (
          <div className="absolute inset-y-0 w-0.5 bg-amber-500" style={{ left: `${Math.min(100, quorum)}%` }} />
        )}
      </div>
    </div>
  );
};

// Shared with the member portal tab: renders the frozen results snapshot
// (or a live tally converted to the same shape).
export const ResultsView = ({ results }) => {
  if (!results) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-border text-center">
          <p className="text-xs text-muted-foreground">Registered</p>
          <p className="text-lg font-bold text-foreground">{results.registered}</p>
        </div>
        <div className="p-3 rounded-xl border border-border text-center">
          <p className="text-xs text-muted-foreground">Voted</p>
          <p className="text-lg font-bold text-foreground">{results.voted}</p>
        </div>
        <div className="p-3 rounded-xl border border-border text-center">
          <p className="text-xs text-muted-foreground">Turnout</p>
          <p className="text-lg font-bold text-foreground">{results.turnout_percent}%</p>
        </div>
        <div className={`p-3 rounded-xl border text-center ${results.quorum_met ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
          <p className="text-xs text-muted-foreground">Quorum ({results.quorum_percent}%)</p>
          <p className={`text-lg font-bold ${results.quorum_met ? 'text-emerald-600' : 'text-red-600'}`}>
            {results.quorum_met ? 'Met' : 'Not met'}
          </p>
        </div>
      </div>

      {(results.positions || []).map((p) => {
        const maxVotes = Math.max(1, ...(p.candidates || []).map((c) => c.votes));
        return (
          <div key={p.position_id} className="p-4 rounded-xl border border-border">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="font-semibold text-foreground">
                {p.title}{p.seats > 1 ? ` · ${p.seats} seats` : ''}
              </p>
              {p.tie && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                  <Icon name="AlertTriangle" size={12} color="currentColor" /> Tie — runoff required
                </span>
              )}
            </div>
            <div className="mt-3 space-y-2">
              {(p.candidates || []).map((c) => (
                <div key={c.candidate_id} className={`p-2.5 rounded-lg border ${c.is_winner ? 'border-emerald-200 bg-emerald-50' : c.is_tie ? 'border-amber-200 bg-amber-50' : 'border-border'}`}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                      {c.is_winner && <Icon name="Trophy" size={14} color="#059669" />}
                      {c.name}
                      {c.is_winner && <span className="text-xs font-semibold text-emerald-600">Elected</span>}
                      {c.is_tie && <span className="text-xs font-semibold text-amber-600">Tied</span>}
                    </span>
                    <span className="font-semibold text-foreground">{c.votes} vote{c.votes !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(c.votes / maxVotes) * 100}%`, background: c.is_winner ? '#059669' : c.is_tie ? '#d97706' : '#94a3b8' }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {p.tie && (
              <p className="text-xs text-amber-700 mt-2">
                The seat boundary falls inside a group of equal vote counts. No winner is declared for the
                contested seat{p.seats > 1 ? 's' : ''} — hold a runoff election between the tied candidates.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Converts flat sacco_election_tally rows into the results-snapshot shape.
export const tallyToResults = (rows, { registered, voted, quorum }) => {
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.position_id)) {
      map.set(r.position_id, { position_id: r.position_id, title: r.position_title, seats: r.seats, tie: false, candidates: [] });
    }
    const p = map.get(r.position_id);
    p.candidates.push({ candidate_id: r.candidate_id, name: r.candidate_name, votes: r.votes, is_winner: r.is_winner, is_tie: r.is_tie });
    if (r.is_tie) p.tie = true;
  });
  const pct = registered > 0 ? Math.round((voted * 1000) / registered) / 10 : 0;
  return {
    positions: [...map.values()],
    registered, voted,
    turnout_percent: pct,
    quorum_percent: quorum,
    quorum_met: pct >= (quorum || 0),
    has_ties: [...map.values()].some((p) => p.tie),
  };
};

const ElectionsTab = ({ ctx }) => {
  const {
    members, elections, electionPositions, electionCandidates, electionVoters, electionAudit,
    createElection, deleteElection, addElectionPosition, deleteElectionPosition,
    openNominations, closeNominations, openElectionVoting, closeElectionVoting,
    publishElectionResults, cancelElection,
    approveCandidate, rejectCandidate, addCandidateDirect,
    getElectionTally, verifyElectionReceipt, notifyElection,
  } = ctx;
  const toast = useToast();

  const [selectedId, setSelectedId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  const [candOpen, setCandOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // { action, title, body, cta, tone }
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null); // tally preview when voting_closed
  const [auditOpen, setAuditOpen] = useState(false);
  const [receiptCode, setReceiptCode] = useState('');
  const [receiptResult, setReceiptResult] = useState(null);

  const [form, setForm] = useState({ title: '', description: '', quorum_percent: '' });
  const [posForm, setPosForm] = useState({ title: '', description: '', seats: 1 });
  const [candForm, setCandForm] = useState({ position_id: '', member_id: '', manifesto: '' });

  const election = elections.find((e) => e.id === selectedId) || null;
  const positions = electionPositions.filter((p) => p.election_id === selectedId);
  const candidates = electionCandidates.filter((c) => c.election_id === selectedId);
  const pendingCands = candidates.filter((c) => c.status === 'pending');
  const approvedCands = candidates.filter((c) => c.status === 'approved');
  const voters = electionVoters.filter((v) => v.election_id === selectedId);
  const votedCount = voters.filter((v) => v.voted_at).length;
  const audit = electionAudit.filter((a) => a.election_id === selectedId);
  const activeMembers = members.filter((m) => m.status === 'active');

  // Load the tally preview once voting closes (admin pre-publish check).
  useEffect(() => {
    setPreview(null);
    setReceiptCode('');
    setReceiptResult(null);
    if (election?.status === 'voting_closed') {
      getElectionTally(election.id)
        .then((rows) => setPreview(tallyToResults(rows, {
          registered: election.register_size || 0,
          voted: votedCount,
          quorum: election.quorum_percent || 0,
        })))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, election?.status]);

  // Fire-and-forget member notification with a completion toast.
  const sendEmails = (type, e, extra = {}) => {
    notifyElection(type, e, extra)
      .then(({ sent, failed }) => {
        if (sent === 0 && failed === 0) return;
        if (failed) toast.warning(`Member emails: ${sent} sent, ${failed} failed.`);
        else toast.success(`Notified ${sent} member${sent !== 1 ? 's' : ''} by email.`);
      })
      .catch(() => {});
  };

  const doCreate = async () => {
    if (!form.title.trim()) { toast.error('Election title is required.'); return; }
    setSaving(true);
    try {
      await createElection(form);
      toast.success('Election created as a draft — add its positions next.');
      setCreateOpen(false);
      setForm({ title: '', description: '', quorum_percent: '' });
    } catch (e) { toast.error(e.message || 'Could not create the election.'); }
    finally { setSaving(false); }
  };

  const doAddPosition = async () => {
    if (!posForm.title.trim()) { toast.error('Position title is required.'); return; }
    setSaving(true);
    try {
      await addElectionPosition(election.id, { ...posForm, display_order: positions.length + 1 });
      toast.success(`Position "${posForm.title}" added.`);
      setPosOpen(false);
      setPosForm({ title: '', description: '', seats: 1 });
    } catch (e) { toast.error(e.message || 'Could not add the position.'); }
    finally { setSaving(false); }
  };

  const doAddCandidate = async () => {
    if (!candForm.position_id || !candForm.member_id) { toast.error('Pick a position and a member.'); return; }
    setSaving(true);
    try {
      await addCandidateDirect({ ...candForm, election_id: election.id });
      toast.success('Candidate added (pre-approved).');
      setCandOpen(false);
      setCandForm({ position_id: '', member_id: '', manifesto: '' });
    } catch (e) { toast.error(e.message || 'Could not add the candidate.'); }
    finally { setSaving(false); }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setSaving(true);
    try {
      await confirm.action();
      setConfirm(null);
    } catch (e) { toast.error(e.message || 'Action failed.'); }
    finally { setSaving(false); }
  };

  const lifecycle = (e) => {
    switch (e.status) {
      case 'draft':
        return (
          <>
            <PrimaryButton icon="Megaphone" disabled={positions.length === 0} onClick={() => setConfirm({
              title: 'Open nominations?',
              body: `Members will be able to stand or nominate others for the ${positions.length} position${positions.length !== 1 ? 's' : ''} on this ballot. Every active member is notified by email.`,
              cta: 'Open nominations',
              action: async () => {
                await openNominations(e.id);
                toast.success('Nominations are open.');
                sendEmails('sacco_election_nominations_open', e, {
                  positions: positions.map((p) => ({ title: p.title, seats: p.seats })),
                });
              },
            })}>Open nominations</PrimaryButton>
            <GhostButton icon="Trash2" onClick={() => setConfirm({
              title: 'Delete this draft?',
              body: 'Only drafts can be deleted. Once an election has opened it can only be cancelled, never removed.',
              cta: 'Delete draft', tone: 'danger',
              action: async () => {
                await deleteElection(e.id);
                setSelectedId(null);
                toast.success('Draft deleted.');
              },
            })}>Delete draft</GhostButton>
          </>
        );
      case 'nominations_open':
        return (
          <PrimaryButton icon="Lock" onClick={() => setConfirm({
            title: 'Close nominations?',
            body: pendingCands.length > 0
              ? `${pendingCands.length} nomination${pendingCands.length !== 1 ? 's are' : ' is'} still pending vetting — approve or reject them before opening the vote.`
              : 'No pending nominations. After closing you can still vet the queue, then open voting.',
            cta: 'Close nominations',
            action: async () => { await closeNominations(e.id); toast.success('Nominations closed.'); },
          })}>Close nominations</PrimaryButton>
        );
      case 'nominations_closed': {
        const unfilled = positions.filter((p) => !approvedCands.some((c) => c.position_id === p.id));
        return (
          <PrimaryButton icon="Vote" onClick={() => setConfirm({
            title: 'Open voting? This freezes the voter register.',
            body: `The register locks at today's ${activeMembers.length} active member${activeMembers.length !== 1 ? 's' : ''} — members who join later cannot vote in this election. Ballots are secret and final, and the candidate list can no longer change.` +
              (unfilled.length ? ` ⚠ ${unfilled.map((p) => `"${p.title}"`).join(', ')} has no approved candidate yet — the database will refuse to open.` : ''),
            cta: 'Freeze register & open voting',
            action: async () => {
              const n = await openElectionVoting(e.id);
              toast.success(`Voting is open — register frozen at ${n} voters.`);
              sendEmails('sacco_election_voting_open', e);
            },
          })}>Open voting</PrimaryButton>
        );
      }
      case 'voting_open':
        return (
          <PrimaryButton icon="TimerOff" onClick={() => setConfirm({
            title: 'Close voting?',
            body: `${votedCount} of ${e.register_size} registered voters have cast a ballot (${e.register_size ? Math.round((votedCount * 100) / e.register_size) : 0}%). No further ballots will be accepted after closing.`,
            cta: 'Close voting',
            action: async () => { await closeElectionVoting(e.id); toast.success('Voting closed — review the tally, then publish.'); },
          })}>Close voting</PrimaryButton>
        );
      case 'voting_closed':
        return (
          <PrimaryButton icon="Trophy" onClick={() => setConfirm({
            title: 'Publish the results?',
            body: 'The tally below is computed by the database from the immutable ballots. Publishing freezes it permanently, makes it visible to every member, and emails them the outcome.',
            cta: 'Publish results',
            action: async () => {
              const results = await publishElectionResults(e.id);
              toast.success('Results published.');
              sendEmails('sacco_election_results', e, {
                winners: (results?.positions || []).map((p) => ({
                  position: p.title,
                  tie: p.tie,
                  name: (p.candidates || []).filter((c) => c.is_winner).map((c) => c.name).join(', ') || '—',
                })),
                turnoutPercent: results?.turnout_percent,
                quorumMet: results?.quorum_met,
                hasTies: results?.has_ties,
              });
            },
          })}>Publish results</PrimaryButton>
        );
      default:
        return null;
    }
  };

  const canCancel = election && !['results_published', 'cancelled'].includes(election.status);

  const doVerifyReceipt = async () => {
    if (!receiptCode.trim()) return;
    try {
      const rows = await verifyElectionReceipt(election.id, receiptCode.trim());
      setReceiptResult(rows);
    } catch (e) { toast.error(e.message || 'Could not verify.'); }
  };

  return (
    <div className="space-y-6">
      <Card
        title="Elections · polling station"
        subtitle="Frozen voter register · secret final ballots · receipt verification · automatic tally"
        actions={<PrimaryButton icon="Plus" onClick={() => setCreateOpen(true)}>New election</PrimaryButton>}
      >
        {elections.length === 0 ? (
          <EmptyState icon="Award" title="No elections yet" hint="Create an election, add its positions, and run nominations before opening the vote." />
        ) : (
          <div className="space-y-2">
            {elections.map((e) => (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id === selectedId ? null : e.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${e.id === selectedId ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted'}`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon name={e.id === selectedId ? 'ChevronDown' : 'ChevronRight'} size={14} color="currentColor" />
                    <p className="font-semibold text-foreground truncate">{e.title}</p>
                    <Badge status={e.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {e.status === 'voting_open' && e.register_size
                      ? `${electionVoters.filter((v) => v.election_id === e.id && v.voted_at).length}/${e.register_size} voted`
                      : `Created ${fmtDate(e.created_at)}`}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {election && (
        <>
          {/* Lifecycle + status */}
          <Card
            title={election.title}
            subtitle={election.description || 'Election lifecycle'}
            actions={
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {lifecycle(election)}
                {canCancel && (
                  <GhostButton icon="Ban" onClick={() => setConfirm({
                    title: 'Cancel this election?',
                    body: 'The election is voided but its record and audit trail are kept permanently. This cannot be undone.',
                    cta: 'Cancel election', tone: 'danger',
                    action: async () => { await cancelElection(election.id); toast.success('Election cancelled.'); },
                  })}>Cancel</GhostButton>
                )}
              </div>
            }
          >
            <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
              <Badge status={election.status} />
              {election.quorum_percent > 0 && <span>Quorum {election.quorum_percent}%</span>}
              {election.nominations_open_at && <span>Nominations {fmtDate(election.nominations_open_at)}</span>}
              {election.voting_open_at && <span>· Voting opened {fmtDate(election.voting_open_at)}</span>}
              {election.register_size != null && <span>· Register {election.register_size} voters</span>}
              {election.results_published_at && <span>· Published {fmtDate(election.results_published_at)}</span>}
            </div>

            {election.status === 'voting_open' && (
              <div className="mt-4">
                <TurnoutBar registered={election.register_size || 0} voted={votedCount} quorum={election.quorum_percent} />
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <Icon name="Lock" size={11} color="currentColor" />
                  Only turnout is visible while voting is open — candidate counts stay sealed in the database until you close the vote.
                </p>
              </div>
            )}
          </Card>

          {/* Positions */}
          {['draft', 'nominations_open', 'nominations_closed'].includes(election.status) && (
            <Card
              title="Positions on the ballot"
              subtitle="Each voter picks one candidate per position; a position with N seats elects the top N"
              actions={<GhostButton icon="Plus" onClick={() => setPosOpen(true)}>Add position</GhostButton>}
            >
              {positions.length === 0 ? (
                <EmptyState icon="ListOrdered" title="No positions yet" hint="Add Chairman, Treasurer, Secretary, Committee Members… before opening nominations." />
              ) : (
                <div className="space-y-2">
                  {positions.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {p.title}{p.seats > 1 ? ` · ${p.seats} seats` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {approvedCands.filter((c) => c.position_id === p.id).length} approved
                          {' · '}{candidates.filter((c) => c.position_id === p.id && c.status === 'pending').length} pending
                        </p>
                      </div>
                      {election.status === 'draft' && (
                        <button
                          onClick={async () => {
                            try { await deleteElectionPosition(p.id); toast.success('Position removed.'); }
                            catch (err) { toast.error(err.message); }
                          }}
                          className="text-xs text-red-500 font-semibold hover:underline"
                        >Remove</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Candidate vetting */}
          {['nominations_open', 'nominations_closed'].includes(election.status) && (
            <Card
              title="Candidates & vetting"
              subtitle="Member nominations arrive as pending — approve or reject each one; you can also add candidates directly"
              actions={<GhostButton icon="UserPlus" onClick={() => setCandOpen(true)}>Add candidate</GhostButton>}
            >
              {candidates.length === 0 ? (
                <EmptyState icon="Users" title="No candidates yet" hint="Nominations from members appear here for vetting." />
              ) : (
                <div className="space-y-2">
                  {candidates.map((c) => {
                    const pos = positions.find((p) => p.id === c.position_id);
                    return (
                      <div key={c.id} className="p-3 rounded-xl border border-border">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-foreground">{c.member?.full_name || '—'}</p>
                              <Badge status={c.status} />
                              <span className="text-xs text-muted-foreground">for {pos?.title || '—'}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {c.nominated_by
                                ? (c.nominated_by === c.member_id ? 'Self-nominated' : `Nominated by ${c.nominator?.full_name || 'a member'}`)
                                : 'Added by admin'}
                              {' · '}{fmtDate(c.created_at)}
                            </p>
                            {c.manifesto && <p className="text-xs text-muted-foreground mt-1 italic">“{c.manifesto}”</p>}
                          </div>
                          {c.status === 'pending' && (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={async () => { try { await approveCandidate(c); toast.success('Candidate approved.'); } catch (err) { toast.error(err.message); } }}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                              >Approve</button>
                              <button
                                onClick={async () => { try { await rejectCandidate(c); toast.success('Candidate rejected.'); } catch (err) { toast.error(err.message); } }}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200"
                              >Reject</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* Ballot summary once voting has started */}
          {['voting_open', 'voting_closed', 'results_published'].includes(election.status) && approvedCands.length > 0 && election.status === 'voting_open' && (
            <Card title="Ballot paper" subtitle="Locked — the candidate list cannot change while voting is open">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {positions.map((p) => (
                  <div key={p.id} className="p-3 rounded-xl border border-border">
                    <p className="text-sm font-semibold text-foreground">{p.title}{p.seats > 1 ? ` · ${p.seats} seats` : ''}</p>
                    <ul className="mt-1 space-y-0.5">
                      {approvedCands.filter((c) => c.position_id === p.id).map((c) => (
                        <li key={c.id} className="text-xs text-muted-foreground">{c.member?.full_name}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Results: preview after close, snapshot after publish */}
          {election.status === 'voting_closed' && (
            <Card title="Tally preview" subtitle="Computed by the database from the sealed ballots — publish to make it final and visible to members">
              {preview ? <ResultsView results={preview} /> : <p className="text-sm text-muted-foreground">Computing tally…</p>}
            </Card>
          )}
          {election.status === 'results_published' && election.results && (
            <Card title="Final results" subtitle={`Published ${fmtDate(election.results_published_at)} — frozen snapshot, verifiable against the immutable ballots`}>
              <ResultsView results={election.results} />
            </Card>
          )}

          {/* Receipt verification (help a member check their ballot) */}
          {['voting_open', 'voting_closed', 'results_published'].includes(election.status) && (
            <Card title="Verify a ballot receipt" subtitle="Enter a member's receipt code to confirm what their anonymous ballot recorded">
              <div className="flex items-center gap-2 max-w-md">
                <TextInput value={receiptCode} onChange={(e) => setReceiptCode(e.target.value)} placeholder="e.g. 0CD877241287" />
                <GhostButton icon="Search" onClick={doVerifyReceipt}>Verify</GhostButton>
              </div>
              {receiptResult && (
                receiptResult.length === 0 ? (
                  <p className="text-sm text-red-600 mt-3">No ballot found for that code in this election.</p>
                ) : (
                  <div className="mt-3 space-y-1.5">
                    {receiptResult.map((r, i) => (
                      <p key={i} className="text-sm text-foreground flex items-center gap-2">
                        <Icon name="CheckCircle2" size={14} color="#059669" />
                        <strong>{r.position_title}</strong> → {r.candidate_name}
                        <span className="text-xs text-muted-foreground">({fmtDate(r.cast_at)})</span>
                      </p>
                    ))}
                  </div>
                )
              )}
            </Card>
          )}

          {/* Audit trail */}
          <Card
            title="Audit trail"
            subtitle="Append-only record of every lifecycle event — written by the database, unchangeable"
            actions={<GhostButton icon={auditOpen ? 'ChevronUp' : 'ChevronDown'} onClick={() => setAuditOpen(!auditOpen)}>{auditOpen ? 'Hide' : `Show (${audit.length})`}</GhostButton>}
          >
            {auditOpen && (
              audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events yet.</p>
              ) : (
                <div className="space-y-2">
                  {audit.map((a) => {
                    const meta = AUDIT_META[a.event] || { icon: 'Circle', label: a.event.replace(/_/g, ' ') };
                    return (
                      <div key={a.id} className="flex items-start gap-3 p-2.5 rounded-lg border border-border">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,193,221,0.1)' }}>
                          <Icon name={meta.icon} size={14} color="#1da8c5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {meta.label}
                            {a.details?.candidate && <span className="text-muted-foreground font-normal"> — {a.details.candidate} ({a.details.position})</span>}
                            {a.details?.register_size != null && <span className="text-muted-foreground font-normal"> — {a.details.register_size} voters registered</span>}
                            {a.details?.voted != null && a.event === 'voting_closed' && <span className="text-muted-foreground font-normal"> — {a.details.voted}/{a.details.registered} voted</span>}
                            {a.event === 'results_published' && a.details?.turnout_percent != null && <span className="text-muted-foreground font-normal"> — turnout {a.details.turnout_percent}%, quorum {a.details.quorum_met ? 'met' : 'not met'}</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">{a.actor_label || 'system'} · {new Date(a.created_at).toLocaleString('en-KE')}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </Card>
        </>
      )}

      {/* New election */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New election"
        footer={<><GhostButton onClick={() => setCreateOpen(false)}>Cancel</GhostButton><PrimaryButton icon="Check" onClick={doCreate} disabled={saving}>{saving ? 'Saving…' : 'Create draft'}</PrimaryButton></>}>
        <div className="space-y-4">
          <Field label="Title *"><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="2026 Office Bearers Election" /></Field>
          <Field label="Description"><TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Annual general meeting elections" /></Field>
          <Field label="Quorum % (of registered voters that must vote)">
            <NumberInput min="0" max="100" value={form.quorum_percent} onChange={(e) => setForm({ ...form, quorum_percent: e.target.value })} placeholder="50" />
          </Field>
          <p className="text-xs text-muted-foreground">
            The election starts as a draft: add its positions, then open nominations.
          </p>
        </div>
      </Modal>

      {/* Add position */}
      <Modal open={posOpen} onClose={() => setPosOpen(false)} title="Add position"
        footer={<><GhostButton onClick={() => setPosOpen(false)}>Cancel</GhostButton><PrimaryButton icon="Check" onClick={doAddPosition} disabled={saving}>{saving ? 'Saving…' : 'Add position'}</PrimaryButton></>}>
        <div className="space-y-4">
          <Field label="Position title *"><TextInput value={posForm.title} onChange={(e) => setPosForm({ ...posForm, title: e.target.value })} placeholder="Chairman" /></Field>
          <Field label="Description"><TextInput value={posForm.description} onChange={(e) => setPosForm({ ...posForm, description: e.target.value })} placeholder="Leads the sacco and chairs meetings" /></Field>
          <Field label="Seats (winners for this position)">
            <NumberInput min="1" value={posForm.seats} onChange={(e) => setPosForm({ ...posForm, seats: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {/* Add candidate directly */}
      <Modal open={candOpen} onClose={() => setCandOpen(false)} title="Add candidate (pre-approved)"
        footer={<><GhostButton onClick={() => setCandOpen(false)}>Cancel</GhostButton><PrimaryButton icon="Check" onClick={doAddCandidate} disabled={saving}>{saving ? 'Saving…' : 'Add candidate'}</PrimaryButton></>}>
        <div className="space-y-4">
          <Field label="Position *">
            <Select value={candForm.position_id} onChange={(e) => setCandForm({ ...candForm, position_id: e.target.value })}>
              <option value="">Select position</option>
              {positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </Select>
          </Field>
          <Field label="Member *">
            <Select value={candForm.member_id} onChange={(e) => setCandForm({ ...candForm, member_id: e.target.value })}>
              <option value="">Select member</option>
              {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.member_no})</option>)}
            </Select>
          </Field>
          <Field label="Manifesto"><TextInput value={candForm.manifesto} onChange={(e) => setCandForm({ ...candForm, manifesto: e.target.value })} placeholder="Optional statement shown to voters" /></Field>
        </div>
      </Modal>

      {/* Confirm dialog */}
      <Modal open={!!confirm} onClose={() => !saving && setConfirm(null)} title={confirm?.title || ''}
        footer={<>
          <GhostButton onClick={() => setConfirm(null)} disabled={saving}>Back</GhostButton>
          <PrimaryButton
            icon={saving ? 'Loader2' : 'Check'}
            onClick={runConfirm}
            disabled={saving}
            className={confirm?.tone === 'danger' ? '!bg-none' : ''}
            style={confirm?.tone === 'danger' ? { background: 'linear-gradient(135deg, #ef4444, #dc2626)' } : undefined}
          >{saving ? 'Working…' : (confirm?.cta || 'Confirm')}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground leading-relaxed">{confirm?.body}</p>
      </Modal>
    </div>
  );
};

export default ElectionsTab;
