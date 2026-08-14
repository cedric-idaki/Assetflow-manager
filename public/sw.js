/**
 * Service worker for the installed / Play Store (TWA) build.
 *
 * Its only jobs are (a) make hashed build assets load instantly on repeat
 * visits and (b) show a branded offline screen instead of Chrome's dinosaur
 * when the network is gone. It is deliberately NOT an offline-first cache.
 *
 * WHAT THIS MUST NEVER DO, and why:
 *
 *   - Cache anything cross-origin. Every Supabase read, auth token refresh and
 *     edge-function call lives on another origin. Caching a signed-in response
 *     risks handing one user's data to the next person on a shared device, so
 *     the fetch handler bails out on anything that is not same-origin.
 *
 *   - Cache non-GET requests, or navigations. Navigations are network-only with
 *     an offline fallback: caching the SPA shell would let a stale index.html
 *     survive a deploy and ask for /assets/index-OLDHASH.js that no longer
 *     exists, which bricks the app until someone clears storage.
 *
 * Only /assets/* is cache-first, and only because Vite content-hashes those
 * filenames — a changed file is a different URL, so a cached one can't go stale.
 */
const VERSION = 'v1';
const SHELL_CACHE = `ararat-shell-${VERSION}`;
const ASSET_CACHE = `ararat-assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';

// Stable filenames only — nothing content-hashed, so this list survives deploys.
const PRECACHE = [OFFLINE_URL, '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, so one 404 can't fail the whole install the way addAll does.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('ararat-') && key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Content-hashed build output — safe to serve from cache indefinitely. */
const isHashedAsset = (url) =>
  url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/');

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase et al. — never touch.

  // Digital Asset Links must always come from the server, or Play's app-to-site
  // verification can end up reading a stale fingerprint.
  if (url.pathname.startsWith('/.well-known/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return (
          cached ||
          new Response('You are offline.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          })
        );
      }),
    );
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            // Opaque/error responses are not worth persisting.
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

// Lets the page trigger an immediate update instead of waiting for all tabs to close.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
