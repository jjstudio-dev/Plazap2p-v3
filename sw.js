// PlazaP2P V3 — Service Worker
// Cache-first para assets estáticos. Network-first para todo lo externo.

// IMPORTANTE: incrementar 'r1' → 'r2' → 'r3'... en cada deploy para forzar actualización de caché
const CACHE    = 'plazap2p-v3-r32';
const STATICS  = [
  './',
  './index.html',
  './css/style.css?v=26',
  './js/app.js?v=26',
  './js/nostr.js',          // importado por app.js sin versión
  './js/relay-pool.js',     // importado por app.js sin versión
  './js/btc-stats.js?v=26',
  './js/btc-chart.js?v=26',
  './js/btc-market.js?v=26',
  './js/converter.js?v=26',
  './js/mini-converter.js?v=26',
  './data/config.json?v=26',
  './data/comunidades.json?v=26',
  './data/herramientas.json?v=26',
  './data/multimedia.json?v=26',
  './data/eventos.json?v=26',
  './data/mantenimiento.json?v=26',
  './docs/bitcoin-whitepaper-es.pdf',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-192.png',
  './icons/icon-512.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(STATICS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // External requests (APIs, fonts, relays): always network, never cache
  if (url.origin !== self.location.origin) {
    e.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  // Local assets: cache-first, fallback to network then cache update
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(request, res.clone()));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
