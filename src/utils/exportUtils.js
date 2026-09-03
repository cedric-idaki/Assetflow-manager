// src/utils/exportUtils.js

/**
 * Serialise rows of plain objects to CSV.
 *
 * The previous version quoted a value only when it contained a comma, so a
 * value carrying a quote, a newline or a leading space came out malformed and
 * shifted every column after it. That is tolerable for a glance-at-it export
 * and not for a file that gets reconciled against a tax return, so every field
 * is quoted and internal quotes are doubled — the RFC 4180 rule.
 *
 * `columns` fixes the column order. Without it the order comes from the first
 * row's keys, which is only stable if every row was built the same way.
 */
const csvCell = (value) => {
  if (value === null || value === undefined) return '""';
  const s = String(value);
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
  // Values here come from tenant-entered names, so prefix them out of it.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/**
 * Serialise a grid — an array of row arrays — to CSV.
 *
 * The lower level of the two, for a file that is not one rectangular table: a
 * dashboard export is several stacked tables with their own headers, and there
 * is no set of object keys that describes all of them at once.
 */
export const toCSVGrid = (rows) =>
  (rows || []).map((row) => (row || []).map(csvCell).join(',')).join('\r\n');

export const toCSV = (data, columns) => {
  if (!data || data.length === 0) return '';
  const headers = columns && columns.length ? columns : Object.keys(data[0]);
  return toCSVGrid([headers, ...data.map((row) => headers.map((h) => row[h]))]);
};

/**
 * Hand the browser a blob to save under a name.
 *
 * Split out of downloadCSV when the report builder gained an .xlsx export: the
 * six lines are the same whatever the file is, and the one detail that is easy
 * to drop — appending the anchor to the document before clicking it — is the
 * one Firefox needs, because an anchor outside the document is not clickable
 * there. A dozen call sites still roll their own; this is where they should go
 * as they are touched.
 */
export const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
};

/** Hand the browser CSV text to save. Returns false if there was nothing to write. */
export const downloadCSVText = (csv, filename) => {
  if (!csv) return false;

  // The BOM is what makes Excel open a UTF-8 CSV without mangling accented
  // names — without it "Wanjirũ" arrives as mojibake.
  return saveBlob(
    new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }),
    filename.endsWith('.csv') ? filename : `${filename}.csv`,
  );
};

/** Hand the browser a CSV to save. Returns false if there was nothing to write. */
export const downloadCSV = (data, filename, columns) =>
  downloadCSVText(toCSV(data, columns), filename);
