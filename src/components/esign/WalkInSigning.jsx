import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import Icon from "../AppIcon";
import FieldFiller from "./FieldFiller";
import { applyFieldsToPDF } from "../../utils/applySignatureToPDF";

// WalkInSigning — in-person multi-signatory signing on a single device.
//
// Given a document that was allocated to several signatories (esign_signers) with
// placed fields (esign_fields), this renders a roster and lets each person sign,
// one after another, on the same screen — each with their own pen signature and a
// captured consent. When the last signatory finishes, all placed fields are burnt
// into the PDF (with the per-page footer + certificate) and the parent record is
// sealed.
//
// Props:
//   doc     — { refId, source, fileUrl, name, label }
//   adminId, currentUser
//   onRecordAudit(payload) / onNotify(payload) — reuse the page's DB helpers
//   onSealed() — parent refreshes data + advances to the done screen
//   onBack()   — leave the signing session

const SIGNER_COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#db2777"];
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const isPdfUrl = (u) => !!u && /\.pdf(\?|$)/i.test(u);

// A stable, ascii-safe verification hash for a signer's signing event.
const makeHash = (label, signedAt, signerId) => {
  try { return btoa(`${label}:${signedAt}:${signerId}`).slice(0, 16) + "…"; }
  catch { return String(signerId).slice(0, 8) + "…"; }
};

