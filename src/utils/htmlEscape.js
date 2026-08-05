/**
 * HTML escaping for the print / invoice / certificate generators.
 *
 * Those build a document as a string and hand it to `window.open('', '_blank')`
 * + `document.write()`. A blank window inherits the OPENER'S ORIGIN, so script
 * in that document runs as the app — with access to the Supabase session in
 * localStorage. Any tenant-supplied value (a client's name, a company name, a
 * checker's comment) interpolated raw into that string is therefore a stored
 * XSS with session-theft impact, not a cosmetic bug.
 *
 * Use the `html` tagged template rather than a bare backtick string:
 *
 *     w.document.write(html`<h1>${client.full_name}</h1>`);
 *
 * Every `${...}` is escaped automatically, so a value added to a template later
 * is safe by default. When a substitution is itself generated markup (a rows
 * fragment, a nested template), opt it out explicitly:
 *
 *     const rows = items.map(i => html`<tr><td>${i.name}</td></tr>`).join('');
 *     w.document.write(html`<table>${rawHtml(rows)}</table>`);
 *
 * `rawHtml` is deliberately noisy: it marks the exact places a reviewer has to
 * check, and there should never be one wrapping a value that came from the DB.
 */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a single value for interpolation into HTML text or an attribute. */
export const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
};

const RAW = Symbol('rawHtml');

/** Mark an already-built HTML fragment as safe to interpolate unescaped. */
export const rawHtml = (value) => ({ [RAW]: String(value ?? '') });

const isRaw = (v) => v !== null && typeof v === 'object' && RAW in v;

/**
 * Tagged template that escapes every substitution unless wrapped in rawHtml().
 * Arrays are joined with '' so `${items.map(...)}` behaves as expected.
 */
export const html = (strings, ...values) =>
  strings.reduce((out, str, i) => {
    if (i === 0) return str;
    const v = values[i - 1];
    let rendered;
    if (isRaw(v)) rendered = v[RAW];
    else if (Array.isArray(v)) rendered = v.map((x) => (isRaw(x) ? x[RAW] : escapeHtml(x))).join('');
    else rendered = escapeHtml(v);
    return out + rendered + str;
  }, '');

export default escapeHtml;
