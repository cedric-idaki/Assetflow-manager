import React, { useState, useMemo, useCallback } from 'react';
import { useToast } from '../../../components/Toast';
import Icon from '../../../components/AppIcon';
import {
  Card, StatCard, Badge, EmptyState, PrimaryButton, GhostButton,
  Modal, Field, TextInput, NumberInput, Select, KES, fmtDate, fmtDateTime, Countdown,
} from '../../sacco-dashboard/components/_shared';

/**
 * Loan guarantees — the member's side of the two-step agreement.
 *
 * Guaranteeing a loan pledges YOUR deposits and shares against somebody else's
 * debt, recoverable "without further notice". So accepting is two deliberate
 * acts, not one click:
 *
 *   Step 1  Read the agreement in full and acknowledge it.
 *   Step 2  Separately confirm it, signing your own name.
 *
 * Nothing here is decoration. sacco_loan_guarantee_review() and
 * sacco_loan_guarantee_confirm() enforce the same sequence server-side and
 * refuse a confirmation whose terms hash does not match the one that was
 * reviewed — so if the borrower changes the loan between the two screens, the
 * guarantor is sent back to read the new terms instead of being bound to them.
 *
 * The wording itself comes from the server (sacco_loan_guarantee_terms) and is
 * only displayed here. There is deliberately no second copy of the clauses in
 * JavaScript to drift out of step with the ones that were hashed.
 *
 * The exposure cap works the same way: the server decides whether this member
 * may take this guarantee on and returns the refusal as a sentence
 * (`blocked_reason`). This screen shows it and shuts the door; it never works
 * the limit out for itself, so the portal and the RPCs cannot disagree about
 * who is over.
 */

const REVIEW_WINDOW_MS = 30 * 60 * 1000;   // mirrors the RPC's 30-minute check

const OPEN_STATUSES = ['requested', 'under_review'];

// Is the recorded review still inside the window the server will accept?
const reviewLive = (g) => (
  !!g?.reviewed_at && (Date.now() - new Date(g.reviewed_at).getTime()) < REVIEW_WINDOW_MS
);

const reviewDeadline = (g) => (
  g?.reviewed_at ? new Date(new Date(g.reviewed_at).getTime() + REVIEW_WINDOW_MS).toISOString() : null
);

// Small labelled figure, used across both modals.
const Figure = ({ label, value, tone = 'text-foreground' }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`text-sm font-semibold mt-0.5 ${tone}`}>{value}</p>
  </div>
);

