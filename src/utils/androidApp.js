/**
 * "Are we running inside the Play Store app?" — used to hide paid registration.
 *
 * WHY: the Android build is a Trusted Web Activity, so it serves this exact
 * site; there is no separate bundle and therefore no build-time flag to switch
 * on. Google Play's Payments policy expects in-app purchases of a digital
 * service to go through Google Play Billing, and our registration wizard takes
 * M-Pesa money for portal access. Rather than wire up Play Billing, the app
 * hides the signup path entirely and existing customers just sign in — the
 * ordinary pattern for B2B SaaS on Play. The web keeps the full flow.
 *
 * DETECTION, in order of reliability:
 *   1. ?src=twa — set as the app's launch URL in twa-manifest.json, so it is
 *      present on the very first navigation of every launch.
 *   2. An `android-app://` referrer, which Chrome attaches when a Trusted Web
 *      Activity opens a page. This is the fallback for when the user has
 *      navigated somewhere that dropped the query string.
 *
 * STORAGE: sessionStorage, never localStorage. A TWA runs on Chrome and shares
 * its storage with the user's ordinary browser, so a localStorage flag written
 * by the app would leak out and hide registration from that same person
 * browsing the site normally in Chrome. sessionStorage is scoped to the
 * browsing context, which is exactly the boundary we want.
 */
export const ANDROID_APP_FLAG_KEY = 'ararat_android_app';
export const ANDROID_APP_LAUNCH_PARAM = 'src';
export const ANDROID_APP_LAUNCH_VALUE = 'twa';

const readSession = (key) => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null; // Storage blocked — fall through to live detection each call.
  }
};

const writeSession = (key, value) => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* Non-fatal: detection just re-runs on the next call. */
  }
};

/** Signals present only on a launch navigation, before the router rewrites the URL. */
const detectFromLaunch = () => {
  if (typeof window === 'undefined') return false;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(ANDROID_APP_LAUNCH_PARAM) === ANDROID_APP_LAUNCH_VALUE) return true;
  } catch {
    /* Malformed query string — fall through to the referrer check. */
  }

  return typeof document !== 'undefined' && (document.referrer || '').startsWith('android-app://');
};

/**
 * True when this page is being shown by the Android app from Google Play.
 *
 * Latches on first detection: the launch markers vanish once React Router takes
 * over the URL, so the answer has to be remembered for the rest of the session.
 */
export const isAndroidAppContext = () => {
  if (typeof window === 'undefined') return false;

  if (readSession(ANDROID_APP_FLAG_KEY) === '1') return true;

  if (detectFromLaunch()) {
    writeSession(ANDROID_APP_FLAG_KEY, '1');
    return true;
  }

  return false;
};
