import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import Icon from "../AppIcon";
import FieldEditor from "./FieldEditor";
import { sendSigningInvite } from "../../services/emailService";
import { sendSigningLinkSMS } from "../../services/smsService";

// ── Reusable signing templates ────────────────────────────────────────────────
//
// A template is a PDF plus a field layout bound to ROLES ("Landlord", "Tenant")
// rather than to named people. Sending from one maps real signers onto those
// roles and materialises the stored geometry into ordinary esign_fields rows, so
// nothing downstream — the filler, the sealer, the audit trail — knows or cares
// that a template was involved.
//
// Three screens: the list, the builder (upload → roles → placement) and the send
// form (role → person).

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || "").trim());

const genSignToken = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, "")
    : null;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const ROLE_PALETTE = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#db2777"];

async function recordAudit(adminId, { contractId, documentLabel, eventType, actor, detail }) {
  try {
    await supabase.from("esign_audit_events").insert({
      admin_id: adminId, contract_id: contractId || null, document_label: documentLabel,
      event_type: eventType, actor, detail,
    });
  } catch (err) { console.error("recordAudit:", err.message); }
}

export default function TemplatesPanel({ adminId, onSent }) {
  const [screen, setScreen] = useState("list");     // list | build | send
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);        // template being sent
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!adminId) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from("esign_templates")
      .select("*")
      .eq("admin_id", adminId)
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    setTemplates(data || []);
    setLoading(false);
  }, [adminId]);

  useEffect(() => { load(); }, [load]);

  const remove = async (tpl) => {
    if (!window.confirm(`Delete the template "${tpl.name}"? Documents already sent from it are unaffected.`)) return;
    const { error: err } = await supabase.from("esign_templates").delete().eq("id", tpl.id);
    if (err) { setError(err.message); return; }
    load();
  };

  if (screen === "build") {
    return <TemplateBuilder adminId={adminId}
      onCancel={() => setScreen("list")}
      onSaved={() => { setScreen("list"); load(); }} />;
  }

  if (screen === "send" && active) {
    return <SendFromTemplate adminId={adminId} template={active}
      onCancel={() => { setActive(null); setScreen("list"); }}
      onSent={async () => { setActive(null); setScreen("list"); await load(); if (onSent) await onSent(); }} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Templates</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Place fields once against roles, then send to anyone without redrawing the layout.
          </p>
        </div>
        <button onClick={() => setScreen("build")}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
          <Icon name="Plus" size={14} color="currentColor" /> New Template
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600 flex items-center gap-2">
          <Icon name="AlertCircle" size={14} color="currentColor" /> {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading templates…</div>
      ) : templates.length === 0 ? (
        <div className="py-16 text-center">
          <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
            <Icon name="Copy" size={22} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-semibold text-foreground">No templates yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Build one from a contract you send often — the field layout is saved against roles, so each send only needs names and emails.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {templates.map((t) => {
            const roles = Array.isArray(t.roles) ? t.roles : [];
            return (
              <div key={t.id} className="bg-card border border-border rounded-xl p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">{t.name}</h3>
                    {t.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>}
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
                    {t.signing_order}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {roles.map((r, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{ background: `${ROLE_PALETTE[i % ROLE_PALETTE.length]}22`, color: ROLE_PALETTE[i % ROLE_PALETTE.length] }}>
                      {r.label}
                    </span>
                  ))}
                </div>

                <p className="text-[11px] text-muted-foreground mt-3">
                  Used {t.use_count || 0}×{t.last_used_at ? ` · last ${fmtDate(t.last_used_at)}` : ""} · created {fmtDate(t.created_at)}
                </p>

                <div className="mt-4 pt-3 border-t border-border flex items-center gap-2">
                  <button onClick={() => { setActive(t); setScreen("send"); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                    <Icon name="Send" size={13} color="currentColor" /> Use
                  </button>
                  <button onClick={() => remove(t)} title="Delete template"
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-muted transition-colors">
                    <Icon name="Trash2" size={13} color="currentColor" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Builder: upload → name roles → place fields ───────────────────────────────
function TemplateBuilder({ adminId, onCancel, onSaved }) {
  const [stage, setStage] = useState("setup");      // setup | fields
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [order, setOrder] = useState("sequential");
  const [roles, setRoles] = useState([{ label: "Signer 1" }]);
  const [fileUrl, setFileUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setRole = (i, v) => setRoles((prev) => prev.map((r, j) => (j === i ? { label: v } : r)));

  // Upload the source PDF, then move into placement. The object is written under
  // a templates/ prefix inside the tenant's own folder so the storage policy
  // (which matches on the first path segment) still recognises it.
  async function handleContinue() {
    if (!file || !adminId || busy) return;
    if (!name.trim()) { setError("Give the template a name."); return; }
    const labels = roles.map((r) => r.label.trim()).filter(Boolean);
    if (!labels.length) { setError("Add at least one role."); return; }
    if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
      setError("Role names must be unique."); return;
    }
    setBusy(true); setError("");
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${adminId}/templates/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("esign-documents")
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from("esign-documents").getPublicUrl(path);
      setFileUrl(pub?.publicUrl || null);
      setStage("fields");
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  // Persist the template and its role-bound geometry. FieldEditor hands back
  // fields whose signer_id is the role index we passed in as a pseudo-signer id.
  async function saveTemplate(fields) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const cleanRoles = roles
        .map((r, i) => ({ index: i, label: r.label.trim() }))
        .filter((r) => r.label);

      const { data: tpl, error: tErr } = await supabase
        .from("esign_templates")
        .insert({
          admin_id: adminId,
          name: name.trim(),
          description: description.trim() || null,
          file_url: fileUrl,
          file_type: "PDF",
          roles: cleanRoles,
          signing_order: order,
          message: message.trim() || null,
        })
        .select("id")
        .single();
      if (tErr) throw new Error(tErr.message);

      if (fields?.length) {
        const { error: fErr } = await supabase.from("esign_template_fields").insert(
          fields.map((f) => ({
            admin_id: adminId,
            template_id: tpl.id,
            role_index: Number(f.signer_id) || 0,
            field_type: f.field_type,
            page_index: f.page_index,
            pos_x: f.pos_x, pos_y: f.pos_y, width: f.width, height: f.height,
            required: f.required !== false,
            mask: f.mask === true,
            options: Array.isArray(f.options) ? f.options.map((o) => String(o).trim()).filter(Boolean) : [],
          }))
        );
        if (fErr) throw new Error(fErr.message);
      }

      await recordAudit(adminId, {
        contractId: tpl.id, documentLabel: name.trim(), eventType: "created", actor: "You",
        detail: `Template created · ${cleanRoles.length} role(s) · ${fields?.length || 0} field(s)`,
      });

      onSaved();
    } catch (err) {
      setError(err.message || "Could not save the template");
      setBusy(false);
    }
  }

  if (stage === "fields" && fileUrl) {
    // Roles stand in for signers; the editor only needs { id, name, role }.
    const roleSigners = roles
      .map((r, i) => ({ id: String(i), name: r.label.trim(), role: `Role ${i + 1}` }))
      .filter((r) => r.name);
    return (
      <div className="space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600 flex items-center gap-2">
            <Icon name="AlertCircle" size={14} color="currentColor" /> {error}
          </div>
        )}
        <FieldEditor
          fileUrl={fileUrl}
          signers={roleSigners}
          saving={busy}
          onBack={() => setStage("setup")}
          onSave={saveTemplate}
          title="Place fields for each role"
          subtitle="Fields are saved against the role, not a person — whoever you assign to that role at send time inherits them."
          actionLabel="Save Template"
          actionBusyLabel="Saving…"
          actionIcon="Save"
          ownerNoun="role"
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <button onClick={onCancel} className="text-xs text-primary font-medium flex items-center gap-1 mb-1 hover:underline">
          <Icon name="ArrowLeft" size={12} color="currentColor" /> Back to templates
        </button>
        <h1 className="text-2xl font-bold text-foreground">New Template</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Upload the document and name the roles that will sign it.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600 flex items-center gap-2">
          <Icon name="AlertCircle" size={14} color="currentColor" /> {error}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">Template name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Standard Tenancy Agreement"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="When to use this template"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">Document (PDF)</label>
          <input type="file" accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full text-sm text-muted-foreground file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary" />
          {file && !/\.pdf$/i.test(file.name) && (
            <p className="text-[11px] text-amber-600 mt-1">Templates need a PDF — field placement renders the pages.</p>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">Roles</label>
          <button onClick={() => setRoles((p) => [...p, { label: `Signer ${p.length + 1}` }])}
            disabled={roles.length >= 5}
            className="text-xs text-primary font-medium hover:underline disabled:opacity-40">
            + Add role
          </button>
        </div>
        {roles.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: ROLE_PALETTE[i % ROLE_PALETTE.length] }} />
            <input value={r.label} onChange={(e) => setRole(i, e.target.value)}
              placeholder={`Role ${i + 1} — e.g. Landlord`}
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground" />
            {roles.length > 1 && (
              <button onClick={() => setRoles((p) => p.filter((_, j) => j !== i))}
                className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">
                <Icon name="X" size={13} color="currentColor" />
              </button>
            )}
          </div>
        ))}

        <div className="pt-2">
          <label className="block text-xs font-semibold text-foreground mb-1.5">Signing order</label>
          <div className="flex gap-2">
            {["sequential", "parallel"].map((o) => (
              <button key={o} onClick={() => setOrder(o)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  order === o ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"
                }`}>
                {o === "sequential" ? "One after another" : "All at once"}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2">
          <label className="block text-xs font-semibold text-foreground mb-1.5">Default invite message <span className="text-muted-foreground font-normal">(optional)</span></label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground" />
        </div>
      </div>

      <button onClick={handleContinue} disabled={!file || busy}
        className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
        <Icon name="ArrowRight" size={14} color="currentColor" /> {busy ? "Uploading…" : "Continue to field placement"}
      </button>
    </div>
  );
}

// ── Send: map real people onto the template's roles ───────────────────────────
function SendFromTemplate({ adminId, template, onCancel, onSent }) {
  const roles = Array.isArray(template.roles) ? template.roles : [];
  const [people, setPeople] = useState(roles.map(() => ({ name: "", email: "", phone: "" })));
  const [message, setMessage] = useState(template.message || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const setP = (i, k, v) => setPeople((prev) => prev.map((p, j) => (j === i ? { ...p, [k]: v } : p)));

  async function send() {
    if (busy) return;
    const filled = people.map((p, i) => ({ ...p, roleIndex: i, roleLabel: roles[i]?.label || `Role ${i + 1}` }));
    const missing = filled.find((p) => !isEmail(p.email));
    if (missing) { setError(`Enter a valid email for "${missing.roleLabel}".`); return; }
    const emails = filled.map((p) => p.email.trim().toLowerCase());
    const dupe = emails.find((e, i) => emails.indexOf(e) !== i);
    if (dupe) { setError(`Duplicate signer email: ${dupe}. Each signatory must be unique.`); return; }

    setBusy(true); setError("");
    try {
      const sequential = template.signing_order === "sequential";
      const expires = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

      // 1. Document row — reuses the template's stored PDF. Sealing writes to a
      //    separate signed_<id>.pdf path, so the template source is read-only.
      const { data: docRow, error: docErr } = await supabase
        .from("esign_documents")
        .insert({
          admin_id: adminId,
          name: template.name,
          file_url: template.file_url,
          file_type: template.file_type || "PDF",
          status: "draft",
          signing_order: template.signing_order,
          message: message.trim() || null,
        })
        .select("id")
        .single();
      if (docErr) throw new Error(docErr.message);

      // 2. Signer rows, in role order.
      const { data: signerRows, error: sErr } = await supabase
        .from("esign_signers")
        .insert(filled.map((p, i) => ({
          admin_id: adminId,
          esign_document_id: docRow.id,
          source_type: "esign_doc",
          name: p.name.trim() || p.email.split("@")[0],
          email: p.email.trim(),
          phone: p.phone?.trim() || null,
          role: p.roleLabel,
          signing_order: sequential ? i : 0,
          status: "pending",
          token: genSignToken(),
          token_expires_at: expires,
          link_base: window.location.origin,
        })))
        .select("id, name, email, phone, role");
      if (sErr) throw new Error(sErr.message);

      // 3. Materialise the template geometry against the new signer ids.
      const { data: tplFields, error: tfErr } = await supabase
        .from("esign_template_fields")
        .select("*")
        .eq("template_id", template.id);
      if (tfErr) throw new Error(tfErr.message);

      if (tplFields?.length) {
        const byRole = new Map(signerRows.map((r, i) => [i, r.id]));
        const rows = tplFields
          .map((f) => {
            const signerId = byRole.get(f.role_index);
            if (!signerId) return null;      // role removed since the template was built
            return {
              admin_id: adminId,
              source_type: "esign_doc",
              esign_document_id: docRow.id,
              signer_id: signerId,
              field_type: f.field_type,
              page_index: f.page_index,
              pos_x: f.pos_x, pos_y: f.pos_y, width: f.width, height: f.height,
              required: f.required,
              mask: f.mask,
              placeholder: f.placeholder,
              options: Array.isArray(f.options) ? f.options : [],
            };
          })
          .filter(Boolean);
        if (rows.length) {
          const { error: fErr } = await supabase.from("esign_fields").insert(rows);
          if (fErr) throw new Error(fErr.message);
        }
      }

      // 4. Go live and invite. Sequential invites only the first signer —
      //    esign-public advances the chain as each one finishes.
      await supabase.from("esign_documents")
        .update({ status: "pending", expires_at: expires })
        .eq("id", docRow.id);

      await supabase.rpc("esign_template_mark_used", { p_template: template.id }).then(() => {}, () => {});

      await recordAudit(adminId, {
        contractId: docRow.id, documentLabel: template.name, eventType: "sent", actor: "You",
        detail: `From template "${template.name}" · ${template.signing_order} order · ${signerRows.length} signer(s)`,
      });

      // Re-read to pick up the tokens, which the insert's select did not return.
      const base = window.location.origin;
      const { data: tokenRows } = await supabase
        .from("esign_signers")
        .select("id, name, email, phone, token, signing_order")
        .eq("esign_document_id", docRow.id)
        .order("signing_order", { ascending: true });

      const toInvite = sequential ? (tokenRows || []).slice(0, 1) : (tokenRows || []);
      await Promise.all(toInvite.filter((r) => r.token).map((r) => {
        const link = `${base}/sign/${r.token}`;
        const jobs = [
          sendSigningInvite(r.email, {
            signerName: r.name, documentName: template.name,
            link, message: message.trim() || undefined, expiresAt: expires,
          }).catch((e) => console.warn("invite email failed:", e.message)),
        ];
        if (r.phone) {
          jobs.push(sendSigningLinkSMS(r.phone, { signerName: r.name, documentName: template.name, link })
            .catch((e) => console.warn("invite SMS failed:", e.message)));
        }
        return Promise.all(jobs);
      }));

      setDone(true);
    } catch (err) {
      setError(err.message || "Could not send from this template");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon name="Send" size={28} color="#059669" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Sent from template</h2>
          <p className="text-sm text-muted-foreground mb-6">
            The field layout from “{template.name}” was applied automatically. Signing links are on their way.
          </p>
          <button onClick={onSent}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
            Back to templates
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <button onClick={onCancel} className="text-xs text-primary font-medium flex items-center gap-1 mb-1 hover:underline">
          <Icon name="ArrowLeft" size={12} color="currentColor" /> Back to templates
        </button>
        <h1 className="text-2xl font-bold text-foreground">{template.name}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Assign someone to each role — the saved field layout is applied for you.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600 flex items-center gap-2">
          <Icon name="AlertCircle" size={14} color="currentColor" /> {error}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        {roles.map((r, i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: ROLE_PALETTE[i % ROLE_PALETTE.length] }} />
              <span className="text-xs font-semibold text-foreground">{r.label}</span>
              {template.signing_order === "sequential" && (
                <span className="text-[11px] text-muted-foreground">signs {i === 0 ? "first" : `#${i + 1}`}</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input value={people[i]?.name || ""} onChange={(e) => setP(i, "name", e.target.value)}
                placeholder="Full name"
                className="px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground" />
              <input value={people[i]?.email || ""} onChange={(e) => setP(i, "email", e.target.value)}
                placeholder="Email"
                className="px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground" />
              <input value={people[i]?.phone || ""} onChange={(e) => setP(i, "phone", e.target.value)}
                placeholder="Phone (optional)"
                className="px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground" />
            </div>
          </div>
        ))}

        <div className="pt-1">
          <label className="block text-xs font-semibold text-foreground mb-1.5">Invite message <span className="text-muted-foreground font-normal">(optional)</span></label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground" />
        </div>
      </div>

      <button onClick={send} disabled={busy}
        className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
        <Icon name="Send" size={14} color="currentColor" /> {busy ? "Sending…" : "Send for signature"}
      </button>
    </div>
  );
}
