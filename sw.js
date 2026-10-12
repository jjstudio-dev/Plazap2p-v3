// PlazaP2P V3 — Service Worker
// Cache-first para assets estáticos. Network-first para todo lo externo.
//
// ── Checklist de release ─────────────────────────────────────────
// Al desplegar cambios, actualizar la versión V en TODOS estos sitios:
//   1. index.html    → style.css?v=V, app.js?v=V y los 7 imports del bloque inline
//   2. js/app.js     → const ASSET_VERSION = 'V' (versiona los data/*.json)
//   3. publicar.html → publicar.css?v=V, publicar-app.js?v=V
//   4. sw.js         → CACHE 'rN' (incrementar) + entradas ?v=V de STATICS
//   5. node tests/sw-cache-lock.test.mjs --update   (el CI falla si cambió un
//      archivo de STATICS y CACHE no)
// Regla: cada entrada de STATICS es EXACTAMENTE una URL que el navegador
// pide de verdad. Los imports internos de ES modules van SIN query.
const CACHE    = 'plazap2p-v3-r51';
const STATICS  = [
  './',
  './index.html',
  './publicar.html',
  // Assets versionados (los pide el HTML / versioned() con ?v=)
  './css/style.css?v=42',
  './css/publicar.css?v=42',
  './js/app.js?v=42',
  './js/app-shell.js?v=42',
  './js/router.js?v=42',
  './js/publicar-app.js?v=42',
  './js/btc-stats.js?v=42',
  './js/btc-chart.js?v=42',
  './js/btc-market.js?v=42',
  './js/converter.js?v=42',
  './js/mini-converter.js?v=42',
  './data/config.json?v=42',
  './data/comunidades.json?v=42',
  './data/herramientas.json?v=42',
  './data/multimedia.json?v=42',
  './data/eventos.json?v=42',
  './data/mantenimiento.json?v=42',
  // publicar-app.js pide la configuración SIN query (no lleva número de
  // versión propio): sin esta entrada, publicar.html sin red se quedaba con
  // los relays de reserva y sin los aspectos de valoración.
  './data/config.json',
  // Imports internos (@import CSS / ES modules, siempre sin query)
  './css/tokens.css',
  // app.js importa router.js (y este, app-shell.js) SIN query: son URLs
  // distintas de las versionadas de arriba y también hay que precachearlas,
  // o la app no arranca offline (tests/sw-precache.test.mjs lo comprueba).
  './js/router.js',
  './js/app-shell.js',
  './js/signer.js',
  './js/publish-utils.js',
  './js/publish-builders.js',
  './js/mis-anuncios.js',
  './js/drafts.js',
  './js/media-upload.js',
  './js/moderation.js',
  './js/trust-signals.js',
  './js/profile.js',
  './js/zaps.js',
  './js/favorites.js',
  './js/listing-utils.js',
  './js/btc-rates.js',
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

  // Navegaciones: la página es la misma con cualquier parámetro (?tab=,
  // ?valorar=<npub>, ?zap=…), así que se busca en la caché IGNORANDO la query
  // y nunca se guarda una copia por URL. Antes, sin red, publicar.html?valorar=…
  // no estaba en la caché y se servía index.html en su lugar.
  // Solo para páginas (/, *.html): una descarga —el APK, el PDF— también
  // llega como navegación y no debe recibir index.html como respuesta.
  if (request.mode === 'navigate' && /(\/|\.html)$/.test(url.pathname)) {
    const shell = url.pathname.endsWith('/publicar.html') ? './publicar.html' : './index.html';
    e.respondWith(
      caches.match(request, { ignoreSearch: true })
        .then(cached => cached || fetch(request))
        .catch(() => caches.match(shell))
    );
    return;
  }

  // Resto de recursos locales: primero la caché; si no está, red.
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        // Se guarda solo lo que tiene una URL estable: sin parámetros, o con
        // la versión de assets (?v=). Un parámetro variable (ratings.json?t=
        // <minuto>) crearía una entrada nueva cada vez y la caché crecería sin
        // límite. La copia se toma AQUÍ, antes de devolver la respuesta: hecha
        // más tarde, el cuerpo ya está consumido y clone() lanza.
        const params = [...url.searchParams.keys()];
        if (res.ok && params.every(k => k === 'v')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => Response.error());   // nunca HTML en lugar de un JS/CSS: daría error de tipo MIME
    })
  );
});
