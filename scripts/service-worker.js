/* Release identifiers and exact local asset URLs are injected after Expo export. */
const CACHE_NAME = 'wordmemo-web-__BUILD_VERSION__';
const PRECACHE_URLS = __PRECACHE_URLS__;
const PRECACHE_PATHS = new Set(PRECACHE_URLS);

self.addEventListener('install', event => {
  // A failed download leaves the previous release active. Do not force an
  // update into an open practice session with skipWaiting().
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Activation happens only after every tab on the previous release closes.
    // User progress is in localStorage and is never touched by this worker.
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('wordmemo-web-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = request.mode === 'navigate' && !PRECACHE_PATHS.has(url.pathname) ? '/index.html' : url.pathname;
  if (!PRECACHE_PATHS.has(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(path);
    // Keep HTML and its assets on the same complete release when offline.
    // Only the exact build assets are intercepted, never external links.
    return cached || fetch(request);
  })());
});
