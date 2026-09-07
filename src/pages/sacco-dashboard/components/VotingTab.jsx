import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useToast } from '../../../components/Toast';
import {
  Card, Badge, PrimaryButton, GhostButton, Modal, Field, TextInput, NumberInput,
  Select, EmptyState, fmtDate, DateTimeInput, CountdownPill, fromLocalInput,
} from './_shared';

// Default a fresh voting window to 3 days out, in the datetime-local format.
const defaultVotingEnd = () => {
  const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// A recorded vote is final, so a click here only stages the choice — the clerk
// reads it back on a second screen before anything reaches sacco_votes. Members
// get the same review step in their portal (see the member VotingTab).
const CHOICES = [
  { value: 'yes',     label: 'Yes',     icon: 'ThumbsUp',   btn: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200', pill: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { value: 'no',      label: 'No',      icon: 'ThumbsDown', btn: 'bg-red-100 text-red-700 hover:bg-red-200',             pill: 'border-red-300 bg-red-50 text-red-700' },
  { value: 'abstain', label: 'Abstain', icon: 'Minus',      btn: 'bg-slate-100 text-slate-600 hover:bg-slate-200',       pill: 'border-slate-300 bg-slate-50 text-slate-600' },
];

const choiceOf = (value) => CHOICES.find((c) => c.value === value);

const VotingTab = ({ ctx }) => {
  const { motions, members, votes, createMotion, secondMotion, openVoting, castVote, publishResults, notifyMotion } = ctx;
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [voteMotion, setVoteMotion] = useState(null);
  const [openMotion, setOpenMotion] = useState(null);      // motion being opened for voting
  const [votingEnd, setVotingEnd] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ title: '', description: '', ballot_type: 'visible', proposer_id: '', quorum_percent: '' });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const [voter, setVoter] = useState('');
  const [pendingChoice, setPendingChoice] = useState('');   // staged, not yet cast

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || '—';
  const hasVoted = (motionId, memberId) => votes.some((v) => v.motion_id === motionId && v.member_id === memberId);
  const tally = (motionId) => {
    const mv = votes.filter((v) => v.motion_id === motionId);
    return {
      yes: mv.filter((v) => v.choice === 'yes').length,
      no: mv.filter((v) => v.choice === 'no').length,
      abstain: mv.filter((v) => v.choice === 'abstain').length,
      total: mv.length,
    };
  };

  const create = async () => {
    if (!form.title.trim()) { toast.error('Motion title is required.'); return; }
    setSaving(true);
    try { await createMotion(form); toast.success('Motion proposed.'); setCreateOpen(false); setForm({ title: '', description: '', ballot_type: 'visible', proposer_id: '', quorum_percent: '' }); }
    catch (e) { toast.error(e.message || 'Could not create motion.'); } finally { setSaving(false); }
  };

  const doSecond = async (m) => {
    const seconder = members.find((x) => x.id !== m.proposer_id);
    if (!seconder) { toast.error('Need a second member to second the motion.'); return; }
    try { await secondMotion(m.id, seconder.id); toast.success(`Seconded by ${seconder.full_name}.`); }
    catch (e) { toast.error(e.message || 'Could not second.'); }
  };
  const openOpenModal = (m) => { setOpenMotion(m); setVotingEnd(defaultVotingEnd()); };

  const doConfirmOpen = async () => {
    const endIso = fromLocalInput(votingEnd);
    if (!endIso) { toast.error('Choose when voting should close.'); return; }
    if (new Date(endIso) <= new Date()) { toast.error('The closing time must be in the future.'); return; }
    setSaving(true);
    try {
      await openVoting(openMotion.id, endIso);
      toast.success('Voting is open — members can now vote until the deadline.');
      notifyMotion('sacco_motion_voting_open', openMotion, { votingEnd: endIso })
        .then(({ sent, failed }) => {
          if (sent === 0 && failed === 0) return;
          if (failed) toast.warning(`Member emails: ${sent} sent, ${failed} failed.`);
          else toast.success(`Notified ${sent} member${sent !== 1 ? 's' : ''} by email.`);
        }).catch(() => {});
      setOpenMotion(null);
    } catch (e) { toast.error(e.message || 'Could not open voting.'); }
    finally { setSaving(false); }
  };

  const doPublish = async (m) => {
    try {
      const r = await publishResults(m);
      if (r?.status === 'passed') toast.success(`Motion passed (${r.yes} yes / ${r.no} no).`);
      else if (r?.quorum_met === false) toast.warning(`Motion not carried — quorum not met (${r.total}/${r.eligible} voted).`);
      else toast.success(`Motion not carried (${r?.yes ?? 0} yes / ${r?.no ?? 0} no).`);
    } catch (e) { toast.error(e.message || 'Could not close the motion.'); }
  };
  const openVoteModal = (m) => { setVoteMotion(m); setVoter(''); setPendingChoice(''); };
  const closeVoteModal = () => { setVoteMotion(null); setVoter(''); setPendingChoice(''); };

  // Step 1 — stage the choice. Nothing is written; the clerk still has to read
  // the member and the choice back on the confirmation screen.
  const stageVote = (choice) => {
    if (!voter) { toast.error('Choose the voting member.'); return; }
    if (hasVoted(voteMotion.id, voter)) { toast.error('That member has already voted — votes are final.'); return; }
    setPendingChoice(choice);
  };

  // Step 2 — confirmed against the summary, so record it. Re-check the ballot
  // in case the member voted from their own portal while this modal was open.
  const confirmVote = async () => {
    if (!voter || !pendingChoice) return;
    if (hasVoted(voteMotion.id, voter)) {
      toast.error('That member has already voted — votes are final.');
      setPendingChoice('');
      return;
    }
    setSaving(true);
    try {
      await castVote(voteMotion, voter, pendingChoice);
      toast.success(`Vote recorded for ${memberName(voter)}: ${choiceOf(pendingChoice)?.label}. It is final.`);
      setVoter('');
      setPendingChoice('');
    }
    catch (e) { toast.error(e.message || 'Could not vote.'); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <Card
        title="Motions & voting" subtitle="Propose → second → open → results (visible or secret ballots)"
        actions={<PrimaryButton icon="Plus" onClick={() => setCreateOpen(true)}>New motion</PrimaryButton>}
      >
        {motions.length === 0 ? (
          <EmptyState icon="Vote" title="No motions yet" hint="Raise a motion for the members to vote on. A motion needs a seconder before it can open." />
        ) : (
          <div className="space-y-3">
            {motions.map((m) => {
              const t = tally(m.id);
              return (
                <div key={m.id} className="p-4 rounded-xl border border-border">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground">{m.title}</p>
                        <Badge status={m.status} />
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Icon name={m.ballot_type === 'secret' ? 'EyeOff' : 'Eye'} size={12} color="currentColor" />
                          {m.ballot_type}
                        </span>
                        {m.status === 'open' && m.voting_end && (
                          <CountdownPill targetIso={m.voting_end} label="Closes in" endedLabel="Closing…" />
                        )}
                      </div>
                      {m.description && <p className="text-sm text-muted-foreground mt-1">{m.description}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        Proposer: {m.proposer?.full_name || memberName(m.proposer_id)}
                        {m.seconder_id && ` · Seconder: ${m.seconder?.full_name || memberName(m.seconder_id)}`}
                        {m.quorum_percent > 0 && ` · Quorum ${m.quorum_percent}%`}
                        {m.voting_end && ` · Closes ${fmtDate(m.voting_end)}`}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 items-end flex-shrink-0">
                      {m.status === 'proposed' && <button onClick={() => doSecond(m)} className="text-xs text-indigo-600 font-semibold hover:underline">Second motion</button>}
                      {m.status === 'seconded' && <button onClick={() => openOpenModal(m)} className="text-xs text-sky-600 font-semibold hover:underline">Open voting</button>}
                      {m.status === 'open' && <>
                        <button onClick={() => openVoteModal(m)} className="text-xs text-primary font-semibold hover:underline">Cast vote</button>
                        <button onClick={() => doPublish(m)} className="text-xs text-emerald-600 font-semibold hover:underline">Close & publish</button>
                      </>}
                    </div>
                  </div>

                  {/* Results / live tally */}
                  {t.total > 0 && (
                    <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 text-sm">
                      <span className="text-emerald-600 font-semibold">Yes {t.yes}</span>
                      <span className="text-red-600 font-semibold">No {t.no}</span>
                      <span className="text-muted-foreground">Abstain {t.abstain}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{t.total} vote{t.total !== 1 ? 's' : ''} cast</span>
                    </div>
                  )}
                  {m.ballot_type === 'secret' && (m.status === 'open' || m.status === 'passed' || m.status === 'rejected') && (
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <Icon name="Lock" size={11} color="currentColor" /> Secret ballot — only aggregate totals are shown.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Create motion */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New motion"
        footer={<><GhostButton onClick={() => setCreateOpen(false)}>Cancel</GhostButton><PrimaryButton icon="Check" onClick={create} disabled={saving}>{saving ? 'Saving…' : 'Propose motion'}</PrimaryButton></>}>
        <div className="space-y-4">
          <Field label="Title *"><TextInput value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Approve 2026 investment plan" /></Field>
          <Field label="Description"><TextInput value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Short summary of the motion" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Ballot type"><Select value={form.ballot_type} onChange={(e) => set('ballot_type', e.target.value)}><option value="visible">Visible (open)</option><option value="secret">Secret (anonymous)</option></Select></Field>
            <Field label="Proposer"><Select value={form.proposer_id} onChange={(e) => set('proposer_id', e.target.value)}><option value="">Select member</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</Select></Field>
          </div>
          <Field label="Quorum % (minimum turnout for the motion to carry)">
            <NumberInput min="0" max="100" value={form.quorum_percent} onChange={(e) => set('quorum_percent', e.target.value)} placeholder="e.g. 50 — leave 0 for no quorum rule" />
          </Field>
        </div>
      </Modal>

      {/* Cast vote — pick, then confirm. A vote cannot be taken back, so the
          choice is read back to the clerk before it is recorded. */}
      <Modal
        open={!!voteMotion}
        onClose={() => { if (!saving) closeVoteModal(); }}
        title={voteMotion ? `${pendingChoice ? 'Confirm vote' : 'Vote'} · ${voteMotion.title}` : ''}
        footer={pendingChoice ? (
          <>
            <GhostButton onClick={() => setPendingChoice('')} disabled={saving}>Go back</GhostButton>
            <PrimaryButton icon="Vote" onClick={confirmVote} disabled={saving}>
              {saving ? 'Recording…' : `Confirm “${choiceOf(pendingChoice)?.label}” vote`}
            </PrimaryButton>
          </>
        ) : <GhostButton onClick={closeVoteModal}>Done</GhostButton>}
      >
        {voteMotion && !pendingChoice && (
          <>
            <Field label="Voting member *">
              <Select value={voter} onChange={(e) => setVoter(e.target.value)}>
                <option value="">Select member</option>
                {members.filter((m) => m.status === 'active').map((m) => (
                  <option key={m.id} value={m.id} disabled={hasVoted(voteMotion.id, m.id)}>
                    {m.full_name}{hasVoted(voteMotion.id, m.id) ? ' · already voted' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
              {CHOICES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => stageVote(c.value)}
                  disabled={saving}
                  className={`inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold disabled:opacity-60 ${c.btn}`}
                >
                  <Icon name={c.icon} size={14} color="currentColor" />
                  {c.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              A member votes once and the ballot is final — members who have already voted cannot be selected here.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              You confirm the member and the choice on the next screen before anything is recorded.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {voteMotion.ballot_type === 'secret'
                ? 'Secret ballot — individual choices are never displayed, only totals.'
                : 'Visible ballot — the breakdown is shown to members after the vote closes.'}
            </p>
          </>
        )}

        {voteMotion && pendingChoice && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
              <Icon name="AlertTriangle" size={15} color="#dc2626" />
              <p className="text-xs text-red-700 leading-relaxed">
                <strong>Votes are final.</strong> Once recorded this ballot cannot be withdrawn, and the
                member can no longer vote on this motion from their own portal.
              </p>
            </div>
            <div className="p-4 rounded-xl border border-border text-center space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Motion</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{voteMotion.title}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Recording the vote of</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{memberName(voter)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Their choice</p>
                <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold ${choiceOf(pendingChoice)?.pill || ''}`}>
                  <Icon name={choiceOf(pendingChoice)?.icon} size={16} color="currentColor" />
                  {choiceOf(pendingChoice)?.label}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Check both against the ballot paper before confirming.
              {voteMotion.ballot_type === 'secret'
                ? ' Secret ballot — only the totals are ever displayed.'
                : ''}
            </p>
          </div>
        )}
      </Modal>

      {/* Open voting (set the deadline) */}
      <Modal open={!!openMotion} onClose={() => !saving && setOpenMotion(null)} title={openMotion ? `Open voting · ${openMotion.title}` : ''}
        footer={<><GhostButton onClick={() => setOpenMotion(null)} disabled={saving}>Cancel</GhostButton><PrimaryButton icon="Vote" onClick={doConfirmOpen} disabled={saving}>{saving ? 'Opening…' : 'Open voting'}</PrimaryButton></>}>
        {openMotion && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Voting opens now and every active member is notified by email. Set the closing deadline — the
              system stops accepting votes the moment it passes and closes the motion automatically.
            </p>
            <Field label="Voting closes *">
              <DateTimeInput value={votingEnd} onChange={(e) => setVotingEnd(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">
              {openMotion.quorum_percent > 0
                ? `The motion carries only if turnout reaches the ${openMotion.quorum_percent}% quorum and Yes beats No.`
                : 'No quorum was set — the motion carries on a simple Yes-over-No majority.'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default VotingTab;
