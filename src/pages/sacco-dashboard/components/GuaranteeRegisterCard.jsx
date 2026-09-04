import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../components/Toast';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import SigningStatusChip from '../../../components/signing/SigningStatusChip';
import SendForSignatureModal from '../../../components/signing/SendForSignatureModal';
import SigningRequestDrawer from '../../../components/signing/SigningRequestDrawer';
import {
  guaranteeSigningStates, guaranteeSigningBlock, openSignedCertificate,
} from '../../../utils/signnowClient';
import { GUARANTOR_ROLE } from '../../../utils/certificateSigning';
import { buildGuaranteeAgreementPdf } from '../../../utils/certificatePdf';
import {
  Card, Badge, EmptyState, PrimaryButton, GhostButton, KES, fmtDate,
} from './_shared';

/**
 * The guarantee register, and the desk that gets each agreement executed.
 *
 * WHAT THIS CARD IS FOR
 * ---------------------
 * A member confirming a guarantee in their portal is a strong record of intent
 * — the wording was hashed, the review was fresh, the name matched the roll.
 * It is still only a row in our own database. When the society comes to recover
 * from a guarantor, what it needs to put in front of a bank, an auditor or an
 * advocate is a document the guarantor signed somewhere we did not control.
 * That is what sending it through SignNow produces, and this is where an
 * officer does it.
 *
 * WHY SENDING IS CHECKED SERVER-SIDE ON THE CLICK
 * -----------------------------------------------
 * Two of the three reasons an agreement cannot be sent are visible here —
 * it is not confirmed, or it has already been executed. The third is not: the
 * loan may have been edited since the guarantor confirmed, in which case the
 * agreement they accepted can no longer be reproduced and must not go out under
 * their name. Only the database can answer that, so
 * sacco_guarantee_signing_block() is asked at the moment of sending and its
 * sentence is shown verbatim. signing_request_open() applies the identical
 * check, so this screen cannot talk the server into anything.
 */

/** Which guarantees are worth looking at, and in what order an officer wants them. */
const FILTERS = [
  { key: 'confirmed', label: 'Confirmed', match: (g) => g.status === 'accepted' },
  { key: 'open', label: 'Awaiting an answer', match: (g) => ['requested', 'under_review'].includes(g.status) },
  { key: 'all', label: 'All', match: () => true },
];

