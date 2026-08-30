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
export const toCSV = (data, columns) => {
  if (!data || data.length === 0) return '';
  const headers = columns && columns.length ? columns : Object.keys(data[0]);

  const cell = (value) => {
    if (value === null || value === undefined) return '""';
    const s = String(value);
    // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
    // Values here come from tenant-entered names, so prefix them out of it.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  return [
    headers.map(cell).join(','),
    ...data.map(row => headers.map(h => cell(row[h])).join(',')),
  ].join('\r\n');
};

/** Hand the browser a CSV to save. Returns false if there was nothing to write. */
export const downloadCSV = (data, filename, columns) => {
  const csv = toCSV(data, columns);
  if (!csv) return false;

  // The BOM is what makes Excel open a UTF-8 CSV without mangling accented
  // names — without it "Wanjirũ" arrives as mojibake.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
};
