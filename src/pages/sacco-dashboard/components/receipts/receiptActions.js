/**
 * Download or print an official receipt from the sacco receipt book.
 *
 * Both take either a receipt that already carries its lines (the viewer has
 * one) or just an id (a schedule row or a share movement only knows which
 * receipt covers it), and both paint through the shared accounting-document
 * renderer, so the paper matches every other document the society hands out.
 */
import {
  buildSaccoPaymentReceipt, downloadAccountingDocument, printAccountingDocument,
} from '../../../../utils/accountingDocument';
import { fetchReceipt } from '../../../../services/saccoReceiptService';

const withLines = async (receiptOrId) => {
  if (receiptOrId && typeof receiptOrId === 'object' && Array.isArray(receiptOrId.lines)) return receiptOrId;
  const id = typeof receiptOrId === 'object' ? receiptOrId?.id : receiptOrId;
  const receipt = id ? await fetchReceipt(id) : null;
  if (!receipt) throw new Error('That receipt could not be found.');
  return receipt;
};

/** Resolves to the filename handed to the browser. */
export const downloadSaccoReceipt = async (receiptOrId, sacco) => {
  const receipt = await withLines(receiptOrId);
  return downloadAccountingDocument(buildSaccoPaymentReceipt({ receipt, sacco }));
};

/** Resolves once the print dialog has the receipt; rejects if the browser refused. */
export const printSaccoReceipt = async (receiptOrId, sacco) => {
  const receipt = await withLines(receiptOrId);
  const handed = await printAccountingDocument(buildSaccoPaymentReceipt({ receipt, sacco }));
  if (!handed) throw new Error('The browser would not open the print dialog. Download the PDF and print it from there.');
  return receipt.receipt_no;
};
