import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/AppIcon";
import SignatureCanvas from "../../components/esign/SignatureCanvas";

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
  const [otp, setOtp]         = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted]   = useState(false);
  const [error, setError]     = useState("");

  const device = navigator.userAgent.slice(0, 80);

  // 1) Validate the link and load the document.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await callEsignPublic({ action: "lookup", token, device });
        if (cancelled) return;
        setDoc(res.document); setSigner(res.signer); setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err.message); setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2) Send the OTP and move into the signing step.
  const startSigning = async () => {
    setOtpSending(true); setError("");
    try {
      await callEsignPublic({ action: "send-otp", token });
      setStatus("signing");
    } catch (err) {
      setError(err.message);
    } finally {
      setOtpSending(false);
    }
  };

  const resendOtp = async () => {
    setError("");
    try { await callEsignPublic({ action: "send-otp", token }); }
    catch (err) { setError(err.message); }
  };

  // 3) Verify OTP + persist the captured signature.
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
  }, [otp, token, device]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
            <Icon name="PenTool" size={16} color="var(--color-primary-foreground)" />
          </div>
          <span className="font-bold text-foreground">AssetFlow — Secure Signing</span>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-5 py-8">
        {status === "loading" && (
          <div className="py-20 text-center text-sm text-muted-foreground">Validating your signing link…</div>
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

            {/* Document viewer */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Icon name="FileText" size={15} color="currentColor" /> Review Document
                </h3>
                {doc.file_url && (
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
                    <Icon name="ExternalLink" size={12} color="currentColor" /> Open in new tab
                  </a>
                )}
              </div>
              {doc.file_url ? (
                <iframe title="Document" src={doc.file_url} className="w-full h-[460px] bg-muted/20" />
              ) : (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No preview available for this document.
                </div>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 flex items-center gap-2">
                <Icon name="AlertCircle" size={13} color="currentColor" /> {error}
              </div>
            )}

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
                  <button onClick={resendOtp} className="text-xs text-primary font-semibold hover:underline whitespace-nowrap">Resend</button>
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
          </div>
        )}
      </main>
    </div>
  );
}
