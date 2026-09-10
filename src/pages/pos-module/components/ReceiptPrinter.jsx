/**
 * RECEIPT PRINT CONTROLS
 *
 * Shared by the two places a POS receipt is printed: the modal that appears
 * when a sale completes, and the reprint from the sales history. Both need the
 * same paper choice, the same duplicate accounting and the same failure
 * message, and a second copy of that logic is exactly how a reprint ends up
 * unmarked or on the wrong paper.
 *
 * Split into a hook and a picker rather than one component, because the two
 * callers lay their buttons out differently — the sale modal puts Print between
 * "New Sale" and "Download PDF", the reprint between "Close" and "Download".
 */

import React, { useState } from 'react';
import { posReceiptDocument, THERMAL, A4 } from '../../../utils/posReceiptDocument';
import { printDocument } from '../../../utils/printDocument';

// The two papers a POS prints to. A till has an 80mm roll; the office printer
// has A4, and only A4 carries the amortisation schedule and signature lines.
export const PAPER_OPTIONS = [
  { value: THERMAL, label: '80mm roll', hint: 'Thermal till printer' },
  { value: A4,      label: 'A4',        hint: 'Office printer — includes schedule' },
];

/**
 * Print state for one receipt.
 *
 * @param buildArgs  () => the argument object posReceiptDocument takes, minus
 *                   `format` and `copyNo`. A function rather than a value so a
 *                   reprint can build it from a sale that is still loading.
 * @param printed    how many copies of this receipt already exist on paper.
 *                   0 at the till. 1 for a reprint from history — the original
 *                   was issued when the sale was made, so every sheet the
 *                   history produces is a duplicate and says so. Marking a true
 *                   first print as a duplicate is harmless; letting a genuine
 *                   duplicate pass unmarked is not, because two unmarked
 *                   receipts read as two payments.
 */
export const useReceiptPrinter = ({ buildArgs, printed = 0 } = {}) => {
  const [paper, setPaper]   = useState(THERMAL);
  const [copies, setCopies] = useState(printed);
  const [error, setError]   = useState('');

  const print = () => {
    setError('');
    const args = buildArgs?.();
    if (!args) { setError('This receipt is not ready to print yet.'); return; }

    const nextCopy = copies + 1;
    const ok = printDocument(posReceiptDocument({ ...args, format: paper, copyNo: nextCopy }));
    if (!ok) {
      setError('The browser blocked the print window. Allow pop-ups for this site and try again.');
      return;
    }
    setCopies(nextCopy);
  };

  return {
    paper, setPaper,
    copies,
    /** Copies made in this sitting, which is what the counter should read. */
    printedHere: copies - printed,
    error, setError,
    print,
    /** The next sheet will carry the DUPLICATE stamp. */
    nextIsDuplicate: copies >= 1,
  };
};

/** The paper choice, plus a plain statement of what the next sheet will say. */
export const PaperPicker = ({ paper, onChange, printedHere, nextIsDuplicate }) => (
  <div>
    <div className="flex items-center justify-between mb-1.5 gap-2">
      <span className="text-xs font-medium text-muted-foreground">Receipt paper</span>
      <span className="text-xs text-muted-foreground text-right">
        {printedHere > 0 && `${printedHere} printed`}
        {printedHere > 0 && nextIsDuplicate && ' · '}
        {nextIsDuplicate && 'next copy marked DUPLICATE'}
      </span>
    </div>
    <div className="grid grid-cols-2 gap-2">
      {PAPER_OPTIONS.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} title={o.hint}
          className={`px-3 py-2 text-xs rounded-xl border text-left transition-colors ${
            paper === o.value
              ? 'border-primary bg-primary/10 text-primary font-semibold'
              : 'border-border text-muted-foreground hover:bg-muted'}`}>
          <span className="block">{o.label}</span>
          <span className="block text-[10px] opacity-70 font-normal">{o.hint}</span>
        </button>
      ))}
    </div>
  </div>
);

export default useReceiptPrinter;
