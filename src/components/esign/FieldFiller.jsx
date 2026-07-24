import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Icon from "../AppIcon";
import PdfFieldCanvas from "./PdfFieldCanvas";
import SignatureCanvas from "./SignatureCanvas";

// FieldFiller — the signer's side. Renders the document and shows ONLY this
// signer's assigned fields as clickable hotspots. signature/initials open a
// signature pad; date/text open a small modal; checkbox toggles in place.
// onComplete receives [{ id, value }] for every field the signer filled.
//
// value convention (matches applyFieldsToPDF / esign-public):
//   signature|initials → JSON.stringify({ type, data, font })
//   date|text          → plain string
//   checkbox           → "true" | "false"

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
};

const isFilled = (v) => v != null && v !== "" && v !== "false";

const TYPE_HINT = { signature: "Sign", initials: "Initials", date: "Date", text: "Text", checkbox: "" };
const NEXT_LABEL = { signature: "Sign here", initials: "Add initials", date: "Set date", text: "Fill in text", checkbox: "Tick box" };

function preview(f, v) {
  if (!isFilled(v)) return <span className="truncate px-1 leading-none">{TYPE_HINT[f.field_type] || "Field"}</span>;
  if (f.field_type === "signature" || f.field_type === "initials") {
    try {
      const cap = JSON.parse(v);
      if (cap.type === "drawn") return <img src={cap.data} alt="signature" className="max-h-full max-w-full object-contain" />;
      return <span className="truncate px-1 leading-none" style={{ fontFamily: cap.font }}>{cap.data}</span>;
    } catch { return <span className="truncate px-1 leading-none">Signed</span>; }
  }
  return <span className="truncate px-1 leading-none">{v}</span>;
}

