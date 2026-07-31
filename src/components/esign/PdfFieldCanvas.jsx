import { useState, useRef, useEffect, useCallback } from "react";
import { loadPdfJs } from "../../utils/pdfjsLoader";
import { resolveFileUrl } from "../../lib/storageUrl";

// Shared PDF page renderer for the field editor (sender) and field filler
// (signer). Renders every page of a PDF to a <canvas> at container width and
// hosts a transparent overlay layer per page so callers can position fields
// using NORMALIZED coordinates (0..1 of the page box) — resolution-independent
// and identical to how applyFieldsToPDF burns them into the final PDF.
//
// pdf.js is loaded from CDN on demand, mirroring how applySignatureToPDF loads
// pdf-lib, so no build dependency is added.
//
// Props:
//   fileUrl           — URL of the PDF to render.
//   renderPageOverlay — (page:{index}) => ReactNode, drawn absolutely over the
//                       page; position children with left/top/width/height in %.
//                       The overlay is pointer-events:none; give interactive
//                       children `pointer-events-auto` and stopPropagation.
//   onPageClick       — (pageIndex, normX, normY, pageRect) => void; fired when
//                       empty page area is clicked (used by the editor to drop).
//   onReady           — () => void; fired once the pages (and overlays) are in
//                       the DOM, so callers can scroll to overlay elements.
//   canvasesRef       — optional ref; receives { [pageIndex]: <canvas> } so the
//                       in-place signer can paint the real document pixels
//                       behind the signing pen.
//   onPagesInfo       — optional; receives [{ index, ratio }] once page metadata
//                       is known (page count for the viewer toolbar).

export default function PdfFieldCanvas({ fileUrl, renderPageOverlay, onPageClick, onReady, canvasesRef, onPagesInfo, className = "" }) {
  const wrapRef    = useRef(null);
  const canvasRefs = useRef({});   // pageIndex -> <canvas>
  const pdfRef     = useRef(null);
  const [pages, setPages]   = useState([]); // [{ index, ratio }]
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError]   = useState("");
  const [width, setWidth]   = useState(0);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; });

  // Fires after the "ready" render commits, so overlay children are in the DOM.
  useEffect(() => { if (status === "ready") onReadyRef.current?.(); }, [status]);

  // Track container width so pages render sharp and fields stay aligned.
  useEffect(() => {
    if (!wrapRef.current) return;
    const measure = () => setWidth(wrapRef.current?.clientWidth || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Load the document + per-page aspect ratios.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!fileUrl) { setStatus("error"); setError("No document to display."); return; }
      try {
        setStatus("loading"); setError("");
        const pdfjsLib = await loadPdfJs();
        const src = await resolveFileUrl(fileUrl);
        if (!src) throw new Error("Could not fetch document");
        const bytes = await fetch(src).then(r => { if (!r.ok) throw new Error(`Could not fetch document (${r.status})`); return r.arrayBuffer(); });
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        const metas = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
          metas.push({ index: i - 1, ratio: vp.height / vp.width });
        }
        if (cancelled) return;
        setPages(metas);
        if (onPagesInfo) onPagesInfo(metas);
        setStatus("ready");
      } catch (err) {
        if (!cancelled) { setError(err.message || "Could not render this document."); setStatus("error"); }
      }
    })();
    return () => { cancelled = true; };
  }, [fileUrl]);

  // Paint each page onto its canvas at the current width (retina-aware).
  useEffect(() => {
    if (status !== "ready" || !width || !pdfRef.current) return;
    let cancelled = false;
    (async () => {
      const pdf = pdfRef.current;
      const dpr = window.devicePixelRatio || 1;
      for (const meta of pages) {
        const canvas = canvasRefs.current[meta.index];
        if (!canvas) continue;
        const page = await pdf.getPage(meta.index + 1);
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const vp = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${width * meta.ratio}px`;
        const ctx = canvas.getContext("2d");
        try { await page.render({ canvasContext: ctx, viewport: vp }).promise; } catch { /* ignore */ }
        if (cancelled) return;
      }
    })();
    return () => { cancelled = true; };
  }, [status, width, pages]);

  const handleClick = useCallback((e, pageIndex) => {
    if (!onPageClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    onPageClick(pageIndex, Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny)), rect);
  }, [onPageClick]);

  return (
    <div ref={wrapRef} className={className}>
      {status === "loading" && (
        <div className="py-16 text-center text-sm text-muted-foreground">Rendering document…</div>
      )}
      {status === "error" && (
        <div className="py-16 text-center text-sm text-red-600">{error}</div>
      )}
      {status === "ready" && pages.map(meta => (
        <div key={meta.index} data-esign-page={meta.index}
          className={`relative mx-auto mb-4 bg-white shadow-sm border border-border ${onPageClick ? "cursor-crosshair" : ""}`}
          style={{ width: "100%", aspectRatio: `1 / ${meta.ratio}` }}
          onClick={onPageClick ? (e) => handleClick(e, meta.index) : undefined}>
          <canvas ref={el => { canvasRefs.current[meta.index] = el; if (canvasesRef) canvasesRef.current = canvasRefs.current; }} className="block w-full" />
          <div className="absolute inset-0 pointer-events-none">
            {renderPageOverlay && renderPageOverlay(meta)}
          </div>
        </div>
      ))}
    </div>
  );
}
