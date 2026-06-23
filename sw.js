const CACHE_NAME = 'sammelbuch-v9';

const APP_SHELL = [
  './Sammelbuch.html',
];

const CDN_URLS = [
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7/babel.min.js',
];

const FONTS_ORIGIN = 'https://fonts.googleapis.com';

// ── Install: pre-cache app shell and CDN scripts ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([...APP_SHELL, ...CDN_URLS])
    )
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: routing strategies ─────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Google Fonts: network-first, fall back to cache
  if (url.origin === FONTS_ORIGIN || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(networkFirst(request));
    return;
  }

  // CDN scripts: cache-first
  if (CDN_URLS.includes(request.url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // App shell (Sammelbuch.html): cache-first
  if (url.pathname.endsWith('Sammelbuch.html') || url.pathname.endsWith('/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else: network-first with cache fallback
  event.respondWith(networkFirst(request));
});

// ── Strategy helpers ──────────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline – bitte später erneut versuchen.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline – bitte später erneut versuchen.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
