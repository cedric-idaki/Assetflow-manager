import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import Icon from "../AppIcon";

// ApiEmbedPanel — the "API & Embed" developer tab on /e-signature.
//
// For teams that want signing INSIDE their own apps rather than redirecting to
// a hosted page: manage per-tenant API keys (SHA-256 hashed, shown once),
// point a webhook at their server, and copy ready-to-paste snippets — REST
// create-document, the iframe embed, and the postMessage listener.

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// esk_live_ + 40 hex chars of CSPRNG entropy.
function generateApiKey() {
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  return "esk_live_" + Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

function CopyBlock({ label, code, language = "" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { /* clipboard unavailable */ }
  };
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 bg-muted/40 border-b border-border">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">{label}</span>
        <button onClick={copy} className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
          <Icon name={copied ? "Check" : "Copy"} size={11} color="currentColor" /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-3.5 text-[11px] leading-relaxed text-foreground bg-card overflow-x-auto whitespace-pre">{code}</pre>
      {language ? null : null}
    </div>
  );
}

export default function ApiEmbedPanel({ adminId, currentUser }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState(null);   // { label, raw } — shown ONCE
  const [webhookDraft, setWebhookDraft] = useState({}); // keyId -> url being edited

  const functionsBase = `${import.meta.env.VITE_SUPABASE_URL || "https://YOUR-PROJECT.supabase.co"}/functions/v1`;
  const portalBase = window.location.origin;

  const load = useCallback(async () => {
    if (!adminId) return;
    setLoading(true); setError("");
    const { data, error: err } = await supabase.from("esign_api_keys")
      .select("id, label, key_hint, webhook_url, active, last_used_at, created_at")
      .eq("admin_id", adminId).order("created_at", { ascending: false });
    if (err) setError(err.message);
    setKeys(data || []);
    setLoading(false);
  }, [adminId]);

  useEffect(() => { load(); }, [load]);

  const createKey = async () => {
    if (creating || !adminId) return;
    setCreating(true); setError("");
    try {
      const raw = generateApiKey();
      const key_hash = await sha256Hex(raw);
      const label = newLabel.trim() || "API key";
      const { error: err } = await supabase.from("esign_api_keys").insert({
        admin_id: adminId, label, key_hash, key_hint: raw.slice(-4), created_by: currentUser?.id || null,
      });
      if (err) throw err;
      setFreshKey({ label, raw });
      setNewLabel("");
      await load();
    } catch (err) {
      setError(err.message || "Could not create the key.");
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (k) => {
    setError("");
    const { error: err } = await supabase.from("esign_api_keys").update({ active: false }).eq("id", k.id);
    if (err) setError(err.message); else await load();
  };

  const saveWebhook = async (k) => {
    const url = (webhookDraft[k.id] ?? k.webhook_url ?? "").trim();
    if (url && !/^https:\/\//i.test(url)) { setError("Webhook URL must start with https://"); return; }
    setError("");
    const { error: err } = await supabase.from("esign_api_keys").update({ webhook_url: url || null }).eq("id", k.id);
    if (err) setError(err.message);
    else { setWebhookDraft(d => { const n = { ...d }; delete n[k.id]; return n; }); await load(); }
  };

  const curlSnippet = `curl -X POST "${functionsBase}/esign-api" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: esk_live_..." \\
  -d '{
    "action": "create-document",
    "name": "Service Agreement — Acme Ltd",
    "external_ref": "your-own-id-123",
    "file_url": "https://your-app.com/files/agreement.pdf",
    "portal_base": "${portalBase}",
    "sequential": true,
    "send_invites": false,
    "signers": [
      {
        "name": "Jane Client", "email": "jane@acme.com", "phone": "+2547...",
        "fields": [
          { "type": "signature", "page": 0, "x": 0.55, "y": 0.78, "w": 0.3,  "h": 0.06 },
          { "type": "date",      "page": 0, "x": 0.55, "y": 0.86, "w": 0.18, "h": 0.035 }
        ]
      }
    ]
  }'

# → { "document_id": "...", "signers": [ { "email": "...",
#     "signing_url": "${portalBase}/sign/<token>",
#     "embed_url":   "${portalBase}/embed/sign/<token>" } ] }
# Fields are optional — without them the signer taps anywhere and signs
# directly on the document. Coordinates are 0..1 of the page, top-left origin.
# Other actions: get-document, list-documents, refresh-link, send-invite.`;

  const iframeSnippet = `<!-- Drop the signer's embed_url into an iframe inside YOUR app -->
<iframe
  src="${portalBase}/embed/sign/SIGNER_TOKEN"
  style="width:100%; height:90vh; border:0; border-radius:12px;"
  allow="clipboard-write">
</iframe>`;

  const listenerSnippet = `// Your app hears every signing event from the iframe:
window.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || msg.source !== "ararat-esign") return;
  switch (msg.event) {
    case "ready":     /* document open, signer verified            */ break;
    case "waiting":   /* sequential order — not their turn yet     */ break;
    case "signed":    /* this signer finished                      */ break;
    case "completed": /* ALL signers done — document sealed        */
      // e.g. close the modal and refresh your own UI
      break;
    case "error":     console.warn(msg.message);                     break;
  }
});`;

  const webhookSnippet = `// POSTed to your webhook URL as each signature lands:
{
  "source": "ararat-esign",
  "event": "signer.signed" | "document.completed",
  "document_id": "…",
  "external_ref": "your-own-id-123",
  "signer": { "name": "Jane Client", "email": "jane@acme.com", "role": "Signer" },
  "signed_at": "2026-07-30T12:00:00Z",
  "completed": true,
  "file_url": "…signed_….pdf",        // sealed, certified PDF (on completion)
  "final_pdf_hash": "sha256…"          // tamper-evidence hash (on completion)
}`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">API & Embedded Signing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Put the whole signing experience inside your own app — create documents over REST, embed the signing
          page in an iframe, and get webhooks as each signature lands. No redirect to a third-party site.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 flex items-center gap-2">
          <Icon name="AlertCircle" size={13} color="currentColor" /> {error}
        </div>
      )}

      {/* How it works */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { icon: "KeyRound", title: "1 · Create a key", text: "Your server authenticates with x-api-key. Keys are hashed — we can never show one twice." },
          { icon: "Code", title: "2 · Create documents via REST", text: "POST a PDF + signers (+ optional field positions). You get hosted and embeddable signing links back." },
          { icon: "AppWindow", title: "3 · Embed & listen", text: "iframe the embed link in your app; postMessage events + webhooks tell you the moment it's signed." },
        ].map(c => (
          <div key={c.title} className="bg-card border border-border rounded-xl p-4">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-2.5">
              <Icon name={c.icon} size={17} color="var(--color-primary)" />
            </div>
            <p className="text-sm font-bold text-foreground">{c.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{c.text}</p>
          </div>
        ))}
      </div>

      {/* Fresh key — shown exactly once */}
      {freshKey && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-bold text-emerald-800 flex items-center gap-2">
            <Icon name="KeyRound" size={15} color="#047857" /> "{freshKey.label}" created — copy it now
          </p>
          <p className="text-xs text-emerald-700">This is the only time the full key is shown. Store it in your server's secrets.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-white border border-emerald-200 rounded-lg text-xs font-mono text-slate-800 overflow-x-auto whitespace-nowrap">{freshKey.raw}</code>
            <button onClick={async () => { try { await navigator.clipboard.writeText(freshKey.raw); } catch { /* ignore */ } }}
              className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors flex items-center gap-1.5">
              <Icon name="Copy" size={12} color="currentColor" /> Copy
            </button>
            <button onClick={() => setFreshKey(null)} className="px-3 py-2 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Key management */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border flex-wrap">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Icon name="KeyRound" size={14} color="var(--color-primary)" /> API keys
          </h3>
          <div className="flex items-center gap-2">
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Label (e.g. Production)"
              className="px-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-44" />
            <button onClick={createKey} disabled={creating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-60">
              <Icon name="Plus" size={12} color="currentColor" /> {creating ? "Creating…" : "New key"}
            </button>
          </div>
        </div>
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading keys…</div>
        ) : keys.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No API keys yet — create one to start integrating.</div>
        ) : (
          <div className="divide-y divide-border">
            {keys.map(k => (
              <div key={k.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${k.active ? "bg-emerald-500" : "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {k.label} <span className="font-mono text-xs text-muted-foreground">esk_live_…{k.key_hint || "????"}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Created {fmtDateTime(k.created_at)} · {k.last_used_at ? `Last used ${fmtDateTime(k.last_used_at)}` : "Never used"}
                      {!k.active && " · Revoked"}
                    </p>
                  </div>
                  {k.active && (
                    <button onClick={() => revokeKey(k)}
                      className="text-xs text-red-500 font-semibold hover:text-red-600">Revoke</button>
                  )}
                </div>
                {k.active && (
                  <div className="flex items-center gap-2 pl-5">
                    <Icon name="Webhook" size={13} color="var(--color-muted-foreground)" />
                    <input
                      value={webhookDraft[k.id] ?? k.webhook_url ?? ""}
                      onChange={e => setWebhookDraft(d => ({ ...d, [k.id]: e.target.value }))}
                      placeholder="https://your-app.com/webhooks/esign (optional)"
                      className="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                    {(webhookDraft[k.id] ?? k.webhook_url ?? "") !== (k.webhook_url ?? "") && (
                      <button onClick={() => saveWebhook(k)}
                        className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors">Save</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Integration snippets */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-4">
          <CopyBlock label="1 · Create a signing request (your server)" code={curlSnippet} />
          <CopyBlock label="4 · Webhook payload (your server receives)" code={webhookSnippet} />
        </div>
        <div className="space-y-4">
          <CopyBlock label="2 · Embed the signing page (your app)" code={iframeSnippet} />
          <CopyBlock label="3 · Listen for signing events (your app)" code={listenerSnippet} />
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-800 space-y-1">
            <p className="font-bold flex items-center gap-1.5"><Icon name="Info" size={13} color="#1d4ed8" /> Notes</p>
            <p>· The signer still gets the full secure flow inside the iframe — consent, OTP by SMS/email, pen-on-document signing and the sealed certificate.</p>
            <p>· Links are one-time and expire (default 14 days) — use <code className="font-mono">refresh-link</code> to re-issue.</p>
            <p>· <code className="font-mono">send_invites: true</code> also delivers email/SMS invites from Ararat if you don't want to deliver links yourself.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
