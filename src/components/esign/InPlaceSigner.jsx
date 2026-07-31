import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import Icon from "../AppIcon";
import { FONTS, INKS, NIBS, ensureSignatureFonts } from "./SignatureCanvas";

// InPlaceSigner — SignNow-style "sign with your pen directly on the document".
//
// Instead of a detached signature pad, the region of the ACTUAL document around
// the tapped field is magnified and the signer draws straight onto the document
// pixels — the ruled line, the "Authorised Signatory" label, the paper itself
// are all under the pen while they sign. On Apply the ink is trimmed to its
// bounding box and stamped into the field.
//
// Props:
//   field        — { field_type, page_index, pos_x, pos_y, width, height } (normalized)
//   pageCanvas   — the rendered <canvas> of the field's page (from PdfFieldCanvas);
//                  falls back to plain paper when unavailable.
//   signerName   — used to prefill the Type tab.
//   initialValue — existing capture JSON when re-editing a filled field.
//   onApply(cap, { reuse }) — cap = { type:"drawn"|"typed", data, font? }.
//   onClose()
//
// Saved-signature reuse (SignNow parity): the applied signature is stored per
// kind (signature / initials) so every later field is one tap.

const STORE_KEY = "ararat_esign_saved_v1";

export function getSavedCapture(kind) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const cap = all[kind];
    return cap && cap.data ? cap : null;
  } catch { return null; }
}

export function setSavedCapture(kind, cap) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    all[kind] = cap;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch { /* private mode — reuse just won't persist */ }
}

