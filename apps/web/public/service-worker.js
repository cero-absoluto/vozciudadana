// Bumped on each strategy change so the activate handler purges the old cache.
const CACHE_NAME = 'vozciudadana-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Only handle GET requests to the same origin
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Network-first for page navigations / HTML. This keeps index.html fresh so
  // it always references the current (hashed) JS/CSS after a deploy — no more
  // "old version served from cache" lag. Falls back to cache when offline.
  const accept = event.request.headers.get('accept') || '';
  const isHtml = event.request.mode === 'navigate' || accept.includes('text/html');
  if (isHtml) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // Cache-first for everything else. Hashed build assets are immutable, so a new
  // deploy produces new filenames and the stale ones simply go unused (and are
  // purged when CACHE_NAME changes). Non-hashed assets get refreshed in the
  // background (stale-while-revalidate).
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || network;
    })
  );
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon  || '/icon-192.png',
      badge:   data.badge || '/icon-72.png',
      data:    { url: data.url },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || 'https://voiceprotest.org';
  event.waitUntil(clients.openWindow(url));
});
