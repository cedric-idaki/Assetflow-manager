/**
 * Device identity for the two-device rule (one phone + one laptop/tablet).
 *
 * This module answers "which device am I?" — it never decides whether that
 * device is allowed. The slot a device occupies is derived server-side from
 * the request's User-Agent in public.classify_device_type(), so a tampered
 * client cannot talk its way into the free slot. The classifier below is a
 * mirror of that SQL, used to label the UI and as the hint the server falls
 * back to when it sees no User-Agent header at all.
 *
 * Keep this file and supabase/migrations/20260813120000_user_device_restrictions.sql
 * in step.
 */

export const DEVICE_ID_STORAGE_KEY = 'ararat_device_id';

// phone -> its own slot; tablet and laptop share the other one.
export const DEVICE_TYPE_LABELS = {
  phone:  'Phone',
  tablet: 'Tablet',
  laptop: 'Computer',
};

export const SLOT_LABELS = {
  mobile:   'mobile phone',
  computer: 'laptop or tablet',
};

export const SLOT_ICONS = {
  mobile:   'Smartphone',
  computer: 'Laptop',
};

export const DEVICE_TYPE_ICONS = {
  phone:  'Smartphone',
  tablet: 'Tablet',
  laptop: 'Laptop',
};

// ── Stable id ────────────────────────────────────────────────────────────────
// Survives reloads and sign-outs; a user who clears site data looks like a new
// device and has to spend one of their device changes. That is the honest
// trade-off of a storage-based id — the alternative, fingerprinting the
// browser, groups genuinely different laptops together and would let a second
// one through.
let memoryDeviceId = null;

const randomId = () => {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0');
};

/**
 * The id for this browser. Falls back to a per-tab id when localStorage is
 * unavailable (private mode, blocked storage) so sign-in still works — that
 * session simply registers as a new device.
 */
export const getDeviceId = () => {
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (stored && stored.length >= 8 && stored.length <= 128) return stored;
    const minted = randomId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, minted);
    return minted;
  } catch {
    if (!memoryDeviceId) memoryDeviceId = randomId();
    return memoryDeviceId;
  }
};

const currentUserAgent = () =>
  (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';

/**
 * 'phone' | 'tablet' | 'laptop'. Mirrors public.classify_device_type().
 */
export const classifyDeviceType = (userAgent = currentUserAgent()) => {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return 'laptop';

  // Tablets first: an iPad's Safari UA also carries "Mobile", and an Android
  // tablet is an Android UA *without* the "Mobile" token.
  if (
    ua.includes('ipad') ||
    ua.includes('tablet') ||
    ua.includes('kindle') ||
    ua.includes('silk/') ||
    ua.includes('playbook') ||
    (ua.includes('android') && !ua.includes('mobile'))
  ) {
    return 'tablet';
  }

  if (
    ua.includes('iphone') ||
    ua.includes('ipod') ||
    ua.includes('android') ||
    ua.includes('windows phone') ||
    ua.includes('blackberry') ||
    ua.includes('bb10') ||
    ua.includes('opera mini') ||
    ua.includes('mobile')
  ) {
    return 'phone';
  }

  return 'laptop';
};

/** 'mobile' | 'computer'. Mirrors public.device_slot_for_type(). */
export const slotForType = (deviceType) => (deviceType === 'phone' ? 'mobile' : 'computer');

// ── Friendly name ────────────────────────────────────────────────────────────
const browserName = (ua) => {
  if (ua.includes('edg/'))            return 'Edge';
  if (ua.includes('opr/') || ua.includes('opera')) return 'Opera';
  if (ua.includes('samsungbrowser'))  return 'Samsung Internet';
  if (ua.includes('firefox') || ua.includes('fxios')) return 'Firefox';
  if (ua.includes('crios') || ua.includes('chrome')) return 'Chrome';
  if (ua.includes('safari'))          return 'Safari';
  return 'Browser';
};

const osName = (ua) => {
  if (ua.includes('windows'))                    return 'Windows';
  if (ua.includes('android'))                    return 'Android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'iOS';
  if (ua.includes('cros'))                       return 'ChromeOS';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macOS';
  if (ua.includes('linux'))                      return 'Linux';
  return 'Unknown OS';
};

/** e.g. "Chrome on Windows" — shown in the device list so a user can tell theirs apart. */
export const describeDevice = (userAgent = currentUserAgent()) => {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return 'Unknown device';
  return `${browserName(ua)} on ${osName(ua)}`;
};

/** Everything the register RPC needs about the device making the call. */
export const currentDeviceDescriptor = () => {
  const userAgent = currentUserAgent();
  const deviceType = classifyDeviceType(userAgent);
  return {
    deviceId:   getDeviceId(),
    deviceType,
    slot:       slotForType(deviceType),
    deviceName: describeDevice(userAgent),
  };
};