// Crop the ink canvas to the drawn strokes (plus breathing room) so the
// signature stamps into the field exactly as written, with no dead margins.
function trimInk(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  if (!w || !h) return null;
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 8;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext("2d").drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export default function InPlaceSigner({ field, pageCanvas, signerName, initialValue, onApply, onClose }) {
  const kind = field.field_type === "initials" ? "initials" : "signature";
  const wrapRef  = useRef(null);   // measures available width
  const bgRef    = useRef(null);   // magnified document pixels
  const inkRef2  = useRef(null);   // transparent pen layer
  const drawing  = useRef(false);
  const lastPt   = useRef(null);
  const [mode, setMode] = useState("draw");
  const [hasInk, setHasInk] = useState(false);
  const [typed, setTyped] = useState(() => {
    try { const cap = initialValue ? JSON.parse(initialValue) : null; if (cap?.type === "typed") return cap.data; } catch { /* ignore */ }
    return signerName || "";
  });
  const [font, setFont] = useState(FONTS[0]);
  const [ink, setInk] = useState(INKS[0]);
  const [nib, setNib] = useState(NIBS[1]);
  const [uploadImg, setUploadImg] = useState(null);
  const [reuse, setReuse] = useState(true);
  const [dims, setDims] = useState(null); // { W, H, fx, fy, fw, fh } display px
  const saved = getSavedCapture(kind);
  const inkCol = useRef(ink); inkCol.current = ink;
  const nibW   = useRef(nib); nibW.current = nib;

  useEffect(() => { ensureSignatureFonts(); }, []);

  // ── Geometry: magnify the document region around the field ──────────────────
  // Crop (normalized page coords) = the field plus generous context, so the
  // signer sees the surrounding document — labels, ruled lines — while signing.
  useLayoutEffect(() => {
    const compute = () => {
      const availW = Math.min(wrapRef.current?.clientWidth || 640, 680);
      const f = field;
      const padX = Math.max(0.06, (f.width || 0.2) * 0.35);
      const padY = Math.max(0.035, (f.height || 0.05) * 1.1);
      const x0 = clamp01((f.pos_x || 0) - padX);
      const x1 = clamp01((f.pos_x || 0) + (f.width || 0.2) + padX);
      const y0 = clamp01((f.pos_y || 0) - padY);
      const y1 = clamp01((f.pos_y || 0) + (f.height || 0.05) + padY);
      // Source pixels come from the page canvas; without one, assume A4 ratio.
      const cw = pageCanvas?.width || 1000;
      const ch = pageCanvas?.height || 1414;
      const sx = x0 * cw, sw = Math.max(1, (x1 - x0) * cw);
      const sy = y0 * ch, sh = Math.max(1, (y1 - y0) * ch);
      let W = availW;
      let H = W * (sh / sw);
      const maxH = Math.max(220, window.innerHeight * 0.42);
      if (H > maxH) { W = W * (maxH / H); H = maxH; }
      W = Math.round(W); H = Math.round(H);
      setDims({
        W, H, sx, sy, sw, sh,
        fx: ((f.pos_x - x0) / (x1 - x0)) * W,
        fy: ((f.pos_y - y0) / (y1 - y0)) * H,
        fw: (f.width  / (x1 - x0)) * W,
        fh: (f.height / (y1 - y0)) * H,
      });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [field, pageCanvas]);

  // Paint the magnified document behind the pen (retina-aware), and size the
  // ink layer to match.
  useEffect(() => {
    if (!dims || mode !== "draw") return;
    const dpr = window.devicePixelRatio || 1;
    const bg = bgRef.current, il = inkRef2.current;
    if (!bg || !il) return;
    bg.width = dims.W * dpr; bg.height = dims.H * dpr;
    bg.style.width = `${dims.W}px`; bg.style.height = `${dims.H}px`;
    const ctx = bg.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, bg.width, bg.height);
    if (pageCanvas && pageCanvas.width) {
      try {
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(pageCanvas, dims.sx, dims.sy, dims.sw, dims.sh, 0, 0, bg.width, bg.height);
      } catch { /* tainted/foreign canvas — plain paper is fine */ }
    }
    // Preserve any ink already drawn across resizes.
    const prev = il.width ? il : null;
    let keep = null;
    if (prev && hasInk) {
      keep = document.createElement("canvas");
      keep.width = il.width; keep.height = il.height;
      keep.getContext("2d").drawImage(il, 0, 0);
    }
    il.width = dims.W * dpr; il.height = dims.H * dpr;
    il.style.width = `${dims.W}px`; il.style.height = `${dims.H}px`;
    if (keep) il.getContext("2d").drawImage(keep, 0, 0, keep.width, keep.height, 0, 0, il.width, il.height);
  }, [dims, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The signing pen (same engine as SignatureCanvas: dot, smoothing) ─────────
  const getPos = (e, canvas) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - r.left) * (canvas.width / r.width),
      y: (t.clientY - r.top) * (canvas.height / r.height),
    };
  };
  const applyPen = (ctx) => {
    const dpr = window.devicePixelRatio || 1;
    ctx.strokeStyle = inkCol.current.color;
    ctx.fillStyle = inkCol.current.color;
    ctx.lineWidth = nibW.current.w * dpr;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };
  const start = (e) => {
    e.preventDefault();
    const canvas = inkRef2.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    const p = getPos(e, canvas);
    applyPen(ctx);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.8, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    lastPt.current = p;
    setHasInk(true);
  };
  const draw = (e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = inkRef2.current;
    const ctx = canvas.getContext("2d");
    const p = getPos(e, canvas);
    const last = lastPt.current || p;
    const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    applyPen(ctx);
    ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mid.x, mid.y);
    lastPt.current = p;
  };
  const stop = () => { drawing.current = false; lastPt.current = null; };
  const clearInk = () => {
    const canvas = inkRef2.current;
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        try { setUploadImg(c.toDataURL("image/png")); } catch { setUploadImg(String(reader.result)); }
      };
      img.onerror = () => setUploadImg(String(reader.result));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const finish = (cap) => {
    if (!cap) return;
    if (reuse) setSavedCapture(kind, cap);
    onApply(cap, { reuse });
  };

  const apply = () => {
    if (mode === "draw") {
      if (!hasInk) return;
      const data = trimInk(inkRef2.current);
      if (data) finish({ type: "drawn", data });
    } else if (mode === "type") {
      if (typed.trim()) finish({ type: "typed", data: typed.trim(), font });
    } else if (mode === "upload") {
      if (uploadImg) finish({ type: "drawn", data: uploadImg });
    }
  };

  const noun = kind === "initials" ? "initials" : "signature";
  const TABS = [
    { id: "draw",   label: "Draw on document", icon: "PenTool" },
    { id: "type",   label: "Type",   icon: "Type" },
    { id: "upload", label: "Upload", icon: "Upload" },
  ];

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3">
      <div ref={wrapRef} className="bg-card border border-border rounded-2xl w-full max-w-[720px] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="PenTool" size={15} color="var(--color-primary)" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                {kind === "initials" ? "Add your initials" : "Sign this document"}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {mode === "draw" ? "You're writing directly on the document with your pen" : `Your ${noun} is placed exactly where the field sits`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={16} color="var(--color-muted-foreground)" />
          </button>
        </div>

        {/* Saved signature — one tap, SignNow style */}
        {saved && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-emerald-50 border-b border-emerald-100">
            <div className="h-9 px-2 bg-white border border-emerald-200 rounded-lg flex items-center overflow-hidden">
              {saved.type === "drawn"
                ? <img src={saved.data} alt="Saved" className="max-h-7 max-w-[120px] object-contain" />
                : <span style={{ fontFamily: saved.font, fontSize: 20 }} className="text-slate-800">{saved.data}</span>}
            </div>
            <p className="flex-1 text-[11px] text-emerald-800">Your saved {noun} from earlier</p>
            <button onClick={() => finish(saved)}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors">
              Use it
            </button>
          </div>
        )}

        {/* Mode tabs */}
        <div className="flex border-b border-border">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setMode(t.id)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${mode === t.id ? "bg-card text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground bg-muted/30"}`}>
              <Icon name={t.icon} size={13} color="currentColor" /> {t.label}
            </button>
          ))}
        </div>

        {mode === "draw" && (
          <>
            {/* Pen: ink colour + nib */}
            <div className="flex items-center justify-between gap-3 px-4 py-2 bg-card border-b border-border flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground mr-1">Ink</span>
                {INKS.map(o => (
                  <button key={o.id} onClick={() => setInk(o)} title={o.label}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${ink.id === o.id ? "scale-110 border-foreground/60" : "border-transparent"}`}
                    style={{ background: o.color }} />
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-semibold text-muted-foreground mr-1">Nib</span>
                {NIBS.map(o => (
                  <button key={o.id} onClick={() => setNib(o)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${nib.id === o.id ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              <button onClick={clearInk} disabled={!hasInk}
                className="text-xs text-red-500 font-semibold hover:text-red-600 disabled:opacity-40">Clear</button>
            </div>

            {/* The document itself, magnified, with the pen layer on top */}
            <div className="bg-slate-200/80 p-3 flex justify-center">
              <div className="relative shadow-lg select-none" style={{ width: dims?.W || "100%", height: dims?.H || 200 }}>
                <canvas ref={bgRef} className="block absolute inset-0 rounded-sm" />
                {/* Field guide — where the signature will live on the page */}
                {dims && (
                  <div className="absolute pointer-events-none rounded-sm border-2 border-dashed"
                    style={{
                      left: dims.fx, top: dims.fy, width: dims.fw, height: dims.fh,
                      borderColor: "rgba(245,158,11,0.85)", background: hasInk ? "transparent" : "rgba(245,158,11,0.08)",
                    }}>
                    {!hasInk && (
                      <span className="absolute -top-5 left-0 text-[10px] font-bold text-amber-600 whitespace-nowrap drop-shadow-sm">
                        {kind === "initials" ? "Initial inside this area" : "Sign inside this area"}
                      </span>
                    )}
                  </div>
                )}
                <canvas ref={inkRef2} className="block absolute inset-0 touch-none"
                  style={{ cursor: "crosshair" }}
                  onMouseDown={start} onMouseMove={draw} onMouseUp={stop} onMouseLeave={stop}
                  onTouchStart={start} onTouchMove={draw} onTouchEnd={stop} />
              </div>
            </div>
            <p className="px-4 py-2 text-[11px] text-muted-foreground flex items-center gap-1.5 bg-muted/20">
              <Icon name="Info" size={12} color="currentColor" />
              This is the real document, zoomed in — your ink lands exactly here on the page.
            </p>
          </>
        )}

        {mode === "type" && (
          <div className="p-4 space-y-3">
            <input type="text" value={typed} onChange={e => setTyped(e.target.value)} placeholder={kind === "initials" ? "Your initials" : "Type your full name"}
              className="w-full px-3 py-2 border border-border rounded-xl text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <div className="h-20 flex items-center justify-center bg-muted/30 rounded-xl border border-dashed border-border">
              <span style={{ fontFamily: font, fontSize: 32, color: "var(--color-foreground)" }}>{typed || "Your Signature"}</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {FONTS.map(f => (
                <button key={f} onClick={() => setFont(f)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${font === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                  style={{ fontFamily: f }}>
                  {f.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === "upload" && (
          <div className="p-4 space-y-3">
            {uploadImg ? (
              <>
                <div className="h-24 flex items-center justify-center bg-muted/30 rounded-xl border border-dashed border-border overflow-hidden">
                  <img src={uploadImg} alt="Signature" className="max-h-full max-w-full object-contain" />
                </div>
                <button onClick={() => setUploadImg(null)} className="text-xs text-red-500 font-semibold hover:text-red-600">Remove</button>
              </>
            ) : (
              <label className="h-24 flex flex-col items-center justify-center gap-1 bg-muted/30 rounded-xl border border-dashed border-border cursor-pointer text-muted-foreground text-sm hover:bg-muted/50 transition-colors">
                <span>Click to upload a signature image</span>
                <span className="text-xs">PNG or JPG</span>
                <input type="file" accept="image/png,image/jpeg" onChange={handleUpload} className="hidden" />
              </label>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 cursor-pointer mr-auto">
            <input type="checkbox" checked={reuse} onChange={e => setReuse(e.target.checked)} className="w-3.5 h-3.5" />
            <span className="text-[11px] text-muted-foreground">Reuse for my other {noun} fields</span>
          </label>
          <button onClick={onClose}
            className="px-4 py-2 border border-border rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
          <button onClick={apply}
            disabled={mode === "draw" ? !hasInk : mode === "type" ? !typed.trim() : !uploadImg}
            className="px-5 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5">
            <Icon name="Check" size={13} color="currentColor" /> Apply to document
          </button>
        </div>
      </div>
    </div>
  );
}