export default function WalkInSigning({ doc, adminId, currentUser, onRecordAudit, onNotify, onSealed, onBack }) {
  const { refId, source, fileUrl, name, label } = doc;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signers, setSigners] = useState([]);
  const [fieldsBySigner, setFieldsBySigner] = useState({});
  const [activeId, setActiveId] = useState(null);   // signatory currently signing
  const [stage, setStage] = useState("consent");    // consent | fill
  const [consented, setConsented] = useState(false); // consent captured for the active signatory
  const [submitting, setSubmitting] = useState(false);

  const openSigner = (id) => { setActiveId(id); setStage("consent"); setConsented(false); setError(""); };
  const closeSigner = () => { setActiveId(null); setStage("consent"); setConsented(false); setError(""); };

  const colorFor = (i) => SIGNER_COLORS[i % SIGNER_COLORS.length];

  // Load the roster + placed fields for this document (source-aware links).
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      let sq = supabase.from("esign_signers")
        .select("id, name, email, role, status, signing_order, signed_at")
        .eq("admin_id", adminId).order("signing_order", { ascending: true });
      sq = source === "esign_doc" ? sq.eq("esign_document_id", refId) : sq.eq("contract_id", refId).eq("source_type", source);
      const { data: srows, error: sErr } = await sq;
      if (sErr) throw new Error(sErr.message);

      let fq = supabase.from("esign_fields").select("*").eq("admin_id", adminId).order("page_index", { ascending: true });
      fq = source === "esign_doc" ? fq.eq("esign_document_id", refId) : fq.eq("contract_id", refId).eq("source_type", source);
      const { data: frows, error: fErr } = await fq;
      if (fErr) throw new Error(fErr.message);

      const grouped = {};
      (frows || []).forEach(f => { (grouped[f.signer_id] ||= []).push(f); });
      setSigners(srows || []);
      setFieldsBySigner(grouped);
    } catch (err) {
      setError(err.message || "Could not load the signatory roster.");
    } finally {
      setLoading(false);
    }
  }, [adminId, refId, source]);

  useEffect(() => { load(); }, [load]);

  const signedCount = signers.filter(s => s.status === "signed").length;
  const total = signers.length;
  const active = signers.find(s => s.id === activeId) || null;
  const activeIndex = signers.findIndex(s => s.id === activeId);

  // Sequential allocation: a signatory can only sign once everyone before them
  // (lower signing_order) has signed. Parallel docs use order 0 for all → ready.
  const isReady = (s) => signers.filter(o => (o.signing_order ?? 0) < (s.signing_order ?? 0)).every(o => o.status === "signed");
  const fieldsFor = (id) => fieldsBySigner[id] || [];

  // Persist one signatory's field values + signature, then seal if they're last.
  const completeSigner = async (signer, vals) => {
    if (!consented) { setError("Please confirm consent before signing."); return; }
    setSubmitting(true); setError("");
    const signedAt = new Date().toISOString();
    try {
      // Representative signature = first signature/initials field with a value.
      const myFields = fieldsFor(signer.id);
      const typeById = Object.fromEntries(myFields.map(f => [f.id, f.field_type]));
      let sig = null;
      for (const v of vals) {
        if ((typeById[v.id] === "signature" || typeById[v.id] === "initials") && v.value) {
          try { sig = JSON.parse(v.value); } catch { sig = { type: "typed", data: String(v.value) }; }
          break;
        }
      }
      sig = sig || { type: "typed", data: signer.name || currentUser?.name || "Signed" };
      const hash = makeHash(label, signedAt, signer.id);
      const device = navigator.userAgent.slice(0, 60);

      // Persist each filled field value.
      for (const fv of vals) {
        await supabase.from("esign_fields").update({ value: fv.value ?? null, filled_at: signedAt }).eq("id", fv.id);
      }
      // Mark this signatory signed and expire any pending link.
      await supabase.from("esign_signers").update({
        status: "signed", signed_at: signedAt, ip: "in-person", device,
        signature_type: sig.type, signature_data: sig.data, signature_hash: hash,
        token: null, token_expires_at: null,
      }).eq("id", signer.id);

      await onRecordAudit?.({
        contractId: refId, documentLabel: label, eventType: "signed",
        actor: signer.name || signer.email, actorEmail: signer.email,
        ip: "in-person", device, detail: `Signed in person — consent captured (session: ${currentUser?.name || "staff"})`, hash,
      });

      // Recompute completion from the freshly-updated roster.
      const updated = signers.map(s => s.id === signer.id ? { ...s, status: "signed", signed_at: signedAt } : s);
      setSigners(updated);
      const allSigned = updated.every(s => s.status === "signed");

      // Flip the parent record's status (intermediate vs sealed).
      if (source === "company") {
        await supabase.from("company_contracts").update({
          esign_status: allSigned ? "signed" : "pending",
          ...(allSigned ? { signed_at: signedAt, signature_hash: hash } : {}),
        }).eq("id", refId);
      } else if (source === "esign_doc") {
        await supabase.from("esign_documents").update({ status: allSigned ? "completed" : "in_review", updated_at: signedAt }).eq("id", refId);
      } else {
        await supabase.from("generated_contracts").update({
          esign_status: allSigned ? "signed" : "pending",
          ...(allSigned ? { signed_at: signedAt, signature_hash: hash } : {}),
        }).eq("id", refId);
      }

      if (allSigned) {
        // Burn all placed fields into the PDF (per-page footer + certificate) and
        // point the record at the sealed copy.
        if (isPdfUrl(fileUrl)) {
          try {
            let allQ = supabase.from("esign_fields").select("*").eq("admin_id", adminId);
            allQ = source === "esign_doc" ? allQ.eq("esign_document_id", refId) : allQ.eq("contract_id", refId).eq("source_type", source);
            const { data: allFields } = await allQ;
            const blob = await applyFieldsToPDF(fileUrl, allFields || [], {
              documentName: name, hash,
              signers: updated.map(s => ({ name: s.name || s.email, role: s.role, signedAt: fmtDateTime(s.signed_at), ip: s.ip || "in-person" })),
            });
            const bucket = source === "esign_doc" ? "esign-documents" : "contracts";
            const path = `${adminId}/signed_${refId}.pdf`;
            const { error: upErr } = await supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType: "application/pdf" });
            if (!upErr) {
              const url = supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl;
              const tbl = source === "company" ? "company_contracts" : source === "esign_doc" ? "esign_documents" : "generated_contracts";
              if (url) await supabase.from(tbl).update({ file_url: url }).eq("id", refId);
            }
          } catch (e) { console.warn("applyFieldsToPDF (walk-in):", e.message); }
        }
        await onRecordAudit?.({ contractId: refId, documentLabel: label, eventType: "completed", actor: "System", detail: "All signatories signed in person. Document sealed.", hash });
        await onNotify?.({ userId: currentUser?.id, type: "success", title: `${name} fully signed`, detail: `${total} signatories signed in person on ${fmtDateTime(signedAt)}.`, contractId: refId });
        closeSigner();
        await onSealed?.();
        return;
      }

      await onNotify?.({ userId: currentUser?.id, type: "info", title: `${name} — ${signer.name || signer.email} signed`, detail: `${signedCount + 1} of ${total} signatories done.`, contractId: refId });
      closeSigner();
    } catch (err) {
      setError(err.message || "Could not record this signature.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading signatories…</div>;

  // ── Active signatory: consent gate, then the pen-driven field filler ──────────
  if (active) {
    const myFields = fieldsFor(active.id);
    return (
      <div className="space-y-4">
        <button onClick={closeSigner}
          className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">
          <Icon name="ArrowLeft" size={12} color="currentColor" /> Back to signatories
        </button>

        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: colorFor(activeIndex) }}>
            {(active.name || active.email || "S").slice(0, 2).toUpperCase()}
          </span>
          <div>
            <p className="text-sm font-bold text-foreground">Signing as {active.name || active.email}</p>
            <p className="text-xs text-muted-foreground">{active.role || "Signatory"} · {myFields.length} field(s)</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 flex items-center gap-2">
            <Icon name="AlertCircle" size={13} color="currentColor" /> {error}
          </div>
        )}

        {stage === "consent" ? (
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <Icon name="ShieldCheck" size={18} color="var(--color-primary)" />
              <div>
                <p className="text-sm font-semibold text-foreground">Consent to sign electronically</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Hand the device to <strong className="text-foreground">{active.name || active.email}</strong>. By continuing they agree that their
                  electronic signature on <strong className="text-foreground">{name}</strong> is legally binding and equivalent to a handwritten one.
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={consented} onChange={e => setConsented(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm text-foreground">I am {active.name || active.email} and I consent to sign this document.</span>
            </label>
            <button onClick={() => setStage("fill")} disabled={!consented}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              <Icon name="PenTool" size={14} color="currentColor" /> Continue to sign
            </button>
          </div>
        ) : myFields.length > 0 && isPdfUrl(fileUrl) ? (
          <FieldFiller fileUrl={fileUrl} fields={myFields} signerName={active.name}
            submitting={submitting} onComplete={(vals) => completeSigner(active, vals)} />
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
            No signature fields were placed for this signatory, so they can't sign in person here. Send them a signing link instead.
          </div>
        )}
      </div>
    );
  }

  // ── Roster view ───────────────────────────────────────────────────────────────
  const allDone = total > 0 && signedCount === total;
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">
        <Icon name="ArrowLeft" size={12} color="currentColor" /> Back
      </button>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-foreground">In-person signing</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{name} · {total} signator{total === 1 ? "y" : "ies"} allocated</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground mb-1">{signedCount} of {total} signed</p>
          <div className="w-40 h-1.5 bg-muted rounded-full">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${total ? (signedCount / total) * 100 : 0}%` }} />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 flex items-center gap-2">
          <Icon name="AlertCircle" size={13} color="currentColor" /> {error}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
        {signers.map((s, i) => {
          const signed = s.status === "signed";
          const ready = isReady(s);
          const count = fieldsFor(s.id).length;
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3.5">
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: colorFor(i) }}>
                {(s.name || s.email || "S").slice(0, 2).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{s.name || s.email}</p>
                <p className="text-xs text-muted-foreground truncate">{s.role || "Signatory"} · {count} field(s){signed && s.signed_at ? ` · signed ${fmtDateTime(s.signed_at)}` : ""}</p>
              </div>
              {signed ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                  <Icon name="Check" size={12} color="currentColor" /> Signed
                </span>
              ) : !ready ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground" title="Sequential order — an earlier signatory must sign first">
                  <Icon name="Clock" size={12} color="currentColor" /> Waiting
                </span>
              ) : count === 0 ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">No fields</span>
              ) : (
                <button onClick={() => openSigner(s.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors">
                  <Icon name="PenTool" size={12} color="currentColor" /> Sign in person
                </button>
              )}
            </div>
          );
        })}
        {signers.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">No signatories allocated to this document.</div>}
      </div>

      {allDone && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-700 flex items-center gap-2">
          <Icon name="CheckCircle" size={14} color="#059669" /> All signatories have signed. The document has been sealed.
        </div>
      )}
    </div>
  );
}
