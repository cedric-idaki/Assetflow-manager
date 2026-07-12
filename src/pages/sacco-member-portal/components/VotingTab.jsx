import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../../components/Toast';
import Icon from '../../../components/AppIcon';
import {
  Card, Badge, EmptyState, PrimaryButton, GhostButton,
  Modal, Field, TextInput, Select, fmtDate,
} from '../../sacco-dashboard/components/_shared';

const emptyMotion = { title: '', description: '', ballot_type: 'visible' };

const CHOICES = [
  { value: 'yes',     label: 'Yes',     icon: 'ThumbsUp',   cls: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' },
  { value: 'no',      label: 'No',      icon: 'ThumbsDown', cls: 'border-red-300 text-red-700 hover:bg-red-50' },
  { value: 'abstain', label: 'Abstain', icon: 'Minus',      cls: 'border-slate-300 text-slate-600 hover:bg-slate-50' },
];

// Result bars for a closed/published motion.
const Results = ({ motion, votes, getMotionResults }) => {
  const [totals, setTotals] = useState(null);

  const load = useCallback(async () => {
    if (motion.ballot_type === 'secret') {
      try { setTotals(await getMotionResults(motion.id)); } catch (_) { setTotals(null); }
    } else {
      const mv = votes.filter((v) => v.motion_id === motion.id);
      setTotals({
        yes_count: mv.filter((v) => v.choice === 'yes').length,
        no_count: mv.filter((v) => v.choice === 'no').length,
        abstain_count: mv.filter((v) => v.choice === 'abstain').length,
        total_votes: mv.length,
      });
    }
  }, [motion.id, motion.ballot_type, votes, getMotionResults]);

  useEffect(() => { load(); }, [load]);

  if (!totals) return null;
  const rows = [
    { label: 'Yes', n: totals.yes_count, color: '#059669' },
    { label: 'No', n: totals.no_count, color: '#dc2626' },
    { label: 'Abstain', n: totals.abstain_count, color: '#64748b' },
  ];
  const max = Math.max(totals.total_votes, 1);
  return (
    <div className="space-y-1.5 mt-3">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-14 text-muted-foreground">{r.label}</span>
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: r.color }} />
          </div>
          <span className="w-6 text-right font-semibold text-foreground">{r.n}</span>
        </div>
      ))}
      <p className="text-xs text-muted-foreground pt-1">
        {totals.total_votes} vote{totals.total_votes === 1 ? '' : 's'} cast
        {motion.ballot_type === 'secret' ? ' · secret ballot — only totals are shown' : ''}
      </p>
    </div>
  );
};

const VotingTab = ({ ctx }) => {
  const { me, motions, votes, proposeMotion, secondMotion, castVote, getMotionResults } = ctx;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyMotion);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const propose = async () => {
    if (!form.title.trim()) { toast.error('The motion needs a title.'); return; }
    setSaving(true);
    try {
      await proposeMotion(form);
      toast.success('Motion proposed — it needs a seconder before it can go to a vote.');
      setOpen(false);
      setForm(emptyMotion);
    } catch (e) {
      toast.error(e.message || 'Could not propose the motion.');
    } finally {
      setSaving(false);
    }
  };

  const second = async (motion) => {
    try {
      await secondMotion(motion);
      toast.success('Motion seconded.');
    } catch (e) {
      toast.error(e.message || 'Could not second the motion.');
    }
  };

  const vote = async (motion, choice) => {
    try {
      await castVote(motion, choice);
      toast.success(`Vote recorded: ${choice}.`);
    } catch (e) {
      toast.error(e.message || 'Could not record your vote.');
    }
  };

  const myVoteOn = (motionId) => votes.find((v) => v.motion_id === motionId && v.member_id === me?.id)?.choice;
  const votingClosed = (m) => m.voting_end && new Date(m.voting_end) < new Date();

  return (
    <Card
      title="Voting & governance"
      subtitle="Propose motions, second them, and cast your vote"
      actions={<PrimaryButton icon="Plus" onClick={() => setOpen(true)}>Propose motion</PrimaryButton>}
    >
      {motions.length === 0 ? (
        <EmptyState icon="Vote" title="No motions yet" hint="Any member can propose a motion — it goes to a vote once seconded and opened by the chairman." />
      ) : (
        <div className="space-y-3">
          {motions.map((m) => {
            const mine = myVoteOn(m.id);
            const canSecond = m.status === 'proposed' && m.proposer_id !== me?.id;
            const canVote = m.status === 'open' && !votingClosed(m);
            const showResults = ['passed', 'rejected', 'closed'].includes(m.status);
            return (
              <div key={m.id} className="border border-border rounded-xl p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{m.title}</p>
                    {m.description && <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      {m.ballot_type === 'secret' ? 'Secret ballot' : 'Open ballot'}
                      {m.proposer?.full_name ? ` · proposed by ${m.proposer.full_name}` : ''}
                      {m.seconder?.full_name ? ` · seconded by ${m.seconder.full_name}` : ''}
                      {m.voting_end ? ` · voting ${votingClosed(m) ? 'closed' : 'closes'} ${fmtDate(m.voting_end)}` : ''}
                    </p>
                  </div>
                  <Badge status={m.status} />
                </div>

                {canSecond && (
                  <GhostButton icon="UserCheck" onClick={() => second(m)}>Second this motion</GhostButton>
                )}

                {canVote && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {CHOICES.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => vote(m, c.value)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${c.cls} ${mine === c.value ? 'ring-2 ring-primary/40' : ''}`}
                      >
                        <Icon name={c.icon} size={13} color="currentColor" />
                        {c.label}{mine === c.value ? ' ✓' : ''}
                      </button>
                    ))}
                    {mine && <span className="text-xs text-muted-foreground">You voted “{mine}” — you can change it while voting is open.</span>}
                  </div>
                )}

                {showResults && <Results motion={m} votes={votes} getMotionResults={getMotionResults} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Propose modal */}
      <Modal
        open={open} onClose={() => setOpen(false)}
        title="Propose a motion"
        footer={<>
          <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Send" onClick={propose} disabled={saving}>{saving ? 'Proposing…' : 'Propose motion'}</PrimaryButton>
        </>}
      >
        <div className="space-y-4">
          <Field label="Title *"><TextInput value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Increase monthly contribution to KES 2,000" /></Field>
          <Field label="Description">
            <textarea
              value={form.description} onChange={(e) => set('description', e.target.value)} rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
              placeholder="Why are you proposing this?"
            />
          </Field>
          <Field label="Ballot type">
            <Select value={form.ballot_type} onChange={(e) => set('ballot_type', e.target.value)}>
              <option value="visible">Visible (open) — votes are public after closing</option>
              <option value="secret">Secret — only totals are published</option>
            </Select>
          </Field>
          <p className="text-xs text-muted-foreground">
            A different member must second the motion, then the chairman opens the voting window.
          </p>
        </div>
      </Modal>
    </Card>
  );
};

export default VotingTab;
