/**
 * PRINT LAUNCHER
 *
 * Hands a complete HTML document to the browser's print pipeline.
 *
 * It prints through an OFF-SCREEN IFRAME rather than `window.open(...).print()`,
 * which is what the finance hub's older payslip/invoice launcher does. That
 * difference matters at a till: a pop-up window is blocked by default in most
 * browsers, and a receipt is printed on every single sale — a cashier who has
 * to clear a blocked-pop-up bar per customer will stop printing receipts. An
 * iframe is same-document, so nothing can block it, nothing opens a tab the
 * cashier then has to close, and the print dialog comes up on the first click.
 *
 * The iframe carries `srcdoc`, so the document is parsed as a real page and its
 * own `@page` rules — the 80mm roll size a receipt needs — reach the printer.
 *
 * `window.open` remains as a fallback for anything that refuses the iframe, so
 * a browser that will not print one still prints the document.
 */

/** Marks our own frames so a later print can clear the one before it. */
const FRAME_MARK = 'data-print-frame';

const printViaWindow = (markup) => {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(markup);
  w.document.close();
  w.focus();
  w.print();
  return true;
};

/**
 * Print `markup` (a full `<html>` document string).
 *
 * Returns true when the print dialog was handed the document, false when the
 * browser refused both routes — the caller shows that as an error rather than
 * leaving the operator to wonder whether anything was sent.
 */
export const printDocument = (markup) => {
  if (typeof document === 'undefined' || !document.body) return false;

  // Clear the frame the previous print left behind, if any. Sweeping on the way
  // IN rather than on a timer means a frame is never pulled out from under a
  // dialog that is still open — not every engine blocks inside print(), and
  // Firefox has returned from it before the preview closes — while still
  // leaving at most one node behind however many receipts a till prints.
  document.querySelectorAll(`iframe[${FRAME_MARK}]`).forEach((el) => el.remove());

  let frame;
  try {
    frame = document.createElement('iframe');
    // Off-screen rather than display:none — a hidden iframe is not laid out in
    // every engine, and an unlaid-out document prints blank.
    frame.setAttribute(FRAME_MARK, '');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
    frame.srcdoc = markup;

    frame.onload = () => {
      try {
        const win = frame.contentWindow;
        win.focus();
        win.onafterprint = () => frame.remove();
        win.print();
      } catch {
        frame.remove();
        printViaWindow(markup);
      }
    };

    document.body.appendChild(frame);
    return true;
  } catch {
    frame?.remove();
    return printViaWindow(markup);
  }
};

export default printDocument;
