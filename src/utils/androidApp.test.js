import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAndroidAppContext, ANDROID_APP_FLAG_KEY } from './androidApp';

/** jsdom keeps location and referrer read-only, so drive them the supported way. */
const setUrl = (url) => window.history.replaceState({}, '', url);

const setReferrer = (value) =>
  Object.defineProperty(document, 'referrer', { value, configurable: true });

describe('isAndroidAppContext', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    setUrl('/');
    setReferrer('');
  });

  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('is false for an ordinary browser visit', () => {
    expect(isAndroidAppContext()).toBe(false);
  });

  it('detects the launch parameter the TWA opens with', () => {
    setUrl('/login?src=twa');
    expect(isAndroidAppContext()).toBe(true);
  });

  it('detects the android-app:// referrer Chrome attaches in a TWA', () => {
    // The fallback for when the user has navigated somewhere that dropped the
    // query string but the launch referrer is still on the document.
    setReferrer('android-app://com.smebusinessclinic.assetflow');
    expect(isAndroidAppContext()).toBe(true);
  });

  it('ignores an unrelated referrer', () => {
    setReferrer('https://www.google.com/');
    expect(isAndroidAppContext()).toBe(false);
  });

  it('stays true after the launch markers are gone', () => {
    // React Router rewrites the URL as soon as the app navigates, so a detector
    // that re-derived the answer every call would flip back to false mid-session
    // and put the registration CTA back on screen inside the Play Store app.
    setUrl('/login?src=twa');
    expect(isAndroidAppContext()).toBe(true);

    setUrl('/role-based-dashboard');
    expect(isAndroidAppContext()).toBe(true);
  });

  it('latches into sessionStorage and never localStorage', () => {
    // A TWA runs on Chrome and shares its storage with the user's own browser.
    // Writing this flag to localStorage would leak out of the app and hide
    // registration from the same person browsing the site normally.
    setUrl('/?src=twa');
    isAndroidAppContext();

    expect(window.sessionStorage.getItem(ANDROID_APP_FLAG_KEY)).toBe('1');
    expect(window.localStorage.getItem(ANDROID_APP_FLAG_KEY)).toBeNull();
  });

  it('still answers when storage is unavailable', () => {
    // Private mode and blocked-storage configurations throw on access; the app
    // has to keep rendering rather than crash on a policy check.
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('storage blocked');
      },
    });

    try {
      setUrl('/?src=twa');
      expect(isAndroidAppContext()).toBe(true);

      setUrl('/');
      expect(isAndroidAppContext()).toBe(false); // no latch to fall back on
    } finally {
      Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});
