import { useState, useRef, useEffect } from "react";

// Shared signature pad used by the internal e-signature page and the public
// external-signing page. Calls onCapture({ type, data, font? }) when applied:
//   - drawn → { type: "drawn", data: <PNG data URL> }
//   - typed → { type: "typed", data: <name>, font }
export default function SignatureCanvas({ onCapture }) {
  const canvasRef = useRef();
  const drawing = useRef(false);
  const [hasSign, setHasSign] = useState(false);
  const [mode, setMode] = useState("draw");
  const [typedSig, setTypedSig] = useState("");
  const FONTS = ["Dancing Script", "Pacifico", "Satisfy", "Caveat"];
  const [font, setFont] = useState(FONTS[0]);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Pacifico&family=Satisfy&family=Caveat:wght@700&display=swap";
    document.head.appendChild(link);
  }, []);

  const getPos = (e, canvas) => { const r = canvas.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
  const start = (e) => { e.preventDefault(); drawing.current = true; const canvas = canvasRef.current; const ctx = canvas.getContext("2d"); const { x, y } = getPos(e, canvas); ctx.beginPath(); ctx.moveTo(x, y); };
  const draw = (e) => { e.preventDefault(); if (!drawing.current) return; const canvas = canvasRef.current; const ctx = canvas.getContext("2d"); ctx.strokeStyle = "var(--color-foreground)"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; const { x, y } = getPos(e, canvas); ctx.lineTo(x, y); ctx.stroke(); setHasSign(true); };
  const stop = () => { drawing.current = false; };
  const clear = () => { const canvas = canvasRef.current; canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); setHasSign(false); };
  const capture = () => {
    if (mode === "draw") { if (!hasSign) return; onCapture({ type: "drawn", data: canvasRef.current.toDataURL() }); }
    else { if (!typedSig.trim()) return; onCapture({ type: "typed", data: typedSig, font }); }
  };

  return (
    <div className="bg-muted/30 border border-border rounded-xl overflow-hidden">
      <div className="flex border-b border-border">
        {[{ id: "draw", label: "Draw" }, { id: "type", label: "Type" }, { id: "upload", label: "Upload" }].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${mode === m.id ? "bg-card text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === "draw" && (
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
