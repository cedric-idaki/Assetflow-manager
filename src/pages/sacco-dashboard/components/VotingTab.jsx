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

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || '—';
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
  const submitVote = async (choice) => {
    if (!voter) { toast.error('Choose the voting member.'); return; }
    setSaving(true);
    try { await castVote(voteMotion, voter, choice); toast.success('Vote recorded.'); setVoter(''); }
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
                        <button onClick={() => { setVoteMotion(m); setVoter(''); }} className="text-xs text-primary font-semibold hover:underline">Cast vote</button>
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

      {/* Cast vote */}
      <Modal open={!!voteMotion} onClose={() => setVoteMotion(null)} title={voteMotion ? `Vote · ${voteMotion.title}` : ''}
        footer={<GhostButton onClick={() => setVoteMotion(null)}>Done</GhostButton>}>
        {voteMotion && (
          <>
            <Field label="Voting member *">
              <Select value={voter} onChange={(e) => setVoter(e.target.value)}>
                <option value="">Select member</option>
                {members.filter((m) => m.status === 'active').map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
              <button onClick={() => submitVote('yes')} disabled={saving} className="py-2 rounded-lg text-sm font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-60">Yes</button>
              <button onClick={() => submitVote('no')} disabled={saving} className="py-2 rounded-lg text-sm font-semibold bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-60">No</button>
              <button onClick={() => submitVote('abstain')} disabled={saving} className="py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60">Abstain</button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {voteMotion.ballot_type === 'secret'
                ? 'Secret ballot — individual choices are never displayed, only totals.'
                : 'Visible ballot — the breakdown is shown to members after the vote closes.'}
            </p>
          </>
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
