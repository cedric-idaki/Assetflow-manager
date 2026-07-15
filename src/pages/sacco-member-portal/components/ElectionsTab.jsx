/**
 * ElectionsTab (member portal) — the voter's side of the polling station.
 *
 * Nominate (self or others) while nominations are open, cast a secret and
 * final ballot while voting is open, keep the anonymous receipt code, verify
 * it any time, and read the published results. The ballot is stored with no
 * link to the member's identity — only the receipt code, shown once here,
 * can locate it (see 20260715120000_sacco_elections.sql).
 */
import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useToast } from '../../../components/Toast';
import {
  Card, Badge, EmptyState, PrimaryButton, GhostButton,
  Modal, Field, TextInput, Select, fmtDate,
} from '../../sacco-dashboard/components/_shared';
import { TurnoutBar, ResultsView } from '../../sacco-dashboard/components/ElectionsTab';

// Live-ish turnout for the member (RLS hides other voters' rows, so realtime
// can't push it — poll the aggregate RPC instead while voting is open).
const MemberTurnout = ({ election, getElectionTurnout, refreshKey }) => {
  const [turnout, setTurnout] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => getElectionTurnout(election.id)
      .then((t) => { if (alive) setTurnout(t); })
      .catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [election.id, getElectionTurnout, refreshKey]);

  if (!turnout) return null;
  return <TurnoutBar registered={turnout.registered} voted={turnout.voted} quorum={election.quorum_percent} />;
};

