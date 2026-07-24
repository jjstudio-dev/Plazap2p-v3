// router.js — Router hash aditivo sobre el shell de 5 destinos (CODE-016,
// ver txt/PLAN_VERIFICACION_APP_PURA.md §19.3). NO sustituye a switchTab()
// ni a la sincronización ?tab= ya existente en app.js (initTabFromUrl/
// window.switchTab) — las dos conviven: ?tab= sigue funcionando para
// enlaces/atajos antiguos (p.ej. los shortcuts del manifest PWA), y el hash
// añade historial real de Atrás/Adelante entre secciones, que hoy no existe
// porque switchTab() usa replaceState.
//
// Deep-link a un anuncio concreto (#/anuncio/<naddr>) y a mercado filtrado
// (#/mercado?tipo=venta&zona=madrid) quedan para la Fase 2: dependen del
// modal de detalle y del estado de filtros, que este router no conoce.
//
// Las funciones puras (parseHash/destRoute/resolveHash) están separadas de
// initRouter() para poder probarlas con node:test sin DOM.

import { GROUPS, tabToDest } from './app-shell.js';

/** '#/plaza/mercado' → { dest: 'plaza', sub: 'mercado' }. Hash vacío → dest null. */
export function parseHash(hash) {
  const clean = String(hash || '').replace(/^#\/?/, '').replace(/\/$/, '');
  if (!clean) return { dest: null, sub: null };
  const [dest, sub] = clean.split('/');
  return { dest: dest || null, sub: sub || null };
}

/** dest+tab → hash canónico, o null si el destino es externo (no tiene hash propio). */
export function destRoute(dest, tab) {
  const g = GROUPS[dest];
  if (!g || g.external) return null;
  if (!tab || tab === g.default) return `#/${dest}`;
  return `#/${dest}/${tab}`;
}

/**
 * Resuelve un hash entrante a { dest, tab } válidos según GROUPS, o null si
 * el hash no corresponde a ninguna sección conocida (hash ajeno/manual).
 */
export function resolveHash(hash) {
  const { dest, sub } = parseHash(hash);
  const g = dest && GROUPS[dest];
  if (!g || g.external) return null;
  const tab = g.tabs && g.tabs.includes(sub) ? sub : g.default;
  return { dest, tab };
}

/** hash canónico para un tab ya activo (usa tabToDest de app-shell.js — misma fuente de verdad). */
export function routeForTab(tab) {
  const dest = tabToDest(tab);
  return dest ? destRoute(dest, tab) : null;
}

// ── Deep link a un anuncio concreto (Fase 2, CODE-004/CODE-003) ────────────
// Vive aparte de GROUPS/resolveHash: un anuncio no es un "destino" del shell,
// es una vista superpuesta (modal) sobre el tab Mercado. El cableado real
// (abrir el modal cuando el dato ya esté cargado, cerrarlo si el hash deja
// de apuntar a él) vive en app.js, que es quien conoce `channels`/openModal.

/** '#/anuncio/<naddr>' → naddr, o null si el hash no es de este tipo. */
export function parseAnuncioHash(hash) {
  const clean = String(hash || '').replace(/^#\/?/, '');
  const m = clean.match(/^anuncio\/([a-z0-9]+)$/i);
  return m ? m[1] : null;
}

/** naddr → hash canónico para compartir/recargar un anuncio concreto. */
export function anuncioRoute(naddr) {
  return `#/anuncio/${naddr}`;
}

function applyHash() {
  const resolved = resolveHash(window.location.hash);
  if (!resolved) return; // hash inválido, ajeno o de sección externa: no navegar
  if (typeof window.switchTab === 'function') {
    window.switchTab(resolved.tab, { syncUrl: false, syncHash: false });
  }
}

export function initRouter() {
  if (window.location.hash) applyHash();
  window.addEventListener('hashchange', applyHash);

  // Encadena sobre el switchTab ya envuelto por app-shell.js: mismo patrón
  // de composición (un solo listener por acción, sin reimplementar el
  // cambio de tab). syncHash:false evita bucles cuando applyHash() ya viene
  // de un hashchange.
  const original = window.switchTab;
  if (typeof original === 'function') {
    window.switchTab = function (tab, options = {}) {
      original(tab, options);
      if (options.syncHash === false) return;
      const hash = routeForTab(tab);
      if (hash && window.location.hash !== hash) {
        window.history.pushState(null, '', hash);
      }
    };
  }
}
