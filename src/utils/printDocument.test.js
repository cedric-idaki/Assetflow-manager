import { describe, it, expect, vi, afterEach } from 'vitest';
import { printDocument } from './printDocument';

const MARKUP = '<html><head><title>Receipt</title></head><body>RCP-1</body></html>';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('printDocument', () => {
  it('prints through an off-screen iframe, so a blocker cannot stop a till', () => {
    // The reason this is not window.open: pop-ups are blocked by default, and
    // a receipt is printed on every sale.
    const opened = vi.spyOn(window, 'open');
    expect(printDocument(MARKUP)).toBe(true);

    const frame = document.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame.srcdoc).toBe(MARKUP);
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(opened).not.toHaveBeenCalled();
  });

  it('does not accumulate a frame per sale', () => {
    // A till prints all day. Each print clears the one before it, so at most
    // one frame is ever in the document.
    printDocument(MARKUP);
    printDocument(MARKUP);
    printDocument(MARKUP);
    expect(document.querySelectorAll('iframe').length).toBe(1);
  });

  it('falls back to a print window when the DOM refuses an iframe', () => {
    vi.spyOn(document, 'createElement').mockImplementation(() => { throw new Error('blocked'); });
    const w = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(w);

    expect(printDocument(MARKUP)).toBe(true);
    expect(w.document.write).toHaveBeenCalledWith(MARKUP);
    expect(w.print).toHaveBeenCalled();
  });

  it('reports failure when both routes are refused, rather than failing silently', () => {
    // The caller shows this as an error; an operator must never be left
    // wondering whether the receipt was sent to the printer.
    vi.spyOn(document, 'createElement').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(window, 'open').mockReturnValue(null);

    expect(printDocument(MARKUP)).toBe(false);
  });
});