const ElectionsTab = ({ ctx }) => {
  const {
    me, members, elections, electionPositions, electionCandidates, myVoterRows,
    nominateCandidate, withdrawCandidacy, castBallot, getElectionTurnout, verifyReceipt,
  } = ctx;
  const toast = useToast();

  const [nominateFor, setNominateFor] = useState(null);   // election being nominated in
  const [nomForm, setNomForm] = useState({ position_id: '', member_id: '', manifesto: '' });
  const [ballotFor, setBallotFor] = useState(null);       // election being voted in
  const [choices, setChoices] = useState({});             // { position_id: candidate_id }
  const [step, setStep] = useState('pick');               // pick → review → receipt
  const [receipt, setReceipt] = useState('');
  const [saving, setSaving] = useState(false);
  const [voteBump, setVoteBump] = useState(0);            // re-poll turnout after casting
  const [verifyFor, setVerifyFor] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);

  const positionsOf = (eid) => electionPositions.filter((p) => p.election_id === eid);
  const candidatesOf = (eid) => electionCandidates.filter((c) => c.election_id === eid);
  const approvedOf = (eid, pid) => candidatesOf(eid).filter((c) => c.position_id === pid && c.status === 'approved');
  const myRegOf = (eid) => myVoterRows.find((r) => r.election_id === eid);
  const myCandidaciesOf = (eid) => candidatesOf(eid).filter((c) => c.member_id === me?.id);

  const visible = elections.filter((e) => e.status !== 'draft');
  const activeMembers = members.filter((m) => m.status === 'active');

  const openNominate = (e) => {
    setNominateFor(e);
    setNomForm({ position_id: positionsOf(e.id)[0]?.id || '', member_id: me?.id || '', manifesto: '' });
  };

  const doNominate = async () => {
    if (!nomForm.position_id || !nomForm.member_id) { toast.error('Pick a position and a member.'); return; }
    setSaving(true);
    try {
      await nominateCandidate({ ...nomForm, election_id: nominateFor.id });
      toast.success(nomForm.member_id === me?.id
        ? 'You are nominated — pending vetting by the sacco admin.'
        : 'Nomination submitted — pending vetting by the sacco admin.');
      setNominateFor(null);
    } catch (err) {
      toast.error(err.message?.includes('duplicate')
        ? 'That member is already a candidate for this position.'
        : (err.message || 'Could not submit the nomination.'));
    } finally { setSaving(false); }
  };

  const doWithdraw = async (c) => {
    try { await withdrawCandidacy(c); toast.success('Candidacy withdrawn.'); }
    catch (err) { toast.error(err.message || 'Could not withdraw.'); }
  };

  const openBallot = (e) => {
    setBallotFor(e);
    setChoices({});
    setStep('pick');
    setReceipt('');
  };

  const selectedCount = Object.values(choices).filter(Boolean).length;

  const doCast = async () => {
    const payload = Object.entries(choices)
      .filter(([, cid]) => cid)
      .map(([pid, cid]) => ({ position_id: pid, candidate_id: cid }));
    if (payload.length === 0) { toast.error('Select at least one candidate.'); return; }
    setSaving(true);
    try {
      const code = await castBallot(ballotFor.id, payload);
      setReceipt(code);
      setStep('receipt');
      setVoteBump((n) => n + 1);
    } catch (err) { toast.error(err.message || 'Could not cast the ballot.'); }
    finally { setSaving(false); }
  };

  const copyReceipt = async () => {
    try { await navigator.clipboard.writeText(receipt); toast.success('Receipt code copied.'); }
    catch (_) { toast.info('Select and copy the code manually.'); }
  };

  const doVerify = async (e) => {
    if (!verifyCode.trim()) return;
    try { setVerifyResult(await verifyReceipt(e.id, verifyCode.trim())); }
    catch (err) { toast.error(err.message || 'Could not verify.'); }
  };

  return (
    <div className="space-y-6">
      <Card
        title="Elections"
        subtitle="Your vote is secret and final — the sacco stores your ballot with no link to your name, and your receipt code proves it was counted"
      >
        {visible.length === 0 ? (
          <EmptyState icon="Award" title="No elections yet" hint="When your sacco opens nominations or voting, it appears here." />
        ) : (
          <div className="space-y-4">
            {visible.map((e) => {
              const reg = myRegOf(e.id);
              const mine = myCandidaciesOf(e.id);
              return (
                <div key={e.id} className="p-4 rounded-xl border border-border">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground">{e.title}</p>
                    <Badge status={e.status} />
                    {e.quorum_percent > 0 && <span className="text-xs text-muted-foreground">Quorum {e.quorum_percent}%</span>}
                  </div>
                  {e.description && <p className="text-sm text-muted-foreground mt-1">{e.description}</p>}

                  {/* My candidacies */}
                  {mine.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {mine.map((c) => {
                        const pos = positionsOf(e.id).find((p) => p.id === c.position_id);
                        const canWithdraw = ['nominations_open', 'nominations_closed'].includes(e.status)
                          && ['pending', 'approved'].includes(c.status);
                        return (
                          <div key={c.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted text-sm">
                            <span className="text-foreground">
                              You are a candidate for <strong>{pos?.title || '—'}</strong> <Badge status={c.status} />
                            </span>
                            {canWithdraw && (
                              <button onClick={() => doWithdraw(c)} className="text-xs text-red-500 font-semibold hover:underline">Withdraw</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Nominations phase */}
                  {e.status === 'nominations_open' && (
                    <div className="mt-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {positionsOf(e.id).map((p) => {
                          const cands = candidatesOf(e.id).filter((c) => c.position_id === p.id && ['pending', 'approved'].includes(c.status));
                          return (
                            <div key={p.id} className="p-3 rounded-lg border border-border">
                              <p className="text-sm font-semibold text-foreground">{p.title}{p.seats > 1 ? ` · ${p.seats} seats` : ''}</p>
                              {cands.length === 0
                                ? <p className="text-xs text-muted-foreground mt-1">No candidates yet — be the first!</p>
                                : (
                                  <ul className="mt-1 space-y-0.5">
                                    {cands.map((c) => (
                                      <li key={c.id} className="text-xs text-muted-foreground">
                                        {c.member?.full_name} {c.status === 'pending' && <span className="text-amber-600">(pending vetting)</span>}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                            </div>
                          );
                        })}
                      </div>
                      <PrimaryButton icon="UserPlus" className="mt-3" onClick={() => openNominate(e)}>
                        Nominate (yourself or a member)
                      </PrimaryButton>
                    </div>
                  )}

                  {e.status === 'nominations_closed' && (
                    <p className="text-sm text-muted-foreground mt-3 flex items-center gap-1.5">
                      <Icon name="Lock" size={13} color="currentColor" />
                      Nominations are closed — voting opens once the candidate list is confirmed.
                    </p>
                  )}

                  {/* Voting phase */}
                  {e.status === 'voting_open' && (
                    <div className="mt-3 space-y-3">
                      <MemberTurnout election={e} getElectionTurnout={getElectionTurnout} refreshKey={voteBump} />
                      {!reg ? (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                          <Icon name="AlertTriangle" size={15} color="#ca8a04" />
                          <p className="text-xs text-amber-800">
                            You are not on the voter register for this election. The register was frozen when
                            voting opened ({fmtDate(e.voting_open_at)}) and only members active at that moment can vote.
                          </p>
                        </div>
                      ) : reg.voted_at ? (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                          <Icon name="CheckCircle2" size={15} color="#059669" />
                          <p className="text-xs text-emerald-800">
                            Ballot cast on {new Date(reg.voted_at).toLocaleString('en-KE')}. Votes are final —
                            use your receipt code below to verify it any time.
                          </p>
                        </div>
                      ) : (
                        <PrimaryButton icon="Vote" onClick={() => openBallot(e)}>Vote now</PrimaryButton>
                      )}
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Icon name="EyeOff" size={11} color="currentColor" />
                        Results stay sealed until voting closes — only turnout is visible now.
                      </p>
                    </div>
                  )}

                  {e.status === 'voting_closed' && (
                    <p className="text-sm text-muted-foreground mt-3 flex items-center gap-1.5">
                      <Icon name="Hourglass" size={13} color="currentColor" />
                      Voting has closed — results are pending publication.
                    </p>
                  )}

                  {/* Results */}
                  {e.status === 'results_published' && e.results && (
                    <div className="mt-3">
                      <ResultsView results={e.results} />
                      <p className="text-xs text-muted-foreground mt-2">
                        Published {fmtDate(e.results_published_at)} · computed automatically from the sealed ballots.
                      </p>
                    </div>
                  )}

                  {/* Receipt verification */}
                  {['voting_open', 'voting_closed', 'results_published'].includes(e.status) && (
                    <div className="mt-3 pt-3 border-t border-border">
                      {verifyFor === e.id ? (
                        <div>
                          <div className="flex items-center gap-2 max-w-md">
                            <TextInput value={verifyCode} onChange={(ev) => setVerifyCode(ev.target.value)} placeholder="Your receipt code" />
                            <GhostButton icon="Search" onClick={() => doVerify(e)}>Verify</GhostButton>
                          </div>
                          {verifyResult && (
                            verifyResult.length === 0 ? (
                              <p className="text-sm text-red-600 mt-2">No ballot found for that code.</p>
                            ) : (
                              <div className="mt-2 space-y-1">
                                {verifyResult.map((r, i) => (
                                  <p key={i} className="text-sm text-foreground flex items-center gap-2">
                                    <Icon name="CheckCircle2" size={14} color="#059669" />
                                    <strong>{r.position_title}</strong> → {r.candidate_name}
                                  </p>
                                ))}
                                <p className="text-xs text-muted-foreground">Your ballot is in the count, recorded exactly as cast.</p>
                              </div>
                            )
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => { setVerifyFor(e.id); setVerifyCode(''); setVerifyResult(null); }}
                          className="text-xs text-primary font-semibold hover:underline flex items-center gap-1"
                        >
                          <Icon name="ShieldCheck" size={12} color="currentColor" /> Verify my ballot receipt
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Nominate modal */}
      <Modal open={!!nominateFor} onClose={() => !saving && setNominateFor(null)} title={nominateFor ? `Nominate · ${nominateFor.title}` : ''}
        footer={<><GhostButton onClick={() => setNominateFor(null)} disabled={saving}>Cancel</GhostButton><PrimaryButton icon="Check" onClick={doNominate} disabled={saving}>{saving ? 'Submitting…' : 'Submit nomination'}</PrimaryButton></>}>
        {nominateFor && (
          <div className="space-y-4">
            <Field label="Position *">
              <Select value={nomForm.position_id} onChange={(e) => setNomForm({ ...nomForm, position_id: e.target.value })}>
                {positionsOf(nominateFor.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </Select>
            </Field>
            <Field label="Who are you nominating? *">
              <Select value={nomForm.member_id} onChange={(e) => setNomForm({ ...nomForm, member_id: e.target.value })}>
                {me && <option value={me.id}>Myself ({me.full_name})</option>}
                {activeMembers.filter((m) => m.id !== me?.id).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </Select>
            </Field>
            <Field label="Manifesto (shown to voters)">
              <TextInput value={nomForm.manifesto} onChange={(e) => setNomForm({ ...nomForm, manifesto: e.target.value })} placeholder="Why this candidate deserves the position" />
            </Field>
            <p className="text-xs text-muted-foreground">
              Nominations are vetted by the sacco admin before appearing on the ballot.
            </p>
          </div>
        )}
      </Modal>

      {/* Ballot modal */}
      <Modal
        open={!!ballotFor}
        onClose={() => { if (!saving && step !== 'receipt') setBallotFor(null); }}
        title={ballotFor ? (step === 'receipt' ? 'Your ballot receipt' : `Ballot · ${ballotFor.title}`) : ''}
        wide
        footer={
          step === 'pick' ? (
            <>
              <GhostButton onClick={() => setBallotFor(null)}>Cancel</GhostButton>
              <PrimaryButton icon="ArrowRight" disabled={selectedCount === 0} onClick={() => setStep('review')}>
                Review ballot ({selectedCount} selection{selectedCount !== 1 ? 's' : ''})
              </PrimaryButton>
            </>
          ) : step === 'review' ? (
            <>
              <GhostButton onClick={() => setStep('pick')} disabled={saving}>Back</GhostButton>
              <PrimaryButton icon="Vote" onClick={doCast} disabled={saving}>
                {saving ? 'Casting…' : 'Confirm & cast my final ballot'}
              </PrimaryButton>
            </>
          ) : (
            <PrimaryButton icon="Check" onClick={() => setBallotFor(null)}>I saved my receipt — done</PrimaryButton>
          )
        }
      >
        {ballotFor && step === 'pick' && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Pick one candidate per position. Leaving a position unselected counts as an abstention for it.
            </p>
            {positionsOf(ballotFor.id).map((p) => (
              <div key={p.id}>
                <p className="text-sm font-semibold text-foreground mb-2">
                  {p.title}{p.seats > 1 ? ` · ${p.seats} seats (you still cast one vote)` : ''}
                </p>
                <div className="space-y-2">
                  {approvedOf(ballotFor.id, p.id).map((c) => {
                    const active = choices[p.id] === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setChoices({ ...choices, [p.id]: active ? '' : c.id })}
                        className={`w-full text-left p-3 rounded-xl border transition-all ${active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${active ? 'border-primary' : 'border-border'}`}
                            style={active ? { background: '#1da8c5' } : {}} />
                          <span className="text-sm font-medium text-foreground">{c.member?.full_name}</span>
                          {c.member?.member_no && <span className="text-xs text-muted-foreground">{c.member.member_no}</span>}
                        </div>
                        {c.manifesto && <p className="text-xs text-muted-foreground mt-1 ml-6 italic">“{c.manifesto}”</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {ballotFor && step === 'review' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
              <Icon name="AlertTriangle" size={15} color="#dc2626" />
              <p className="text-xs text-red-700 leading-relaxed">
                <strong>Votes are final.</strong> Once you confirm, your ballot cannot be changed or withdrawn.
                It is stored anonymously — you will receive a one-time receipt code as the only proof of your choices.
              </p>
            </div>
            <div className="space-y-2">
              {positionsOf(ballotFor.id).map((p) => {
                const cand = candidatesOf(ballotFor.id).find((c) => c.id === choices[p.id]);
                return (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-xl border border-border text-sm">
                    <span className="text-muted-foreground">{p.title}</span>
                    <span className={`font-semibold ${cand ? 'text-foreground' : 'text-muted-foreground italic'}`}>
                      {cand ? cand.member?.full_name : 'Abstain'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {ballotFor && step === 'receipt' && (
          <div className="text-center space-y-4 py-2">
            <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center bg-emerald-100">
              <Icon name="CheckCircle2" size={28} color="#059669" />
            </div>
            <p className="text-sm font-semibold text-foreground">Your ballot has been cast and sealed.</p>
            <div className="p-4 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5">
              <p className="text-xs text-muted-foreground mb-1">Anonymous receipt code — shown only once</p>
              <p className="text-2xl font-bold tracking-widest text-foreground" style={{ fontFamily: 'monospace' }}>{receipt}</p>
              <GhostButton icon="Copy" className="mt-3" onClick={copyReceipt}>Copy code</GhostButton>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
              Save this code somewhere safe. It proves your ballot was counted — exactly as you cast it —
              without revealing who you are. Nobody else, including the sacco admin, can link this code to your name.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ElectionsTab;