// Modal for the field types that need input (everything except checkbox).
function FillModal({ field, value, onClose, onSave }) {
  const type = field.field_type;
  const [text, setText] = useState(type === "text" && value ? value : "");
  const [dateVal, setDateVal] = useState(() => new Date().toISOString().slice(0, 10));
  const title = { signature: "Add your signature", initials: "Add your initials", date: "Select a date", text: "Enter text" }[type] || "Fill field";

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={16} color="var(--color-muted-foreground)" />
          </button>
        </div>
        <div className="p-5">
          {(type === "signature" || type === "initials") && (
            <SignatureCanvas onCapture={(cap) => onSave(JSON.stringify(cap))} />
          )}
          {type === "text" && (
            <>
              <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={field.placeholder || "Type here"}
                className="w-full px-3 py-2 border border-border rounded-xl text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <button onClick={() => onSave(text.trim())} disabled={!text.trim()}
                className="mt-3 w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">Save</button>
            </>
          )}
          {type === "date" && (
            <>
              <input type="date" value={dateVal} onChange={e => setDateVal(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-xl text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <button onClick={() => onSave(fmtDate(dateVal))}
                className="mt-3 w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">Save</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FieldFiller({ fileUrl, fields = [], signerName, submitting = false, onComplete }) {
  const [values, setValues] = useState({});
  const [editing, setEditing] = useState(null);
  const [docReady, setDocReady] = useState(false);
  const [activeId, setActiveId] = useState(null); // field currently highlighted by the guide
  const fieldRefs = useRef({});      // field id -> overlay <button>
  const scrollRef = useRef(null);    // the document scroll container
  const advanceRef = useRef(false);  // scroll to the next field after the current one is filled
  const highlightTimer = useRef(null);
  const snapTimer = useRef(null);

  const setValue = useCallback((id, v) => setValues(prev => ({ ...prev, [id]: v })), []);

  // Date fields are pre-filled with today's date automatically (SignNow-style);
  // the signer can still click one to change it.
  useEffect(() => {
    setValues(prev => {
      let changed = false;
      const next = { ...prev };
      for (const f of fields) {
        if (f.field_type === "date" && next[f.id] == null) {
          next[f.id] = fmtDate(new Date().toISOString());
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [fields]);

  const requiredIds = fields.filter(f => f.required).map(f => f.id);
  const filledCount = requiredIds.filter(id => isFilled(values[id])).length;
  const allDone = filledCount >= requiredIds.length;

  // Reading order for the guide: page, then top-to-bottom, then left-to-right.
  const orderedFields = useMemo(
    () => [...fields].sort((a, b) => a.page_index - b.page_index || a.pos_y - b.pos_y || a.pos_x - b.pos_x),
    [fields]
  );
  // Next stop: first unfilled required field; if the sender marked nothing
  // required, walk the optional ones instead.
  const nextField =
    orderedFields.find(f => f.required && !isFilled(values[f.id])) ||
    (requiredIds.length === 0 ? orderedFields.find(f => !isFilled(values[f.id])) : null) ||
    null;
  const nextFieldRef = useRef(nextField);
  nextFieldRef.current = nextField;

  // Center the field inside the document scroll container. Smooth when the
  // browser animates it; if the animation never runs (throttled tabs), snap.
  const goToField = useCallback((f) => {
    const el = f && fieldRefs.current[f.id];
    const box = scrollRef.current;
    if (!el || !box) return;
    const elRect = el.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const raw = box.scrollTop + (elRect.top - boxRect.top) - box.clientHeight / 2 + elRect.height / 2;
    const top = Math.max(0, Math.min(raw, box.scrollHeight - box.clientHeight));
    box.scrollTo({ top, behavior: "smooth" });
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      if (Math.abs(box.scrollTop - top) > 4) box.scrollTop = top;
    }, 600);
    setActiveId(f.id);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setActiveId(null), 2000);
  }, []);

  useEffect(() => () => { clearTimeout(highlightTimer.current); clearTimeout(snapTimer.current); }, []);

  // Once the document renders, scan for this signer's fields and take them to
  // the first spot that needs attention.
  useEffect(() => {
    if (!docReady) return;
    const t = setTimeout(() => goToField(nextFieldRef.current), 450);
    return () => clearTimeout(t);
  }, [docReady, goToField]);

  // After a field is filled, glide to the next unfilled one.
  useEffect(() => {
    if (!advanceRef.current) return;
    advanceRef.current = false;
    goToField(nextFieldRef.current);
  }, [values, goToField]);

  const openField = (f) => {
    if (f.field_type === "checkbox") {
      const turningOn = values[f.id] !== "true";
      if (turningOn) advanceRef.current = true;
      setValue(f.id, turningOn ? "true" : "false");
      return;
    }
    setEditing(f);
  };

  const overlay = (page) => fields.filter(f => f.page_index === page.index).map(f => {
    const v = values[f.id];
    const done = f.field_type === "checkbox" ? v === "true" : isFilled(v);
    const active = f.id === activeId;
    return (
      <button key={f.id} ref={el => { fieldRefs.current[f.id] = el; }}
        onClick={(e) => { e.stopPropagation(); openField(f); }}
        className="absolute rounded-md border-2 border-dashed flex items-center justify-center text-[10px] font-semibold pointer-events-auto overflow-hidden transition-all duration-300"
        style={{ left: `${f.pos_x * 100}%`, top: `${f.pos_y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%`,
          borderColor: active ? "#f59e0b" : done ? "#059669" : "#2563eb",
          background: active ? "rgba(245,158,11,0.18)" : done ? "rgba(5,150,105,0.14)" : "rgba(37,99,235,0.12)",
          boxShadow: active ? "0 0 0 4px rgba(245,158,11,0.35)" : undefined,
          color: done ? "#047857" : "#1d4ed8" }}>
        {f.field_type === "checkbox"
          ? (v === "true" ? <Icon name="Check" size={14} color="#059669" /> : null)
          : preview(f, v)}
      </button>
    );
  });

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-700 flex items-center gap-2">
        <Icon name="PenTool" size={14} color="#1d4ed8" />
        We'll take you to each place that needs your attention{signerName ? `, ${signerName}` : ""} — click a highlighted field to complete it.
      </div>

      <div ref={scrollRef} className="bg-muted/20 border border-border rounded-xl p-4 max-h-[60vh] overflow-y-auto">
        {docReady && fields.length > 0 && (
          <div className="sticky top-1 z-10 h-0 flex justify-end pointer-events-none">
            {nextField ? (
              <button onClick={() => goToField(nextField)}
                className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-amber-400 text-amber-950 text-xs font-bold shadow-lg hover:bg-amber-300 transition-colors">
                <Icon name="ArrowDown" size={13} color="#451a03" />
                Next: {NEXT_LABEL[nextField.field_type] || "Field"}
              </button>
            ) : (
              <span className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-emerald-500 text-white text-xs font-bold shadow-lg">
                <Icon name="Check" size={13} color="white" />
                All fields completed
              </span>
            )}
          </div>
        )}
        <PdfFieldCanvas fileUrl={fileUrl} renderPageOverlay={overlay} onReady={() => setDocReady(true)} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{filledCount} of {requiredIds.length} required field(s) completed</p>
        <button
          onClick={() => onComplete(fields.filter(f => values[f.id] != null).map(f => ({ id: f.id, value: values[f.id] })))}
          disabled={!allDone || submitting}
          className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
          {submitting ? "Submitting…" : "Finish & Sign"}
        </button>
      </div>

      {editing && (
        <FillModal field={editing} value={values[editing.id]}
          onClose={() => setEditing(null)}
          onSave={(v) => { if (isFilled(v)) advanceRef.current = true; setValue(editing.id, v); setEditing(null); }} />
      )}
    </div>
  );
}
