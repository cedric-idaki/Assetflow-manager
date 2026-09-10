/**
 * Signed-URL access for the private storage buckets.
 *
 * kyc-documents, contracts, esign-documents and employee-documents used to be
 * public buckets, so the app stored a permanent `.../object/public/<bucket>/<path>`
 * URL in columns like file_url and read it straight back into an href. Those
 * buckets are private as of the 20260731091000 migration — a public URL now 404s
 * and every read has to be a short-lived signed URL minted for the current
 * session.
 *
 * Rather than rewrite the stored data, these helpers accept whatever is already
 * in the column — a legacy public URL, an existing signed URL, or a bare storage
 * path — recover the bucket and path from it, and sign on demand at render time.
 *
 * client-photos and asset-images are still public buckets; URLs pointing at them
 * pass through untouched.
 */

import { supabase } from './supabase';
import { logger } from '../utils/logger';

/** Buckets that require a signed URL. Everything else passes through. */
const PRIVATE_BUCKETS = new Set([
  'kyc-documents',
  'contracts',
  'esign-documents',
  'employee-documents',
  // Asset register attachments — title deeds and logbooks, private from the
  // first day (20260830200000). Rows here store the BARE PATH rather than a
  // URL, so callers pass { bucket: ASSET_DOC_BUCKET } to resolve one.
  'sacco-asset-documents',
  // Certificates out for signature and the signed copies that come back
  // (20260901160000). A share certificate names a member, their holding and
  // their member number, so this one was private from the first day too. Rows
  // store the BARE PATH; callers pass { bucket: 'signed-certificates' }.
  'signed-certificates',
]);

/** Long enough to open and read a document, short enough not to be a share link. */
export const DEFAULT_TTL_SECONDS = 3600;

/**
 * Recover { bucket, path } from a stored value.
 *
 * Handles the three shapes that exist in the data: a legacy public URL, a signed
 * URL that has since expired, and a bare `<segment>/<file>` path. Returns null
 * for anything that is not a Supabase storage reference (external links, blob:
 * and data: URLs), which callers treat as "use as-is".
 */
export const parseStorageRef = (value, bucketHint = null) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!/^https?:\/\//i.test(trimmed)) {
    // A bare path is only resolvable when the caller names the bucket.
    if (!bucketHint) return null;
    return { bucket: bucketHint, path: trimmed.replace(/^\/+/, '') };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // /storage/v1/object/{public|sign|authenticated}/{bucket}/{path...}
  const match = parsed.pathname.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/
  );
  if (!match) return null;

  const [, bucket, rawPath] = match;
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    path = rawPath;
  }
  return { bucket, path };
};

/**
 * Resolve a stored value into a URL that will actually load right now.
 *
 * Values that are not private-bucket references are returned unchanged, so this
 * is safe to call on any URL column without first checking where it points.
 */
export const resolveFileUrl = async (value, { bucket = null, expiresIn = DEFAULT_TTL_SECONDS } = {}) => {
  // Already a live signed URL — hand it back untouched. This matters on the
  // public /sign/:token page, where esign-public signs the document server-side
  // and the visitor has no session to re-sign with.
  if (typeof value === 'string' && /\/storage\/v1\/object\/sign\//.test(value) && /[?&]token=/.test(value)) {
    return value;
  }

  const ref = parseStorageRef(value, bucket);
  if (!ref || !PRIVATE_BUCKETS.has(ref.bucket)) return value || null;

  const { data, error } = await supabase.storage
    .from(ref.bucket)
    .createSignedUrl(ref.path, expiresIn);

  if (error) {
    // Most often this is the tenant policy correctly refusing, or an object that
    // was removed. Surface null so callers can show "unavailable" rather than
    // opening a tab onto a 404.
    logger.warn('Could not sign storage URL', {
      bucket: ref.bucket,
      error: error.message,
    });
    return null;
  }
  return data?.signedUrl ?? null;
};

/**
 * Open a stored file in a new tab.
 *
 * The tab is opened synchronously and pointed at the signed URL once it comes
 * back — opening after the await would be blocked as a non-user-initiated popup.
 */
export const openStoredFile = async (value, options = {}) => {
  const win = window.open('', '_blank', 'noopener,noreferrer');
  const url = await resolveFileUrl(value, options);

  if (!url) {
    if (win) win.close();
    return false;
  }
  if (win) {
    win.location.href = url;
  } else {
    // Popup blocked despite the synchronous open — fall back to same-tab.
    window.location.href = url;
  }
  return true;
};
