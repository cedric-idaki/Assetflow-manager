import { useState, useRef, useEffect } from "react";
import Icon from "../AppIcon";

// Shared signature pad used by the internal e-signature page and the public
// external-signing page. Calls onCapture({ type, data, font? }) when applied:
//   - drawn → { type: "drawn", data: <PNG data URL> }
//   - typed → { type: "typed", data: <name>, font }
//
// Draw mode is a proper signing pen: pick an ink colour and nib size, then sign.
// Strokes are smoothed (quadratic midpoints) and mapped to the canvas's internal
// resolution so the ink lands exactly under the pen at any display width.

export const FONTS = ["Dancing Script", "Pacifico", "Satisfy", "Caveat"];
export const INKS = [
  { id: "blue",   label: "Blue",   color: "#1d4ed8" },
  { id: "black",  label: "Black",  color: "#0f172a" },
  { id: "indigo", label: "Indigo", color: "#4338ca" },
];
export const NIBS = [
  { id: "fine",   label: "Fine",   w: 1.6 },
  { id: "medium", label: "Medium", w: 2.8 },
  { id: "bold",   label: "Bold",   w: 4.4 },
];

// Inject the script-font stylesheet once (shared by every signing surface).
let fontsInjected = false;
export function ensureSignatureFonts() {
  if (fontsInjected || typeof document === "undefined") return;
  fontsInjected = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Pacifico&family=Satisfy&family=Caveat:wght@700&display=swap";
  document.head.appendChild(link);
}

export default function SignatureCanvas({ onCapture }) {
  const canvasRef = useRef();
  const drawing = useRef(false);
  const lastPt = useRef(null);
  const [hasSign, setHasSign] = useState(false);
  const [mode, setMode] = useState("draw");
  const [typedSig, setTypedSig] = useState("");
  const [uploadImg, setUploadImg] = useState(null);
  const [font, setFont] = useState(FONTS[0]);
  const [ink, setInk] = useState(INKS[0]);
  const [nib, setNib] = useState(NIBS[1]);
  // Event handlers read the live pen settings from refs (they close over the
  // first render otherwise).
  const inkRef = useRef(ink); inkRef.current = ink;
  const nibRef = useRef(nib); nibRef.current = nib;

  useEffect(() => { ensureSignatureFonts(); }, []);

  // Map a pointer event to the canvas's INTERNAL pixel coordinates. The pad is
  // displayed at container width (CSS) but has a fixed backing resolution, so we
  // scale by the width/height ratios — without this the ink drifts from the pen
  // whenever the pad is rendered wider than its backing store.
  const getPos = (e, canvas) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - r.left) * (canvas.width / r.width),
      y: (t.clientY - r.top) * (canvas.height / r.height),
    };
  };

  const applyPen = (ctx) => {
    ctx.strokeStyle = inkRef.current.color;
    ctx.fillStyle = inkRef.current.color;
    ctx.lineWidth = nibRef.current.w;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const p = getPos(e, canvas);
    applyPen(ctx);
    // A dot so a tap / period registers as ink.
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.8, nibRef.current.w / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    lastPt.current = p;
    setHasSign(true);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const p = getPos(e, canvas);
    const last = lastPt.current || p;
    // Smooth the line: curve through the midpoint using the sampled point as the
    // control handle, then continue the path from that midpoint.
    const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    applyPen(ctx);
    ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mid.x, mid.y);
    lastPt.current = p;
    setHasSign(true);
  };

  const stop = () => { drawing.current = false; lastPt.current = null; };
  const clear = () => { const canvas = canvasRef.current; canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); setHasSign(false); };

  // Read an uploaded signature image and normalise it to a PNG data URL so it
  // embeds cleanly in the signed PDF (pdf-lib embeds PNG).
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

  const capture = () => {
    if (mode === "draw") { if (!hasSign) return; onCapture({ type: "drawn", data: canvasRef.current.toDataURL() }); }
    else if (mode === "upload") { if (!uploadImg) return; onCapture({ type: "drawn", data: uploadImg }); }
    else { if (!typedSig.trim()) return; onCapture({ type: "typed", data: typedSig, font }); }
  };

  const TABS = [
    { id: "draw", label: "Draw", icon: "PenTool" },
    { id: "type", label: "Type", icon: "Type" },
    { id: "upload", label: "Upload", icon: "Upload" },
  ];

  return (
    <div className="bg-muted/30 border border-border rounded-xl overflow-hidden">
      <div className="flex border-b border-border">
        {TABS.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${mode === m.id ? "bg-card text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon name={m.icon} size={13} color="currentColor" /> {m.label}
          </button>
        ))}
      </div>
      {mode === "draw" && (
        <>
          {/* Pen controls — ink colour + nib size */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 bg-card border-b border-border flex-wrap">
            <div className="flex items-center gap-1.5">
              <Icon name="PenTool" size={13} color="var(--color-muted-foreground)" />
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
          </div>
          <canvas ref={canvasRef} width={640} height={200}
            className="block w-full bg-card cursor-crosshair touch-none"
            style={{ height: 176 }}
            onMouseDown={start} onMouseMove={draw} onMouseUp={stop} onMouseLeave={stop}
            onTouchStart={start} onTouchMove={draw} onTouchEnd={stop} />
          <div className="px-3 py-2 flex justify-between items-center bg-muted/20">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Icon name="PenTool" size={12} color="currentColor" /> Sign above with your pen
            </span>
            <button onClick={clear} className="text-xs text-red-500 font-semibold hover:text-red-600">Clear</button>
          </div>
        </>
      )}
      {mode === "type" && (
        <div className="p-4 bg-card space-y-3">
          <input type="text" value={typedSig} onChange={e => setTypedSig(e.target.value)} placeholder="Type your full name"
            className="w-full px-3 py-2 border border-border rounded-xl text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <div className="h-20 flex items-center justify-center bg-muted/30 rounded-xl border border-dashed border-border">
            <span style={{ fontFamily: font, fontSize: 32, color: "var(--color-foreground)" }}>{typedSig || "Your Signature"}</span>
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
        <div className="p-4 bg-card space-y-3">
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
      <div className="p-3 border-t border-border">
        <button onClick={capture}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
          <Icon name="Check" size={14} color="currentColor" /> Apply Signature
        </button>
      </div>
    </div>
  );
}
