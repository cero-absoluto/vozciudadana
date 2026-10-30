// Bumped on each strategy change so the activate handler purges the old cache.
const CACHE_NAME = 'vozciudadana-v6';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

const cacheableResponse = response => response?.ok
  && !/no-store|private/i.test(response.headers.get('cache-control') || '');
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all(ASSETS.map(async asset => {
    const response = await fetch(asset, {cache:'reload',credentials:'omit'});
    if (!response.ok) throw new Error('Public shell unavailable');
    if (cacheableResponse(response)) await cache.put(asset,response);
  }))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('vozciudadana-') && key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  // Only handle GET requests to the same origin
  if (event.request.method !== 'GET') return;
  let url;
  try { url = new URL(event.request.url); } catch { return; }
  if (url.origin !== self.location.origin || url.username || url.password) return;
  // Cache only public shell/static paths, without proof/query parameters.
  const publicPath = url.pathname === '/' || url.pathname === '/index.html'
    || url.pathname === '/manifest.json' || /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(url.pathname)
    || url.pathname === '/fonts/pdf-sans-subset.ttf' || /^\/(?:icon-\d+|apple-touch-icon|favicon(?:-\d+x\d+)?)\.(png|svg|ico)$/.test(url.pathname);
  if (!publicPath || url.search || event.request.headers.get('authorization')
    || ['no-store','reload'].includes(event.request.cache)) return;

  const offlineResponse = () => new Response('Network unavailable and no cached response.', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
  // Handle the rejection even when a cached response wins the race. Keep the
  // refresh and cache write alive without making a successful response depend
  // on cache availability or quota.
  const network = fetch(event.request).catch(() => null);
  event.waitUntil(
    network.then(async response => {
      if (!cacheableResponse(response)) return;
      const clone = response.clone();
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, clone);
    }).catch(() => {})
  );
  const cachedResponse = () => caches.open(CACHE_NAME).then(cache => cache.match(event.request)).catch(() => undefined);

  // Network-first for page navigations / HTML. This keeps index.html fresh so
  // it always references the current (hashed) JS/CSS after a deploy — no more
  // "old version served from cache" lag. Falls back to cache when offline.
  const accept = event.request.headers.get('accept') || '';
  const isHtml = event.request.mode === 'navigate' || accept.includes('text/html');
  if (isHtml) {
    event.respondWith(
      network.then(async response => response
        || await cachedResponse()
        || await caches.open(CACHE_NAME).then(cache => cache.match('./index.html')).catch(() => undefined)
        || offlineResponse())
    );
    return;
  }

  // Cache-first for everything else. Hashed build assets are immutable, so a new
  // deploy produces new filenames and the stale ones simply go unused (and are
  // purged when CACHE_NAME changes). Non-hashed assets get refreshed in the
  // background (stale-while-revalidate).
  event.respondWith(
    cachedResponse().then(cached => cached || network.then(response => response || offlineResponse()))
  );
});

// Push input is data. Never allow it to open another origin or load remote icons.
function notificationUrl(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/', self.location.origin);
    return url.origin === self.location.origin && ['https:','http:'].includes(url.protocol)
      && !url.username && !url.password ? url.href : self.location.origin + '/';
  } catch { return self.location.origin + '/'; }
}
self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { return; }
  if (!data || typeof data !== 'object' || typeof data.title !== 'string' || typeof data.body !== 'string') return;
  event.waitUntil(self.registration.showNotification(data.title.slice(0,160), {
    body: data.body.slice(0,1024), icon: '/icon-192.png', badge: '/icon-72.png',
    data: {url:notificationUrl(data.url)}, vibrate:[200,100,200],
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(notificationUrl(event.notification.data?.url)));
});