const GuaranteeRegisterCard = ({ ctx }) => {
  const { sacco, guarantees = [], refreshGuarantees } = ctx;
  const toast = useToast();

  const [filter, setFilter] = useState('confirmed');
  const [signing, setSigning] = useState({});      // guarantee id → execution state
  // Whether that read actually answered. A society whose signing migration is
  // not applied is NOT a society that has chosen not to require signatures,
  // and the footnote below must not claim it is.
  const [signingKnown, setSigningKnown] = useState(false);
  const [sendFor, setSendFor] = useState(null);    // the guarantee being sent
  const [checking, setChecking] = useState(null);  // id whose block is being read
  const [blocked, setBlocked] = useState(null);    // { id, reason }
  const [drawerId, setDrawerId] = useState(null);

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[2];
    return guarantees.filter(f.match);
  }, [guarantees, filter]);

  // One call for the whole page, not one per row — the same reason
  // signing_status_for() exists. Keyed on the ids actually on screen.
  const ids = useMemo(() => rows.map((g) => g.id), [rows]);
  const idKey = ids.join(',');

  const refreshSigning = useCallback(async () => {
    if (ids.length === 0) { setSigning({}); return; }
    try {
      setSigning(await guaranteeSigningStates(ids));
      setSigningKnown(true);
    } catch (_) {
      // A society whose signing migration is not applied yet. Nothing to show,
      // and nothing to claim either.
      setSigningKnown(false);
    }
  // ids is rebuilt every render; idKey is what actually changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  useEffect(() => { refreshSigning(); }, [refreshSigning]);

  const requiredHere = Object.values(signing).some((s) => s?.required);

  /**
   * Ask the server whether this one may go, then open the panel.
   *
   * The refusal is displayed rather than thrown: an officer looking at a
   * guarantee that cannot be executed needs the reason next to the row, not in
   * a toast that has already gone.
   */
  const startSend = async (g) => {
    setBlocked(null);
    setChecking(g.id);
    try {
      const reason = await guaranteeSigningBlock(g.id);
      if (reason) { setBlocked({ id: g.id, reason }); return; }
      setSendFor(g);
    } catch (e) {
      toast.error(e.message || 'Could not check this agreement.');
    } finally {
      setChecking(null);
    }
  };

  /**
   * Draw the agreement.
   *
   * The wording is fetched from sacco_loan_guarantee_terms() at build time and
   * rendered as it comes back — the server is the only author of the clauses,
   * exactly as it is in the member portal. The gate above has already
   * established that what it returns still hashes to what the guarantor
   * confirmed.
   */
  const buildFor = (g) => async ({ serial, signers }) => {
    const { data: terms, error } = await supabase.rpc('sacco_loan_guarantee_terms', {
      p_guarantee_id: g.id,
    });
    if (error) throw new Error(error.message || 'The agreement could not be read.');

    return buildGuaranteeAgreementPdf({
      terms,
      saccoName: sacco?.name,
      signatureName: g.signature_name,
      serial,
      signers,
      draft: true,
    });
  };

  const openExecuted = async (state) => {
    const opened = await openSignedCertificate(state.signedPath);
    if (!opened) toast.error('Allow pop-ups for this site to open the executed agreement.');
  };

  const afterChange = async () => {
    await Promise.all([refreshSigning(), refreshGuarantees?.()]);
  };

  return (
    <Card
      title="Guarantees"
      subtitle="Who is standing behind whose borrowing, and whether the agreement has been executed"
      actions={
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                filter === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon="ShieldCheck"
          title={filter === 'confirmed' ? 'No confirmed guarantees' : 'Nothing here yet'}
          hint="Members nominate each other from their own portal. A guarantee appears here as soon as it is requested, and becomes executable once the guarantor confirms it."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((g) => {
            const state = signing[g.id];
            const executed = state?.status === 'released';
            const inFlight = ['draft', 'sent', 'viewed', 'signed'].includes(state?.status);
            const sendable = g.status === 'accepted' && !executed;

            return (
              <div key={g.id} className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {g.guarantor?.full_name || 'Member'} guarantees {KES(g.amount_guaranteed)}
                      {' of '}{g.borrower?.full_name || 'a member'}&apos;s loan
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {g.ref_no} · loan of {KES(g.loan?.principal)}
                      {g.loan?.term_months ? ` over ${g.loan.term_months} months` : ''}
                      {' · asked '}{fmtDate(g.created_at)}
                      {g.status === 'accepted' && g.accepted_at
                        ? ` · confirmed ${fmtDate(g.accepted_at)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge status={g.status} />
                    {/* Only meaningful once the agreement is final: nothing is
                        sendable before that, so a chip on an open request would
                        say "Needs signing" about a document that does not exist. */}
                    {g.status === 'accepted' && (
                      <SigningStatusChip
                        request={state?.status ? state : null}
                        requireSignature={!!state?.required}
                      />
                    )}
                  </div>
                </div>

                {blocked?.id === g.id && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                    <Icon name="AlertTriangle" size={14} color="#b45309" />
                    <p className="text-xs text-amber-900">{blocked.reason}</p>
                  </div>
                )}

                {executed && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                    <Icon name="FileCheck" size={14} color="#059669" />
                    <p className="text-xs text-emerald-700">
                      Executed on {fmtDate(state.releasedAt)} and stored as the agreement of record.
                      Both members can open it from their own portal.
                    </p>
                  </div>
                )}

                {sendable && (
                  <div className="flex flex-wrap items-center gap-2">
                    {inFlight ? (
                      <GhostButton icon="Send" onClick={() => setDrawerId(state.requestId)}>
                        Track the signature
                      </GhostButton>
                    ) : (
                      <PrimaryButton
                        icon={checking === g.id ? 'Loader2' : 'PenLine'}
                        disabled={checking === g.id}
                        onClick={() => startSend(g)}
                      >
                        {checking === g.id ? 'Checking…' : 'Send for e-signature'}
                      </PrimaryButton>
                    )}
                    {state?.requestId && !inFlight && (
                      <GhostButton icon="History" onClick={() => setDrawerId(state.requestId)}>
                        Signing history
                      </GhostButton>
                    )}
                  </div>
                )}

                {executed && (
                  <div className="flex flex-wrap items-center gap-2">
                    <PrimaryButton icon="Download" onClick={() => openExecuted(state)}>
                      Open the executed agreement
                    </PrimaryButton>
                    <GhostButton icon="History" onClick={() => setDrawerId(state.requestId)}>
                      Signing history
                    </GhostButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {signingKnown && !requiredHere && rows.some((g) => g.status === 'accepted') && (
        <p className="text-xs text-muted-foreground mt-4">
          Guarantee agreements are not required to be signed for this society. Turn that on under
          e-signature → SignNow to stop treating a portal confirmation as the final word.
        </p>
      )}

      <SendForSignatureModal
        open={!!sendFor}
        onClose={() => setSendFor(null)}
        onSent={afterChange}
        docKind="guarantee_agreement"
        sourceTable="sacco_loan_guarantees"
        sourceId={sendFor?.id}
        documentName={sendFor ? `Guarantee Agreement ${sendFor.ref_no || ''}`.trim() : ''}
        build={sendFor ? buildFor(sendFor) : undefined}
        intro={(
          <>
            The guarantor signs their own undertaking and your officer countersigns it. The
            agreement is <strong>not executed</strong> until both have signed — any copy printed
            before then carries a DRAFT watermark.
          </>
        )}
        // The person bound by a guarantee is the only person who can sign it,
        // so their row is filled from the member register and locked.
        pinnedSigners={sendFor ? [{
          role: GUARANTOR_ROLE,
          name: sendFor.guarantor?.full_name || '',
          email: sendFor.guarantor?.email || '',
          order: 1,
          required: true,
        }] : []}
      />

      <SigningRequestDrawer
        open={!!drawerId}
        requestId={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={afterChange}
      />
    </Card>
  );
};

export default GuaranteeRegisterCard;
