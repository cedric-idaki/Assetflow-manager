import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useToast } from '../../../components/Toast';
import { Card, Badge, PrimaryButton, GhostButton, Modal, Field, TextInput, Select, EmptyState, fmtDate } from './_shared';

const VotingTab = ({ ctx }) => {
  const { motions, members, votes, createMotion, secondMotion, openVoting, castVote, publishResults } = ctx;
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [voteMotion, setVoteMotion] = useState(null);
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
  const doOpen = async (m) => {
    const end = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    try { await openVoting(m.id, end); toast.success('Voting is now open (3-day window).'); }
    catch (e) { toast.error(e.message || 'Could not open voting.'); }
  };
  const doPublish = async (m) => {
    try { await publishResults(m); toast.success('Results published.'); }
    catch (e) { toast.error(e.message || 'Could not publish.'); }
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
                      </div>
                      {m.description && <p className="text-sm text-muted-foreground mt-1">{m.description}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        Proposer: {m.proposer?.full_name || memberName(m.proposer_id)}
                        {m.seconder_id && ` · Seconder: ${m.seconder?.full_name || memberName(m.seconder_id)}`}
                        {m.voting_end && ` · Closes ${fmtDate(m.voting_end)}`}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 items-end flex-shrink-0">
                      {m.status === 'proposed' && <button onClick={() => doSecond(m)} className="text-xs text-indigo-600 font-semibold hover:underline">Second motion</button>}
                      {m.status === 'seconded' && <button onClick={() => doOpen(m)} className="text-xs text-sky-600 font-semibold hover:underline">Open voting</button>}
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
            <div className="grid grid-cols-3 gap-2 mt-4">
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
    </div>
  );
};

export default VotingTab;
