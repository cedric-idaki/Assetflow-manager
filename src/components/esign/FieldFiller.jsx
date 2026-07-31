import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Icon from "../AppIcon";
import PdfFieldCanvas from "./PdfFieldCanvas";
import InPlaceSigner, { getSavedCapture } from "./InPlaceSigner";

// FieldFiller — the signer's SignNow-style workspace. The document fills the
// screen with a viewer toolbar (page / zoom / progress), each of THIS signer's
// fields is a gold tag on the page, and a pointed "Sign" flag walks them from
// field to field. Signature/initials open the in-place signer (pen directly on
// the magnified document); once captured, the signature is saved and every
// later signature field applies with one tap. Dates prefill; date/text edit in
// a small popover anchored to the field; checkboxes toggle in place.
//
// onComplete receives [{ id, value }] for every field the signer filled.
//
// value convention (matches applyFieldsToPDF / esign-public):
//   signature|initials → JSON.stringify({ type, data, font })
//   date|text          → plain string
//   checkbox           → "true" | "false"
//
// Optional: onAddField(spec) → field-with-id lets the signer stamp a signature
// ANYWHERE on the document (used when the sender placed no fields).

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
};

const isFilled = (v) => v != null && v !== "" && v !== "false";

const TAG_LABEL  = { signature: "Sign", initials: "Initial", date: "Date", text: "Text", checkbox: "Tick", radio: "Choose", dropdown: "Select" };
const NEXT_LABEL = { signature: "Sign here", initials: "Initial here", date: "Set date", text: "Fill in text", checkbox: "Tick box", radio: "Pick an option", dropdown: "Select an option" };
// Radio and dropdown both store the chosen label as their value.
const CHOICE_TYPES = new Set(["radio", "dropdown"]);
const optionsOf = (f) => (Array.isArray(f?.options) ? f.options.filter(Boolean) : []);
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6, 2];

function FilledPreview({ f, v }) {
  if (f.field_type === "signature" || f.field_type === "initials") {
    try {
      const cap = JSON.parse(v);
      if (cap.type === "drawn") return <img src={cap.data} alt="signature" className="max-h-full max-w-full object-contain" draggable={false} />;
      return <span className="truncate px-0.5 leading-none text-slate-800" style={{ fontFamily: cap.font, fontSize: "min(4vw, 20px)" }}>{cap.data}</span>;
    } catch { return <span className="truncate px-1 leading-none">Signed</span>; }
  }
  return <span className="truncate px-1 leading-none text-slate-800">{v}</span>;
}

