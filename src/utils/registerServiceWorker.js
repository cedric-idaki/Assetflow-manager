/**
 * Registers public/sw.js, which gives the installed Android app its offline
 * screen and makes repeat launches load from cache.
 *
 * Production only. In dev the worker would sit in front of Vite's module graph
 * and break HMR, and once registered on localhost it outlives the dev server —
 * so the guard also actively unregisters any worker left over from running a
 * production preview on the same origin.
 */
export const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return;

  if (!import.meta.env.PROD) {
    navigator.serviceWorker.getRegistrations?.().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
    return;
  }

  // After load: registration competes with the app's own first data fetches for
  // bandwidth, and those matter more to how fast the app feels.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // A failed registration costs the offline screen, nothing else — the app
      // itself still works, so this must never surface to the user.
      console.warn('Service worker registration failed:', error);
    });
  });
};
