// PlazaP2P V3 — Service Worker
// Cache-first para assets estáticos. Network-first para todo lo externo.
//
// ── Checklist de release ─────────────────────────────────────────
// Al desplegar cambios, actualizar la versión V en TODOS estos sitios:
//   1. index.html    → style.css?v=V, app.js?v=V y los 5 imports del bloque inline
//   2. js/app.js     → const ASSET_VERSION = 'V' (versiona los data/*.json)
//   3. publicar.html → publicar.css?v=V, publicar-app.js?v=V
//   4. sw.js         → CACHE 'rN' (incrementar) + entradas ?v=V de STATICS
// Regla: cada entrada de STATICS es EXACTAMENTE una URL que el navegador
// pide de verdad. Los imports internos de ES modules van SIN query.
const CACHE    = 'plazap2p-v3-r36';
const STATICS  = [
  './',
  './index.html',
  './publicar.html',
  // Assets versionados (los pide el HTML / versioned() con ?v=)
  './css/style.css?v=30',
  './css/publicar.css?v=30',
  './js/app.js?v=30',
  './js/publicar-app.js?v=30',
  './js/btc-stats.js?v=30',
  './js/btc-chart.js?v=30',
  './js/btc-market.js?v=30',
  './js/converter.js?v=30',
  './js/mini-converter.js?v=30',
  './data/config.json?v=30',
  './data/comunidades.json?v=30',
  './data/herramientas.json?v=30',
  './data/multimedia.json?v=30',
  './data/eventos.json?v=30',
  './data/mantenimiento.json?v=30',
  // Imports internos de ES modules (siempre sin query)
  './js/signer.js',
  './js/publish-utils.js',
  './js/publish-builders.js',
  './js/mis-anuncios.js',
  './js/reputacion.js',
  './js/nostr.js',
  './js/relay-pool.js',
  './js/nwc.js',
  './js/wallet-session.js',
  './js/wallet-ui.js',
  './js/vendor/nostr-crypto.js',
  './js/vendor/qrcode.js',
  // Estáticos sin versionar
  './docs/bitcoin-whitepaper-es.pdf',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-192.png',
  './icons/icon-512.svg',
  './icons/icon-512.png',
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

  // Callback de Amber (NIP-55): la URL lleva el resultado firmado en los
  // query params — SIEMPRE red directa y NUNCA cache.put (evita persistir
  // eventos firmados en el caché y servir versiones stale del callback)
  if (url.pathname.endsWith('/publicar.html') &&
      (url.searchParams.has('amber') || url.searchParams.has('event') || url.searchParams.has('res'))) {
    e.respondWith(
      fetch(request).catch(() =>
        caches.match('./publicar.html').then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Local assets: cache-first, fallback to network then cache update
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        // No cachear URLs con cache-buster temporal (ratings.json?t=<minuto>):
        // crearían una entrada nueva por minuto y la caché crecería sin límite.
        if (res.ok && !url.searchParams.has('t')) {
          caches.open(CACHE).then(c => c.put(request, res.clone()));
        }
        return res;
      }).catch(() => {
        // Fallback offline SOLO para navegaciones — servir HTML a un módulo
        // JS o CSS fallido provocaría un error de MIME type.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
