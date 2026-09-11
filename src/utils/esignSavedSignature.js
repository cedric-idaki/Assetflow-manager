// Saved-signature store for the e-signature module.
//
// A captured signature is offered back for one-tap reuse on the signer's later
// fields. It belongs to ONE signer on ONE device — never to whoever signs next.
//
// The first version of this store kept a single device-wide entry, so the ink
// stayed on the machine forever and was handed to the next person who opened a
// document: a brand-new SACCO or company account found a "saved signature"
// waiting for it and stamped someone else's mark on its own contracts. Every
// entry is now filed under a fingerprint of the signing identity and expires,
// so nothing on the device is permanent and nothing crosses accounts.

const STORE_KEY = "ararat_esign_saved_v2";
// v1 held the unscoped device-wide entry; drop it the first time we read.
const LEGACY_KEYS = ["ararat_esign_saved_v1"];
// Long enough for one signing session, far short of a lifetime.
export const SAVED_TTL_MS = 12 * 60 * 60 * 1000;
// Walk-in desks cycle through signatories; keep only the recent few.
const MAX_IDENTITIES = 8;
// An uploaded signature image can be megabytes. Anything larger than this is
// used for the document at hand but never written to the device.
const MAX_DATA_CHARS = 512 * 1024;

const KINDS = new Set(["signature", "initials"]);

const storage = () => {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }       // private mode / blocked site data
};

// Fold the identity parts into a short opaque bucket key (FNV-1a). This is a
// lookup key, not a secret — its job is to keep raw emails out of the device
// store while still separating one signer from another.
export function signerFingerprint(...parts) {
  const raw = parts
    .map((p) => (p == null ? "" : String(p).trim().toLowerCase()))
    .filter(Boolean)
    .join("|");
  if (!raw) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `s${h.toString(36)}${raw.length.toString(36)}`;
}

const fresh = (entry, now) =>
  !!entry && typeof entry.savedAt === "number" && now - entry.savedAt < SAVED_TTL_MS;

// Read the store, dropping the legacy key and any entry that has aged out.
function readStore() {
  const store = storage();
  if (!store) return {};
  for (const k of LEGACY_KEYS) {
    try { store.removeItem(k); } catch { /* nothing we can do */ }
  }
  let parsed;
  try { parsed = JSON.parse(store.getItem(STORE_KEY) || "{}"); }
  catch { return {}; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const now = Date.now();
  const kept = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (fresh(entry, now)) kept[key] = entry;
  }
  return kept;
}

function writeStore(next) {
  const store = storage();
  if (!store) return false;
  // Keep the most recently used identities; older buckets are dropped.
  const entries = Object.entries(next)
    .sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0))
    .slice(0, MAX_IDENTITIES);
  try {
    store.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries)));
    return true;
  } catch {
    // Quota exceeded — keep only the newest identity and try once more.
    try {
      store.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, 1))));
      return true;
    } catch { return false; }
  }
}

// The saved capture for this signer, or null. An unknown signer (no key) never
// inherits one — that is the whole point of the scoping.
export function getSavedCapture(kind, signerKey) {
  if (!signerKey || !KINDS.has(kind)) return null;
  const entry = readStore()[signerKey];
  if (!entry) return null;
  const cap = entry[kind];
  return cap && cap.data ? cap : null;
}

// Remember a capture for this signer. Returns false when it was not persisted
// (no identity, no storage, or an image too large to keep).
export function setSavedCapture(kind, cap, signerKey) {
  if (!signerKey || !KINDS.has(kind) || !cap || !cap.data) return false;
  if (String(cap.data).length > MAX_DATA_CHARS) return false;
  const next = readStore();
  next[signerKey] = { ...(next[signerKey] || {}), [kind]: cap, savedAt: Date.now() };
  return writeStore(next);
}

// Forget this signer's saved marks — "that isn't mine" / signing is finished.
export function clearSavedCaptures(signerKey) {
  if (!signerKey) return false;
  const next = readStore();
  if (!next[signerKey]) return false;
  delete next[signerKey];
  return writeStore(next);
}
