/**
 * AGRIMETS — Service Worker
 * Strategy: Network-first for all app files.
 * Always fetches fresh from server, never serves stale cache.
 * This bypasses GitHub Pages CDN caching completely.
 */

const SW_VERSION = 'v' + Date.now(); // Changes on every deploy

self.addEventListener('install', (e) => {
  // Activate immediately without waiting
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Take control of all open tabs immediately
  e.waitUntil(clients.claim());

  // Delete ALL old caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => caches.delete(key)))
    )
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Only intercept same-origin requests (our app files)
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request, {
      cache: 'no-store',        // Force fresh from network
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      }
    })
    .catch(() => {
      // If network fails (offline), try cache as fallback
      return caches.match(e.request);
    })
  );
});
