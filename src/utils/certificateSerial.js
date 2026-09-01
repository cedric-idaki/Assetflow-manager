/**
 * Certificate serial numbers.
 *
 * Every certificate the system issues — share certificates, settlement /
 * ownership-transfer certificates, electronic signature certificates — carries
 * one serial minted by the database, unique across the whole platform:
 *
 *   ARA-SHR-2026-000412-7QK3
 *
 * The four trailing characters are random, which is what stops a serial from
 * being a licence to walk the rest of the register. See
 * supabase/migrations/20260901140000_certificate_serials.sql.
 *
 * These helpers are pure: minting happens only in the database, and
 * verification only through system_certificate_verify().
 */

// Everything except letters and digits is decoration. People retype serials off
// paper with spaces, lowercase, or the wrong dash, and all of those should find
// the certificate — the database indexes the same normalised form.
export const normalizeSerial = (s) =>
  String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Put a normalised serial back into its printed shape, so what we echo to the
 * reader matches the paper in their hand. Anything that is not the shape we
 * mint is returned trimmed and uppercased rather than forced into groups —
 * a serial from some future format should still be legible.
 */
export const formatSerial = (s) => {
  const raw = String(s ?? '').trim();
  if (!raw) return '';
  if (raw.includes('-')) return raw.toUpperCase();

  const key = normalizeSerial(raw);
  const m = key.match(/^([A-Z]{3})([A-Z]{3})(\d{4})(\d{6})([A-Z0-9]{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}` : raw.toUpperCase();
};

/**
 * Does this look like one of our serials at all? Used only to keep the verify
 * box from firing a round trip on an obviously empty or truncated entry — the
 * database is the authority on whether a serial exists.
 */
export const isSerialShaped = (s) => {
  const key = normalizeSerial(s);
  return key.length >= 12 && /^[A-Z0-9]+$/.test(key);
};

/** What each serial's type segment means, for display next to a result. */
export const CERT_TYPE_LABELS = {
  share:      'Share certificate',
  settlement: 'Settlement & ownership transfer',
  esignature: 'Electronic signature',
};

export const certTypeLabel = (t) => CERT_TYPE_LABELS[t] || 'Certificate';

/**
 * The one-line verdict for a verification result, and the tone to show it in.
 *
 * `digest_ok` false is the loud case: the serial is real and on file, but the
 * row no longer matches the digest taken when it was issued, so something has
 * edited the registry outside the issuing functions. That is worse news than a
 * serial that simply does not exist, and must never read as "verified".
 */
export const verdictOf = (r) => {
  if (!r) return { tone: 'unknown', title: 'No certificate with that serial', detail: 'Nothing on this platform has ever been issued under that number. Check for a mistyped character.' };
  if (r.digest_ok === false) return { tone: 'tampered', title: 'Record does not match its own seal', detail: 'This serial is on file, but the stored record has been altered since it was issued. Treat the document as unverified and report it.' };
  if (r.certificate_status === 'revoked') return { tone: 'revoked', title: 'Revoked', detail: r.revoked_reason_text || 'The issuer withdrew this certificate.' };
  if (r.certificate_status === 'superseded') return { tone: 'superseded', title: 'Superseded', detail: r.superseded_by_serial ? `Replaced by ${formatSerial(r.superseded_by_serial)}.` : 'A later certificate has replaced this one.' };
  return { tone: 'valid', title: 'Genuine and current', detail: 'This serial matches a certificate issued by this system, and the record is unaltered.' };
};
