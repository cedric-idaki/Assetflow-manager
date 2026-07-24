import { useState, useRef, useEffect, useCallback } from "react";
import Icon from "../AppIcon";
import PdfFieldCanvas from "./PdfFieldCanvas";
import { detectSignableAreas } from "../../utils/detectSignableAreas";

// FieldEditor — the sender's SignNow-style field placement surface. Pick a
// signer and a field type, then click the document to drop a field; drag to
// move, drag the corner to resize, × to delete. Coordinates are normalized
// (0..1 of the page box). onSave receives the placed fields; an empty array is
// valid (the document then falls back to single-signature capture).

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const FIELD_TYPES = [
  { id: "signature", label: "Signature", icon: "PenTool",     w: 0.24, h: 0.060 },
  { id: "initials",  label: "Initials",  icon: "Type",        w: 0.10, h: 0.050 },
  { id: "date",      label: "Date",      icon: "Calendar",    w: 0.16, h: 0.035 },
  { id: "text",      label: "Text",      icon: "AlignLeft",   w: 0.22, h: 0.035 },
  { id: "checkbox",  label: "Checkbox",  icon: "CheckSquare", w: 0.035, h: 0.025 },
];
const TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map(t => [t.id, t.label]));

const SIGNER_COLORS = [
  { solid: "#2563eb", soft: "rgba(37,99,235,0.16)" },
  { solid: "#7c3aed", soft: "rgba(124,58,237,0.16)" },
  { solid: "#059669", soft: "rgba(5,150,105,0.16)" },
  { solid: "#d97706", soft: "rgba(217,119,6,0.16)" },
  { solid: "#db2777", soft: "rgba(219,39,119,0.16)" },
];

// A single placed field: handles its own drag-move and corner-resize.
function FieldBox({ field, color, label, onChange, onRemove, suppressRef }) {
  const boxRef = useRef(null);
  const drag = useRef(null);

  const pageRect = () => boxRef.current?.parentElement?.getBoundingClientRect();

  const begin = (mode) => (e) => {
    e.stopPropagation(); e.preventDefault();
    const rect = pageRect(); if (!rect) return;
    drag.current = {
      mode, moved: false, startX: e.clientX, startY: e.clientY, rw: rect.width, rh: rect.height,
      ox: field.pos_x, oy: field.pos_y, ow: field.width, oh: field.height, px: field.pos_x, py: field.pos_y, w: field.width, h: field.height,
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.startX) / d.rw;
    const dy = (e.clientY - d.startY) / d.rh;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    if (d.mode === "move") {
      onChange(field.tmpId, { pos_x: clamp(d.ox + dx, 0, 1 - d.w), pos_y: clamp(d.oy + dy, 0, 1 - d.h) });
    } else {
      onChange(field.tmpId, { width: clamp(d.ow + dx, 0.03, 1 - d.px), height: clamp(d.oh + dy, 0.015, 1 - d.py) });
    }
  };
  const onUp = () => {
    if (drag.current?.moved && suppressRef) suppressRef.current = Date.now();
    drag.current = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  return (
    <div ref={boxRef}
      onMouseDown={begin("move")} onClick={(e) => e.stopPropagation()}
      className="absolute rounded-md border-2 flex items-center justify-center text-[10px] font-semibold select-none cursor-move pointer-events-auto overflow-hidden"
      style={{ left: `${field.pos_x * 100}%`, top: `${field.pos_y * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%`,
        borderColor: color.solid, background: color.soft, color: color.solid }}>
      <span className="truncate px-1 leading-none">{label}</span>
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(field.tmpId); }}
        className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] leading-none shadow pointer-events-auto">×</button>
      <span onMouseDown={begin("resize")}
        className="absolute -bottom-1 -right-1 w-3 h-3 rounded-sm cursor-se-resize pointer-events-auto"
        style={{ background: color.solid }} />
    </div>
  );
}

