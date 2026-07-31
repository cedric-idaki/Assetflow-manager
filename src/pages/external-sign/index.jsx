import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/AppIcon";
import SignatureCanvas from "../../components/esign/SignatureCanvas";
import FieldFiller from "../../components/esign/FieldFiller";
import { detectSignableAreas } from "../../utils/detectSignableAreas";

// Invoke the esign-public edge function, surfacing the server's JSON error.
async function callEsignPublic(body) {
  const { data, error } = await supabase.functions.invoke("esign-public", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg || "Request failed");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── Sealing overlay — the "scan": the document is verified, stamped and sealed
// with a visible scanning pass while the server burns the signature in. ───────
const SEAL_STEPS = [
  "Verifying your code",
  "Applying your signature to the document",
  "Stamping every page",
  "Sealing & certifying",
];

function SealingOverlay({ step }) {
  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
      <style>{`
        @keyframes esignScan { 0% { top: -8%; } 100% { top: 104%; } }
        .esign-scan-beam { animation: esignScan 1.6s ease-in-out infinite alternate; }
        @keyframes esignPulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
        .esign-pulse { animation: esignPulse 1.2s ease-in-out infinite; }
      `}</style>
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6">
        {/* Mini document being scanned */}
        <div className="relative w-28 h-36 mx-auto bg-white rounded-md border border-slate-200 shadow-inner overflow-hidden">
          <div className="p-3 space-y-1.5">
            {[...Array(7)].map((_, i) => (
              <div key={i} className="h-1.5 rounded bg-slate-200" style={{ width: `${[90, 75, 85, 60, 80, 45, 70][i]}%` }} />
            ))}
            <div className="pt-2">
              <div className="h-4 w-16 rounded-sm border-b-2 border-blue-700"
                style={{ background: "repeating-linear-gradient(105deg, transparent, transparent 2px, rgba(29,78,216,0.5) 3px, transparent 5px)" }} />
            </div>
          </div>
          <div className="esign-scan-beam absolute left-0 right-0 h-8 pointer-events-none"
            style={{ background: "linear-gradient(to bottom, transparent, rgba(16,185,129,0.35), rgba(16,185,129,0.75), rgba(16,185,129,0.35), transparent)" }} />
        </div>
        <div className="mt-5 space-y-2.5">
          {SEAL_STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2.5">
              {i < step ? (
                <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <Icon name="Check" size={12} color="#059669" />
                </span>
              ) : i === step ? (
                <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin flex-shrink-0" />
              ) : (
                <span className="w-5 h-5 rounded-full border border-border flex-shrink-0" />
              )}
              <span className={`text-xs ${i < step ? "text-muted-foreground line-through decoration-emerald-400/60" : i === step ? "text-foreground font-semibold esign-pulse" : "text-muted-foreground/60"}`}>
                {label}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-center text-muted-foreground">Don't close this window — this takes a few seconds.</p>
      </div>
    </div>
  );
}

export default function ExternalSignPage({ embedded = false }) {
  const { token } = useParams();
  const [status, setStatus]   = useState("loading"); // loading | ready | signing | done | error
  const [doc, setDoc]         = useState(null);
  const [signer, setSigner]   = useState(null);
  const [dbFields, setDbFields] = useState([]);     // fields the sender placed
  const [adhocFields, setAdhocFields] = useState([]); // auto-detected / tap-anywhere areas
  const [otp, setOtp]         = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [pendingVals, setPendingVals] = useState(null); // filled field values awaiting OTP
  const [submitting, setSubmitting] = useState(false);
  const [sealStep, setSealStep] = useState(null);       // sealing overlay progress
  const [completed, setCompleted]   = useState(false);
  const [error, setError]     = useState("");
  const [consent, setConsent] = useState(false);        // "I agree to sign electronically"
  const [consentText, setConsentText] = useState("I agree to conduct business electronically and to sign this document electronically.");
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [phoneHint, setPhoneHint] = useState(null);
  const [waitingOn, setWaitingOn] = useState(null);     // earlier sequential signer still pending
  const [sentChannel, setSentChannel] = useState(null); // where the last OTP actually went
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const [declined, setDeclined] = useState(false);
  const sealTimer = useRef(null);

  const device = navigator.userAgent.slice(0, 80);
  const isPdf = !!doc?.file_url && /\.pdf(\?|$)/i.test(doc.file_url);
  const effFields = dbFields.length ? dbFields : adhocFields;
  // PDFs always sign directly on the document — even with zero pre-placed
  // fields the signer can tap anywhere and sign there.
  const useFields = isPdf;

  // ── Embedded mode: notify the host app of every lifecycle event ─────────────
  const emitEmbed = useCallback((event, payload = {}) => {
    if (!embedded) return;
    try { window.parent?.postMessage({ source: "ararat-esign", event, ...payload }, "*"); } catch { /* ignore */ }
  }, [embedded]);

  // 1) Validate the link and load the document + assigned fields. If the
  // sender placed no fields, auto-detect the document's own signature areas
  // (ruled lines, "Authorised Signatory"/"Date" labels, {{tags}}) so the
  // signer signs directly on the document — no separate steps or tabs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await callEsignPublic({ action: "lookup", token, device });
        if (cancelled) return;
        setDoc(res.document); setSigner(res.signer);
        setSmsAvailable(!!res.sms_available);
        setPhoneHint(res.phone_hint || null);
        setWaitingOn(res.waiting_on || null);
        if (res.consent_text) setConsentText(res.consent_text);
        const assigned = res.fields || [];
        setDbFields(assigned);
        if (!assigned.length && res.document?.file_url && /\.pdf(\?|$)/i.test(res.document.file_url)) {
          try {
            const det = await detectSignableAreas(res.document.file_url);
            if (!cancelled && det.length) {
              setAdhocFields(det.map((d, i) => ({ ...d, id: `adhoc-${i}`, required: d.field_type === "signature" })));
            }
          } catch (e) { console.warn("auto-detect:", e.message); }
        }
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err.message); setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Embedded lifecycle events follow the page status.
  useEffect(() => {
    if (status === "ready") emitEmbed(waitingOn ? "waiting" : "ready", { document: doc?.name, signer: signer?.email, waiting_on: waitingOn || undefined });
    else if (status === "error") emitEmbed("error", { message: error });
    else if (status === "done") emitEmbed(completed ? "completed" : "signed", { completed });
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearInterval(sealTimer.current), []);

  // Deliver the OTP — SMS first when the signer has a phone on file (the server
  // falls back to email if the SMS gateway declines), else email.
  const sendOtp = async (channel) => {
    const useChannel = channel || (smsAvailable ? "sms" : "email");
    setOtpSending(true); setError("");
    try {
      const res = await callEsignPublic({ action: "send-otp", token, channel: useChannel });
      setSentChannel(res.channel || "email");
      setOtpSent(true);
      return true;
    }
    catch (err) { setError(err.message); return false; }
    finally { setOtpSending(false); }
  };

  // Tap-anywhere signing (no pre-placed fields): drop a field where the signer
  // tapped; FieldFiller opens the pen on that exact spot of the document.
  const handleAddField = useCallback((spec) => {
    const created = { ...spec, id: `adhoc-user-${Date.now()}`, mask: false };
    setAdhocFields(prev => [...prev, created]);
    return created;
  }, []);

  // 2a) Field flow: everything filled → deliver the OTP and open the confirm step.
  const handleFieldsComplete = async (vals) => {
    if (!dbFields.length) {
      // Ad-hoc flow: a signature must actually be on the document.
      const typeById = Object.fromEntries(adhocFields.map(f => [f.id, f.field_type]));
      const hasSig = vals.some(v => (typeById[v.id] === "signature" || typeById[v.id] === "initials") && v.value);
      if (!hasSig) {
        setError('Add your signature first — use "Sign anywhere" and tap the spot on the document where you want to sign.');
        return;
      }
    }
    setPendingVals(vals); setError("");
    if (!otpSent) await sendOtp();
  };

  // The sealing "scan": advance the step list while the server burns the
  // signature into the PDF; the last step resolves when the call returns.
  const startSealing = () => {
    setSealStep(0);
    clearInterval(sealTimer.current);
    sealTimer.current = setInterval(() => {
      setSealStep(s => (s == null || s >= SEAL_STEPS.length - 1 ? s : s + 1));
    }, 1100);
  };
  const finishSealing = () => { clearInterval(sealTimer.current); setSealStep(SEAL_STEPS.length); };

  const submitFields = async () => {
    if (!consent) { setError("Please tick the box to agree to sign electronically."); return; }
    if (otp.trim().length !== 6) { setError(`Enter the 6-digit code sent to your ${sentChannel === "sms" ? "phone" : "email"}.`); return; }
    setSubmitting(true); setError("");
    startSealing();
    try {
      const payload = { action: "verify-and-sign", token, code: otp.trim(), device, consent: true };
      if (dbFields.length) {
        payload.fields = pendingVals;
      } else {
        // Auto-detected / tap-anywhere fields don't exist server-side yet —
        // send their geometry + values so the server records and burns them.
        const valMap = Object.fromEntries((pendingVals || []).map(v => [v.id, v.value]));
        payload.fields_adhoc = adhocFields
          .filter(f => valMap[f.id] != null)
          .map(f => ({
            field_type: f.field_type, page_index: f.page_index,
            pos_x: f.pos_x, pos_y: f.pos_y, width: f.width, height: f.height,
            mask: f.mask === true, value: valMap[f.id],
          }));
      }
      const res = await callEsignPublic(payload);
      finishSealing();
      setTimeout(() => {
        setSealStep(null);
        setCompleted(!!res.completed); setStatus("done");
      }, 650);
    } catch (err) {
      clearInterval(sealTimer.current); setSealStep(null);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 2b) Legacy flow (non-PDF): consent, OTP, then a signature pad.
  const startSigning = async () => {
    if (!consent) { setError("Please tick the box to agree to sign electronically."); return; }
    setError("");
    const ok = await sendOtp();
    if (ok) setStatus("signing");
  };

  const handleApply = useCallback(async (signature) => {
    if (!consent) { setError("Please tick the box to agree to sign electronically."); return; }
    if (otp.trim().length !== 6) { setError(`Enter the 6-digit code sent to your ${sentChannel === "sms" ? "phone" : "email"} first.`); return; }
    setSubmitting(true); setError("");
    startSealing();
    try {
      const res = await callEsignPublic({ action: "verify-and-sign", token, code: otp.trim(), signature, device, consent: true });
      finishSealing();
      setTimeout(() => {
        setSealStep(null);
        setCompleted(!!res.completed); setStatus("done");
      }, 650);
    } catch (err) {
      clearInterval(sealTimer.current); setSealStep(null);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [otp, token, device, consent, sentChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2c) Decline. Deliberately does NOT require an OTP: refusing asserts nothing
  // about identity, and gating it behind a code would just push people to close
  // the tab instead, which leaves the sender guessing.
  const submitDecline = useCallback(async () => {
    const why = declineReason.trim();
    if (!why) { setError("Please give a brief reason so the sender knows why."); return; }
    setDeclining(true); setError("");
    try {
      const res = await callEsignPublic({ action: "decline", token, reason: why, device });
      if (res?.error) throw new Error(res.error);
      setDeclineOpen(false);
      setDeclined(true);
    } catch (err) {
      setError(err.message || "Could not record your decision. Please try again.");
    } finally {
      setDeclining(false);
    }
  }, [declineReason, token, device]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar — hidden inside an embed; the host app provides its own chrome */}
      {!embedded && (
        <header className="border-b border-border bg-card">
          <div className="max-w-5xl mx-auto px-5 py-4 flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
              <Icon name="PenTool" size={16} color="var(--color-primary-foreground)" />
            </div>
            <span className="font-bold text-foreground">Ararat — Secure Signing</span>
            {signer && status !== "loading" && (
              <span className="ml-auto text-xs text-muted-foreground hidden sm:block">
                Signing as <strong className="text-foreground">{signer?.name || signer?.email}</strong>
              </span>
            )}
          </div>
        </header>
      )}

      <main className={`flex-1 w-full mx-auto ${embedded ? "px-3 py-4" : "px-5 py-6"} ${useFields ? "max-w-5xl" : "max-w-3xl"}`}>
        {status === "loading" && (
          <div className="py-20 text-center text-sm text-muted-foreground">Opening your document…</div>
        )}

        {status === "error" && (
          <div className="bg-card border border-border rounded-2xl p-10 text-center max-w-md mx-auto">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="AlertTriangle" size={26} color="#dc2626" />
            </div>
            <h1 className="text-lg font-bold text-foreground">Can't open this document</h1>
            <p className="text-sm text-muted-foreground mt-2">{error || "This signing link is invalid or has expired."}</p>
          </div>
        )}

        {declined && (
          <div className="bg-card border border-border rounded-2xl p-10 text-center max-w-md mx-auto">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="XCircle" size={30} color="#d97706" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-1">You declined to sign</h1>
            <p className="text-sm text-muted-foreground">
              The sender has been notified along with the reason you gave. Nothing has been signed.
            </p>
            <p className="text-xs text-muted-foreground mt-4">This link has now expired and can't be reused.</p>
          </div>
        )}

        {status === "done" && !declined && (
          <div className="bg-card border border-border rounded-2xl p-10 text-center max-w-md mx-auto">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="CheckCircle" size={30} color="#059669" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-1">Signature recorded</h1>
            <p className="text-sm text-muted-foreground">
              {completed
                ? "All parties have signed. The document is now sealed and certified."
                : "Thank you. Your signature has been applied; remaining parties will be notified."}
            </p>
            <p className="text-xs text-muted-foreground mt-4">This link has now expired and can't be reused.</p>
          </div>
        )}

        {(status === "ready" || status === "signing") && doc && !declined && (
          <div className="space-y-4">
            <div>
              <h1 className={`font-bold text-foreground ${embedded ? "text-lg" : "text-2xl"}`}>{doc.name}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Signing as <strong className="text-foreground">{signer?.name || signer?.email}</strong>
                {signer?.role ? ` · ${signer.role}` : ""}
              </p>
            </div>

            {waitingOn && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
                <Icon name="Clock" size={15} color="#b45309" />
                <span>
                  This document signs in order — <strong>{waitingOn}</strong> signs before you.
                  You can review it below; we'll notify you the moment it's your turn.
                </span>
              </div>
            )}

            {error && pendingVals == null && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 flex items-center gap-2">
                <Icon name="AlertCircle" size={13} color="currentColor" /> {error}
              </div>
            )}

            {/* Legal consent — required before any signature is accepted. */}
            {!waitingOn && (
              <label className="bg-card border border-border rounded-xl px-4 py-3 flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="w-4 h-4 mt-0.5" />
                <span className="text-sm text-foreground">
                  {consentText}
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Your consent is recorded with a server timestamp as part of the signing audit trail.
                  </span>
                </span>
              </label>
            )}

            {/* Refusing is a first-class outcome — without it a signer who
                disagrees can only abandon the link, leaving the sender waiting
                on a document that is never coming back. */}
            {!waitingOn && !declineOpen && (
              <div className="text-center">
                <button onClick={() => { setDeclineOpen(true); setError(""); }}
                  className="text-xs text-muted-foreground hover:text-red-600 font-medium underline underline-offset-2 transition-colors">
                  I don't agree to sign this document
                </button>
              </div>
            )}

            {!waitingOn && declineOpen && (
              <div className="bg-card border border-amber-300 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Icon name="AlertTriangle" size={15} color="#d97706" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Decline to sign</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      This stops the document for everyone and notifies the sender. It can't be undone — you'd need a new invitation.
                    </p>
                  </div>
                </div>
                <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3}
                  maxLength={500} placeholder="Briefly, why are you declining?"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground" />
                <div className="flex items-center gap-2">
                  <button onClick={submitDecline} disabled={declining || !declineReason.trim()}
                    className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors disabled:opacity-50">
                    {declining ? "Submitting…" : "Confirm decline"}
                  </button>
                  <button onClick={() => { setDeclineOpen(false); setDeclineReason(""); setError(""); }}
                    disabled={declining}
                    className="px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {waitingOn ? (
              /* ── Read-only preview while an earlier signer finishes ── */
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                {doc.file_url ? (
                  <iframe title="Document" src={doc.file_url} className="w-full h-[460px] bg-muted/20" />
                ) : (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">No preview available for this document.</div>
                )}
              </div>
            ) : useFields ? (
              /* ── Direct signing: the document opens right here; the signer's
                    pen writes straight onto the page. ── */
              <>
                {!dbFields.length && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-xs text-emerald-700 flex items-center gap-2">
                    <Icon name="Sparkles" size={14} color="#059669" />
                    {adhocFields.length
                      ? "We highlighted the signature areas found in this document — tap one to sign right on the page, or use \"Sign anywhere\"."
                      : "Tap \"Sign anywhere\" in the toolbar, then tap the exact spot on the document where you want to sign."}
                  </div>
                )}
                <FieldFiller fileUrl={doc.file_url} fields={effFields} signerName={signer?.name}
                  submitting={submitting} onComplete={handleFieldsComplete}
                  onAddField={!dbFields.length ? handleAddField : undefined} />
              </>
            ) : (
              /* ── Fallback (non-PDF): review + signature pad ── */
              <>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                      <Icon name="FileText" size={15} color="currentColor" /> Review Document
                    </h3>
                  </div>
                  {doc.file_url ? (
                    <iframe title="Document" src={doc.file_url} className="w-full h-[460px] bg-muted/20" />
                  ) : (
                    <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                      No preview available for this document.
                    </div>
                  )}
                </div>

                {status === "ready" && (
                  <button onClick={startSigning} disabled={otpSending}
                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60">
                    {otpSending ? "Sending verification code…" : "Continue to Sign"}
                  </button>
                )}

                {status === "signing" && (
                  <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-blue-700 flex items-center gap-2">
                          <Icon name={sentChannel === "sms" ? "Smartphone" : "Mail"} size={13} color="#1d4ed8" />
                          {otpSending ? "Sending a 6-digit code…"
                            : sentChannel === "sms" ? `We texted a 6-digit code to ${phoneHint}`
                            : `We emailed a 6-digit code to ${signer?.email}`}
                        </p>
                        <button onClick={() => sendOtp(sentChannel || undefined)} className="text-xs text-primary font-semibold hover:underline whitespace-nowrap">Resend</button>
                      </div>
                      {smsAvailable && !otpSending && (
                        <button onClick={() => sendOtp(sentChannel === "sms" ? "email" : "sms")} className="text-[11px] text-blue-700/80 hover:underline">
                          {sentChannel === "sms" ? `Send to my email (${signer?.email}) instead` : `Text the code to my phone (${phoneHint}) instead`}
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">Verification code</label>
                      <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        inputMode="numeric" placeholder="123456"
                        className="w-full tracking-[0.4em] text-center text-lg font-bold px-3 py-2.5 border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>

                    <div>
                      <h3 className="text-base font-semibold text-foreground mb-3">Your Signature</h3>
                      {submitting
                        ? <div className="py-10 text-center text-sm text-muted-foreground">Applying your signature…</div>
                        : <SignatureCanvas onCapture={handleApply} />}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* OTP confirmation for the direct field flow — appears after filling. */}
      {pendingVals != null && status !== "done" && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="bg-primary px-5 py-4">
              <p className="text-base font-bold text-primary-foreground flex items-center gap-2">
                <Icon name="Shield" size={16} color="currentColor" /> Verify & Sign
              </p>
              <p className="text-xs text-primary-foreground/70 mt-1">Signing as <strong className="text-primary-foreground">{signer?.name || signer?.email}</strong></p>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-blue-700 flex items-center gap-2">
                    <Icon name={sentChannel === "sms" ? "Smartphone" : "Mail"} size={13} color="#1d4ed8" />
                    {otpSending ? "Sending a 6-digit code…"
                      : sentChannel === "sms" ? `We texted a 6-digit code to ${phoneHint}`
                      : `We emailed a 6-digit code to ${signer?.email}`}
                  </p>
                  <button onClick={() => sendOtp(sentChannel || undefined)} className="text-xs text-primary font-semibold hover:underline whitespace-nowrap">Resend</button>
                </div>
                {smsAvailable && !otpSending && (
                  <button onClick={() => sendOtp(sentChannel === "sms" ? "email" : "sms")} className="text-[11px] text-blue-700/80 hover:underline">
                    {sentChannel === "sms" ? `Send to my email (${signer?.email}) instead` : `Text the code to my phone (${phoneHint}) instead`}
                  </button>
                )}
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="w-4 h-4 mt-0.5" />
                <span className="text-xs text-foreground">{consentText}</span>
              </label>
              <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric" placeholder="123456" autoFocus
                className="w-full tracking-[0.4em] text-center text-lg font-bold px-3 py-2.5 border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 flex items-center gap-2">
                  <Icon name="AlertCircle" size={13} color="currentColor" /> {error}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setPendingVals(null); setError(""); }}
                  className="flex-1 py-2.5 border border-border rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Back</button>
                <button onClick={submitFields} disabled={submitting}
                  className="flex-[2] py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60">
                  {submitting ? "Applying…" : "Verify & Sign"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* The sealing scan — verify, stamp, seal */}
      {sealStep != null && <SealingOverlay step={sealStep} />}
    </div>
  );
}
