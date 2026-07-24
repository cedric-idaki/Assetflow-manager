import { useState, useEffect, useCallback } from "react";
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

export default function ExternalSignPage() {
  const { token } = useParams();
  const [status, setStatus]   = useState("loading"); // loading | ready | signing | done | error
  const [doc, setDoc]         = useState(null);
  const [signer, setSigner]   = useState(null);
  const [dbFields, setDbFields] = useState([]);     // fields the sender placed
  const [adhocFields, setAdhocFields] = useState([]); // auto-detected signature areas
  const [otp, setOtp]         = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [pendingVals, setPendingVals] = useState(null); // filled field values awaiting OTP
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted]   = useState(false);
  const [error, setError]     = useState("");

  const device = navigator.userAgent.slice(0, 80);
  const isPdf = !!doc?.file_url && /\.pdf(\?|$)/i.test(doc.file_url);
  const effFields = dbFields.length ? dbFields : adhocFields;
  const useFields = effFields.length > 0 && isPdf;

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

  const sendOtp = async () => {
    setOtpSending(true); setError("");
    try { await callEsignPublic({ action: "send-otp", token }); setOtpSent(true); return true; }
    catch (err) { setError(err.message); return false; }
    finally { setOtpSending(false); }
  };

  // 2a) Field flow: everything filled → email the OTP and open the confirm step.
  const handleFieldsComplete = async (vals) => {
    setPendingVals(vals); setError("");
    if (!otpSent) await sendOtp();
  };

  const submitFields = async () => {
    if (otp.trim().length !== 6) { setError("Enter the 6-digit code sent to your email."); return; }
    setSubmitting(true); setError("");
    try {
      const payload = { action: "verify-and-sign", token, code: otp.trim(), device };
      if (dbFields.length) {
        payload.fields = pendingVals;
      } else {
        // Auto-detected fields don't exist server-side yet — send their
        // geometry + values so the server records and burns them.
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
      setCompleted(!!res.completed); setStatus("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 2b) Legacy flow (no fields, non-PDF): OTP first, then a plain signature pad.
  const startSigning = async () => { const ok = await sendOtp(); if (ok) setStatus("signing"); };

  const handleApply = useCallback(async (signature) => {
    if (otp.trim().length !== 6) { setError("Enter the 6-digit code sent to your email first."); return; }
    setSubmitting(true); setError("");
    try {
      const res = await callEsignPublic({ action: "verify-and-sign", token, code: otp.trim(), signature, device });
      setCompleted(!!res.completed); setStatus("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [otp, token, device]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
            <Icon name="PenTool" size={16} color="var(--color-primary-foreground)" />
          </div>
          <span className="font-bold text-foreground">Ararat — Secure Signing</span>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-5 py-8">
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

        {status === "done" && (
          <div className="bg-card border border-border rounded-2xl p-10 text-center max-w-md mx-auto">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="CheckCircle" size={30} color="#059669" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-1">Signature recorded</h1>
            <p className="text-sm text-muted-foreground">
              {completed
                ? "All parties have signed. The document is now sealed."
                : "Thank you. Your signature has been applied; remaining parties will be notified."}
            </p>
            <p className="text-xs text-muted-foreground mt-4">This link has now expired and can't be reused.</p>
          </div>
        )}

        {(status === "ready" || status === "signing") && doc && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{doc.name}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Signing as <strong className="text-foreground">{signer?.name || signer?.email}</strong>
                {signer?.role ? ` · ${signer.role}` : ""}
              </p>
            </div>

            {error && pendingVals == null && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 flex items-center gap-2">
                <Icon name="AlertCircle" size={13} color="currentColor" /> {error}
              </div>
            )}

            {useFields ? (
              /* ── Direct signing: the document opens right here with its
                    signature areas highlighted. Tap → e-pen; dates auto-fill. ── */
              <>
                {!dbFields.length && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-xs text-emerald-700 flex items-center gap-2">
                    <Icon name="Sparkles" size={14} color="#059669" />
                    We highlighted the signature areas found in this document — tap each one to sign. Dates are filled in for you.
                  </div>
                )}
                <FieldFiller fileUrl={doc.file_url} fields={effFields} signerName={signer?.name}
                  submitting={submitting} onComplete={handleFieldsComplete} />
              </>
            ) : (
              /* ── Fallback (non-PDF or nothing detected): review + signature pad ── */
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
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-blue-700 flex items-center gap-2">
                        <Icon name="Mail" size={13} color="#1d4ed8" /> We emailed a 6-digit code to {signer?.email}
                      </p>
                      <button onClick={sendOtp} className="text-xs text-primary font-semibold hover:underline whitespace-nowrap">Resend</button>
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
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-blue-700 flex items-center gap-2">
                  <Icon name="Mail" size={13} color="#1d4ed8" />
                  {otpSending ? "Sending a 6-digit code…" : `We emailed a 6-digit code to ${signer?.email}`}
                </p>
                <button onClick={sendOtp} className="text-xs text-primary font-semibold hover:underline whitespace-nowrap">Resend</button>
              </div>
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
    </div>
  );
}