export default function FieldEditor({ fileUrl, signers = [], onSave, onBack, saving = false }) {
  const usable = signers.filter(s => s.id);
  const [fields, setFields] = useState([]);
  const [activeType, setActiveType] = useState("signature");
  const [activeSigner, setActiveSigner] = useState(usable[0]?.id || null);
  const [suggestions, setSuggestions] = useState(null); // null = not scanned yet
  const [detecting, setDetecting] = useState(false);
  const [sendError, setSendError] = useState("");
  const suppressRef = useRef(0);

  // SignNow-style auto-detection: scan the document's text layer for signable
  // segments (labels, underscore lines, {{tags}}, checkboxes) and suggest them.
  const runDetect = useCallback(async () => {
    if (!fileUrl) return;
    setDetecting(true);
    try {
      const found = await detectSignableAreas(fileUrl);
      setSuggestions(found);
    } catch (err) {
      console.warn("detectSignableAreas:", err.message);
      setSuggestions([]);
    } finally {
      setDetecting(false);
    }
  }, [fileUrl]);

  useEffect(() => { runDetect(); }, [runDetect]);

  // Accept the suggestions: anchor-tag fields go to their tagged signer index,
  // everything else to the currently selected signer. All remain editable.
  const applySuggestions = () => {
    if (!suggestions?.length) { setSuggestions(null); return; }
    const mapped = suggestions.map((s, i) => {
      const signerId = (s.signerIndex != null && usable[s.signerIndex]?.id) ? usable[s.signerIndex].id : activeSigner;
      if (!signerId) return null;
      const { signerIndex, ...rest } = s;
      return { ...rest, signer_id: signerId, tmpId: `det-${Date.now()}-${i}` };
    }).filter(Boolean);
    setFields(prev => [...prev, ...mapped]);
    setSuggestions(null);
  };

  const colorIdx = (signerId) => Math.max(0, usable.findIndex(s => s.id === signerId));
  const colorFor = (signerId) => SIGNER_COLORS[colorIdx(signerId) % SIGNER_COLORS.length];
  const signerName = (signerId) => { const s = usable.find(x => x.id === signerId); return s?.name || s?.email || "Signer"; };

  const addField = useCallback((pageIndex, nx, ny) => {
    if (Date.now() - suppressRef.current < 300) return; // trailing click after a drag
    if (!activeSigner) return;
    const t = FIELD_TYPES.find(t => t.id === activeType) || FIELD_TYPES[0];
    setFields(prev => [...prev, {
      tmpId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      signer_id: activeSigner, field_type: activeType, page_index: pageIndex,
      pos_x: clamp(nx - t.w / 2, 0, 1 - t.w), pos_y: clamp(ny - t.h / 2, 0, 1 - t.h),
      width: t.w, height: t.h, required: true,
    }]);
  }, [activeSigner, activeType]);

  const patchField  = useCallback((tmpId, patch) => setFields(prev => prev.map(f => f.tmpId === tmpId ? { ...f, ...patch } : f)), []);
  const removeField = useCallback((tmpId) => setFields(prev => prev.filter(f => f.tmpId !== tmpId)), []);

  const overlay = (page) => fields.filter(f => f.page_index === page.index).map(f => (
    <FieldBox key={f.tmpId} field={f} color={colorFor(f.signer_id)} label={TYPE_LABEL[f.field_type]}
      onChange={patchField} onRemove={removeField} suppressRef={suppressRef} />
  ));

  const countFor = (signerId) => fields.filter(f => f.signer_id === signerId).length;

  // With multiple signatories every allocated signer must have at least one
  // field, otherwise they'd receive a link with nothing to sign. Single-signer
  // documents may be sent with no fields (they fall back to signature capture).
  const handleSend = () => {
    if (usable.length >= 2) {
      const missing = usable.filter(s => countFor(s.id) === 0);
      if (missing.length) {
        setSendError(`Place at least one field for: ${missing.map(s => s.name || s.email).join(", ")}. Every signatory needs somewhere to sign.`);
        return;
      }
    }
    setSendError("");
    onSave(fields);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="text-xs text-primary font-medium flex items-center gap-1 mb-1 hover:underline">
            <Icon name="ArrowLeft" size={12} color="currentColor" /> Back
          </button>
          <h2 className="text-2xl font-bold text-foreground">Place signature fields</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Pick a signer and a field, then click the document to drop it. Drag to move, corner to resize.</p>
        </div>
        <button onClick={handleSend} disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60">
          <Icon name="Send" size={14} color="currentColor" /> {saving ? "Sending…" : `Save & Send (${fields.length})`}
        </button>
      </div>

      {sendError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600 flex items-center gap-2">
          <Icon name="AlertCircle" size={14} color="currentColor" /> {sendError}
        </div>
      )}

      {/* Auto-detection banner (SignNow-style) */}
      {detecting && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700 flex items-center gap-2">
          <Icon name="Loader" size={14} color="#1d4ed8" /> Scanning the document for signature lines, labels and tags…
        </div>
      )}
      {!detecting && suggestions?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-800 flex items-center gap-2">
            <Icon name="Sparkles" size={14} color="#d97706" />
            We detected <strong>{suggestions.length} signable area{suggestions.length > 1 ? "s" : ""}</strong> in this
            document (signature lines, labels{suggestions.some(s => s.mask) ? ", tags" : ""}). Add them and adjust as needed.
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => setSuggestions(null)}
              className="px-3 py-1.5 border border-amber-300 text-amber-700 rounded-lg text-xs font-semibold hover:bg-amber-100 transition-colors">Dismiss</button>
            <button onClick={applySuggestions}
              className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors">
              Add {suggestions.length} field{suggestions.length > 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
        {/* Tool rail */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Signer</h3>
            <div className="space-y-1.5">
              {usable.map((s) => {
                const c = SIGNER_COLORS[colorIdx(s.id) % SIGNER_COLORS.length];
                const active = activeSigner === s.id;
                return (
                  <button key={s.id} onClick={() => setActiveSigner(s.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${active ? "bg-muted" : "hover:bg-muted/50"}`}>
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.solid }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold text-foreground truncate">{s.name || s.email}</span>
                      <span className="block text-[11px] text-muted-foreground truncate">{s.role || "Signer"}</span>
                    </span>
                    <span className="text-[11px] font-semibold text-muted-foreground">{countFor(s.id)}</span>
                  </button>
                );
              })}
              {usable.length === 0 && <p className="text-xs text-muted-foreground">No signers added.</p>}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Field</h3>
            <div className="grid grid-cols-2 gap-2">
              {FIELD_TYPES.map(t => (
                <button key={t.id} onClick={() => setActiveType(t.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors ${activeType === t.id ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
                  <Icon name={t.icon} size={13} color="currentColor" /> {t.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">Click the page to place a <strong>{TYPE_LABEL[activeType]}</strong> for <strong>{signerName(activeSigner)}</strong>.</p>
            <button onClick={runDetect} disabled={detecting}
              className="mt-3 w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50">
              <Icon name="Sparkles" size={13} color="currentColor" /> {detecting ? "Scanning…" : "Auto-detect fields"}
            </button>
          </div>
        </div>

        {/* Document */}
        <div className="bg-muted/20 border border-border rounded-xl p-4 max-h-[70vh] overflow-y-auto">
          <PdfFieldCanvas fileUrl={fileUrl} onPageClick={addField} renderPageOverlay={overlay} />
        </div>
      </div>
    </div>
  );
}