const StepPips = ({ step }) => (
  <div className="flex items-center gap-2">
    {[1, 2].map((n) => (
      <React.Fragment key={n}>
        <span
          className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
            step === n ? 'text-white' : step > n ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
          }`}
          style={step === n ? { background: 'linear-gradient(135deg, #34c1dd, #1da8c5)' } : {}}
        >
          {step > n ? <Icon name="Check" size={12} color="currentColor" /> : n}
        </span>
        {n === 1 && <span className="w-6 h-px bg-border" />}
      </React.Fragment>
    ))}
  </div>
);

// The society's cap, as the server reports it for this agreement. `reason` is
// non-null exactly when sacco_loan_guarantee_review/_confirm would refuse.
const capBlock = (t) => t?.blocked_reason || null;

const capLine = (t, saccoName) => {
  if (!t?.cap?.enforced) return null;
  const mult = parseFloat(t.cap.multiple || 1);
  const basis = t.cap.counts_shares ? 'savings and shares' : 'savings';
  return `${saccoName || 'This sacco'} lets a member guarantee ${
    mult === 1 ? 'up to the value of their own' : `up to ${mult}× their own`
  } ${basis} — ${KES(t.cap.limit)} for you.`;
};

const emptyRequest = { loan_id: '', guarantor_member_id: '', amount: '', notes: '' };

const GuaranteesTab = ({ ctx }) => {
  const {
    me, members, loans, guarantees,
    getGuaranteeTerms, requestGuarantee, reviewGuarantee, confirmGuarantee,
    declineGuarantee, waitOnGuarantee, cancelGuarantee,
  } = ctx;
  const toast = useToast();

  // The acceptance flow: one modal that walks step 1 → step 2.
  const [flow, setFlow] = useState(null);   // { guarantee, terms, step, acknowledged, signature, deadline }
  const [busy, setBusy] = useState(false);
  const [loadingTerms, setLoadingTerms] = useState(false);

  const [declining, setDeclining] = useState(null);  // guarantee awaiting a decline reason
  const [declineReason, setDeclineReason] = useState('');

  const [deferring, setDeferring] = useState(null);  // guarantee awaiting a "not yet" note
  const [waitNote, setWaitNote] = useState('');

  const [requesting, setRequesting] = useState(false);
  const [form, setForm] = useState(emptyRequest);
  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const asGuarantor = useMemo(
    () => guarantees.filter((g) => g.guarantor_member_id === me?.id),
    [guarantees, me?.id],
  );
  const asBorrower = useMemo(
    () => guarantees.filter((g) => g.borrower_member_id === me?.id),
    [guarantees, me?.id],
  );

  // Open requests I have not yet answered at all. One I have deferred is still
  // open and still mine to settle, but I have said where I stand, so it does
  // not count here — this figure is the same set the tab badge counts, and the
  // two must not disagree.
  const waiting = asGuarantor.filter((g) => OPEN_STATUSES.includes(g.status) && !g.waited_at);
  const deferred = asGuarantor.filter((g) => OPEN_STATUSES.includes(g.status) && g.waited_at);
  const committed = asGuarantor.filter((g) => g.status === 'accepted');
  const exposure = committed.reduce((s, g) => s + parseFloat(g.amount_guaranteed || 0), 0);

  /**
   * Open the acceptance flow.
   *
   * `atStep` is a request, not a guarantee: a member who has already reviewed
   * can jump to the confirmation, but only if that review is still live AND
   * the agreement has not moved underneath it. Otherwise they go back to
   * step 1, because the server would refuse the confirmation anyway — better
   * to say so before they type their name than after.
   */
  const openFlow = useCallback(async (g, atStep = 1) => {
    setFlow({ guarantee: g, terms: null, step: atStep, acknowledged: false, signature: '' });
    setLoadingTerms(true);
    try {
      const terms = await getGuaranteeTerms(g.id);
      const stale = atStep === 2 && (!reviewLive(g) || terms?.terms_changed_since_review);
      if (stale) {
        toast.info(terms?.terms_changed_since_review
          ? 'The agreement changed since you read it — please read the new terms.'
          : 'Your reading of these terms has expired — please read them again.');
      }
      setFlow((f) => (f && f.guarantee.id === g.id
        ? { ...f, terms, step: stale ? 1 : atStep, deadline: reviewDeadline(g) }
        : f));
    } catch (e) {
      toast.error(e.message || 'Could not open the agreement.');
      setFlow(null);
    } finally {
      setLoadingTerms(false);
    }
  }, [getGuaranteeTerms, toast]);

  // Step 1 → records that these exact terms were read, then moves to step 2.
  const submitReview = async () => {
    if (!flow?.terms) return;
    setBusy(true);
    try {
      const row = await reviewGuarantee(flow.guarantee.id, flow.terms.hash);
      setFlow((f) => (f ? {
        ...f,
        guarantee: { ...f.guarantee, ...row },
        step: 2,
        deadline: reviewDeadline(row) || reviewDeadline({ reviewed_at: new Date().toISOString() }),
      } : f));
    } catch (e) {
      toast.error(e.message || 'Could not record that you have read the agreement.');
    } finally {
      setBusy(false);
    }
  };

  // Step 2 → the agreement is finalized here and nowhere else.
  const submitConfirm = async () => {
    if (!flow?.terms) return;
    setBusy(true);
    try {
      await confirmGuarantee(flow.guarantee.id, flow.terms.hash, flow.signature);
      toast.success(
        `You are now a guarantor for ${KES(flow.terms.amount_guaranteed)} of ${flow.terms.borrower?.name}'s loan.`,
        'Guarantee confirmed',
      );
      setFlow(null);
    } catch (e) {
      toast.error(e.message || 'Could not confirm the guarantee.');
    } finally {
      setBusy(false);
    }
  };

  const submitDecline = async () => {
    if (!declining) return;
    setBusy(true);
    try {
      await declineGuarantee(declining.id, declineReason);
      toast.success('Request declined.');
      setDeclining(null);
      setDeclineReason('');
      setFlow(null);
    } catch (e) {
      toast.error(e.message || 'Could not decline the request.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * The third answer. It refuses nothing and commits to nothing — the request
   * stays open, any review already recorded stays valid, and the member can
   * come back and confirm or decline whenever they are ready. What it does is
   * tell the borrower they have been heard, and what they are waiting for.
   */
  const submitWait = async () => {
    if (!deferring) return;
    setBusy(true);
    try {
      await waitOnGuarantee(deferring.id, waitNote);
      toast.success(
        `${deferring.borrower?.full_name || 'The borrower'} has been told you need more time.`,
        'Answer sent',
      );
      setDeferring(null);
      setWaitNote('');
    } catch (e) {
      toast.error(e.message || 'Could not send your answer.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (g) => {
    try {
      await cancelGuarantee(g.id);
      toast.success('Request withdrawn.');
    } catch (e) {
      toast.error(e.message || 'Could not withdraw the request.');
    }
  };

  // ── Borrower: ask somebody to guarantee ────────────────────────────────────
  const guaranteeableLoans = loans.filter((l) => !['closed', 'rejected'].includes(l.status));
  const candidates = members.filter((m) => m.id !== me?.id && m.status === 'active');

  const submitRequest = async () => {
    if (!form.loan_id) { toast.error('Choose the loan.'); return; }
    if (!form.guarantor_member_id) { toast.error('Choose the member you are asking.'); return; }
    if (!(parseFloat(form.amount) > 0)) { toast.error('Enter the amount to be guaranteed.'); return; }
    setBusy(true);
    try {
      // `emailed` is reported rather than assumed: the request and the in-app
      // notification are already saved either way, and a borrower who thinks
      // an email went out when it did not will sit waiting for an answer that
      // nobody knows they owe.
      const { emailed } = (await requestGuarantee(form)) || {};
      toast.success(
        emailed
          ? 'Request sent — they have been emailed and it is waiting in their portal.'
          : 'Request sent — it is waiting in their portal. We could not email them, so tell them to look.',
        'Guarantor requested',
      );
      setRequesting(false);
      setForm(emptyRequest);
    } catch (e) {
      toast.error(e.message || 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  const t = flow?.terms;
  const nameHint = t?.guarantor?.name || me?.full_name || '';
  // What this member would stand behind in total if they confirmed this one.
  const committedAfter = parseFloat(t?.capacity?.already_committed || 0)
    + parseFloat(t?.amount_guaranteed || 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Awaiting your answer" value={waiting.length} icon="ShieldQuestion" tone="warning"
          hint={deferred.length ? `${deferred.length} more you asked for time on` : undefined}
        />
        <StatCard label="Loans you guarantee" value={committed.length} icon="ShieldCheck" tone="success" />
        <StatCard label="Your total exposure" value={KES(exposure)} icon="TrendingDown" tone="primary" />
        <StatCard
          label="Guarantors on your loans"
          value={asBorrower.filter((g) => g.status === 'accepted').length}
          icon="Users" tone="muted"
        />
      </div>

      {/* ── Requests addressed to me ──────────────────────────────────────── */}
      <Card
        title="Requests for you"
        subtitle="Members asking you to stand behind their loan — read the agreement, then confirm it"
      >
        {asGuarantor.length === 0 ? (
          <EmptyState
            icon="ShieldQuestion" title="Nobody has asked you to guarantee a loan"
            hint="When a fellow member names you as a guarantor, the agreement appears here for you to read and confirm."
          />
        ) : (
          <div className="space-y-3">
            {asGuarantor.map((g) => {
              const open = OPEN_STATUSES.includes(g.status);
              const read = g.status === 'under_review';
              const live = reviewLive(g);
              return (
                <div key={g.id} className="border border-border rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {KES(g.amount_guaranteed)} of {g.borrower?.full_name || 'a member'}&apos;s loan
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {g.ref_no} · loan of {KES(g.loan?.principal)} over {g.loan?.term_months} months
                        {g.borrower?.member_no ? ` · ${g.borrower.member_no}` : ''}
                        {' · asked '}{fmtDate(g.created_at)}
                      </p>
                      {g.notes && <p className="text-xs text-muted-foreground mt-1 italic">“{g.notes}”</p>}
                    </div>
                    <Badge status={g.status} />
                  </div>

                  {/* Where this one stands in the two steps */}
                  {read && (
                    <div className={`flex flex-wrap items-center gap-2 p-2.5 rounded-lg border text-xs ${
                      live ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-amber-50 border-amber-200 text-amber-700'
                    }`}>
                      <Icon name={live ? 'FileCheck' : 'TimerOff'} size={14} color="currentColor" />
                      {live ? (
                        <span>
                          <strong>Step 1 done</strong> — you read the terms on {fmtDateTime(g.reviewed_at)}.
                          Confirm within <Countdown targetIso={reviewDeadline(g)} endedLabel="0s" /> or read them again.
                        </span>
                      ) : (
                        <span>
                          <strong>Your reading has expired</strong> — you read these terms on {fmtDateTime(g.reviewed_at)}.
                          Read them again before confirming.
                        </span>
                      )}
                    </div>
                  )}
                  {g.status === 'accepted' && (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                      <Icon name="ShieldCheck" size={14} color="#059669" />
                      <p className="text-xs text-emerald-700">
                        Confirmed on {fmtDateTime(g.accepted_at)}, signed as <strong>{g.signature_name}</strong>.
                        This guarantee is final and is released when the loan is repaid in full.
                      </p>
                    </div>
                  )}
                  {g.status === 'declined' && g.decline_reason && (
                    <p className="text-xs text-muted-foreground">You declined: “{g.decline_reason}”</p>
                  )}

                  {/* "Not yet" — shown while the request is still open and the
                      member has not moved past it. Once they have opened the
                      agreement, the step-1 panel above is the live state and
                      says more; two panels about the same request would just
                      compete. The deferral is still in the event history. */}
                  {open && g.waited_at && !read && (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-sky-50 border border-sky-200">
                      <Icon name="Clock" size={14} color="#0369a1" />
                      <p className="text-xs text-sky-700">
                        You asked for more time on {fmtDateTime(g.waited_at)}.
                        {g.wait_note ? <> You said: “{g.wait_note}”</> : null}
                        {' '}This request is still open — answer it whenever you are ready.
                      </p>
                    </div>
                  )}

                  {open && (
                    <div className="flex flex-wrap items-center gap-2">
                      {read && live ? (
                        <>
                          <PrimaryButton icon="PenLine" onClick={() => openFlow(g, 2)}>
                            Confirm the guarantee
                          </PrimaryButton>
                          <GhostButton icon="BookOpen" onClick={() => openFlow(g, 1)}>Read again</GhostButton>
                        </>
                      ) : (
                        <PrimaryButton icon="BookOpen" onClick={() => openFlow(g, 1)}>
                          {read ? 'Read the agreement again' : 'Read the agreement'}
                        </PrimaryButton>
                      )}
                      <GhostButton
                        icon="Clock"
                        onClick={() => { setDeferring(g); setWaitNote(g.wait_note || ''); }}
                      >
                        {g.waited_at ? 'Update your note' : 'Not yet'}
                      </GhostButton>
                      <GhostButton icon="X" onClick={() => { setDeclining(g); setDeclineReason(''); }}>
                        Decline
                      </GhostButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── My own loans' guarantors ──────────────────────────────────────── */}
      <Card
        title="Guarantors on your loans"
        subtitle="Who you have asked, and where each agreement has reached"
        actions={
          <PrimaryButton icon="UserPlus" onClick={() => setRequesting(true)} disabled={guaranteeableLoans.length === 0}>
            Request a guarantor
          </PrimaryButton>
        }
      >
        {asBorrower.length === 0 ? (
          <EmptyState
            icon="Users" title="You have not asked anyone yet"
            hint={guaranteeableLoans.length === 0
              ? 'Apply for a loan first — guarantors are requested against a specific loan.'
              : 'Ask a fellow member to guarantee part of your loan. They read the agreement and confirm it in their own portal.'}
          />
        ) : (
          <div className="space-y-3">
            {asBorrower.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center justify-between gap-3 border border-border rounded-xl p-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {g.guarantor?.full_name || 'Member'} · {KES(g.amount_guaranteed)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {g.ref_no} · loan of {KES(g.loan?.principal)} · asked {fmtDate(g.created_at)}
                    {g.status === 'under_review' && ' · they are reading the agreement'}
                    {g.status === 'accepted' && ` · confirmed ${fmtDate(g.accepted_at)}`}
                    {g.status === 'declined' && g.decline_reason ? ` · “${g.decline_reason}”` : ''}
                  </p>
                  {/* An unanswered request and one the member has deferred look
                      identical without this — and they are not the same thing.
                      Only while still 'requested': once they are reading the
                      agreement the line above says so, which is newer news. */}
                  {g.status === 'requested' && g.waited_at && (
                    <p className="text-xs text-sky-700 mt-1">
                      <Icon name="Clock" size={11} color="currentColor" className="inline align-[-1px] mr-1" />
                      Asked for more time on {fmtDate(g.waited_at)}
                      {g.wait_note ? <> — “{g.wait_note}”</> : null}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge status={g.status} />
                  {OPEN_STATUSES.includes(g.status) && (
                    <GhostButton icon="Undo2" onClick={() => withdraw(g)}>Withdraw</GhostButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ══ THE TWO-STEP FLOW ══════════════════════════════════════════════ */}
      <Modal
        open={!!flow} onClose={() => setFlow(null)} wide
        title={flow?.step === 2 ? 'Step 2 of 2 · Confirm the guarantee' : 'Step 1 of 2 · Read the agreement'}
        footer={flow?.step === 2 ? (
          <>
            <GhostButton icon="ArrowLeft" onClick={() => setFlow((f) => ({ ...f, step: 1 }))}>
              Back to the terms
            </GhostButton>
            <PrimaryButton
              icon="ShieldCheck" onClick={submitConfirm}
              disabled={busy || !flow?.signature?.trim() || !!capBlock(t)}
            >
              {busy ? 'Confirming…' : 'Confirm — this is final'}
            </PrimaryButton>
          </>
        ) : (
          <>
            {/* Answering from inside the terms closes them: each answer's modal
                stands on its own rather than stacking on the agreement.
                "Not yet" belongs here as much as on the card — having just read
                what they are being asked for is exactly when a member decides
                they need to think about it. */}
            <GhostButton
              icon="X"
              onClick={() => { setDeclining(flow?.guarantee); setDeclineReason(''); setFlow(null); }}
            >
              Decline
            </GhostButton>
            <GhostButton
              icon="Clock"
              onClick={() => {
                setDeferring(flow?.guarantee);
                setWaitNote(flow?.guarantee?.wait_note || '');
                setFlow(null);
              }}
            >
              Not yet
            </GhostButton>
            <PrimaryButton
              icon="ArrowRight" onClick={submitReview}
              disabled={busy || loadingTerms || !flow?.acknowledged || !t || !!capBlock(t)}
            >
              {busy ? 'Saving…' : 'I have read this — continue'}
            </PrimaryButton>
          </>
        )}
      >
        {loadingTerms && <p className="text-sm text-muted-foreground py-6 text-center">Loading the agreement…</p>}

        {t && flow?.step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <StepPips step={1} />
              <span className="text-xs text-muted-foreground">{t.ref_no} · terms {t.version}</span>
            </div>

            {t.terms_changed_since_review && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <Icon name="AlertTriangle" size={15} color="#ca8a04" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  <strong>These terms have changed</strong> since you last read them. Your earlier reading no
                  longer counts — read the agreement as it now stands before confirming.
                </p>
              </div>
            )}

            {/* What is being asked */}
            <div className="p-4 rounded-xl border border-border bg-muted/40 space-y-4">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">You are being asked to guarantee</p>
                <p className="text-2xl font-bold text-foreground mt-1">{KES(t.amount_guaranteed)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  of {t.borrower?.name}&apos;s loan ({t.loan?.ref})
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border">
                <Figure label="Loan amount" value={KES(t.loan?.principal)} />
                <Figure label="Interest" value={`${t.loan?.rate}% p.a.`} />
                <Figure label="Term" value={`${t.loan?.term_months} months`} />
                <Figure label="Purpose" value={t.loan?.purpose || '—'} />
              </div>
            </div>

            {/* What actually stands behind the promise, and the society's cap */}
            <div className="p-4 rounded-xl border border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                What this commits, and what backs it
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Figure label="Your savings" value={KES(t.capacity?.deposits)} />
                <Figure
                  label={t.cap && t.cap.counts_shares === false ? 'Your shares (not counted)' : 'Your shares'}
                  value={KES(t.capacity?.share_value)}
                  tone={t.cap && t.cap.counts_shares === false ? 'text-muted-foreground' : 'text-foreground'}
                />
                <Figure label="Already guaranteed" value={KES(t.capacity?.already_committed)} />
                <Figure
                  label="This would take you to"
                  value={KES(committedAfter)}
                  tone={capBlock(t) ? 'text-red-600' : 'text-foreground'}
                />
              </div>
              {t.cap?.enforced && (
                <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{capLine(t, t.sacco_name)}</p>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                    parseFloat(t.cap.headroom || 0) > 0
                      ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  }`}
                  >
                    <Icon name="Gauge" size={12} color="currentColor" />
                    {KES(t.cap.headroom)} left to give
                  </span>
                </div>
              )}
            </div>

            {/* The gate. The sentence is the server's, not this screen's. */}
            {capBlock(t) && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                <Icon name="ShieldAlert" size={15} color="#dc2626" />
                <div>
                  <p className="text-xs font-semibold text-red-700">
                    You cannot take this guarantee on
                  </p>
                  <p className="text-xs text-red-700 leading-relaxed mt-0.5">{capBlock(t)}</p>
                  <p className="text-xs text-red-700/80 leading-relaxed mt-1">
                    Save more, or wait until one of your guarantees is released. You can still read the
                    agreement, and you can decline the request so {t.borrower?.name} can ask someone else.
                  </p>
                </div>
              </div>
            )}

            {/* The agreement itself, verbatim from the server */}
            <div className="rounded-xl border border-border divide-y divide-border">
              {(t.clauses || []).map((c, i) => (
                <div key={c.heading || i} className="p-4">
                  <p className="text-xs font-semibold text-foreground">{c.heading}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1">{c.body}</p>
                </div>
              ))}
            </div>

            {!capBlock(t) && (
              <>
                <label className="flex items-start gap-2.5 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50">
                  <input
                    type="checkbox"
                    checked={!!flow.acknowledged}
                    onChange={(e) => setFlow((f) => ({ ...f, acknowledged: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span className="text-xs text-foreground leading-relaxed">
                    I have read the agreement above in full, and I understand that my own deposits, shares and
                    future contributions can be used to repay this loan if {t.borrower?.name} does not.
                  </span>
                </label>

                <p className="text-xs text-muted-foreground">
                  Continuing records that you have read these exact terms. You are <strong>not</strong> a
                  guarantor yet — the agreement is finalized only when you confirm it on the next step.
                </p>
              </>
            )}
          </div>
        )}

        {t && flow?.step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <StepPips step={2} />
              <span className="text-xs text-muted-foreground">{t.ref_no} · terms {t.version}</span>
            </div>

            {/* Between reading and signing, this member's position can move —
                another guarantee confirmed elsewhere, a contribution reversed.
                The server re-checks the cap on confirm, so say so here rather
                than letting them type their name into a refusal. */}
            {capBlock(t) ? (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                <Icon name="ShieldAlert" size={15} color="#dc2626" />
                <div>
                  <p className="text-xs font-semibold text-red-700">
                    Your position has changed — this can no longer be confirmed
                  </p>
                  <p className="text-xs text-red-700 leading-relaxed mt-0.5">{capBlock(t)}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                <Icon name="AlertTriangle" size={15} color="#dc2626" />
                <p className="text-xs text-red-700 leading-relaxed">
                  <strong>A confirmed guarantee is final.</strong> You cannot withdraw it. It stands until the
                  loan is repaid in full, or the sacco accepts a substitute guarantor.
                </p>
              </div>
            )}

            <div className="p-4 rounded-xl border border-border text-center space-y-1">
              <p className="text-xs text-muted-foreground">You are confirming a guarantee of</p>
              <p className="text-2xl font-bold text-foreground">{KES(t.amount_guaranteed)}</p>
              <p className="text-xs text-muted-foreground">
                on {t.borrower?.name}&apos;s loan {t.loan?.ref} — {KES(t.loan?.principal)} over {t.loan?.term_months} months
              </p>
            </div>

            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border border-border">
              <Icon name="FileCheck" size={14} color="#1da8c5" />
              <p className="text-xs text-muted-foreground">
                You read terms <strong>{t.version}</strong> just now.
                {flow.deadline && (
                  <> This confirmation is open for <Countdown targetIso={flow.deadline} endedLabel="no longer — read them again" />.</>
                )}
              </p>
            </div>

            <Field label="Sign by typing your full name *">
              <TextInput
                value={flow.signature}
                onChange={(e) => setFlow((f) => ({ ...f, signature: e.target.value }))}
                placeholder={nameHint}
                autoComplete="off"
              />
            </Field>
            <p className="text-xs text-muted-foreground -mt-2">
              Exactly as the sacco holds it: <strong>{nameHint}</strong>
            </p>
          </div>
        )}
      </Modal>

      {/* Decline */}
      <Modal
        open={!!declining} onClose={() => setDeclining(null)}
        title="Decline this request"
        footer={<>
          <GhostButton onClick={() => setDeclining(null)}>Keep it open</GhostButton>
          <PrimaryButton icon="X" onClick={submitDecline} disabled={busy}>
            {busy ? 'Declining…' : 'Decline the request'}
          </PrimaryButton>
        </>}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {declining?.borrower?.full_name || 'The borrower'} will see that you have declined. You are not
            bound by anything, and they can ask someone else.
          </p>
          <Field label="Reason (optional — the borrower will see it)">
            <textarea
              value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
              placeholder="I am already guaranteeing two other loans."
            />
          </Field>
        </div>
      </Modal>

      {/* Not yet — the answer between yes and no */}
      <Modal
        open={!!deferring} onClose={() => setDeferring(null)}
        title={deferring?.waited_at ? 'Update your answer' : 'Ask for more time'}
        footer={<>
          <GhostButton onClick={() => setDeferring(null)}>Cancel</GhostButton>
          <PrimaryButton icon="Clock" onClick={submitWait} disabled={busy}>
            {busy ? 'Sending…' : 'Send this answer'}
          </PrimaryButton>
        </>}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {deferring?.borrower?.full_name || 'The borrower'} will see that you need more time before you
            decide. You are <strong>not</strong> agreeing to anything and you are not refusing — the request
            stays open, and you can confirm or decline it whenever you are ready.
          </p>
          <Field label="What are you waiting for? (optional — the borrower will see it)">
            <textarea
              value={waitNote} onChange={(e) => setWaitNote(e.target.value)} rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
              placeholder="Ask me again after the 5th, once my salary is in."
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            A note is worth more than the delay on its own: without one, the borrower only learns that you
            have not decided, not when it would be worth asking again.
          </p>
        </div>
      </Modal>

      {/* Borrower: request a guarantor */}
      <Modal
        open={requesting} onClose={() => setRequesting(false)}
        title="Request a guarantor"
        footer={<>
          <GhostButton onClick={() => setRequesting(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Send" onClick={submitRequest} disabled={busy}>
            {busy ? 'Sending…' : 'Send the request'}
          </PrimaryButton>
        </>}
      >
        <div className="space-y-4">
          <Field label="Which loan *">
            <Select value={form.loan_id} onChange={(e) => setF('loan_id', e.target.value)}>
              <option value="">Select a loan…</option>
              {guaranteeableLoans.map((l) => (
                <option key={l.id} value={l.id}>
                  LN-{l.id.slice(0, 8).toUpperCase()} — {KES(l.principal)} ({l.status})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Who are you asking *">
            <Select value={form.guarantor_member_id} onChange={(e) => setF('guarantor_member_id', e.target.value)}>
              <option value="">Select a member…</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name}{m.member_no ? ` · ${m.member_no}` : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="Amount they would guarantee (KES) *">
            <NumberInput value={form.amount} onChange={(e) => setF('amount', e.target.value)} placeholder="25000" />
          </Field>
          <Field label="Message (optional)">
            <textarea
              value={form.notes} onChange={(e) => setF('notes', e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
              placeholder="Asking you to cover half of my school-fees loan."
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            They are notified in their portal and by email, and can answer <strong>yes</strong>,
            <strong> no</strong>, or <strong>not yet</strong> if they need more time. A yes means reading the
            full agreement and then confirming it separately — nothing binds them until they have done both.
          </p>
        </div>
      </Modal>
    </div>
  );
};

export default GuaranteesTab;
