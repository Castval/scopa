// Service Worker per Scopa PWA
const CACHE_VERSION = 'scopa-v9';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const IMG_CACHE = `${CACHE_VERSION}-img`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/client.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];
// TTL immagini: 7 giorni. Dopo tale periodo vengono ri-fetchate dalla rete
// e aggiornate in cache (stale-while-revalidate con scadenza).
const IMG_TTL_MS = 7 * 24 * 60 * 60 * 1000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Mai cachare socket.io, /api, /health
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api') || url.pathname.startsWith('/health')) {
    return;
  }
  // Solo GET
  if (req.method !== 'GET') return;

  // Network-first per HTML/JS/CSS (così aggiornamenti immediati)
  if (req.destination === 'document' || req.destination === 'script' || req.destination === 'style') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('/')))
    );
    return;
  }

  // Stale-while-revalidate con TTL per immagini (carte, icone).
  // Cache fresca (<= TTL): serve subito dalla cache; se scaduta, ri-fetcha.
  // Rete in background aggiorna sempre la cache (best-effort).
  if (req.destination === 'image') {
    e.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((res) => {
        // Salva con timestamp per il TTL
        if (res && res.ok) {
          const headers = new Headers(res.headers);
          headers.set('sw-cached-at', String(Date.now()));
          const body = res.clone().blob();
          body.then((b) => cache.put(req, new Response(b, { status: res.status, statusText: res.statusText, headers })));
        }
        return res;
      }).catch(() => null);

      if (cached) {
        const cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0', 10);
        const eta = Date.now() - cachedAt;
        if (eta < IMG_TTL_MS) return cached;
        // Scaduto: aspetta la rete (fallback alla cache se rete fallisce)
        const res = await fetchPromise;
        return res || cached;
      }
      // Non in cache: aspetta rete
      return (await fetchPromise) || new Response('', { status: 504 });
    })());
  }
});
