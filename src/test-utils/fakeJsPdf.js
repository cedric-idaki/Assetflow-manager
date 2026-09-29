/**
 * A stand-in for jsPDF that records what was drawn.
 *
 * jsPDF itself is loaded from a CDN at runtime and is not installed, so the
 * painters are exercised against this: enough of the API to run every
 * generator end to end, and a log of text and images to assert on. Text width
 * is approximated (0.5 × font size per character, in the document's unit) —
 * good enough to test that fitting logic shrinks and clips.
 */
export class FakeJsPDF {
  constructor(opts = {}) {
    this.opts = opts;
    const landscape = opts.orientation === 'landscape';
    const pt = opts.unit === 'pt';
    const w = pt ? 595.28 : 210;
    const h = pt ? 841.89 : 297;
    this.internal = {
      getNumberOfPages: () => this.pages,
      pageSize: {
        getWidth: () => (landscape ? h : w),
        getHeight: () => (landscape ? w : h),
      },
    };
    this.fontSize = 10;
    this.font = ['helvetica', 'normal'];
    this.pages = 1;
    this.texts = [];
    this.images = [];
    this.saved = null;
    this.GState = function GState(o) { Object.assign(this, o); };
    FakeJsPDF.instances.push(this);
  }

  /** Every document constructed since the last reset, newest last. */
  static instances = [];

  static last() { return FakeJsPDF.instances[FakeJsPDF.instances.length - 1]; }

  static reset() { FakeJsPDF.instances = []; }

  setFont(name, style) { this.font = [name, style]; return this; }
  setFontSize(n) { this.fontSize = n; return this; }
  getFontSize() { return this.fontSize; }
  setTextColor() { return this; }
  setFillColor() { return this; }
  setDrawColor() { return this; }
  setLineWidth() { return this; }
  setGState() { return this; }
  saveGraphicsState() { return this; }
  restoreGraphicsState() { return this; }
  rect() { return this; }
  roundedRect() { return this; }
  line() { return this; }
  circle() { return this; }

  getTextWidth(s) { return String(s ?? '').length * this.fontSize * 0.5 * (this.opts.unit === 'pt' ? 1 : 0.3528); }

  splitTextToSize(s, width) {
    const words = String(s ?? '').split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach((word) => {
      const next = cur ? `${cur} ${word}` : word;
      if (this.getTextWidth(next) > width && cur) { lines.push(cur); cur = word; } else cur = next;
    });
    if (cur || !lines.length) lines.push(cur);
    return lines;
  }

  text(s, x, y, opts) {
    (Array.isArray(s) ? s : [s]).forEach((t) => {
      this.texts.push({ text: String(t), x, y, size: this.fontSize, style: this.font[1], opts, page: this.pages });
    });
    return this;
  }

  addImage(src, format, x, y, w, h) {
    this.images.push({ src, format, x, y, w, h, page: this.pages });
    return this;
  }

  addPage() { this.pages += 1; return this; }
  setPage() { return this; }
  getNumberOfPages() { return this.pages; }
  save(name) { this.saved = name; }
  output() { return new Blob(['%PDF-fake'], { type: 'application/pdf' }); }

  /** Everything written, as one string, for "does it say X" assertions. */
  allText() { return this.texts.map((t) => t.text).join('\n'); }
}

export default FakeJsPDF;
