import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import MainLayout from "../../layouts/MainLayout";
import Icon from "../../components/AppIcon";

const fmt = (n) => `KES ${(parseFloat(n) || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const MOCK_USER = { name: "Eric Nganga", role: "Administrator", email: "eric@assetflow.co.ke", initials: "EN", plan: "Gold" };

const MOCK_DOCS = [
  { id: "SFP-20260428-1001", name: "Employment Contract — James M.", type: "PDF", pages: 4, status: "pending", signers: [{ name: "Eric Nganga", initials: "EN", signed: false, role: "Employer" }, { name: "James Mwangi", initials: "JM", signed: false, role: "Employee" }], sent: "2026-04-24", due: "2026-05-01", external: true, urgent: true },
  { id: "SFP-20260420-9821", name: "Q2 Financial Report 2025", type: "XLSX", pages: 12, status: "completed", signers: [{ name: "Finance Dept", initials: "FD", signed: true }, { name: "Eric Nganga", initials: "EN", signed: true }, { name: "M. Ochieng", initials: "MD", signed: true }], sent: "2026-04-20", due: "2026-04-22", external: false },
  { id: "SFP-20260418-0033", name: "Vendor Agreement — TechParts Ltd", type: "DOCX", pages: 8, status: "in_review", signers: [{ name: "V. Patel", initials: "VP", signed: false, role: "Vendor Rep" }], sent: "2026-04-18", due: "2026-05-05", external: true },
  { id: "SFP-20260412-0055", name: "NDA — Startup Partnership", type: "PDF", pages: 2, status: "completed", signers: [{ name: "Eric Nganga", initials: "EN", signed: true }, { name: "S. Patel", initials: "SP", signed: true }], sent: "2026-04-12", due: "2026-04-20", external: true },
  { id: "SFP-20260410-0071", name: "Board Resolution — Expansion", type: "PDF", pages: 3, status: "completed", signers: [{ name: "Dir 1", initials: "D1", signed: true }, { name: "Dir 2", initials: "D2", signed: true }, { name: "Dir 3", initials: "D3", signed: true }], sent: "2026-04-10", due: "2026-04-14", external: false },
  { id: "SFP-20260405-0088", name: "Lease Agreement — Office Space", type: "PDF", pages: 20, status: "expired", signers: [{ name: "Landlord", initials: "LM", signed: false }], sent: "2026-04-05", due: "2026-04-15", external: true },
  { id: "SFP-DRAFT-0099", name: "Purchase Order #4821", type: "DOCX", pages: 2, status: "draft", signers: [], sent: null, due: null, external: false },
  { id: "SFP-20260426-0101", name: "IT Policy Update v3", type: "PDF", pages: 2, status: "pending", signers: [{ name: "IT Admin", initials: "IT", signed: true }, { name: "Eric Nganga", initials: "EN", signed: false }], sent: "2026-04-26", due: "2026-05-10", external: false },
];

const AUDIT_EVENTS = [
  { id: 1, action: "Document Created & Uploaded", actor: "Eric Nganga", time: "Apr 20, 2026, 09:14 AM EAT", ip: "197.232.xx.xx", device: "MacBook Pro (Chrome 124)", detail: "Uploaded original XLSX, converted to PDF for signing", hash: "3a7f9e2b…d41c8e4f", status: "complete" },
  { id: 2, action: "Sent for Signature", actor: "Eric Nganga → Finance Dept., MD Office", time: "Apr 20, 2026, 09:22 AM EAT", ip: "197.232.xx.xx", device: "MacBook Pro (Chrome 124)", detail: "Sequential order set. Expiry: Apr 22, 2026", hash: "b82c5d1a…9f3e7b2c", status: "complete" },
  { id: 3, action: "Document Viewed", actor: "Janet Kamau (Finance)", time: "Apr 21, 2026, 10:05 AM EAT", ip: "154.123.xx.xx", device: "Windows 11 (Edge 123)", detail: "12 minutes viewing time", hash: "7d4e1b9c…2a6f8d3e", status: "view" },
  { id: 4, action: "Signed — Finance Department", actor: "Janet Kamau", time: "Apr 21, 2026, 10:18 AM EAT", ip: "154.123.xx.xx", device: "Windows 11 (Edge 123)", detail: "Auth: PIN + OTP (SMS to +254 7xx xxx x78)", hash: "e9a1c4f2…71d3b9e8", status: "signed" },
  { id: 5, action: "Signed — Managing Director", actor: "M. Ochieng (MD)", time: "Apr 22, 2026, 02:45 PM EAT", ip: "41.90.xx.xx", device: "iOS 18 (Safari)", detail: "Auth: PIN + OTP + Biometric (Face ID). All pages notarized.", hash: "c3b7a2f9…5e1d4c8b", status: "signed" },
  { id: 6, action: "Document Completed & Sealed", actor: "System", time: "Apr 22, 2026, 02:46 PM EAT", ip: "—", device: "—", detail: "All signatures verified. Company seal applied. PDF/A archived. Notifications sent to all parties.", hash: "a1b2c3d4…z9y8x7w6", status: "final" },
];

const NOTIFICATIONS = [
  { id: 1, type: "warning", title: "Security: Signature used on Board Resolution", detail: "IP: 41.107.xx.xx · Device: iPhone 15 · Apr 25, 2026", time: "5 min ago", read: false },
  { id: 2, type: "success", title: "James Mwangi completed signing Employment Contract", detail: "All required signatures collected · Ready to download", time: "1 hr ago", read: false },
  { id: 3, type: "info", title: "Vendor Agreement expires in 7 days", detail: "Janet Kamau hasn't signed yet · Send reminder?", time: "2 hrs ago", read: false },
  { id: 4, type: "info", title: "Invited to co-sign Partnership MOU", detail: "Requested by: ceo@partner.co.ke · Due: May 15", time: "Yesterday", read: true },
  { id: 5, type: "neutral", title: "NDA audit log exported by Finance", detail: "Exported as PDF · 6 events recorded", time: "Apr 24", read: true },
];

const PLAN_LIMITS = { Bronze: { external: 15, addon: 1200 }, Silver: { external: 38, addon: 2200 }, Gold: { external: 56, addon: 3200 } };
const CURRENT_EXTERNAL_USED = 23;

// ── Helpers ────────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    pending:   "bg-amber-100 text-amber-700",
    completed: "bg-emerald-100 text-emerald-700",
    signed:    "bg-emerald-100 text-emerald-700",
    in_review: "bg-blue-100 text-blue-700",
    expired:   "bg-red-100 text-red-700",
    draft:     "bg-muted text-muted-foreground",
    sent:      "bg-blue-100 text-blue-700",
  };
  const labels = { pending: "Pending", completed: "Completed", signed: "Signed", in_review: "In Review", expired: "Expired", draft: "Draft", sent: "Sent" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] || map.draft}`}>
      {labels[status] || status}
    </span>
  );
}