// Small popover anchored next to a date/text field (SignNow edits these inline
// rather than in a centred modal).
function FieldPopover({ field, value, anchor, onSave, onClose }) {
  const type = field.field_type;
  const [text, setText] = useState(type === "text" && value ? value : "");
  const [dateVal, setDateVal] = useState(() => new Date().toISOString().slice(0, 10));
  const W = 250;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8));
  const below = anchor.bottom + 168 < window.innerHeight;
  const style = { left, width: W, ...(below ? { top: anchor.bottom + 6 } : { bottom: window.innerHeight - anchor.top + 6 }) };
  const save = () => onSave(type === "date" ? fmtDate(dateVal) : text.trim());
  const choices = optionsOf(field);

  // Radio and dropdown pick from a fixed list, so the popover becomes the list
  // itself — one tap picks and applies, with no separate confirm step.
  if (CHOICE_TYPES.has(type)) {
    return (
      <>
        <div className="fixed inset-0 z-[60]" onClick={onClose} />
        <div className="fixed z-[61] bg-card border border-border rounded-xl shadow-2xl p-3 space-y-2" style={style}>
          <p className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
            <Icon name={type === "radio" ? "CircleDot" : "ChevronDown"} size={12} color="var(--color-primary)" />
            {field.placeholder || "Choose one"}
          </p>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {choices.length === 0 && (
              <p className="text-[11px] text-muted-foreground px-1 py-2">This field has no choices configured.</p>
            )}
            {choices.map((o, i) => {
              const picked = value === o;
              return (
                <button key={i} onClick={() => onSave(o)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs font-medium border transition-colors ${
                    picked ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-foreground hover:bg-muted/60"
                  }`}>
                  <span className={`w-3 h-3 rounded-full border flex-shrink-0 ${picked ? "border-primary" : "border-muted-foreground/50"}`}
                    style={picked ? { boxShadow: "inset 0 0 0 2.5px var(--color-primary)" } : undefined} />
                  <span className="truncate">{o}</span>
                </button>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div className="fixed z-[61] bg-card border border-border rounded-xl shadow-2xl p-3 space-y-2" style={style}>
        <p className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
          <Icon name={type === "date" ? "Calendar" : "Type"} size={12} color="var(--color-primary)" />
          {type === "date" ? "Choose a date" : field.placeholder || "Enter text"}
        </p>
        {type === "date" ? (
          <input type="date" value={dateVal} onChange={e => setDateVal(e.target.value)} autoFocus
            className="w-full px-2.5 py-1.5 border border-border rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
        ) : (
          <input value={text} onChange={e => setText(e.target.value)} autoFocus placeholder="Type here"
            onKeyDown={e => { if (e.key === "Enter" && text.trim()) save(); }}
            className="w-full px-2.5 py-1.5 border border-border rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
        )}
        <button onClick={save} disabled={type === "text" && !text.trim()}
          className="w-full py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50">
          Apply
        </button>
      </div>
    </>
  );
}

export default function FieldFiller({ fileUrl, fields = [], signerName, submitting = false, onComplete, onAddField }) {
  const [values, setValues] = useState({});
  const [editing, setEditing] = useState(null);     // field open in the in-place signer
  const [popover, setPopover] = useState(null);     // { field, anchor } for date/text
  const [docReady, setDocReady] = useState(false);
  const [activeId, setActiveId] = useState(null);   // field being highlighted by the guide
  const [justFilled, setJustFilled] = useState(null); // stamp-in animation target
  const [zoom, setZoom] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [curPage, setCurPage] = useState(1);
  const [addMode, setAddMode] = useState(false);
  const [toast, setToast] = useState(null);
  const fieldRefs = useRef({});
  const scrollRef = useRef(null);
  const canvasesRef = useRef({});
  const advanceRef = useRef(false);
  const highlightTimer = useRef(null);
  const snapTimer = useRef(null);
  const toastTimer = useRef(null);
  const stampTimer = useRef(null);

  const setValue = useCallback((id, v) => setValues(prev => ({ ...prev, [id]: v })), []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const markStamped = useCallback((id) => {
    setJustFilled(id);
    clearTimeout(stampTimer.current);
    stampTimer.current = setTimeout(() => setJustFilled(null), 700);
  }, []);

  // Date fields prefill with today (SignNow-style); the signer can still change.
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
  const nextField =
    orderedFields.find(f => f.required && !isFilled(values[f.id])) ||
    (requiredIds.length === 0 ? orderedFields.find(f => !isFilled(values[f.id])) : null) ||
    null;
  const nextFieldRef = useRef(nextField);
  nextFieldRef.current = nextField;

  // Centre a field inside the scroll container; snap if the animation is
  // throttled away.
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

  useEffect(() => () => {
    clearTimeout(highlightTimer.current); clearTimeout(snapTimer.current);
    clearTimeout(toastTimer.current); clearTimeout(stampTimer.current);
  }, []);

  // Once the document renders, take the signer to the first field.
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

  // Track the visible page for the toolbar indicator.
  const handleScroll = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const mid = box.getBoundingClientRect().top + box.clientHeight / 2;
    let best = 1, bestDist = Infinity;
    box.querySelectorAll("[data-esign-page]").forEach(el => {
      const r = el.getBoundingClientRect();
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < bestDist) { bestDist = d; best = Number(el.dataset.esignPage) + 1; }
    });
    setCurPage(best);
  }, []);

  const applyCapture = useCallback((f, cap) => {
    advanceRef.current = true;
    setValue(f.id, JSON.stringify(cap));
    markStamped(f.id);
  }, [setValue, markStamped]);

  const openField = (f) => {
    if (submitting) return;
    if (f.field_type === "checkbox") {
      const turningOn = values[f.id] !== "true";
      if (turningOn) advanceRef.current = true;
      setValue(f.id, turningOn ? "true" : "false");
      return;
    }
    if (f.field_type === "date" || f.field_type === "text" || CHOICE_TYPES.has(f.field_type)) {
      const el = fieldRefs.current[f.id];
      setPopover({ field: f, anchor: el ? el.getBoundingClientRect() : { left: 100, top: 100, bottom: 120 } });
      return;
    }
    // signature / initials — one tap applies the saved signature (SignNow
    // behaviour); tapping the field again opens the pen to change it.
    const kind = f.field_type === "initials" ? "initials" : "signature";
    const saved = getSavedCapture(kind);
    if (!isFilled(values[f.id]) && saved) {
      applyCapture(f, saved);
      showToast(`Your saved ${kind} was applied — tap the field to change it.`);
      return;
    }
    setEditing(f);
  };

  // Tap-anywhere signing: in add mode, a click on the page drops a signature
  // field at that spot and opens the pen right there.
  const handlePageClick = useCallback((pageIndex, nx, ny) => {
    if (!addMode || !onAddField) return;
    const w = 0.3, h = 0.06;
    const created = onAddField({
      field_type: "signature", page_index: pageIndex,
      pos_x: Math.min(Math.max(0, nx - w / 2), 1 - w),
      pos_y: Math.min(Math.max(0, ny - h / 2), 1 - h),
      width: w, height: h, required: false,
    });
    setAddMode(false);
    if (created) setEditing(created);
  }, [addMode, onAddField]);

  const overlay = (page) => fields.filter(f => f.page_index === page.index).map(f => {
    const v = values[f.id];
    const done = f.field_type === "checkbox" ? v === "true" : isFilled(v);
    const active = f.id === activeId;
    const isNext = nextField && f.id === nextField.id;
    const sigLike = f.field_type === "signature" || f.field_type === "initials";
    return (
      <button key={f.id} ref={el => { fieldRefs.current[f.id] = el; }}
        onClick={(e) => { e.stopPropagation(); openField(f); }}
        title={done ? "Tap to change" : NEXT_LABEL[f.field_type]}
        className={`absolute flex items-center justify-center pointer-events-auto overflow-visible transition-all duration-300 group ${justFilled === f.id ? "esign-stamp-in" : ""}`}
        style={{ left: `${f.pos_x * 100}%`, top: `${f.pos_y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}>
        {/* The field skin: gold tag while empty; once signed, just the ink on the paper */}
        <span className={`absolute inset-0 rounded-[3px] transition-all duration-300 ${done && sigLike ? "border border-transparent group-hover:border-emerald-300/70" : "border-2"}`}
          style={done && sigLike ? {} : {
            borderColor: active || isNext ? "#f59e0b" : done ? "#059669" : "rgba(217,151,7,0.75)",
            borderStyle: done ? "solid" : "dashed",
            background: active ? "rgba(245,158,11,0.24)" : done ? (sigLike ? "transparent" : "rgba(5,150,105,0.08)") : "rgba(250,204,21,0.16)",
            boxShadow: active ? "0 0 0 4px rgba(245,158,11,0.35)" : isNext ? "0 0 0 3px rgba(245,158,11,0.22)" : undefined,
          }} />
        {/* Pointed guide flag on the next field (SignNow's gold arrow) */}
        {isNext && !done && (
          <span className="absolute right-full top-1/2 -translate-y-1/2 mr-1 flex items-center esign-flag-bounce pointer-events-none">
            <span className="px-2 py-1 rounded-l-md bg-amber-400 text-amber-950 text-[10px] font-black uppercase tracking-wide whitespace-nowrap shadow-md">
              {NEXT_LABEL[f.field_type]}
            </span>
            <span className="w-0 h-0 border-y-[11px] border-y-transparent border-l-[9px] border-l-amber-400 drop-shadow" />
          </span>
        )}
        <span className="relative z-[1] flex items-center justify-center w-full h-full text-[10px] font-semibold" style={{ color: done ? "#047857" : "#a16207" }}>
          {f.field_type === "checkbox"
            ? (v === "true" ? <Icon name="Check" size={14} color="#059669" /> : null)
            : done
              ? <FilledPreview f={f} v={v} />
              : (
                <span className="flex items-center gap-1 px-1 truncate leading-none">
                  <Icon name={sigLike ? "PenTool" : f.field_type === "date" ? "Calendar" : f.field_type === "radio" ? "CircleDot" : f.field_type === "dropdown" ? "ChevronDown" : "Type"} size={10} color="currentColor" />
                  {TAG_LABEL[f.field_type]}{f.required ? " *" : ""}
                </span>
              )}
        </span>
      </button>
    );
  });

  const zoomIdx = ZOOMS.indexOf(zoom);
  const remaining = requiredIds.length - filledCount;

  return (
    <div className="space-y-0">
      {/* stamp + guide-flag animations */}
      <style>{`
        @keyframes esignStampIn { 0% { transform: scale(1.5); opacity: 0; } 60% { transform: scale(0.94); opacity: 1; } 100% { transform: scale(1); } }
        .esign-stamp-in { animation: esignStampIn 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
        @keyframes esignFlagBounce { 0%, 100% { transform: translate(0, -50%); } 50% { transform: translate(-5px, -50%); } }
        .esign-flag-bounce { animation: esignFlagBounce 1.2s ease-in-out infinite; }
      `}</style>

      {/* ── Viewer toolbar ── */}
      <div className="bg-card border border-border rounded-t-xl px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
          Page {curPage}{pageCount ? ` / ${pageCount}` : ""}
        </span>
        <span className="h-4 w-px bg-border mx-1" />
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(ZOOMS[Math.max(0, zoomIdx - 1)])} disabled={zoomIdx <= 0}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors">
            <Icon name="Minus" size={13} color="currentColor" />
          </button>
          <button onClick={() => setZoom(1)} className="px-2 h-7 rounded-lg border border-border text-[11px] font-semibold text-muted-foreground hover:bg-muted transition-colors min-w-[52px]">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIdx + 1)])} disabled={zoomIdx >= ZOOMS.length - 1}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors">
            <Icon name="Plus" size={13} color="currentColor" />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onAddField && (
            <button onClick={() => setAddMode(m => !m)}
              className={`flex items-center gap-1.5 px-3 h-7 rounded-lg text-[11px] font-bold border transition-colors ${addMode ? "bg-amber-400 border-amber-400 text-amber-950" : "border-border text-muted-foreground hover:bg-muted"}`}>
              <Icon name="PenTool" size={12} color="currentColor" />
              {addMode ? "Tap the document where you want to sign" : "Sign anywhere"}
            </button>
          )}
          {requiredIds.length > 0 && (
            <span className={`px-2.5 h-7 inline-flex items-center rounded-full text-[11px] font-bold ${remaining === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {remaining === 0 ? "All fields done" : `${remaining} field${remaining === 1 ? "" : "s"} left`}
            </span>
          )}
        </div>
      </div>

      {/* ── Document workspace ── */}
      <div ref={scrollRef} onScroll={handleScroll}
        className="bg-slate-200/70 border-x border-border px-4 py-5 max-h-[68vh] overflow-auto relative">
        {docReady && fields.length > 0 && (
          <div className="sticky top-0 z-10 h-0 flex justify-end pointer-events-none">
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
        <div style={{ width: `${zoom * 100}%`, minWidth: zoom > 1 ? `${zoom * 100}%` : undefined }} className="mx-auto max-w-none">
          <PdfFieldCanvas fileUrl={fileUrl} renderPageOverlay={overlay}
            canvasesRef={canvasesRef}
            onPagesInfo={(metas) => setPageCount(metas.length)}
            onPageClick={onAddField ? handlePageClick : undefined}
            onReady={() => setDocReady(true)} />
        </div>
        {addMode && (
          <div className="sticky bottom-2 z-10 flex justify-center pointer-events-none">
            <span className="px-3.5 py-2 rounded-full bg-slate-900/85 text-white text-xs font-semibold shadow-lg">
              Tap the exact spot on the document where your signature should go
            </span>
          </div>
        )}
      </div>

      {/* ── Progress / finish bar ── */}
      <div className="bg-card border border-border rounded-b-xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">{filledCount} of {requiredIds.length} required field(s) completed</p>
          <div className="mt-1.5 h-1.5 bg-muted rounded-full max-w-[220px]">
            <div className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${requiredIds.length ? (filledCount / requiredIds.length) * 100 : 100}%` }} />
          </div>
        </div>
        <button
          onClick={() => onComplete(fields.filter(f => values[f.id] != null).map(f => ({ id: f.id, value: values[f.id] })))}
          disabled={!allDone || submitting}
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2">
          {submitting ? "Submitting…" : <><Icon name="CheckCircle" size={15} color="currentColor" /> Finish & Sign</>}
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[65] px-4 py-2.5 rounded-full bg-slate-900/90 text-white text-xs font-semibold shadow-xl flex items-center gap-2">
          <Icon name="Check" size={13} color="#34d399" /> {toast}
        </div>
      )}

      {popover && (
        <FieldPopover field={popover.field} value={values[popover.field.id]} anchor={popover.anchor}
          onClose={() => setPopover(null)}
          onSave={(v) => {
            if (isFilled(v)) { advanceRef.current = true; markStamped(popover.field.id); }
            setValue(popover.field.id, v);
            setPopover(null);
          }} />
      )}

      {editing && (
        <InPlaceSigner field={editing} signerName={signerName}
          pageCanvas={canvasesRef.current?.[editing.page_index] || null}
          initialValue={values[editing.id]}
          onClose={() => setEditing(null)}
          onApply={(cap) => { applyCapture(editing, cap); setEditing(null); }} />
      )}
    </div>
  );
}
