/**
 * The tenant's letterhead, fetched once and shared by every document.
 *
 * public.get_tenant_letterhead() returns the business identity — branding over
 * the registration record — to anyone in the tenant: staff, clients, sacco
 * members. That is the point of it: company_profiles is readable only by the
 * tenant owner, so a cashier's receipt used to be headed "Ararat".
 *
 * The logo comes back as a storage path. It is loaded here, once, into a data:
 * URL with its pixel size, so every renderer can embed it synchronously — a
 * jsPDF painter needs the bytes, and an HTML document printed through an
 * iframe must not race a network fetch against the print dialog.
 *
 * FAILS SOFT, always. A letterhead is decoration on a document somebody is
 * waiting for: no fetch failure, missing migration or broken image may ever
 * cost the receipt. Every path here resolves to a letterhead or to null.
 *
 * Cached per signed-in user, for ten minutes, so a till left open all day
 * picks up a new logo without anyone reloading, and signing in as somebody
 * else can never read the previous user's cache.
 */

import { supabase } from './supabase';
import { logger } from '../utils/logger';
import { normaliseLetterhead } from '../utils/letterhead';

export const BRANDING_BUCKET = 'tenant-branding';

const TTL_MS = 10 * 60 * 1000;
/** A failure is retried sooner — a transient blip should not cost ten minutes. */
const FAILURE_TTL_MS = 60 * 1000;
const LOGO_TIMEOUT_MS = 8000;

let cacheUser = null;
let cache = new Map();          // key → { at, ttl, promise, value }
const listeners = new Set();

/** Public URL of a stored logo. The bucket is public: logos are printed matter. */
export const logoPublicUrl = (path) => {
  if (!path) return null;
  try {
    return supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path)?.data?.publicUrl || null;
  } catch {
    return null;
  }
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('Could not read the logo'));
  reader.readAsDataURL(blob);
});

const imageSize = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
  img.onerror = () => reject(new Error('The logo is not a readable image'));
  img.src = src;
});

/**
 * PNG or JPEG, from the file's own first bytes. The storage response's
 * Content-Type is usually right, but jsPDF refuses an image whose declared
 * format does not match its bytes, so the bytes decide.
 */
const sniffFormat = async (blob) => {
  try {
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'PNG';
    if (head[0] === 0xff && head[1] === 0xd8) return 'JPEG';
  } catch { /* fall through to the declared type */ }
  if (/jpe?g/i.test(blob.type || '')) return 'JPEG';
  if (/png/i.test(blob.type || '')) return 'PNG';
  return null;
};

/**
 * Load an image URL into { src: data URL, width, height, format }. Rejects on
 * anything that is not a PNG or JPEG; callers treat that as "no logo".
 */
export const loadLogoImage = async (url, { timeoutMs = LOGO_TIMEOUT_MS } = {}) => {
  if (!url) return null;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl?.signal });
    if (!res.ok) throw new Error(`The logo could not be downloaded (${res.status})`);
    const blob = await res.blob();
    const format = await sniffFormat(blob);
    if (!format) throw new Error('The logo is not a PNG or JPEG image');

    const raw = await blobToDataUrl(blob);
    // Re-label the data URL with the sniffed type so the two always agree.
    const src = raw.replace(/^data:[^;,]*/, `data:image/${format === 'JPEG' ? 'jpeg' : 'png'}`);
    const { width, height } = await imageSize(src);
    return { src, width, height, format };
  } finally {
    clearTimeout(timer);
  }
};

const sessionUserId = async () => {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch {
    return null;
  }
};

const load = async (tenantId) => {
  const { data, error } = await supabase.rpc('get_tenant_letterhead', { p_admin_id: tenantId || null });
  if (error) throw error;
  const lh = normaliseLetterhead(data);
  if (!lh) return null;

  if (lh.logoPath) {
    try {
      lh.logo = await loadLogoImage(logoPublicUrl(lh.logoPath));
    } catch (err) {
      // The identity still prints; only the picture is lost.
      logger.warn('Letterhead logo could not be loaded — printing without it', {
        error: err?.message,
      });
      lh.logo = null;
    }
  }
  return lh;
};

/**
 * The letterhead for `tenantId`, or for the caller's own tenant when omitted.
 * Resolves to null when there is none (not signed in, not a tenant, not
 * deployed yet, offline) — never rejects.
 */
export const fetchLetterhead = async ({ tenantId = null, force = false } = {}) => {
  const userId = await sessionUserId();
  if (!userId) return null;

  if (cacheUser !== userId) {
    cache = new Map();
    cacheUser = userId;
  }

  const key = tenantId || 'self';
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < hit.ttl) return hit.promise;

  const entry = { at: Date.now(), ttl: TTL_MS, value: undefined, promise: null };
  const generation = cache;
  entry.promise = load(tenantId)
    .then((lh) => {
      entry.value = lh;
      // The caller's own letterhead is also THAT tenant's letterhead, so a
      // document naming the tenant explicitly does not fetch it a second time.
      // Only into the cache this request was made against: if the branding
      // was saved (or the user changed) while it was in flight, this value is
      // already stale and must not seed the fresh cache.
      if (lh?.tenantId && key === 'self' && cache === generation && !cache.has(lh.tenantId)) {
        cache.set(lh.tenantId, entry);
      }
      return lh;
    })
    .catch((err) => {
      logger.warn('Letterhead unavailable — documents print without branding', {
        tenantId, error: err?.message,
      });
      entry.value = null;
      entry.ttl = FAILURE_TTL_MS;
      return null;
    });

  cache.set(key, entry);
  return entry.promise;
};

/**
 * The letterhead if it has already been fetched, synchronously; undefined when
 * it has not (null means "fetched, and there is none"). Lets a hook render the
 * cached value on its first paint instead of flashing an empty header.
 */
export const peekLetterhead = (tenantId = null) => {
  const hit = cache.get(tenantId || 'self');
  if (!hit || Date.now() - hit.at >= hit.ttl) return undefined;
  return hit.value;
};

/**
 * The signed-in user's own letterhead from the cache, or null. For document
 * builders that must produce a page synchronously (a print button hands the
 * browser a finished page on the click). The cache is warmed at sign-in by
 * LetterheadPrefetch, so by the time anyone presses Print it is here; a
 * builder that finds nothing prints from the record it was given, as before.
 */
export const currentLetterhead = () => peekLetterhead(null) ?? null;

/** Subscribe to "the letterhead changed". Returns the unsubscribe function. */
export const onLetterheadChange = (fn) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

/**
 * Drop the cache and tell every subscriber to refetch. Called after the
 * branding is saved, so every open document preview and the next download in
 * this session carry the new identity at once.
 */
export const invalidateLetterhead = () => {
  cache = new Map();
  listeners.forEach((fn) => {
    try { fn(); } catch { /* a listener's failure is its own */ }
  });
};

/** Called on sign-out: nothing survives into the next session. */
export const clearLetterheadCache = () => {
  cache = new Map();
  cacheUser = null;
};

export default fetchLetterhead;