function Avatar({ initials, size = 32 }) {
  const colors = { EN: "bg-primary", JM: "bg-blue-600", FD: "bg-emerald-600", MD: "bg-violet-600", VP: "bg-orange-600", SP: "bg-teal-600", LM: "bg-amber-600", IT: "bg-blue-700", D1: "bg-violet-700", D2: "bg-pink-700", D3: "bg-emerald-700" };
  const bg = colors[initials] || "bg-primary";
  const sz = size <= 24 ? "w-6 h-6 text-[9px]" : size <= 32 ? "w-8 h-8 text-xs" : size <= 40 ? "w-10 h-10 text-sm" : "w-12 h-12 text-base";
  return (
    <div className={`${sz} ${bg} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
}

function FileTypeBadge({ type }) {
  const map = { PDF: "bg-red-100 text-red-700", DOCX: "bg-blue-100 text-blue-700", XLSX: "bg-emerald-100 text-emerald-700" };
  return <span className={`text-xs font-bold px-2 py-0.5 rounded ${map[type] || "bg-muted text-muted-foreground"}`}>{type}</span>;
}

// ── OTP Modal ──────────────────────────────────────────────────────────────────
function OTPModal({ signer, onVerified, onClose }) {
  const [step, setStep] = useState("enter_otp");
  const [otp, setOtp] = useState(["","","","","",""]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedOtp] = useState(() => String(Math.floor(100000 + Math.random() * 900000)));
  const refs = [useRef(),useRef(),useRef(),useRef(),useRef(),useRef()];

  const handleOtpChange = (i, val) => {
    if (!/^\d*$/.test(val)) return;
    const n = [...otp]; n[i] = val.slice(-1); setOtp(n);
    if (val && i < 5) refs[i+1].current?.focus();
  };
  const handleKeyDown = (i, e) => { if (e.key === "Backspace" && !otp[i] && i > 0) refs[i-1].current?.focus(); };
  const handleVerify = async () => {
    const entered = otp.join("");
    if (entered.length !== 6) { setError("Please enter the complete 6-digit OTP"); return; }
    if (!password.trim()) { setError("Please enter your signing password"); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    if (entered !== generatedOtp) { setError("Invalid OTP."); setLoading(false); return; }
    if (password.trim().length < 4) { setError("Invalid password."); setLoading(false); return; }
    setStep("verified"); setLoading(false);
    setTimeout(() => onVerified({ otp: entered, verifiedAt: new Date().toISOString(), ip: "197.232.xx.xx", device: navigator.userAgent.slice(0,50) }), 800);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="bg-primary px-6 py-5">
          <p className="text-base font-bold text-primary-foreground flex items-center gap-2">
            <Icon name="Shield" size={16} color="currentColor" /> Signature Verification
          </p>
          <p className="text-xs text-primary-foreground/70 mt-1">Signing as: <strong className="text-primary-foreground">{signer?.name}</strong></p>
        </div>
        {step === "verified" ? (
          <div className="p-8 text-center">
            <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="CheckCircle" size={28} color="#059669" />
            </div>
            <p className="text-base font-bold text-emerald-700">Identity Verified!</p>
            <p className="text-xs text-muted-foreground mt-1">Applying your signature...</p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-emerald-700">Demo OTP: <strong>{generatedOtp}</strong></p>
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground mb-2">Enter 6-Digit OTP</p>
              <div className="flex gap-2 justify-center">
                {otp.map((digit, i) => (
                  <input key={i} ref={refs[i]} type="text" inputMode="numeric" maxLength={1} value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)} onKeyDown={e => handleKeyDown(i, e)}
                    className={`w-11 h-13 text-center text-xl font-bold border-2 rounded-xl outline-none bg-background text-foreground transition-colors ${digit ? "border-primary bg-primary/5" : "border-border"}`} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground mb-1.5">Signing Password</p>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your signing password"
                className="w-full px-3 py-2.5 text-sm border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 flex items-center gap-2">
                <Icon name="AlertCircle" size={13} color="currentColor" /> {error}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleVerify} disabled={loading}
                className="flex-[2] py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60">
                {loading ? "Verifying..." : "Verify & Sign"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Signature Canvas ───────────────────────────────────────────────────────────
function SignatureCanvas({ onCapture }) {
  const canvasRef = useRef();
  const drawing = useRef(false);
  const [hasSign, setHasSign] = useState(false);
  const [mode, setMode] = useState("draw");
  const [typedSig, setTypedSig] = useState("");
  const FONTS = ["Dancing Script","Pacifico","Satisfy","Caveat"];
  const [font, setFont] = useState(FONTS[0]);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Pacifico&family=Satisfy&family=Caveat:wght@700&display=swap";
    document.head.appendChild(link);
  }, []);

  const getPos = (e, canvas) => { const r = canvas.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX-r.left, y: t.clientY-r.top }; };
  const start = (e) => { e.preventDefault(); drawing.current=true; const canvas=canvasRef.current; const ctx=canvas.getContext("2d"); const {x,y}=getPos(e,canvas); ctx.beginPath(); ctx.moveTo(x,y); };
  const draw = (e) => { e.preventDefault(); if(!drawing.current) return; const canvas=canvasRef.current; const ctx=canvas.getContext("2d"); ctx.strokeStyle="var(--color-foreground)"; ctx.lineWidth=2.5; ctx.lineCap="round"; ctx.lineJoin="round"; const {x,y}=getPos(e,canvas); ctx.lineTo(x,y); ctx.stroke(); setHasSign(true); };
  const stop = () => { drawing.current=false; };
  const clear = () => { const canvas=canvasRef.current; canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height); setHasSign(false); };
  const capture = () => {
    if (mode==="draw") { if(!hasSign) return; onCapture({ type:"drawn", data:canvasRef.current.toDataURL() }); }
    else { if(!typedSig.trim()) return; onCapture({ type:"typed", data:typedSig, font }); }
  };

  return (
    <div className="bg-muted/30 border border-border rounded-xl overflow-hidden">
      <div className="flex border-b border-border">
        {[{id:"draw",label:"Draw"},{id:"type",label:"Type"},{id:"upload",label:"Upload"}].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${mode===m.id ? "bg-card text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {m.label}
          </button>
        ))}
      </div>
      {mode==="draw" && (
        <>
          <canvas ref={canvasRef} width={420} height={150}
            className="block w-full bg-card cursor-crosshair touch-none"
            onMouseDown={start} onMouseMove={draw} onMouseUp={stop} onMouseLeave={stop}
            onTouchStart={start} onTouchMove={draw} onTouchEnd={stop} />
          <div className="px-3 py-2 flex justify-between items-center bg-muted/20">
            <span className="text-xs text-muted-foreground">Draw your signature above</span>
            <button onClick={clear} className="text-xs text-red-500 font-semibold hover:text-red-600">Clear</button>
          </div>
        </>
      )}
      {mode==="type" && (
        <div className="p-4 bg-card space-y-3">
          <input type="text" value={typedSig} onChange={e => setTypedSig(e.target.value)} placeholder="Type your full name"
            className="w-full px-3 py-2 border border-border rounded-xl text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <div className="h-20 flex items-center justify-center bg-muted/30 rounded-xl border border-dashed border-border">
            <span style={{ fontFamily: font, fontSize: 32, color: "var(--color-foreground)" }}>{typedSig || "Your Signature"}</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {FONTS.map(f => (
              <button key={f} onClick={() => setFont(f)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${font===f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                style={{ fontFamily: f }}>
                {f.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>
      )}
      {mode==="upload" && (
        <div className="p-8 text-center text-muted-foreground text-sm bg-card">
          Click to upload signature image (PNG/SVG)
        </div>
      )}
      <div className="p-3 border-t border-border">
        <button onClick={capture}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
          Apply Signature
        </button>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
function Dashboard({ docs, setActive, setSelectedDoc }) {
  const completed = docs.filter(d => d.status === "completed" || d.status === "signed").length;
  const pending = docs.filter(d => d.status === "pending").length;
  const total = docs.length;
  const planLimit = PLAN_LIMITS[MOCK_USER.plan].external;
  const pct = Math.round((CURRENT_EXTERNAL_USED / planLimit) * 100);
  const recentDocs = docs.filter(d => d.status !== "draft").slice(0, 5);

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Documents", val: total, sub: "+12 this month", icon: "FileText", color: "bg-primary/10 text-primary" },
          { label: "Completed", val: completed, sub: `${total ? Math.round((completed/total)*100) : 0}% completion rate`, icon: "CheckCircle", color: "bg-emerald-500/10 text-emerald-600" },
          { label: "Awaiting", val: pending, sub: "2 urgent (expiring soon)", icon: "Clock", color: "bg-amber-500/10 text-amber-600" },
          { label: "Team Signatories", val: 34, sub: "Active team members", icon: "Users", color: "bg-violet-500/10 text-violet-600" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="text-xs text-muted-foreground font-medium">{s.label}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${s.color}`}>
                <Icon name={s.icon} size={15} color="currentColor" />
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground">{s.val}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Documents */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-base font-semibold text-foreground">Recent Documents</h3>
            <button onClick={() => setActive("documents")} className="text-xs text-primary font-medium hover:underline">View all →</button>
          </div>
          <div className="divide-y divide-border">
            {recentDocs.map(doc => (
              <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => { setSelectedDoc(doc); setActive("documents"); }}>
                <FileTypeBadge type={doc.type} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">{doc.type} · {doc.pages} pages</p>
                </div>
                <div className="flex -space-x-2">
                  {doc.signers.slice(0,3).map((s, i) => (
                    <div key={i} className="border-2 border-card rounded-full"><Avatar initials={s.initials} size={24} /></div>
                  ))}
                </div>
                <StatusBadge status={doc.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* External Signing Usage */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-1">External Signing Usage</h3>
            <p className="text-xs text-muted-foreground mb-3">{MOCK_USER.plan} Plan · {CURRENT_EXTERNAL_USED}/{planLimit} docs used</p>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${pct > 85 ? "bg-red-500" : pct > 65 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">{planLimit - CURRENT_EXTERNAL_USED} remaining · KES 25/doc overage</p>
          </div>

          {/* Signing Progress */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-3">Signing Progress</h3>
            {docs.filter(d => d.status === "pending" || d.status === "in_review").slice(0,3).map(doc => {
              const signed = doc.signers.filter(s => s.signed).length;
              const tot = doc.signers.length || 1;
              const p = Math.round((signed/tot)*100);
              return (
                <div key={doc.id} className="mb-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-muted-foreground truncate max-w-[160px]">{doc.name.split("—")[0].trim()}</span>
                    <span className="text-xs text-muted-foreground">{signed}/{tot}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${p}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Actions */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-3">Quick Actions</h3>
            <div className="space-y-2">
              {[
                { label: "Upload New Document", icon: "Upload", page: "upload" },
                { label: "View Audit Trail", icon: "Search", page: "audit" },
                { label: "Manage Team", icon: "Users", page: "settings" },
              ].map(a => (
                <button key={a.label} onClick={() => setActive(a.page)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-muted/50 hover:bg-muted text-sm text-foreground transition-colors text-left">
                  <Icon name={a.icon} size={14} color="currentColor" />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Documents ──────────────────────────────────────────────────────────────────
function Documents({ docs, setDocs, setActive }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [showAudit, setShowAudit] = useState(false);

  const filtered = docs.filter(d => {
    const matchFilter = filter === "all" || d.status === filter;
    const matchSearch = d.name.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  function handleAction(doc, action) {
    if (action === "audit") { setSelected(doc); setShowAudit(true); }
    else if (action === "sign") { setActive("sign"); }
    else if (action === "resend") { setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: "pending" } : d)); }
  }

  if (showAudit && selected) return <AuditModal doc={selected} onClose={() => setShowAudit(false)} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">All Documents</h1>
        <div className="relative">
          <Icon name="Search" size={14} color="var(--color-muted-foreground)" className="absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents..."
            className="pl-9 pr-3 py-2 text-sm border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 w-56" />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl w-fit flex-wrap">
        {[["all","All"],["pending","Pending"],["completed","Completed"],["in_review","In Review"],["draft","Drafts"],["expired","Expired"]].map(([val,label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter===val ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[2fr_80px_120px_100px_100px_120px] px-5 py-3 bg-muted/30 border-b border-border">
          {["Name","Type","Status","Signers","Due Date","Action"].map(h => (
            <div key={h} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</div>
          ))}
        </div>
        {filtered.map(doc => (
          <div key={doc.id} className="grid grid-cols-[2fr_80px_120px_100px_100px_120px] px-5 py-3.5 border-b border-border items-center hover:bg-muted/20 transition-colors last:border-0">
            <div className="flex items-center gap-3 min-w-0">
              <FileTypeBadge type={doc.type} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{doc.name}</p>
                <p className="text-xs text-muted-foreground">{doc.id}</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">{doc.type} · {doc.pages}p</div>
            <StatusBadge status={doc.status} />
            <div className="flex -space-x-1.5">
              {doc.signers.slice(0,4).map((s,i) => (
                <div key={i} className="border-2 border-card rounded-full" title={s.name}><Avatar initials={s.initials} size={24} /></div>
              ))}
            </div>
            <div className={`text-xs ${doc.status === "expired" ? "text-red-500" : "text-muted-foreground"}`}>
              {doc.due ? fmtDate(doc.due) : "—"}
            </div>
            <div className="flex gap-1.5">
              {doc.status === "pending" && <button onClick={() => handleAction(doc,"sign")} className="px-2.5 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors">Sign</button>}
              {(doc.status === "completed" || doc.status === "signed") && <button onClick={() => handleAction(doc,"audit")} className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-200 transition-colors">Audit</button>}
              {doc.status === "expired" && <button onClick={() => handleAction(doc,"resend")} className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold hover:bg-amber-200 transition-colors">Resend</button>}
              {["in_review","draft"].includes(doc.status) && <button className="px-2.5 py-1 bg-muted text-muted-foreground rounded-lg text-xs font-semibold hover:bg-muted/80 transition-colors">View</button>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">No documents found</div>}
      </div>
    </div>
  );
}

// ── Audit Modal ────────────────────────────────────────────────────────────────
function AuditModal({ doc, onClose }) {
  const events = doc.id === "SFP-20260420-9821" ? AUDIT_EVENTS : AUDIT_EVENTS.slice(0,3);
  const statusConfig = {
    complete: { color: "bg-blue-500", icon: "Circle" },
    view:     { color: "bg-violet-500", icon: "Eye" },
    signed:   { color: "bg-emerald-500", icon: "Check" },
    final:    { color: "bg-primary", icon: "Lock" },
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onClose} className="text-xs text-primary font-medium flex items-center gap-1 mb-2 hover:underline">
            <Icon name="ArrowLeft" size={12} color="currentColor" /> Back to Documents
          </button>
          <h2 className="text-2xl font-bold text-foreground">Audit Trail</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{doc.name} · {doc.id} · SHA-256 verified</p>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 border border-border rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
          <Icon name="Download" size={13} color="currentColor" /> Export PDF
        </button>
      </div>
      <div className="relative">
        <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" />
        {events.map(ev => {
          const cfg = statusConfig[ev.status] || statusConfig.complete;
          return (
            <div key={ev.id} className="flex gap-4 mb-4 relative">
              <div className={`w-10 h-10 rounded-full ${cfg.color} border-2 border-card flex items-center justify-center flex-shrink-0 z-10`}>
                <Icon name={cfg.icon} size={14} color="white" />
              </div>
              <div className="bg-card border border-border rounded-xl p-4 flex-1">
                <p className="text-sm font-semibold text-foreground mb-1">{ev.action}</p>
                <p className="text-xs text-muted-foreground mb-1">By: {ev.actor} · {ev.time}</p>
                <p className="text-xs text-muted-foreground mb-1">IP: {ev.ip} · Device: {ev.device}</p>
                <p className="text-xs text-foreground mb-2">{ev.detail}</p>
                <div className="bg-muted/50 rounded-lg px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  hash: {ev.hash} {ev.status === "final" && <span className="text-emerald-600 font-bold">· IMMUTABLE</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sign Document ──────────────────────────────────────────────────────────────
function SignDocument({ docs, onStartSigning }) {
  const pending = docs.filter(d => d.status === "pending" || d.status === "sent");

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-foreground">Sign a Document</h1>
      <p className="text-sm text-muted-foreground">Choose a pending document to sign</p>
      {pending.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Icon name="CheckCircle" size={22} color="#059669" />
          </div>
          <p className="text-base font-semibold text-foreground">No pending documents</p>
          <p className="text-sm text-muted-foreground mt-1">All documents have been signed</p>
        </div>
      ) : pending.map(doc => (
        <div key={doc.id} className="bg-card border border-border rounded-xl p-5 flex items-center justify-between hover:border-primary/40 transition-colors">
          <div className="flex items-center gap-3">
            <FileTypeBadge type={doc.type} />
            <div>
              <p className="text-sm font-semibold text-foreground">{doc.name}</p>
              <p className="text-xs text-muted-foreground">{doc.id} · {doc.sent ? fmtDate(doc.sent) : "—"}</p>
            </div>
          </div>
          <button onClick={() => onStartSigning(doc)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
            <Icon name="PenTool" size={13} color="currentColor" /> Sign Now
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Upload ─────────────────────────────────────────────────────────────────────
function Upload({ setDocs, setActive }) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [signers, setSigners] = useState([{ email: "", role: "Signer" }]);
  const [order, setOrder] = useState("sequential");
  const [sent, setSent] = useState(false);

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  function handleSend() {
    if (!file) return;
    const newDoc = {
      id: `SFP-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ""),
      type: file.name.split(".").pop().toUpperCase(),
      pages: Math.floor(Math.random() * 10) + 1,
      status: "pending",
      signers: signers.filter(s => s.email).map(s => ({ name: s.email.split("@")[0], initials: s.email.slice(0,2).toUpperCase(), signed: false, role: s.role })),
      sent: new Date().toISOString().split("T")[0],
      due: new Date(Date.now() + 7*864e5).toISOString().split("T")[0],
      external: true,
    };
    setDocs(prev => [newDoc, ...prev]);
    setSent(true);
  }

  if (sent) return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Icon name="Send" size={28} color="#059669" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Document Sent!</h2>
        <p className="text-sm text-muted-foreground mb-6">Secure signing links have been dispatched to all signers. You'll be notified when each party signs.</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => { setSent(false); setFile(null); setSigners([{ email: "", role: "Signer" }]); }}
            className="px-4 py-2 border border-border rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
            Upload Another
          </button>
          <button onClick={() => setActive("documents")}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
            View Documents
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload & Send Document</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Upload a document, add signers, and send secure signing links.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <div className="space-y-4">
          {/* Drop zone */}
          <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}>
            {file ? (
              <div>
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Icon name="FileText" size={22} color="var(--color-primary)" />
                </div>
                <p className="font-semibold text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{(file.size/1024).toFixed(1)} KB</p>
                <button onClick={() => setFile(null)} className="mt-3 text-xs text-red-500 hover:text-red-600">Remove</button>
              </div>
            ) : (
              <>
                <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Icon name="Upload" size={22} color="var(--color-muted-foreground)" />
                </div>
                <p className="font-semibold text-foreground text-sm">Drag & drop your document here</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">PDF, Word (.docx), Excel (.xlsx) · Max 50MB</p>
                <label className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-semibold cursor-pointer hover:bg-primary/90 transition-colors">
                  Browse Files
                  <input type="file" accept=".pdf,.docx,.xlsx" onChange={e => setFile(e.target.files[0])} className="hidden" />
                </label>
              </>
            )}
          </div>

          {/* Convert tools */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-3">Convert Document</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Word → PDF", icon: "FileText" },
                { label: "PDF → Editable", icon: "Edit" },
                { label: "Excel → PDF", icon: "Table" },
                { label: "Merge PDFs", icon: "Layers" },
              ].map(c => (
                <button key={c.label} className="flex items-center gap-2 p-3 bg-muted/30 border border-border rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-left">
                  <Icon name={c.icon} size={14} color="currentColor" />
                  <span className="text-xs font-medium">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Signer config */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-3">Add Signers</h3>
            {signers.map((s, i) => (
              <div key={i} className="mb-3">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Signer {i+1} email</label>
                <input value={s.email} onChange={e => setSigners(prev => prev.map((p,j) => j===i ? {...p,email:e.target.value} : p))}
                  placeholder={`signer${i+1}@example.com`}
                  className="w-full px-3 py-2 text-sm border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 mb-1.5" />
                <select value={s.role} onChange={e => setSigners(prev => prev.map((p,j) => j===i ? {...p,role:e.target.value} : p))}
                  className="w-full px-3 py-2 text-xs border border-border rounded-xl bg-background text-muted-foreground focus:outline-none">
                  {["Signer","Approver","Witness","Final Authority"].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            ))}
            <button onClick={() => setSigners(p => [...p, { email: "", role: "Signer" }])}
              className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
              <Icon name="Plus" size={11} color="currentColor" /> Add Signer
            </button>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-base font-semibold text-foreground mb-3">Signing Order</h3>
            {["sequential","parallel"].map(o => (
              <label key={o} className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="radio" name="order" value={o} checked={order===o} onChange={() => setOrder(o)} />
                <span className="text-sm text-foreground capitalize">{o}</span>
                <span className="text-xs text-muted-foreground">{o==="sequential" ? "(A→B→C)" : "(all at once)"}</span>
              </label>
            ))}
          </div>

          <button onClick={handleSend} disabled={!file}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            Send for Signature
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Approval Chains ────────────────────────────────────────────────────────────
function Workflow() {
  const [chains, setChains] = useState([
    { id: 1, name: "Vendor Agreement Approval", type: "sequential", steps: ["Eric N.","Janet K.","Finance Dept.","Director"], active: 1 },
    { id: 2, name: "HR Document Flow", type: "parallel", steps: ["HR Manager","Legal","MD Office"], active: 0 },
  ]);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("sequential");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Approval Chains</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Build multi-step signing workflows with sequential, parallel, or delegated approvals.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        <div className="space-y-4">
          {chains.map(chain => (
            <div key={chain.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-base font-semibold text-foreground">{chain.name}</p>
                  <span className="text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full capitalize">{chain.type}</span>
                </div>
                <span className="text-xs text-muted-foreground">In Progress</span>
              </div>
              <div className="flex items-center gap-0 overflow-x-auto">
                {chain.steps.map((step, i) => (
                  <div key={i} className="flex items-center">
                    <div className="text-center">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold mx-auto mb-1 border-2 ${
                        i < chain.active ? "bg-emerald-500 border-emerald-500 text-white" :
                        i === chain.active ? "bg-primary border-primary text-white" :
                        "bg-muted border-border text-muted-foreground"
                      }`}>
                        {i < chain.active ? <Icon name="Check" size={14} color="white" /> : i + 1}
                      </div>
                      <p className={`text-xs max-w-[60px] text-center ${i === chain.active ? "text-primary font-semibold" : "text-muted-foreground"}`}>{step}</p>
                    </div>
                    {i < chain.steps.length - 1 && (
                      <div className={`w-8 h-0.5 flex-shrink-0 mx-1 mb-4 ${i < chain.active ? "bg-emerald-500" : "bg-border"}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-foreground">Create New Chain</h3>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Chain Name</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Purchase Order Flow"
              className="w-full px-3 py-2 text-sm border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-2">Type</label>
            {["sequential","parallel","delegated"].map(t => (
              <label key={t} className="flex items-center gap-2 mb-1.5 cursor-pointer">
                <input type="radio" name="chaintype" value={t} checked={newType===t} onChange={() => setNewType(t)} />
                <span className="text-sm text-foreground capitalize">{t}</span>
              </label>
            ))}
          </div>
          <button onClick={() => { if (newName) { setChains(p => [...p, { id: Date.now(), name: newName, type: newType, steps: ["Step 1","Step 2","Step 3"], active: 0 }]); setNewName(""); }}}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
            Create Chain
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Notifications ──────────────────────────────────────────────────────────────
function NotificationsPage({ notifs, setNotifs }) {
  const iconMap = { warning: "AlertTriangle", success: "CheckCircle", info: "Info", neutral: "FileText" };
  const colorMap = { warning: "text-amber-600 bg-amber-100", success: "text-emerald-600 bg-emerald-100", info: "text-blue-600 bg-blue-100", neutral: "text-muted-foreground bg-muted" };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
        <button onClick={() => setNotifs(p => p.map(n => ({ ...n, read: true })))}
          className="text-xs text-primary font-medium hover:underline">
          Mark all read
        </button>
      </div>
      <div className="space-y-2">
        {notifs.map(n => (
          <div key={n.id} onClick={() => setNotifs(p => p.map(x => x.id===n.id ? {...x,read:true} : x))}
            className={`flex gap-4 p-4 rounded-xl border cursor-pointer transition-all ${n.read ? "bg-card border-border" : "bg-primary/5 border-primary/20"}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[n.type]}`}>
              <Icon name={iconMap[n.type]} size={15} color="currentColor" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${n.read ? "font-medium" : "font-semibold"} text-foreground`}>{n.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{n.detail}</p>
            </div>
            <div className="flex items-start gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground whitespace-nowrap">{n.time}</span>
              {!n.read && <div className="w-2 h-2 rounded-full bg-primary mt-1 flex-shrink-0" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────────
function Settings() {
  const [pinEnabled, setPinEnabled] = useState(true);
  const [otpEnabled, setOtpEnabled] = useState(true);
  const [sigAlert, setSigAlert] = useState(true);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.width = canvas.offsetWidth;
      canvas.height = 80;
      const ctx = canvas.getContext("2d");
      ctx.strokeStyle = "var(--color-foreground)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctxRef.current = ctx;
      ctx.font = "italic 28px Georgia, serif";
      ctx.fillStyle = "var(--color-foreground)";
      ctx.fillText("Eric Nganga", 20, 55);
    }
  }, []);

  function Toggle({ value, onChange }) {
    return (
      <button onClick={onChange} className={`w-10 h-6 rounded-full relative transition-colors ${value ? "bg-primary" : "bg-muted"}`}>
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${value ? "left-5" : "left-1"}`} />
      </button>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Auth */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-foreground">Signature & Authentication</h3>
          {[
            { label: "Require PIN before signing", val: pinEnabled, fn: () => setPinEnabled(p => !p) },
            { label: "OTP confirmation after signing", val: otpEnabled, fn: () => setOtpEnabled(p => !p) },
            { label: "Signature Alert — notify when signature is used", val: sigAlert, fn: () => setSigAlert(p => !p) },
          ].map(s => (
            <div key={s.label} className="flex items-center justify-between py-3 border-b border-border last:border-0">
              <span className="text-sm text-foreground">{s.label}</span>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${s.val ? "text-emerald-600" : "text-muted-foreground"}`}>{s.val ? "Enabled" : "Disabled"}</span>
                <Toggle value={s.val} onChange={s.fn} />
              </div>
            </div>
          ))}
          <div>
            <p className="text-xs text-muted-foreground mb-2">My Saved Signature</p>
            <canvas ref={canvasRef} className="w-full h-20 border border-border rounded-xl block" />
            <button className="mt-2 text-xs text-primary font-medium hover:underline">Update Signature</button>
          </div>
        </div>

        {/* Profile */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-foreground">Profile</h3>
          <div className="flex items-center gap-3">
            <Avatar initials="EN" size={48} />
            <div>
              <p className="font-semibold text-foreground">{MOCK_USER.name}</p>
              <p className="text-xs text-muted-foreground">{MOCK_USER.role} · {MOCK_USER.email}</p>
            </div>
          </div>
          {[["Full Name", MOCK_USER.name], ["Email", MOCK_USER.email], ["Organization", "AssetFlow Ltd"]].map(([label, val]) => (
            <div key={label}>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">{label}</label>
              <input defaultValue={val} className="w-full px-3 py-2 text-sm border border-border rounded-xl bg-muted/30 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          ))}
        </div>

        {/* Team */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-base font-semibold text-foreground mb-4">Team Members</h3>
          {[
            { name: "Janet Kamau", role: "Finance", initials: "JK" },
            { name: "M. Ochieng", role: "Director", initials: "MD" },
            { name: "HR Department", role: "HR Admin", initials: "HR" },
          ].map(m => (
            <div key={m.name} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
              <Avatar initials={m.initials} size={34} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{m.name}</p>
                <p className="text-xs text-muted-foreground">{m.role}</p>
              </div>
              <select className="text-xs border border-border rounded-lg px-2 py-1 bg-background text-muted-foreground focus:outline-none">
                <option>Internal Signer</option>
                <option>Administrator</option>
                <option>Viewer</option>
              </select>
            </div>
          ))}
          <button className="mt-3 w-full py-2 border border-dashed border-border rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1">
            <Icon name="Plus" size={12} color="currentColor" /> Invite Team Member
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Audit Trail Page ───────────────────────────────────────────────────────────
function AuditPage({ docs }) {
  const [selectedId, setSelectedId] = useState("SFP-20260420-9821");
  const doc = docs.find(d => d.id === selectedId) || docs.find(d => d.status === "completed");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Audit Trail</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Tamper-proof, immutable event log for all document activity.</p>
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Select Document</label>
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[320px]">
          {docs.filter(d => d.status === "completed" || d.status === "pending" || d.status === "signed").map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      {doc && <AuditModal doc={doc} onClose={() => {}} />}
    </div>
  );
}

// ── Co-Sign ────────────────────────────────────────────────────────────────────
function CoSign({ docs }) {
  const pending = [
    { doc: "Vendor Agreement", from: "Procurement", due: "May 2", waiting: "Janet K." },
    { doc: "NDA Amendment", from: "Legal Dept", due: "May 10", waiting: "Legal Dept." },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Co-Signing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage parallel signing and co-signatory invitations.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <div className="space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground mb-3">Pending Co-Sign Requests</h3>
            {pending.map(p => (
              <div key={p.doc} className="bg-card border border-border rounded-xl p-5 mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{p.doc}</p>
                  <p className="text-xs text-muted-foreground mt-1">Awaiting {p.waiting} · Expires {p.due}</p>
                </div>
                <button className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-xl text-xs font-semibold hover:bg-amber-200 transition-colors">Remind</button>
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-base font-semibold text-foreground mb-3">Awaiting Your Signature</h3>
            {[
              { doc: "Employment Contract — James M.", from: "HR Dept.", due: "May 1", role: "Employer", urgent: true },
              { doc: "Vendor Agreement — TechParts", from: "Procurement", due: "May 5", role: "Approver" },
            ].map(d => (
              <div key={d.doc} className={`bg-card border rounded-xl p-5 mb-3 flex items-center justify-between ${d.urgent ? "border-amber-200 bg-amber-50/50 dark:bg-amber-900/10" : "border-border"}`}>
                <div>
                  <p className="text-sm font-semibold text-foreground">{d.doc}</p>
                  <p className="text-xs text-muted-foreground mt-1">From: {d.from} · Role: {d.role} · Due: {d.due} {d.urgent && "⚠️"}</p>
                </div>
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:bg-primary/90 transition-colors">
                  <Icon name="PenTool" size={12} color="currentColor" /> Sign Now
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-foreground">Invite Co-Signers</h3>
          {[
            { email: "james@co.ke", initials: "JM", role: "Signer 1 · Approver" },
            { email: "finance@co.ke", initials: "FD", role: "Signer 2 · Witness" },
            { email: "md@co.ke", initials: "MD", role: "Signer 3 · Final Auth." },
          ].map(s => (
            <div key={s.email} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
              <Avatar initials={s.initials} size={30} />
              <div className="flex-1">
                <p className="text-xs font-semibold text-foreground">{s.email}</p>
                <p className="text-xs text-muted-foreground">{s.role}</p>
              </div>
              <button className="text-muted-foreground hover:text-red-500 transition-colors">
                <Icon name="X" size={14} color="currentColor" />
              </button>
            </div>
          ))}
          <button className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
            <Icon name="Plus" size={11} color="currentColor" /> Add Co-Signer
          </button>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Signing Order</label>
            <select className="w-full px-3 py-2 text-sm border border-border rounded-xl bg-background text-foreground focus:outline-none">
              <option>Sequential A→B→C</option>
              <option>Parallel (all at once)</option>
            </select>
          </div>
          <button className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
            Send Invitations
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ESignaturePage() {
  const [active, setActive]           = useState("dashboard");
  const [adminId, setAdminId]         = useState(null);
  const [dbContracts, setDbContracts] = useState([]);
  const [localDocs, setLocalDocs]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [selectedContract, setSelected] = useState(null);
  const [showOTP, setShowOTP]         = useState(false);
  const [signature, setSignature]     = useState(null);
  const [signingStep, setSigningStep] = useState(1);
  const [auditEvents, setAuditEvents] = useState([]);
  const [notifs, setNotifs]           = useState([
    { id: 1, type: "info", title: "E-Signature module loaded", detail: "Contracts synced from database", time: "Just now", read: false },
  ]);
  const [selectedDoc, setSelectedDoc] = useState(null);

  const dbDocs = dbContracts.map(c => ({
    id: c.invoice_number || c.id,
    _dbId: c.id,
    name: (c.pricing_model === "installment" ? "Hire Purchase Agreement" : "Sale Agreement") + " — " + (c.client_name || "Client"),
    type: "PDF", pages: 4,
    status: c.esign_status || "pending",
    signers: [
      { name: c.client_name || "Client", initials: (c.client_name || "CL").slice(0,2).toUpperCase(), signed: ["signed","completed","settled"].includes(c.esign_status), role: "Buyer" },
      { name: "Authorized Officer", initials: "AO", signed: ["signed","completed","settled"].includes(c.esign_status), role: "Vendor" },
    ],
    sent: c.generated_at, due: null, external: false, _raw: c,
  }));

  const docs = [...dbDocs, ...localDocs.length > 0 ? localDocs : MOCK_DOCS];
  const unread = notifs.filter(n => !n.read).length;

  useEffect(() => {
    const boot = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase.from("user_profiles").select("role, admin_id").eq("id", user.id).single();
        const aId = profile?.role === "admin" ? user.id : (profile?.admin_id || user.id);
        setAdminId(aId);
        await fetchContracts(aId);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    boot();
  }, []);

  const fetchContracts = async (aId) => {
    if (!aId) return;
    try {
      const { data } = await supabase
        .from("generated_contracts")
        .select("id, invoice_number, client_name, pricing_model, generated_at, esign_status, signed_at, admin_id, sale:sales(total_amount, sale_date), client:clients(full_name, phone, email)")
        .eq("admin_id", aId)
        .order("generated_at", { ascending: false });
      setDbContracts(data || []);
    } catch (err) { console.error("fetchContracts:", err.message); }
  };

  const updateStatus = async (docId, newStatus) => {
    const doc = docs.find(d => d.id === docId || d._dbId === docId);
    const dbId = doc?._dbId || docId;
    await supabase.from("generated_contracts").update({ esign_status: newStatus }).eq("id", dbId);
    if (adminId) await fetchContracts(adminId);
  };

  const startSigning = (doc) => {
    setSelected(doc._raw || doc);
    setSigningStep(2);
    setSignature(null);
    setAuditEvents([{ type: "view", action: "Contract Opened for Signing", actor: "Admin", time: new Date().toISOString(), ip: "197.232.xx.xx", hash: btoa(doc.id || "x").slice(0,16) + "…" }]);
    setActive("sign");
  };

  const handleOTPVerified = async (otpData) => {
    setShowOTP(false);
    if (!signature || !selectedContract) return;
    const hashInput = (selectedContract.invoice_number || selectedContract.id) + otpData.verifiedAt + (signature.data || "");
    const hash = btoa(hashInput).slice(0,16) + "…" + btoa(hashInput).slice(-8);
    setAuditEvents(prev => [...prev, { type: "signed", action: "Document Signed — OTP Verified", actor: "Authorized Officer", time: new Date().toISOString(), ip: otpData.ip, hash }]);
    try {
      await supabase.from("generated_contracts").update({ esign_status: "signed", signed_at: new Date().toISOString(), signature_hash: hash, signature_type: signature.type }).eq("id", selectedContract.id);
    } catch (err) { console.error(err); }
    setSigningStep(3);
    if (adminId) await fetchContracts(adminId);
  };

  const NAV_ITEMS = [
    { id: "dashboard", icon: "LayoutDashboard", label: "Dashboard" },
    { id: "documents", icon: "FileText",        label: "All Documents" },
    { id: "sign",      icon: "PenTool",         label: "Sign a Document" },
    { id: "upload",    icon: "Upload",          label: "Upload & Convert" },
    { id: "workflow",  icon: "GitBranch",       label: "Approval Chains" },
    { id: "cosign",    icon: "Users",           label: "Co-Signing" },
    { id: "audit",     icon: "Search",          label: "Audit Trail" },
  ];

  const stats = {
    total: docs.length,
    pending: docs.filter(d => ["pending","sent"].includes(d.status)).length,
    signed: docs.filter(d => d.status === "signed").length,
  };

  return (
    <MainLayout>
      <div className="p-5 space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">E-Signature</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Document signing, approval chains and audit trail</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setActive("notifications")}
              className={`relative w-9 h-9 flex items-center justify-center rounded-xl border transition-colors ${active === "notifications" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
              <Icon name="Bell" size={16} color="currentColor" />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{unread}</span>
              )}
            </button>
            <button onClick={() => setActive("settings")}
              className={`w-9 h-9 flex items-center justify-center rounded-xl border transition-colors ${active === "settings" ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
              <Icon name="Settings" size={16} color="currentColor" />
            </button>
            <button onClick={() => setActive("upload")}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
              <Icon name="Plus" size={14} color="currentColor" /> New Document
            </button>
          </div>
        </div>

        {/* Tab bar — pill style, single line */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {NAV_ITEMS.map(n => (
            <button key={n.id} onClick={() => setActive(n.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap border transition-colors flex-shrink-0 ${
                active === n.id
                  ? "border-primary/30 bg-primary/10 text-primary font-semibold"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}>
              <Icon name={n.icon} size={13} color="currentColor" />
              {n.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {active === "dashboard" && <Dashboard docs={docs} setActive={setActive} setSelectedDoc={(d) => { setSelectedDoc(d); setActive("documents"); }} />}
          {active === "documents" && <Documents docs={docs} setDocs={setLocalDocs} setActive={setActive} extra={{ updateStatus }} />}
          {active === "sign" && (
            <>
              {signingStep === 1 && <SignDocument docs={docs} onStartSigning={startSigning} />}
              {signingStep === 2 && selectedContract && (
                <div className="space-y-5 max-w-2xl mx-auto">
                  <button onClick={() => setSigningStep(1)} className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">
                    <Icon name="ArrowLeft" size={12} color="currentColor" /> Back
                  </button>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">Sign Contract</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">{selectedContract.invoice_number} — {selectedContract.client_name}</p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-5">
                    <h3 className="text-base font-semibold text-foreground mb-4">Your Signature</h3>
                    <SignatureCanvas onCapture={(sig) => { setSignature(sig); setShowOTP(true); }} />
                  </div>
                </div>
              )}
              {signingStep === 3 && (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center max-w-sm">
                    <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Icon name="CheckCircle" size={30} color="#059669" />
                    </div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Contract Signed!</h2>
                    <p className="text-sm text-muted-foreground mb-6">Audit trail recorded. All parties have been notified.</p>
                    <button onClick={() => { setSigningStep(1); setActive("dashboard"); }}
                      className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
                      Back to Dashboard
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {active === "upload"        && <Upload setDocs={(newDoc) => setLocalDocs(p => [newDoc, ...p])} setActive={setActive} />}
          {active === "workflow"      && <Workflow />}
          {active === "cosign"        && <CoSign docs={docs} />}
          {active === "audit"         && <AuditPage docs={docs} />}
          {active === "notifications" && <NotificationsPage notifs={notifs} setNotifs={setNotifs} />}
          {active === "settings"      && <Settings />}
        </div>
      </div>

      {showOTP && (
        <OTPModal
          signer={{ name: "Authorized Officer", phone: "+254 7XX XXX XXX" }}
          onVerified={handleOTPVerified}
          onClose={() => { setShowOTP(false); setSignature(null); }}
        />
      )}
    </MainLayout>
  );
}
