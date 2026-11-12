import { encodeNaddr, hexToNpub, hexToNote, getTagValue, getTagValues, decodeNpub } from './nostr.js';
import { RelayPool } from './relay-pool.js';
import { fetchSignedConfig } from './signed-config.js';
import { loadServedConfig } from './config-loader.js';
import { fetchReputacionBatch } from './reputacion.js';
import { parseAnuncioHash, anuncioRoute, routeForTab } from './router.js';
import { isBlocked, blockPubkey, unblockPubkey, listBlocked, exportBlocked, importBlocked } from './moderation.js';
import { trustLevel, compareSellersByRating } from './trust-signals.js';
import { fetchZapReceipts } from './zaps.js';
import { communitiesFrom } from './comunidades-2140.js';
import { communityPoints, listingPoints, eventPoints, COMMERCE_TAG } from './map-data.js';
import { mostPreciseGeohash } from './geohash.js';
import { externalMarketsFrom, marketTags, marketOf, externalCategory, normalizeCurrency, marketListingUrl, isMarketSigned } from './external-markets.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import { channelTagFilters, isExpired, expirationTs, isItemExpired, parseCalendarDate, calDate, detectCategory, detectPayment, publishedAtOf, parseOrderTags, reviveCachedItem, maskContacts, safeHref, allDayLastDay } from './listing-utils.js';

// ── Constants ──────────────────────────────────────────────────
const CACHE_KEY      = 'plazap2p_v3';
const CACHE_TTL      = 30 * 60 * 1000;
const PAGE_SIZE      = 12;
const SORT_PREF_KEY  = 'plazap2p_sort';
const ASSET_VERSION  = '68';

// ── State ──────────────────────────────────────────────────────
let config        = null;
let pool          = null;
let isInitialLoad = true;
let lastUpdated   = null;
let activeTab     = 'mercado';
let activeFilter   = 'all';
let activeLocation = 'all';
let searchQuery   = '';
let sortPrefs     = {};  // { [channelId]: 'newest' | 'oldest' }

// Intercambio (Mostro) state
let intercambioShowAll = false;   // false = community (trusted instances), true = all network
let intercambioFiat    = 'EUR';   // selected fiat currency filter
let trustedMostroHexPubkeys = []; // resolved at init from config.intercambio.trustedMostroInstances

// Ratings state
let liveRatings  = {};  // { [pubkeyHex]: { avg, n, aspects, comments } | null } — kind 1985 live (null = consultado, sin datos)
let liveRatingsFetching = false;

const STATIC_TABS = new Set(['comunidades', 'herramientas', 'multimedia', 'vendedores', 'mapa']);

let staticEvents = [];  // curated fallback events loaded from data/eventos.json
let staticComunidades = [];
let staticComunidades2140 = [];   // comunidades de España de 2140meetups.com (mapa y listado)
let staticHerramientas = [];
let staticComunidadesError = false;
let staticHerramientasError = false;
let staticMultimediaError = false;
const GITHUB_REPO_URL = 'https://github.com/jjstudio-dev/Plazap2p-v3';
let pendingAnuncioNaddr = null; // CODE-004: naddr de #/anuncio/<naddr> aún no cargado

const channels   = {};  // { [channelId]: Map<key, parsedItem> }
const limits     = {};  // { [channelId]: number }
const eoseCounts = {};  // { [channelId]: number } — relays that sent EOSE
const eoseSettled = {}; // { [channelId]: boolean } — UI already settled
const eoseRelays  = {}; // { [channelId]: Set<url> } — deduplicar EOSE por relay
const tombstones  = {}; // { [channelId]: Map<key, created_at> } — retirados/vendidos/caducados ya vistos
const unconfirmed = {}; // { [channelId]: Set<key> } — vienen de la caché y ningún relay los ha vuelto a entregar
const settleChecks = []; // funciones que re-evalúan si un canal ya puede darse por cargado
const MAX_TOASTS  = 3;

// ── Bootstrap ──────────────────────────────────────────────────
async function init() {
  try {
    // Las pestañas no dependen de la configuración: con la red lenta, los
    // clics hechos antes de que llegara config.json se perdían.
    initTabs();
    await loadConfig();
    resolveIntercambioConfig();
    for (const ch of config.channels) {
      channels[ch.id]    = new Map();
      tombstones[ch.id]  = new Map();
      unconfirmed[ch.id] = new Set();
      limits[ch.id]      = PAGE_SIZE;
      eoseCounts[ch.id]  = 0;
      eoseSettled[ch.id] = false;
    }
    loadFromCache();
    loadSortPrefs();
    initPool();
    initUI();
    initAnuncioDeepLink();
    renderActiveChannel();   // pinta la caché, o los esqueletos si aún no hay nada
    updateAllBadges();
    isInitialLoad = true;
    subscribeAll();
    loadStaticData();
    applySignedConfig();
    setTimeout(() => { isInitialLoad = false; }, 6000);
    window._badgeInterval = setInterval(updateAllBadges, 30000);
    window.addEventListener('pagehide', () => clearInterval(window._badgeInterval), { once: true });
  } catch (err) {
    console.error('PlazaP2P init error:', err);
    showInitError();
  }
}

/** W-07: si el arranque falla, se dice y se ofrece reintentar en vez de dejar la página en blanco. */
function showInitError() {
  if (document.getElementById('init-error')) return;
  const main = document.querySelector('main') || document.body;
  const box = document.createElement('div');
  box.id = 'init-error';
  box.className = 'empty-state';
  box.innerHTML = `<div class="empty-icon">⚠️</div>
    <p class="empty-title">No se pudo iniciar PlazaP2P</p>
    <p class="empty-sub">Algo falló al cargar la aplicación. Comprueba tu conexión y vuelve a intentarlo.</p>
    <button class="btn-primary" onclick="location.reload()">Reintentar</button>`;
  main.prepend(box);
}

async function loadConfig() {
  // W-02: misma carga (URL versionada + config firmada + reserva) que publicar.html.
  config = await loadServedConfig({ version: ASSET_VERSION });
}

// PZ-F1-01: la configuración firmada (kind 30078 del mantenedor) sustituye a la servida. Los
// relays nuevos se usan en la próxima carga; lo demás (instancias de confianza), ya.
async function applySignedConfig() {
  try {
    const signed = await fetchSignedConfig(pool);
    if (!signed) return;
    config = { ...config, ...signed, relays: config.relays, channels: config.channels };
    resolveIntercambioConfig();
    if (activeTab === 'intercambio') renderActiveChannel();
  } catch (err) {
    console.warn('[config] configuración firmada no disponible:', err?.message);
  }
}

function initPool() {
  pool = new RelayPool(config.relays, {
    onConnect() {
      updateRelayStatus();
      // Volvió la conexión con la pestaña en "Sin conexión a relays": repintar.
      if (channels[activeTab]?.size === 0) renderActiveChannel();
    },
    onDisconnect() { updateRelayStatus(); settleChecks.forEach(fn => fn()); }
  });
  pool.connect();
  renderRelayList();
}

// ── Cache ──────────────────────────────────────────────────────
// Debounce: durante la carga inicial llegan cientos de eventos seguidos;
// serializar todos los canales en cada uno sería O(n²).
let _saveCacheTimer = null;
function saveToCache() {
  if (_saveCacheTimer) return;
  _saveCacheTimer = setTimeout(() => {
    _saveCacheTimer = null;
    try {
      const data = {};
      for (const id of Object.keys(channels)) {
        data[id] = [...channels[id].entries()];
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) { console.warn('[cache] saveToCache failed:', e?.message); }
  }, 800);
}

function loadSortPrefs() {
  try {
    const raw = localStorage.getItem(SORT_PREF_KEY);
    sortPrefs  = raw ? JSON.parse(raw) : {};
  } catch { sortPrefs = {}; }
}

function saveSortPrefs() {
  try { localStorage.setItem(SORT_PREF_KEY, JSON.stringify(sortPrefs)); } catch {}
}

// La caché es solo un arranque en caliente: lo que no tenga exactamente la
// forma esperada se descarta entrada a entrada (reviveCachedItem), y solo se
// aceptan canales configurados y kinds de ese canal. Antes, un único item mal
// formado dejaba la pestaña en blanco en cada visita.
function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    const { ts, data } = parsed;
    if (!Number.isFinite(ts) || Date.now() - ts > CACHE_TTL) return false;
    if (!data || typeof data !== 'object') return false;
    const blocked = blockedIndex();
    for (const chCfg of config.channels) {
      const entries = data[chCfg.id];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
        const item = reviveCachedItem(entry[1]);
        if (!item || !chCfg.kinds.includes(item.kind)) continue;
        if (isItemExpired(item)) continue;        // caducó mientras estaba en caché
        if (isItemBlocked(item, blocked)) continue; // su autor se ocultó después de guardarse
        channels[chCfg.id].set(entry[0], item);
        unconfirmed[chCfg.id].add(entry[0]);
      }
    }
    lastUpdated = new Date(ts);
    return true;
  } catch { return false; }
}

// ── Moderación local aplicada a lo ya cargado ──────────────────────────────
// Los items parseados no guardan todos la pubkey en hex (feed/artículos/
// eventos solo llevan npub), así que se compara por ambas formas.
function blockedIndex() {
  const hexes = listBlocked();
  return { hexes: new Set(hexes), npubs: new Set(hexes.map(hexToNpub)) };
}

function isItemBlocked(item, blocked) {
  return blocked.npubs.has(item.npub) || blocked.hexes.has(item.pubkeyHex) || blocked.hexes.has(item.botPubkey);
}

/** Quita de todos los canales lo publicado por autores ocultos. */
function purgeBlocked() {
  const blocked = blockedIndex();
  for (const ch of Object.values(channels)) {
    for (const [key, item] of ch) {
      if (isItemBlocked(item, blocked)) ch.delete(key);
    }
  }
  saveToCache();
  renderActiveChannel();
  updateAllBadges();
}

// ── Subscriptions ──────────────────────────────────────────────
/**
 * Etiquetas `t` que se piden para un canal sin filtro propio. El Mercado
 * pide además las de los mercados externos compatibles (Mercasats…), solo
 * él: sus notas o artículos no son anuncios.
 */
function generalTagsFor(chId) {
  const tags = config.community_tags || ['plazap2p'];
  return chId === 'mercado' ? [...tags, ...marketTags(externalMarketsFrom(config))] : tags;
}

function subscribeAll() {
  const refreshMs  = config.refresh_interval_ms || 300000;

  // `complete`: contestó la mayoría de los relays configurados, así que lo
  // que venía de la caché y nadie ha vuelto a entregar ya no existe en la red
  // (borrado por su autor, o expulsado por los relays). Sin esto seguía en
  // pantalla indefinidamente: cada visita lo volvía a guardar en la caché.
  function settleChannel(chId, kinds, noTagFilter, specificTags, complete = false) {
    if (eoseSettled[chId]) return;
    eoseSettled[chId] = true;
    if (complete && unconfirmed[chId].size > 0) {
      for (const key of unconfirmed[chId]) channels[chId].delete(key);
      saveToCache();
      updateAllBadges();
    }
    unconfirmed[chId].clear();
    // Siempre repintar el canal activo: decide entre datos, "sin contenido" o
    // "sin conexión" (ver renderActiveChannelInner).
    if (activeTab === chId) renderActiveChannel();
    setTimeout(() => {
      if (!pool) return;
      pool.unsubscribe(chId);
      const sinceTs = Math.floor(Date.now() / 1000);
      const refreshFilter = specificTags
        ? { kinds, '#t': specificTags, since: sinceTs }
        : noTagFilter
          ? { kinds, since: sinceTs }
          : { kinds, '#t': generalTagsFor(chId), since: sinceTs };
      pool.subscribe(chId, [refreshFilter], {
        onEvent: (ev) => addEvent(chId, ev),
        onEose:  () => {}
      });
    }, refreshMs);
  }

  for (const ch of config.channels) {
    const noTagFilter  = ch.noTagFilter === true;
    const specificTags = channelTagFilters(ch);   // e.g. ["plazap2p-directorio", ...] o null
    const filters = noTagFilter
      ? [{ kinds: ch.kinds, limit: 100 }]
      : specificTags
        ? [{ kinds: ch.kinds, '#t': specificTags, limit: 200 }]
        : [{ kinds: ch.kinds, '#t': generalTagsFor(ch.id), limit: 100 }];

    // Fallback: settle after 6s even if some relays never send EOSE
    setTimeout(() => settleChannel(ch.id, ch.kinds, noTagFilter, specificTags), 6000);

    // El canal está cargado cuando han contestado todos los relays de los que
    // cabe esperar respuesta (pool.expectedCount), no "todos los configurados":
    // con un relay caído eso nunca se cumplía y cada pestaña esperaba los 6 s.
    const checkSettled = () => {
      const got = eoseCounts[ch.id] || 0;
      const expected = pool.expectedCount;
      // Nadie va a contestar (todos los relays caídos): no esperar los 6 s.
      if (expected === 0) settleChannel(ch.id, ch.kinds, noTagFilter, specificTags, false);
      else if (got > 0 && got >= expected) {
        settleChannel(ch.id, ch.kinds, noTagFilter, specificTags, got * 2 >= config.relays.length);
      }
    };
    settleChecks.push(checkSettled);

    pool.subscribe(ch.id, filters, {
      onEvent: (ev) => addEvent(ch.id, ev),
      onEose:  (url) => {
        if (!eoseRelays[ch.id]) eoseRelays[ch.id] = new Set();
        if (eoseRelays[ch.id].has(url)) return; // ignorar EOSE duplicado del mismo relay
        eoseRelays[ch.id].add(url);
        eoseCounts[ch.id] = (eoseCounts[ch.id] || 0) + 1;
        checkSettled();
      }
    });
  }
}

// ── Event ingestion ────────────────────────────────────────────
function addEvent(channelId, event) {
  try {
    const ch = channels[channelId];
    if (!ch) return;

    // Defensa anti relay-malicioso: el filtro REQ es una petición, no una
    // garantía. Verificar que el evento cumple kind y tag del canal.
    const chCfg = config.channels.find(c => c.id === channelId);
    if (chCfg) {
      if (Array.isArray(chCfg.kinds) && !chCfg.kinds.includes(event.kind)) return;
      if (chCfg.noTagFilter !== true) {
        const required = channelTagFilters(chCfg) || generalTagsFor(channelId);
        if (!event.tags?.some(t => t[0] === 't' && required.includes(t[1]))) return;
      }
    }

    // MOD-001: moderación LOCAL — el autor sigue publicando normalmente en
    // Nostr, esta app simplemente no le muestra su contenido EN ESTE navegador.
    if (isBlocked(event.pubkey)) return;

    const key      = eventKey(event);
    unconfirmed[channelId]?.delete(key);   // un relay lo sigue sirviendo: no es un resto de la caché
    const existing = ch.get(key);
    if (existing && event.created_at <= existing.created_at) return;

    // Lápida: ya se vio una versión retirada/vendida/caducada de esta misma
    // publicación. Una versión MÁS ANTIGUA que llegue después desde un relay
    // desactualizado no debe resucitarla (el orden de llegada entre relays
    // no está garantizado).
    const tombs = tombstones[channelId] || (tombstones[channelId] = new Map());
    const buriedAt = tombs.get(key);
    if (buriedAt != null && event.created_at <= buriedAt) return;

    // Eventos de prueba de la app (tag plazap2p-test): nunca mostrarlos
    if (event.tags?.some(t => t[0] === 't' && t[1] === 'plazap2p-test')) return;

    const parsed = parseEvent(event);
    if (!parsed) return;

    const isReallyNew = !existing;

    // Remove listings that are sold/deleted/inactive, or Mostro orders that are no longer pending
    // ('inactive' es el estado que usa la retirada de anuncios de publicar.html)
    const statusLower = parsed.status?.toLowerCase() || '';
    // ADS-002 (NIP-40): un anuncio caducado no se lista como activo. Solo
    // afecta a lectura/render — el evento sigue existiendo en los relays.
    const shouldRemove =
      isExpired(event) ||
      statusLower === 'sold' ||
      statusLower === 'deleted' ||
      statusLower === 'inactive' ||
      (event.kind === 38383 && statusLower !== 'pending');

    if (shouldRemove) {
      tombs.set(key, event.created_at);
      if (!existing) return;   // nada que quitar de pantalla: solo recordar la lápida
      ch.delete(key);
    } else {
      tombs.delete(key);       // versión activa más reciente que la lápida (republicado)
      ch.set(key, parsed);
      if (pendingAnuncioNaddr === parsed.naddr) tryOpenPendingAnuncio();
    }
    lastUpdated = new Date();

    if (!isInitialLoad && isReallyNew && !shouldRemove) {
      const label = config.channels.find(c => c.id === channelId)?.label || channelId;
      showToast(`⚡ Nuevo en ${label}`);
    }

    saveToCache();
    if (activeTab === channelId) renderActiveChannel();
    else if (activeTab === 'mapa' && (channelId === 'mercado' || channelId === 'eventos')) scheduleMapRefresh();
    // W-04: una propuesta nueva de comunidad/herramienta llega por el canal
    // Mercado; hay que repintar la pestaña estática que la enseña.
    else if (isDirectoryProposal(parsed) && (activeTab === 'comunidades' || activeTab === 'herramientas')) {
      renderActiveChannel();
    }
    updateAllBadges();
  } catch (e) { console.warn('[addEvent]', e); }
}

function eventKey(event) {
  if ([30402, 30023, 30405, 31922, 31923, 38383].includes(event.kind)) {
    return `${event.pubkey}:${getTagValue(event.tags, 'd') || event.id}`;
  }
  return event.id;
}

// ── Parsers ────────────────────────────────────────────────────
function parseEvent(event) {
  switch (event.kind) {
    case 1:     return parseFeedPost(event);
    case 30023: return parseArticle(event);
    case 30402: return parseListing(event);
    case 31922:
    case 31923: return parseCalendarEvent(event);
    case 38383: return parseOrder(event);
    case 30405: return parseGeneric(event);
    default:    return parseGeneric(event);
  }
}

function parseListing(event) {
  const { tags, pubkey, created_at } = event;
  const title       = getTagValue(tags, 'title') || 'Sin título';
  const summary     = sanitize(getTagValue(tags, 'summary') || '');
  const location    = cityOnly(getTagValue(tags, 'location'));
  const tTags       = getTagValues(tags, 't').map(t => t.toLowerCase());
  // Anuncio de un mercado externo (Mercasats…): no lleva las etiquetas de tipo de PlazaP2P.
  const market      = marketOf(tTags, externalMarketsFrom(config));
  const category    = market ? externalCategory(tTags) : detectCategory(tTags);
  const payment     = detectPayment(tTags);
  const dTag        = getTagValue(tags, 'd') || event.id;
  const publishedAt = publishedAtOf(tags, created_at);
  const status      = getTagValue(tags, 'status') || 'active';
  const naddr       = encodeNaddr({ kind: 30402, pubkey, identifier: dTag });
  const npub        = hexToNpub(pubkey);
  const priceTag    = tags.find(t => t[0] === 'price');
  const price       = priceTag?.[1] || '';
  const currency    = market ? normalizeCurrency(priceTag?.[2]) : (priceTag?.[2] || '');
  const marketInfo  = market ? {
    id: market.id, label: market.label,
    url: marketListingUrl(event, market),
    // Firmado por la cuenta del mercado en nombre de otro vendedor (anuncios de Telegram).
    proxied: isMarketSigned(event, market),
  } : null;
  return {
    kind: 30402, title, summary, location, category, payment, price, currency, publishedAt, status, naddr, npub,
    pubkeyHex: pubkey, created_at, expiresAt: expirationTs(event),
    tTags, links: getTagValues(tags, 'r'), platforms: getTagValues(tags, 'platform'),
    market: marketInfo,
    // Mapa: zona (`g`) y si es un punto de venta con ubicación exacta.
    geohash: mostPreciseGeohash(tags),
    isCommerce: tTags.includes(COMMERCE_TAG),
  };
}

function parseFeedPost(event) {
  return {
    kind:        1,
    content:     sanitize(event.content || ''),
    npub:        hexToNpub(event.pubkey),
    note:        hexToNote(event.id),
    publishedAt: event.created_at,
    created_at:  event.created_at
  };
}

function parseArticle(event) {
  const { tags, pubkey, created_at } = event;
  const dTag        = getTagValue(tags, 'd') || event.id;
  const publishedAt = publishedAtOf(tags, created_at);
  return {
    kind:        30023,
    title:       getTagValue(tags, 'title') || 'Sin título',
    summary:     sanitize(getTagValue(tags, 'summary') || ''),
    image:       getTagValue(tags, 'image') || null,
    publishedAt,
    naddr:       encodeNaddr({ kind: 30023, pubkey, identifier: dTag }),
    npub:        hexToNpub(pubkey),
    created_at
  };
}

function parseCalendarEvent(event) {
  const { tags, pubkey, created_at, kind } = event;
  const dTag     = getTagValue(tags, 'd') || event.id;
  const title    = getTagValue(tags, 'title') || getTagValue(tags, 'name') || 'Evento sin título';
  const summary  = sanitize(getTagValue(tags, 'summary') || event.content || '');
  const location = getTagValues(tags, 'location').join(' · ');
  const startRaw = getTagValue(tags, 'start');
  const endRaw   = getTagValue(tags, 'end');
  const tzid     = getTagValue(tags, 'start_tzid') || '';
  const links    = getTagValues(tags, 'r');
  const start    = parseCalendarDate(kind, startRaw);
  // Todo el día: `end` es exclusivo en NIP-52; lo que se enseña es el último día.
  const end      = parseCalendarDate(kind, kind === 31922 && /^\d{4}-\d{2}-\d{2}$/.test(endRaw || '')
    ? allDayLastDay(endRaw, startRaw) : endRaw);
  const naddr    = encodeNaddr({ kind, pubkey, identifier: dTag });

  return {
    kind,
    title,
    summary,
    location,
    start,
    end,
    tzid,
    links,
    naddr,
    status: getTagValue(tags, 'status') || 'active',   // la retirada desde publicar.html republica con status:inactive
    geohash: mostPreciseGeohash(tags),
    npub: hexToNpub(pubkey),
    publishedAt: start?.ts || created_at,
    created_at
  };
}

function parseOrder(event) {
  const { tags, pubkey, created_at } = event;
  // Rangos imposibles (relay malicioso) → null: ver parseOrderTags().
  const fields = parseOrderTags(tags);
  if (!fields) return null;
  const dTag  = getTagValue(tags, 'd') || event.id;
  const naddr = encodeNaddr({ kind: 38383, pubkey, identifier: dTag });

  return {
    kind: 38383,
    ...fields,
    dTag,
    botPubkey: pubkey,
    naddr,
    publishedAt: created_at,
    created_at
  };
}

function parseGeneric(event) {
  return {
    kind:        event.kind,
    content:     sanitize(event.content || ''),
    npub:        hexToNpub(event.pubkey),
    note:        hexToNote(event.id),
    publishedAt: event.created_at,
    created_at:  event.created_at
  };
}

// ── Ratings helpers ────────────────────────────────────────────
// Solo cuentan las valoraciones live (kind 1985 de los relays). El índice
// estático que generaba un bot nunca desplegado se eliminó (W-03).
function getSellerRating(pubkeyHex) {
  if (!pubkeyHex) return null;
  const live = liveRatings[pubkeyHex];
  if (live && live.n > 0) return live;
  return null;
}

// Consulta en lote las valoraciones kind 1985 de los vendedores visibles
// y re-renderiza el directorio cuando llegan (si el tab sigue activo).
const liveRatingMisses = {};   // pubkey → consultas de reputación que no llegaron a completarse

function refreshLiveRatings(hexes) {
  if (!pool || liveRatingsFetching) return;
  const pendientes = [...hexes].filter(h => !(h in liveRatings)).slice(0, 30);
  if (pendientes.length === 0) return;
  liveRatingsFetching = true;
  fetchReputacionBatch(pool, pendientes)
    .then(results => {
      for (const [hex, r] of Object.entries(results)) {
        // PZ-F8-01: media solo con 3 o más valoraciones de la red de confianza.
        if (r && r.showsAverage) {
          liveRatings[hex] = { avg: r.avg, n: r.count, aspects: r.aspects, comments: r.comments };
        } else if (r?.complete || (liveRatingMisses[hex] = (liveRatingMisses[hex] || 0) + 1) >= 3) {
          liveRatings[hex] = null;   // null = ya consultado, sin valoraciones (evita re-fetch)
        }
        // Si la consulta se cortó por tiempo no se anota nada: «sin valoraciones»
        // podía no ser verdad y quedaba fijo hasta recargar (VW4-07). Se
        // reintenta en el siguiente pintado, como mucho tres veces.
      }
      liveRatingsFetching = false;
      if (activeTab === 'vendedores') renderSellersDirectory();
    })
    .catch(() => { liveRatingsFetching = false; });
}

function renderStarDisplay(avg, n, compact = true) {
  const safeAvg = Math.max(0, Math.min(5, Number(avg) || 0));
  const safeN   = Math.max(0, Number(n) || 0);
  const rounded = Math.round(safeAvg * 2) / 2;
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    if (i <= rounded) stars += '<span class="star-mini filled">★</span>';
    else if (i - 0.5 <= rounded) stars += '<span class="star-mini half">★</span>';
    else stars += '<span class="star-mini">☆</span>';
  }
  if (compact) {
    return `<div class="star-display-compact">${stars}<span class="star-count-compact">${safeAvg.toFixed(1)} (${safeN})</span></div>`;
  }
  return `<div class="star-display-full">${stars}<span class="star-count-full">${safeAvg.toFixed(1)} · ${safeN} ${plural(safeN, 'valoración', 'valoraciones')}</span></div>`;
}

// REP-003: distribución 5★→1★, no solo la media — visible solo con datos en
// vivo (rep.distribution la calcula aggregate() en reputacion.js).
function renderDistributionBars(distribution, total) {
  if (!total) return '';
  return [5, 4, 3, 2, 1].map(star => {
    const n = distribution?.[star] || 0;
    const pct = Math.round((n / total) * 100);
    return `<div class="rating-aspect-item">
      <span class="aspect-label">${star}★</span>
      <div class="aspect-bar-track"><div class="aspect-bar-fill" style="width:${pct}%"></div></div>
      <span class="aspect-val">${n}</span>
    </div>`;
  }).join('');
}

function renderAspectsBar(aspects) {
  const LABELS = { comunicacion: '💬 Comunicación', cumplimiento: '✅ Cumplimiento', precio_justo: '💰 Precio justo', rapidez: '⚡ Rapidez', confianza: '🔐 Confianza' };
  return Object.entries(aspects)
    .filter(([, v]) => v != null && Number(v) > 0)
    .map(([k, v]) => {
      const safeV = Math.max(0, Math.min(5, Number(v) || 0));
      const pct = Math.round((safeV / 5) * 100);
      return `<div class="rating-aspect-item">
        <span class="aspect-label">${esc(LABELS[k] || k)}</span>
        <div class="aspect-bar-track"><div class="aspect-bar-fill" style="width:${pct}%"></div></div>
        <span class="aspect-val">${safeV.toFixed(1)}</span>
      </div>`;
    }).join('');
}

function buildSellerIndex() {
  const idx = {};
  const ch = channels['mercado'];
  if (!ch) return idx;
  for (const item of ch.values()) {
    if (!item.pubkeyHex) continue;
    if (!idx[item.pubkeyHex]) idx[item.pubkeyHex] = { npub: item.npub, count: 0 };
    idx[item.pubkeyHex].count++;
  }
  return idx;
}

function renderSellersDirectory() {
  const grid = document.getElementById('channel-vendedores');
  if (!grid) return;

  const sellerIdx = buildSellerIndex();
  const liveHexes = Object.keys(liveRatings).filter(h => liveRatings[h] && liveRatings[h].n > 0);
  const allHexes = new Set([...Object.keys(sellerIdx), ...liveHexes]);

  const sellers = [...allHexes].map(hex => ({
    hex,
    npub: sellerIdx[hex]?.npub || hexToNpub(hex),
    listingCount: sellerIdx[hex]?.count || 0,
    rating: getSellerRating(hex)
  })).filter(s => s.listingCount > 0 || (s.rating && s.rating.n > 0));

  // Tras el render inmediato, pedir a los relays las valoraciones live pendientes
  refreshLiveRatings(allHexes);

  if (sellers.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">👥</div>
      <p class="empty-title">Directorio de vendedores vacío</p>
      <p class="empty-sub">Cuando los miembros de la comunidad publiquen anuncios aparecerán aquí con su reputación.</p>
    </div>`;
    return;
  }

  sellers.sort(compareSellersByRating);

  grid.innerHTML = sellers.map(s => {
    const stars = s.rating ? renderStarDisplay(s.rating.avg, s.rating.n, true) : '<span class="no-rating">Sin valoraciones aún</span>';
    return `<article class="seller-card">
      <div class="seller-npub">${esc(s.npub.slice(0, 20))}…</div>
      <div class="seller-rating-row">${stars}</div>
      <div class="seller-meta">${s.listingCount} anuncio${s.listingCount !== 1 ? 's' : ''}</div>
      <button type="button" class="btn-secondary btn-sm seller-check-btn" onclick="openReputacionModal('${s.hex}')">Ver reputación →</button>
    </article>`;
  }).join('');
}

// ── Modal de reputación (detalle live, kind 1985 de los relays) ──
window.openReputacionModal = async function(hex) {
  if (!/^[0-9a-f]{64}$/i.test(String(hex))) return;
  const modal = document.getElementById('listing-modal');
  if (!modal) return;

  const npub = hexToNpub(hex);
  const valorarUrl = `publicar.html?valorar=${npub}`;
  const shell = (body) => `
    <div class="modal-overlay" onclick="closeModal()"></div>
    <div class="modal-box">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <div class="modal-category" style="color:var(--btc, #f7931a)">REPUTACIÓN</div>
      <h2 id="modal-title" class="modal-title" style="word-break:break-all;font-size:0.95rem">${esc(npub.slice(0, 24))}…</h2>
      ${body}
      <div class="modal-actions">
        <a href="${valorarUrl}" class="btn-primary">⭐ Valorar a este usuario</a>
        <button onclick="closeModal()" class="btn-secondary">Cerrar</button>
      </div>
    </div>`;

  modal.innerHTML = shell(`<div class="modal-rating-section"><span class="no-rating-text">Consultando valoraciones en los relays…</span></div>`);
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  modal.dataset.repHex = hex;   // token: descarta respuestas de un hex ya no visible

  let rep = null;
  try {
    const results = await fetchReputacionBatch(pool, [hex]);
    rep = results[hex] || null;
  } catch { /* mostrar fallback abajo */ }

  // El usuario puede haber cerrado el modal, o abierto la reputación de OTRO
  // vendedor, mientras llegaban estos datos — no pisar lo que se ve ahora.
  if (modal.classList.contains('hidden') || modal.dataset.repHex !== hex) return;

  // Valoraciones que existen pero no cuentan (ver reputacion.js): se dice,
  // para que la cifra no parezca arbitraria frente a otros clientes Nostr.
  const excluded = Number(rep?.excludedRecent) || 0;
  const excludedHtml = excluded > 0
    ? `<p class="no-rating-text" id="rep-excluded-note">${excluded} ${plural(excluded, 'valoración', 'valoraciones')} de cuentas que ni tú ni PlazaP2P seguís no cuenta${excluded === 1 ? '' : 'n'} en la media. Cualquiera puede crear cuentas para inflar o hundir una reputación; solo cuenta tu red de confianza.</p>`
    : '';

  if (!rep || !rep.showsAverage) {
    modal.innerHTML = shell(`<div class="modal-rating-section modal-rating-none">
      <span class="no-rating-text">Sin valoraciones firmadas todavía. Las valoraciones son eventos Nostr (kind 1985) verificables por cualquiera.</span>
      ${excludedHtml}
    </div>`);
    return;
  }

  const avg = rep.avg;
  const n   = rep.count;
  const aspects = rep.aspects || {};
  const comments = (rep?.comments || []).slice(0, 10);

  const commentsHtml = comments.length
    ? `<div class="modal-rating-header" style="margin-top:14px">Comentarios firmados</div>` +
      comments.map(c => {
        const r = Math.max(1, Math.min(5, Number(c.rating) || 0));
        return `<div class="modal-notice" style="display:block">
        <div style="color:var(--btc,#f7931a)">${'★'.repeat(r)}${'☆'.repeat(5 - r)}</div>
        <div style="margin:4px 0">${esc(c.comment)}</div>
        <div style="font-size:0.72rem;color:var(--t-3,#48484d)">${esc(hexToNpub(c.author).slice(0, 16))}… · ${fmtAge(c.ts)}</div>
      </div>`;
      }).join('')
    : '';

  const distributionHtml = rep.distribution
    ? `<div class="modal-rating-header" style="margin-top:12px">Distribución (${rep.count} ${plural(rep.count, 'valoración', 'valoraciones')})</div>` +
      renderDistributionBars(rep.distribution, rep.count)
    : '';

  // SPAM-001/REP-001: señal de confianza EXPLICADA, nunca "verificado" ni
  // una promesa de seguridad — solo cuántos valoradores distintos hay.
  const trust = trustLevel(n);
  const trustHtml = `<div class="trust-signal trust-${trust.level}">
    <strong>${esc(trust.label)}</strong>
    <span>${esc(trust.note)}</span>
  </div>`;

  modal.innerHTML = shell(`<div class="modal-rating-section">
    <div class="modal-rating-header">Reputación agregada (en vivo desde los relays)</div>
    ${renderStarDisplay(avg, n, false)}
    ${trustHtml}
    ${excludedHtml}
    ${Object.keys(aspects).length ? renderAspectsBar(aspects) : ''}
    ${distributionHtml}
    ${commentsHtml}
  </div>`);
};

// ── Rendering ──────────────────────────────────────────────────
const CAT_COLORS = {
  venta: '#00d4ff', compra: '#30d158', servicio: '#bf5af2',
  trueque: '#ffd60a', general: '#86868b', otro: '#86868b',
  evento: '#86868b', comunidad: '#86868b', herramienta: '#86868b'
};
// Publicaciones que no son una oferta comercial: no tiene sentido pintarles
// "medio de pago" (detectPayment() devuelve 'Bitcoin' por defecto).
const NON_COMMERCE_CATS = new Set(['evento', 'comunidad', 'herramienta']);
// Canales que enseñan esqueletos mientras cargan.
const SKELETON_TABS = new Set(['mercado', 'feed', 'articulos', 'directorio']);

function renderActiveChannel() {
  try { renderActiveChannelInner(); }
  catch (e) { console.error('[render]', activeTab, e); }
}

function renderActiveChannelInner() {
  if (activeTab === 'vendedores') { renderSellersDirectory(); return; }
  if (activeTab === 'mapa') { renderMapa(); return; }
  if (activeTab === 'comunidades') {
    if (staticComunidadesError) renderStaticError('comunidades', 'las comunidades');
    else renderComunidades(staticComunidades, GITHUB_REPO_URL);
    return;
  }
  if (activeTab === 'herramientas') {
    if (staticHerramientasError) renderStaticError('herramientas', 'las herramientas');
    else renderHerramientas(staticHerramientas, GITHUB_REPO_URL);
    return;
  }
  if (activeTab === 'multimedia' && staticMultimediaError) { renderStaticError('multimedia', 'los recursos multimedia'); return; }
  if (STATIC_TABS.has(activeTab)) return;

  const grid = document.getElementById(`channel-${activeTab}`);
  if (!grid) return;

  const ch = channels[activeTab];
  if (!ch) return;

  document.getElementById('load-more-btn')?.remove();

  // Canal sin nada que enseñar: mientras los relays no han contestado se está
  // CARGANDO (esqueletos); después, "sin contenido" o "sin conexión". Antes,
  // al entrar en una pestaña aún cargando salía "Sin resultados — prueba con
  // otro filtro", que no era verdad. Eventos e Intercambio tienen su propio
  // estado vacío más abajo.
  if (ch.size === 0 && SKELETON_TABS.has(activeTab)) {
    if (!eoseSettled[activeTab]) { showSkeletons(activeTab); return; }
    if (pool && pool.connectedCount === 0) { showNoRelays(activeTab); return; }
    if (activeTab !== 'directorio') { showEmpty(activeTab); return; }
  }

  const sort = sortPrefs[activeTab] || 'newest';
  let items = [...ch.values()].filter(item => !isItemExpired(item));
  // W-04: las propuestas de comunidad/herramienta se publican como kind 30402
  // y caían en el Mercado. Se enseñan en su pestaña, no aquí.
  if (activeTab === 'mercado') items = items.filter(item => !isDirectoryProposal(item));
  if (activeTab === 'eventos') {
    items = sortCalendarEvents(items);
  } else {
    items.sort((a, b) =>
      sort === 'oldest' ? a.publishedAt - b.publishedAt : b.publishedAt - a.publishedAt
    );
  }

  // Populate location dropdown from all items before applying filters
  if (activeTab === 'mercado') updateLocationSelect(items);

  if (activeTab === 'mercado' && activeFilter === 'favoritos') {
    items = items.filter(l => isFavorite(l.naddr)); // BON-001: pseudo-categoría, no un campo real del evento
  } else if (activeTab === 'mercado' && activeFilter !== 'all') {
    items = items.filter(l => l.category === activeFilter);
  }

  if (activeTab === 'mercado' && activeLocation !== 'all') {
    items = items.filter(l => l.location === activeLocation);
  }

  const q = searchQuery.trim().toLowerCase();
  if (q) {
    items = items.filter(item => {
      const text = [item.title, item.summary, item.content, item.location].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    });
  }

  if (activeTab === 'intercambio') {
    renderIntercambioOrders(grid);
    return;
  }

  if (activeTab === 'directorio') {
    renderDirectorio(grid, items);
    return;
  }

  if (activeTab === 'eventos') {
    renderCalendarEvents(grid, items);
    return;
  }

  if (items.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🔍</div>
      <p class="empty-title">Sin resultados</p>
      <p class="empty-sub">Prueba con otro filtro o zona.</p>
    </div>`;
    return;
  }

  const lim = limits[activeTab];
  grid.innerHTML = items.slice(0, lim).map(renderCard).join('');

  if (items.length > lim) {
    const remaining = items.length - lim;
    const btn = document.createElement('button');
    btn.id        = 'load-more-btn';
    btn.className = 'btn-load-more';
    btn.textContent = `Ver más · ${remaining} restante${remaining !== 1 ? 's' : ''}`;
    btn.onclick = () => { limits[activeTab] += PAGE_SIZE; renderActiveChannel(); };
    grid.after(btn);
  }
}

function renderCard(item) {
  switch (item.kind) {
    case 30402: return renderListingCard(item);
    case 1:     return renderFeedCard(item);
    case 30023: return renderArticleCard(item);
    case 31922:
    case 31923: return renderCalendarEventCard(item);
    default:    return renderGenericCard(item);
  }
}

function sortCalendarEvents(items) {
  const now = Math.floor(Date.now() / 1000);
  const upcoming = items.filter(e => !isCalendarEventPast(e, now));
  const past = items.filter(e => isCalendarEventPast(e, now));
  return [
    ...upcoming.sort((a, b) => (a.start?.ts || a.publishedAt) - (b.start?.ts || b.publishedAt)),
    ...past.sort((a, b) => (b.start?.ts || b.publishedAt) - (a.start?.ts || a.publishedAt))
  ];
}

function isCalendarEventPast(e, now = Math.floor(Date.now() / 1000)) {
  const startTs = e.start?.ts || e.publishedAt;
  return (e.end?.ts || startTs) < now;
}

function renderCalendarEvents(grid, items) {
  if (items.length === 0) {
    if (staticEvents.length > 0) {
      // Un evento recurrente (meetup mensual…) no "ha pasado" porque su última
      // fecha anotada quede atrás: sigue vigente. Antes acababan todos en
      // "Eventos anteriores" con la marca "Pasado".
      const dated = staticEvents.filter(e => !isStaticEventStale(e));
      const upcoming = [
        ...dated.filter(e => !staticEventTs(e) || staticEventTs(e) >= Date.now() / 1000).sort((a, b) => new Date(a.start) - new Date(b.start)),
        ...dated.filter(e => staticEventTs(e) && staticEventTs(e) < Date.now() / 1000),   // recurrentes sin fecha próxima anotada
      ];
      const past = staticEvents.filter(isStaticEventStale).sort((a, b) => new Date(b.start) - new Date(a.start));

      const html = [
        `<div class="event-static-notice">
          <span class="event-static-badge">📌 Curado</span>
          <span>Próximos eventos de la comunidad — cuando se publiquen en Nostr aparecerán en tiempo real.</span>
        </div>`,
        ...upcoming.map(renderStaticEventCard),
        ...(past.length ? [`<div class="event-archive-divider"><span>Eventos anteriores</span></div>`, ...past.map(renderStaticEventCard)] : [])
      ];
      grid.innerHTML = html.join('');
    } else if (staticEventsError) {
      grid.innerHTML = `<div class="event-empty-card">
        <div class="event-empty-icon">⚠️</div>
        <div>
          <p class="event-empty-title">No se pudieron cargar los eventos curados</p>
          <p class="event-empty-sub">No es que no haya eventos: falló la descarga. Comprueba tu conexión.</p>
          <button class="btn-primary" onclick="window.retryStaticData?.()">Reintentar</button>
        </div>
      </div>`;
    } else {
      grid.innerHTML = `<div class="event-empty-card">
        <div class="event-empty-icon">📅</div>
        <div>
          <p class="event-empty-title">No hay eventos activos ahora mismo</p>
          <p class="event-empty-sub">Cuando la comunidad publique eventos NIP-52 en Nostr aparecerán aquí automáticamente.</p>
        </div>
      </div>`;
    }
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const upcoming = items.filter(e => !isCalendarEventPast(e, now));
  const past = items.filter(e => isCalendarEventPast(e, now));
  const lim = limits[activeTab];
  const visibleUpcoming = upcoming.slice(0, lim);
  const remainingLimit = Math.max(0, lim - visibleUpcoming.length);
  const visiblePast = past.slice(0, remainingLimit);
  const html = [];

  if (upcoming.length === 0 && past.length > 0) {
    html.push(`<div class="event-archive-note">
      <span class="event-archive-kicker">Archivo</span>
      <strong>No hay eventos activos ahora mismo</strong>
      <span>Te dejamos los últimos eventos publicados para referencia, sin mezclarlos con próximos encuentros.</span>
    </div>`);
  }

  if (visibleUpcoming.length) html.push(...visibleUpcoming.map(renderCalendarEventCard));
  if (visiblePast.length) {
    if (upcoming.length > 0) {
      html.push(`<div class="event-archive-divider"><span>Eventos anteriores</span></div>`);
    }
    html.push(...visiblePast.map(renderCalendarEventCard));
  }

  grid.innerHTML = html.join('');

  if (items.length > lim) {
    const remaining = items.length - lim;
    const btn = document.createElement('button');
    btn.id = 'load-more-btn';
    btn.className = 'btn-load-more';
    btn.textContent = `Ver más · ${remaining} restante${remaining !== 1 ? 's' : ''}`;
    btn.onclick = () => { limits[activeTab] += PAGE_SIZE; renderActiveChannel(); };
    grid.after(btn);
  }
}

function renderListingCard(l) {
  const color    = CAT_COLORS[l.category] || '#86868b';
  const njumpUrl = `https://njump.me/${l.naddr}`;
  const payment  = l.payment.slice(0, 2).map(esc).join(' · ');
  const isNew    = (Date.now() / 1000 - l.publishedAt) < 3600;
  const rating   = getSellerRating(l.pubkeyHex);
  const ratingHtml = rating ? renderStarDisplay(rating.avg, rating.n, true) : '';
  const favActive = isFavorite(l.naddr);
  return `<article class="listing-card" onclick="openModal('${l.naddr}')" style="--card-accent:${color}">
    <div class="card-top-row">
      <div class="card-badge" style="color:${color};border-color:${color}40">${esc(l.category.toUpperCase())}</div>
      ${isNew ? '<span class="card-new-badge">nuevo</span>' : ''}
      ${l.market ? `<span class="card-market-badge" title="Anuncio publicado en ${esc(l.market.label)}">vía ${esc(l.market.label)}</span>` : ''}
      <button class="card-fav-btn${favActive ? ' active' : ''}" onclick="event.stopPropagation(); toggleFav('${l.naddr}', this)" title="${favActive ? 'Quitar de favoritos' : 'Guardar en favoritos'}" aria-pressed="${favActive}">${favActive ? '⭐' : '☆'}</button>
    </div>
    <h3 class="card-title">${esc(l.title)}</h3>
    ${l.location ? `<div class="card-location">📍 ${esc(l.location)}</div>` : ''}
    ${NON_COMMERCE_CATS.has(l.category) ? '' : `<div class="card-payment">⚡ ${payment}</div>`}
    <div class="card-footer">
      <span class="card-age">${fmtAge(l.publishedAt)}</span>
      ${ratingHtml}
      <div class="card-footer-actions">
        <button class="card-share-btn" onclick="event.stopPropagation(); shareOrCopy('${njumpUrl}')" title="Compartir">🔗</button>
        <a href="${njumpUrl}" target="_blank" rel="noopener noreferrer"
           class="card-nostr-link" onclick="event.stopPropagation()">Ver en Nostr →</a>
      </div>
    </div>
  </article>`;
}

function renderDirectorio(grid, items) {
  if (items.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📒</div>
      <p class="empty-title">El directorio está vacío</p>
      <p class="empty-sub">Los servicios publicados desde <a href="publicar.html?type=servicio">Publicar</a>, y las fichas con el tag <code>#plazap2p-directorio</code>, aparecerán aquí.</p>
    </div>`;
    return;
  }

  const lim = limits['directorio'] ?? PAGE_SIZE;
  grid.innerHTML = items.slice(0, lim).map(renderDirectorioCard).join('');

  if (items.length > lim) {
    const remaining = items.length - lim;
    const btn = document.createElement('button');
    btn.id        = 'load-more-btn';
    btn.className = 'btn-load-more';
    btn.textContent = `Ver más · ${remaining} restante${remaining !== 1 ? 's' : ''}`;
    btn.onclick = () => { limits['directorio'] += PAGE_SIZE; renderActiveChannel(); };
    grid.after(btn);
  }
}

function renderDirectorioCard(l) {
  const color    = CAT_COLORS[l.category] || '#bf5af2';
  const njumpUrl = `https://njump.me/${l.naddr}`;
  const priceTag = l.price ? `<span class="dir-price">${esc(l.price)} ${esc(l.currency || '')}</span>` : '';
  return `<article class="dir-card" onclick="window.open('${njumpUrl}','_blank','noopener noreferrer')" style="--card-accent:${color}">
    <div class="dir-card-header">
      <div class="card-badge" style="color:${color};border-color:${color}40">${esc((l.category || 'servicio').toUpperCase())}</div>
      ${priceTag}
    </div>
    <h3 class="dir-card-title">${esc(l.title)}</h3>
    ${l.location ? `<div class="dir-card-location">📍 ${esc(l.location)}</div>` : ''}
    ${l.summary  ? `<p class="dir-card-summary">${l.summary.slice(0, 120)}${l.summary.length > 120 ? '…' : ''}</p>` : ''}
    <div class="dir-card-footer">
      <span class="dir-nostr-link">Ver en Nostr →</span>
    </div>
  </article>`;
}

function renderFeedCard(p) {
  const njumpUrl = `https://njump.me/${p.note}`;
  const isNew    = (Date.now() / 1000 - p.publishedAt) < 3600;
  return `<article class="feed-card" onclick="window.open('${njumpUrl}','_blank','noopener noreferrer')">
    <div class="card-top-row">
      <span class="kind-badge kind-post">POST</span>
      ${isNew ? '<span class="card-new-badge">nuevo</span>' : ''}
      <span class="card-age" style="margin-left:auto">${fmtAge(p.publishedAt)}</span>
    </div>
    <p class="feed-content">${p.content}</p>
    <div class="card-footer">
      <span class="card-npub">${p.npub.slice(0, 16)}…</span>
      <div class="card-footer-actions">
        <button class="card-share-btn" onclick="event.stopPropagation(); shareOrCopy('${njumpUrl}')" title="Compartir">🔗</button>
        <span class="card-nostr-link">Ver en Nostr →</span>
      </div>
    </div>
  </article>`;
}

function renderArticleCard(a) {
  const njumpUrl = `https://njump.me/${a.naddr}`;
  const isNew    = (Date.now() / 1000 - a.publishedAt) < 3600;
  return `<article class="article-card" onclick="window.open('${njumpUrl}','_blank','noopener noreferrer')">
    ${a.image && safeUrl(a.image) ? `<div class="article-img-wrap article-img-pending"><button type="button" class="btn-ghost btn-sm article-img-load" data-src="${safeUrl(a.image)}" onclick="event.stopPropagation(); loadArticleImage(this)">🖼 Mostrar imagen</button></div>` : ''}
    <div class="article-body">
      <div class="card-top-row">
        <span class="kind-badge kind-article">ARTÍCULO</span>
        ${isNew ? '<span class="card-new-badge">nuevo</span>' : ''}
      </div>
      <h3 class="card-title">${esc(a.title)}</h3>
      ${a.summary ? `<p class="article-summary">${a.summary}</p>` : ''}
      <div class="card-footer">
        <span class="card-age">${fmtAge(a.publishedAt)}</span>
        <div class="card-footer-actions">
          <button class="card-share-btn" onclick="event.stopPropagation(); shareOrCopy('${njumpUrl}')" title="Compartir">🔗</button>
          <span class="card-nostr-link">Leer →</span>
        </div>
      </div>
    </div>
  </article>`;
}

function renderGenericCard(item) {
  const njumpUrl = `https://njump.me/${item.note}`;
  return `<article class="feed-card" onclick="window.open('${njumpUrl}','_blank','noopener noreferrer')">
    <div class="card-top-row">
      <span class="kind-badge">KIND:${item.kind}</span>
      <span class="card-age" style="margin-left:auto">${fmtAge(item.publishedAt)}</span>
    </div>
    <p class="feed-content">${item.content}</p>
    <div class="card-footer">
      <span class="card-nostr-link">Ver en Nostr →</span>
    </div>
  </article>`;
}

// ── Calendar events ────────────────────────────────────────────
function renderCalendarEventCard(e) {
  const njumpUrl = `https://njump.me/${e.naddr}`;
  const now      = Math.floor(Date.now() / 1000);
  const startTs  = e.start?.ts || e.publishedAt;
  const isPast   = (e.end?.ts || startTs) < now;
  const date     = calDate(e.start);
  const day      = date ? date.toLocaleDateString('es-ES', { day: '2-digit' }) : '??';
  const month    = date ? date.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase() : '';
  const dateFmt  = fmtCalendarDate(e);
  const primaryLink = e.links.find(link => safeUrl(link)) || njumpUrl;

  return `<article class="event-card${isPast ? ' event-past' : ''}" onclick="window.open('${njumpUrl}','_blank','noopener noreferrer')">
    <div class="event-date-block">
      <span class="event-date">${day}</span>
      <span class="event-month">${esc(month)}</span>
    </div>
    <div class="event-body">
      <div class="event-top">
        <span class="event-type-badge" style="color:#ffd60a;border-color:#ffd60a40">NIP-52</span>
        ${isPast ? '<span class="event-past-badge">Pasado</span>' : ''}
      </div>
      <h3 class="event-title">${esc(e.title)}</h3>
      ${e.location ? `<div class="event-location">📍 ${esc(e.location)}</div>` : ''}
      ${dateFmt ? `<div class="event-time">📅 ${dateFmt}</div>` : ''}
      ${e.summary ? `<p class="event-desc">${e.summary}</p>` : ''}
      <div class="event-actions">
        <a href="${safeUrl(primaryLink)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm" onclick="event.stopPropagation()">Ver evento ↗</a>
        <a href="${njumpUrl}" target="_blank" rel="noopener noreferrer" class="btn-ghost btn-sm" onclick="event.stopPropagation()">Nostr ↗</a>
        <button class="card-share-btn" onclick="event.stopPropagation(); shareOrCopy('${njumpUrl}')" title="Compartir">🔗</button>
      </div>
    </div>
  </article>`;
}

/** Segundos Unix del inicio de un evento curado, o 0 si no tiene fecha legible. */
function staticEventTs(e) {
  const ms = e?.start ? new Date(e.start).getTime() : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** Evento curado que ya pasó de verdad: con fecha atrás y NO recurrente. */
function isStaticEventStale(e) {
  const ts = staticEventTs(e);
  return !e.recurrente && ts > 0 && ts < Math.floor(Date.now() / 1000);
}

function renderStaticEventCard(e) {
  const now    = Math.floor(Date.now() / 1000);
  const ts     = staticEventTs(e);
  const isPast = isStaticEventStale(e);
  // Recurrente con la última fecha ya pasada: la fecha anotada no es la
  // próxima, así que no se enseña como si lo fuera.
  const dateUnknown = !!e.recurrente && ts > 0 && ts < now;
  const startD = (ts > 0 && !dateUnknown) ? new Date(ts * 1000) : null;
  const day   = startD ? startD.toLocaleDateString('es-ES', { day: '2-digit' }) : (dateUnknown ? '↻' : '??');
  const month = startD ? startD.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase() : '';
  const primaryLink = (e.links || []).find(l => safeUrl(l)) || '';
  const recLabel = e.recurrente ? ' <span class="event-recurrent-badge">Recurrente</span>' : '';
  return `<article class="event-card${isPast ? ' event-past' : ''}">
    <div class="event-date-block">
      <span class="event-date">${day}</span>
      <span class="event-month">${esc(month)}</span>
    </div>
    <div class="event-body">
      <div class="event-top">
        <span class="event-type-badge" style="color:#f7931a;border-color:#f7931a40">📌 Curado</span>
        ${isPast ? '<span class="event-past-badge">Pasado</span>' : ''}${recLabel}
      </div>
      <h3 class="event-title">${esc(e.title)}</h3>
      ${e.location ? `<div class="event-location">📍 ${esc(e.location)}</div>` : ''}
      ${startD ? `<div class="event-time">📅 ${startD.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>` : ''}
      ${dateUnknown ? `<div class="event-time">📅 Se repite — consulta la próxima fecha en el enlace</div>` : ''}
      ${e.summary ? `<p class="event-desc">${esc(e.summary)}</p>` : ''}
      ${primaryLink ? `<div class="event-actions"><a href="${safeUrl(primaryLink)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm">Ver evento ↗</a></div>` : ''}
    </div>
  </article>`;
}

function fmtCalendarDate(e) {
  const startDate = calDate(e.start);
  const endDate   = calDate(e.end);
  if (!startDate) return '';
  if (e.kind === 31922) {
    const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    const start = startDate.toLocaleDateString('es-ES', opts);
    if (!endDate) return start;
    return `${start} → ${endDate.toLocaleDateString('es-ES', opts)}`;
  }

  const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  const start = startDate.toLocaleString('es-ES', opts);
  if (!endDate) return e.tzid ? `${start} · ${esc(e.tzid)}` : start;
  const end = endDate.toLocaleString('es-ES', opts);
  return `${start} → ${end}${e.tzid ? ` · ${esc(e.tzid)}` : ''}`;
}

// ── Skeletons / Empty ──────────────────────────────────────────
function showSkeletons(channelId, n = 6) {
  const grid = document.getElementById(`channel-${channelId}`);
  if (!grid) return;
  grid.innerHTML = Array(n).fill(0).map(() => `<div class="listing-card skeleton">
    <div class="skel skel-badge"></div>
    <div class="skel skel-title"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-line short"></div>
  </div>`).join('');
}

function showNoRelays(channelId) {
  const grid = document.getElementById(`channel-${channelId}`);
  if (!grid) return;
  grid.innerHTML = `<div class="empty-state">
    <div class="empty-icon">🔌</div>
    <p class="empty-title">Sin conexión a relays</p>
    <p class="empty-sub">No se pudo conectar a ningún relay. Comprueba tu conexión y recarga la página.</p>
    <button class="btn-primary" onclick="switchTab('relays')">Ver estado de relays</button>
  </div>`;
}

function showEmpty(channelId) {
  const grid = document.getElementById(`channel-${channelId}`);
  if (!grid) return;
  if (channelId === 'intercambio') {
    renderIntercambioOrders(grid);
    return;
  }
  if (channelId === 'eventos') {
    renderCalendarEvents(grid, []);
    return;
  }
  const ch   = config.channels.find(c => c.id === channelId);
  const tag  = (config.community_tags || ['plazap2p'])[0];
  grid.innerHTML = `<div class="empty-state">
    <div class="empty-icon">${esc(ch?.icon || '📡')}</div>
    <p class="empty-title">Sin contenido aún</p>
    <p class="empty-sub">Publica en Nostr con el tag <code>#${esc(tag)}</code> y aparecerá aquí.</p>
    <a class="btn-primary" href="publicar.html">Publicar en PlazaP2P</a>
  </div>`;
}

// ── Toast ──────────────────────────────────────────────────────
/** W-13: los enlaces del pie abren Info y bajan hasta su bloque. */
window.irAInfo = function(id) {
  window.switchTab?.('acerca');
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
};

function showToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  // Un mismo aviso repetido (p.ej. "Nuevo en Mercado" ×40 cuando un relay
  // lento descarga de golpe) no se apila; y nunca más de MAX_TOASTS a la vez.
  if ([...container.children].some(t => t.textContent === msg)) return;
  while (container.children.length >= MAX_TOASTS) container.firstElementChild.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);
  void toast.offsetHeight;
  toast.classList.add('toast-visible');
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 350);
  }, 3200);
}

// ── Deep link a un anuncio: #/anuncio/<naddr> (CODE-004) ────────
// Complementa router.js (que solo conoce destinos del shell, no anuncios
// concretos): aquí sí tenemos `channels`/openModal, así que el cableado
// real vive en este archivo. No sustituye la navegación por tabs — un
// anuncio es una vista superpuesta sobre el tab Mercado.
function initAnuncioDeepLink() {
  const naddr = parseAnuncioHash(window.location.hash);
  if (naddr) watchPendingAnuncio(naddr);

  window.addEventListener('hashchange', () => {
    const n = parseAnuncioHash(window.location.hash);
    if (n) { watchPendingAnuncio(n); return; }
    // El hash ya no apunta a un anuncio (Atrás/Adelante a otra sección):
    // si el modal seguía abierto, cerrarlo para no dejar UI y URL desincronizadas.
    clearTimeout(anuncioTimer);
    pendingAnuncioNaddr = null;
    const modal = document.getElementById('listing-modal');
    if (modal && !modal.classList.contains('hidden')) window.closeModal({ syncHash: false });
  });
}

let anuncioTimer = null;

/** W-08: un enlace roto no puede quedarse esperando para siempre. */
function watchPendingAnuncio(naddr) {
  pendingAnuncioNaddr = naddr;
  clearTimeout(anuncioTimer);
  anuncioTimer = setTimeout(() => {
    if (pendingAnuncioNaddr !== naddr) return;
    pendingAnuncioNaddr = null;
    showToast('No encontramos ese anuncio (puede haber caducado)');
  }, 8000);
}

/** Busca un naddr en todos los canales: mercado, directorio o eventos. */
function findItemByNaddr(naddr) {
  for (const ch of Object.values(channels)) {
    const found = [...ch.values()].find(x => x.naddr === naddr);
    if (found) return found;
  }
  return null;
}

// Los eventos de mercado llegan async desde los relays (o ya están en
// caché) — reintenta cada vez que hay datos nuevos hasta encontrar el naddr
// pendiente. Si a los 8 s no apareció, se avisa (W-08).
function tryOpenPendingAnuncio() {
  if (!pendingAnuncioNaddr) return;
  const found = findItemByNaddr(pendingAnuncioNaddr);
  if (!found) return;
  const target = pendingAnuncioNaddr;
  clearTimeout(anuncioTimer);
  pendingAnuncioNaddr = null;
  if (found.kind === 31922 || found.kind === 31923) {
    window.switchTab('eventos', { syncUrl: false, syncHash: false });
    showToast('Evento encontrado en la pestaña Eventos');
    return;
  }
  if (activeTab !== 'mercado') window.switchTab('mercado', { syncUrl: false, syncHash: false });
  window.openModal(target, { syncHash: false });
}

// ── Modal (mercado / kind:30402) ───────────────────────────────
window.openModal = function(naddr, options = {}) {
  const l = findItemByNaddr(naddr);
  if (!l || l.kind !== 30402) return;

  const color    = CAT_COLORS[l.category] || '#86868b';
  const njumpUrl = `https://njump.me/${l.naddr}`;
  const modal    = document.getElementById('listing-modal');
  const rating   = getSellerRating(l.pubkeyHex);
  // Valorar dentro de la app: publicar.html abre la sección Valorar con el
  // npub del vendedor precargado (firma con la clave del usuario, kind 1985).
  // REP-002: ref=naddr da contexto (qué anuncio motivó la valoración) sin
  // certificar que la operación se completó — publicar-app.js lo añade como
  // tag 'a' opcional, ignorándolo si llega roto.
  const valorarUrl = `publicar.html?valorar=${l.npub}&ref=${encodeURIComponent(l.naddr)}`;

  let ratingBlockFor = rating => rating
    ? `<div class="modal-rating-section">
        <div class="modal-rating-header">Reputación del vendedor</div>
        ${renderStarDisplay(rating.avg, rating.n, false)}
        ${rating.aspects ? renderAspectsBar(rating.aspects) : ''}
        <a href="${esc(valorarUrl)}" class="btn-ghost btn-sm modal-rate-btn">⭐ Valorar con tu clave</a>
      </div>`
    : `<div class="modal-rating-section modal-rating-none">
        <span class="no-rating-text">Sin valoraciones aún</span>
        <a href="${esc(valorarUrl)}" class="btn-ghost btn-sm modal-rate-btn">⭐ Ser el primero en valorar</a>
      </div>`;
  // Firmado por la cuenta de un mercado externo en nombre de otro vendedor: una
  // valoración iría a esa cuenta, no a quien vende.
  const proxiedBlock = `<div class="modal-rating-section modal-rating-none">
      <span class="no-rating-text">Publicado por la cuenta de ${esc(l.market?.label || '')} en nombre de otro vendedor: su reputación está en ${esc(l.market?.label || '')}.</span>
    </div>`;
  if (l.market?.proxied) ratingBlockFor = () => proxiedBlock;
  const ratingBlock = ratingBlockFor(rating);
  const marketUrl = l.market?.url ? safeHref(l.market.url, window.location.href) : '';
  const marketNotice = l.market ? `<div class="modal-notice modal-market-notice">
        <span>🏪</span>
        <span>Anuncio de <strong>${esc(l.market.label)}</strong>. Ese mercado marca los vendidos en su web, no en Nostr: confirma con el vendedor que sigue disponible.
        ${marketUrl ? `<a href="${esc(marketUrl)}" target="_blank" rel="noopener noreferrer">Ver en ${esc(l.market.label)} ↗</a>` : ''}</span>
      </div>` : '';

  const modalFavActive = isFavorite(l.naddr);
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeModal()"></div>
    <div class="modal-box">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <button class="card-fav-btn${modalFavActive ? ' active' : ''}" style="position:absolute;top:14px;right:52px" onclick="toggleFav('${l.naddr}', this)" title="${modalFavActive ? 'Quitar de favoritos' : 'Guardar en favoritos'}" aria-pressed="${modalFavActive}">${modalFavActive ? '⭐' : '☆'}</button>
      <div class="modal-category" style="color:${color}">${esc(l.category.toUpperCase())}</div>
      <h2 id="modal-title" class="modal-title">${esc(l.title)}</h2>
      ${l.location ? `<div class="modal-location">📍 ${esc(l.location)}</div>` : ''}
      ${l.summary  ? `<p class="modal-summary">${l.summary}</p>` : ''}
      <div class="modal-meta">
        ${NON_COMMERCE_CATS.has(l.category) ? '' : `<span><strong>Pago:</strong> ${l.payment.map(esc).join(', ')}</span>`}
        <span><strong>Publicado:</strong> ${fmtAge(l.publishedAt)}</span>
      </div>
      ${l.price ? `<div class="modal-meta"><span><strong>Precio:</strong> ${esc(l.price)} ${esc(l.currency || '')}</span>
        <button class="card-share-btn" onclick="closeModal();switchTab('conversor')" title="Convertir a sats/otras monedas">🧮 Convertir</button></div>` : ''}
      <div id="modal-rating-slot">${ratingBlock}</div>
      ${marketNotice}
      <div class="modal-notice">
        <span>🔒</span>
        <span>La información completa y el contacto están en la red Nostr. La interacción ocurre fuera de esta interfaz.</span>
      </div>
      <div class="modal-actions">
        <a href="${njumpUrl}" target="_blank" rel="noopener noreferrer" class="btn-primary">
          Ver anuncio completo en Nostr ↗
        </a>
        <button onclick="closeModal()" class="btn-secondary">Cerrar</button>
      </div>
      ${l.market?.proxied ? '' : `<a class="btn-ghost btn-sm modal-rate-btn" href="publicar.html?zap=${l.npub}&ref=${encodeURIComponent(l.naddr)}" title="Pago Lightning con recibo Nostr (NIP-57)">
        ⚡ Enviar zap
      </a>
      <a class="btn-ghost btn-sm modal-rate-btn" href="publicar.html?pagar=${encodeURIComponent(l.naddr)}" title="Pagar una factura Lightning (PAY-001)">
        💳 Pagar
      </a>`}
      <div class="modal-zap-total" id="modal-zap-total"></div>
      <div class="modal-secondary-actions">
        <button class="modal-hide-seller-btn" onclick="hideSeller('${l.pubkeyHex}')" title="Deja de ver publicaciones de este autor en este navegador">
          🚫 Ocultar este vendedor
        </button>
        <a class="modal-hide-seller-btn" href="publicar.html?report=${l.npub}&ref=${encodeURIComponent(l.naddr)}" title="Reporte público y firmado (MOD-002)">
          🚩 Reportar
        </a>
      </div>
    </div>`;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  trapFocus(modal);

  // CODE-004: URL restaurable — abrir un anuncio (desde donde sea: tarjeta,
  // búsqueda, deep link) queda reflejado en el hash para poder compartirlo,
  // recargar y usar Atrás para cerrarlo. syncHash:false lo usa
  // tryOpenPendingAnuncio() cuando el hash YA es el origen de la apertura.
  if (options.syncHash !== false) {
    const hash = anuncioRoute(naddr);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }

  // ZAP-002: número de recibos de zap bien formados (countableZapReceipt en
  // zaps.js). Sin contrastar el emisor con el proveedor LNURL del vendedor, un
  // recibo no prueba que hubo pago: se enseña cuántos hay, nunca una suma.
  modal.dataset.naddr = naddr;

  // Valoraciones en vivo del autor: sin esto la ficha solo enseñaba lo que ya
  // hubiera en memoria, y decía "Sin valoraciones aún" de un vendedor que en
  // la pestaña «Vendedores» tenía veinte.
  if (pool && !(l.pubkeyHex in liveRatings)) {
    fetchReputacionBatch(pool, [l.pubkeyHex]).then(results => {
      const r = results[l.pubkeyHex];
      liveRatings[l.pubkeyHex] = (r && r.showsAverage)
        ? { avg: r.avg, n: r.count, aspects: r.aspects, comments: r.comments }
        : null;
      if (modal.classList.contains('hidden') || modal.dataset.naddr !== naddr) return;
      const slot = document.getElementById('modal-rating-slot');
      if (slot) slot.innerHTML = ratingBlockFor(getSellerRating(l.pubkeyHex));
    }).catch(() => { /* relay caído: se queda lo que ya se enseñaba */ });
  }

  fetchZapReceipts(pool, l.pubkeyHex).then(({ receipts }) => {
    if (modal.classList.contains('hidden') || modal.dataset.naddr !== naddr) return; // ya se cerró o cambió de anuncio
    const el = document.getElementById('modal-zap-total');
    if (!el) return;
    el.textContent = receipts.length > 0
      ? `⚡ ${receipts.length} recibo${receipts.length === 1 ? '' : 's'} de zap público${receipts.length === 1 ? '' : 's'} (no se puede comprobar desde aquí que se pagaran)`
      : '';
  }).catch(() => { /* sin zaps o relay caído: no mostrar nada, no es un error visible */ });
};

// La imagen de un artículo la elige su autor: pedirla enseña la IP del
// visitante a ese servidor. Solo se carga cuando el usuario la pide.
window.loadArticleImage = function(btn) {
  const wrap = btn.parentElement;
  const img = document.createElement('img');
  img.className = 'article-img';
  img.alt = '';
  img.onerror = () => { wrap.style.display = 'none'; };
  img.src = btn.dataset.src;
  wrap.classList.remove('article-img-pending');
  wrap.replaceChildren(img);
};

window.closeModal = function(options = {}) {
  const modal = document.getElementById('listing-modal');
  modal?.classList.add('hidden');
  document.body.style.overflow = '';
  releaseFocus(modal);
  if (options.syncHash === false) return; // ya viene de un cambio de hash (Atrás/Adelante)
  if (parseAnuncioHash(window.location.hash)) {
    window.history.replaceState(null, '', routeForTab(activeTab) || '#/plaza');
  }
};

// MOD-001: oculta a un autor SOLO en este navegador — no es un reporte ni
// afecta a lo que otros ven. Purga lo ya cargado en todos los canales
// (no solo mercado: el mismo autor puede tener posts en feed/eventos/...).
window.hideSeller = function(pubkeyHex) {
  if (!confirm('¿Ocultar las publicaciones de este vendedor en este navegador? Puedes deshacerlo luego en Acerca → Moderación personal.')) return
  blockPubkey(pubkeyHex);
  window.closeModal();
  purgeBlocked();
};

// ── Focus trap (B.4): #listing-modal y #modal-donar-overlay son los únicos
// diálogos modales de la app — Tab/Shift+Tab quedan atrapados dentro
// mientras están abiertos, y el foco vuelve al elemento que los abrió.
let modalReturnFocus = null;
const FOCUSABLE_SEL = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function trapFocus(container) {
  if (!container) return;
  // Reabrir sin cerrar antes (de un anuncio a otro por enlace directo): no
  // acumular manejadores ni perder el elemento al que devolver el foco.
  if (container._trapKeydown) container.removeEventListener('keydown', container._trapKeydown);
  else modalReturnFocus = document.activeElement;
  const focusables = () => [...container.querySelectorAll(FOCUSABLE_SEL)];
  focusables()[0]?.focus();
  const onKeydown = e => {
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', onKeydown);
  container._trapKeydown = onKeydown;
}

function releaseFocus(container) {
  if (container?._trapKeydown) {
    container.removeEventListener('keydown', container._trapKeydown);
    container._trapKeydown = null;
  }
  modalReturnFocus?.focus?.();
  modalReturnFocus = null;
}

// ── Filters (mercado only) ─────────────────────────────────────
function initFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      limits['mercado'] = PAGE_SIZE;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderActiveChannel();
    });
  });

  document.getElementById('location-select')?.addEventListener('change', e => {
    activeLocation = e.target.value;
    limits['mercado'] = PAGE_SIZE;
    renderActiveChannel();
  });
}

function updateLocationSelect(items) {
  const select = document.getElementById('location-select');
  if (!select) return;
  const current   = select.value;
  const locations = [...new Set(items.map(i => i.location).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="all">📍 Todas las zonas</option>` +
    locations.map(l => `<option value="${esc(l)}"${l === current ? ' selected' : ''}>${esc(l)}</option>`).join('');
  // Si la última publicación de la zona activa desaparece, el <select> vuelve
  // visualmente a "Todas" (no queda option que coincida) pero activeLocation
  // seguía usándose en el filtro — dejaba el mercado "sin resultados" en
  // silencio. Sincronizar la variable con lo que el <select> ahora muestra.
  if (activeLocation !== 'all' && !locations.includes(activeLocation)) activeLocation = 'all';
}

// ── UI init ────────────────────────────────────────────────────
function initUI() {
  initFilters();
  initSort();
  initSearch();
  initTabFromUrl();
  initModerationUI();

  // Accesibilidad: Escape cierra los modales abiertos
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const listing = document.getElementById('listing-modal');
    if (listing && !listing.classList.contains('hidden')) window.closeModal();
    const donar = document.getElementById('modal-donar-overlay');
    if (donar && !donar.classList.contains('hidden')) window.closeDonarModal();
  });
}

// ── MOD-001/BON-017: gestión de la lista de moderación personal ─────────
function renderBlockedList() {
  const wrap = document.getElementById('blocked-list');
  if (!wrap) return;
  const hexes = listBlocked();
  if (hexes.length === 0) {
    wrap.innerHTML = `<div class="blocked-empty">No has ocultado a ningún vendedor.</div>`;
    return;
  }
  wrap.innerHTML = hexes.map(hex => {
    const npub = hexToNpub(hex);
    return `<div class="blocked-item">
      <span>${esc(npub.slice(0, 20))}…</span>
      <button type="button" data-unblock="${hex}">Dejar de ocultar</button>
    </div>`;
  }).join('');
}

function initModerationUI() {
  renderBlockedList();

  document.getElementById('blocked-list')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-unblock]');
    if (!btn) return;
    unblockPubkey(btn.getAttribute('data-unblock'));
    renderBlockedList();
    renderActiveChannel(); // el contenido de ese autor puede volver a aparecer
  });

  document.getElementById('btn-export-blocked')?.addEventListener('click', async () => {
    const json = exportBlocked();
    try {
      await navigator.clipboard.writeText(json);
      showToast('📋 Lista copiada al portapapeles');
    } catch {
      // Sin permiso de portapapeles: al menos mostrarla para copiar a mano
      prompt('Copia tu lista de moderación (JSON):', json);
    }
  });

  document.getElementById('btn-import-blocked')?.addEventListener('click', () => {
    const errEl = document.getElementById('err-blocked');
    if (errEl) errEl.textContent = '';
    const raw = prompt('Pega el JSON exportado de tu lista de moderación:');
    if (!raw) return;
    try {
      const added = importBlocked(raw);
      renderBlockedList();
      purgeBlocked();   // lo ya cargado de esos autores desaparece ahora, no en la próxima visita
      showToast(`✅ ${added} vendedor${added === 1 ? '' : 'es'} añadido${added === 1 ? '' : 's'} a la lista`);
    } catch (e) {
      if (errEl) errEl.textContent = 'No se pudo importar: ' + (e?.message || 'formato inválido');
    }
  });
}

function initSearch() {
  document.querySelectorAll('.tab-search').forEach(input => {
    input.addEventListener('input', () => {
      searchQuery = input.value;
      // Sync all search inputs (there's one per tab but only one active)
      document.querySelectorAll('.tab-search').forEach(el => {
        if (el !== input) el.value = input.value;
      });
      limits[activeTab] = PAGE_SIZE;
      renderActiveChannel();
    });
  });

  // CODE-002: la búsqueda del hero (solo visible ≤768px) es un .tab-search
  // más — el bloque de arriba ya la sincroniza y filtra. Solo le falta
  // llevar al mercado la primera vez que se usa, porque filtra activeTab
  // y el hero no tiene un tab propio.
  const heroSearch = document.getElementById('hero-search');
  heroSearch?.addEventListener('focus', () => {
    if (activeTab !== 'mercado') window.switchTab('mercado');
  }, { once: true });
}

function initSort() {
  document.querySelectorAll('.sort-select').forEach(sel => {
    const ch  = sel.dataset.channel;
    sel.value = sortPrefs[ch] || 'newest';
    sel.addEventListener('change', () => {
      sortPrefs[ch] = sel.value;
      // Sync any duplicate selects for same channel
      document.querySelectorAll(`.sort-select[data-channel="${ch}"]`).forEach(s => { s.value = sel.value; });
      saveSortPrefs();
      if (activeTab === ch) { limits[ch] = PAGE_SIZE; renderActiveChannel(); }
    });
  });
}

function initTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function initTabFromUrl() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  const validTabs = [...document.querySelectorAll('.nav-tab')].map(btn => btn.dataset.tab);
  if (tab && validTabs.includes(tab)) {
    window.switchTab(tab, { syncUrl: false });
  }
}

window.switchTab = function(tab, options = {}) {
  activeTab = tab;
  if (!limits[tab]) limits[tab] = PAGE_SIZE;

  document.querySelectorAll('.nav-tab').forEach(b => {
    const isActive = b.dataset.tab === tab;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.section-panel').forEach(p => {
    p.classList.remove('active');
    if (p.id === `tab-${tab}`) p.classList.add('active');
  });

  renderActiveChannel();
  if (tab === 'relays') renderRelayStatus();
  if (options.syncUrl !== false) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url);
  }
};

// ── Badges & counters ──────────────────────────────────────────
function updateAllBadges() {
  // Publicaciones distintas: un servicio está a la vez en Mercado y en
  // Directorio (misma clave) y se contaba dos veces.
  const total = new Set(Object.values(channels).flatMap(m => [...m.keys()])).size;
  const el    = document.getElementById('listing-count');
  if (el) {
    const current = parseInt(el.textContent) || 0;
    if (current !== total) animateNum(el, current, total);
  }

  const upd = document.getElementById('counter-updated');
  if (upd && lastUpdated) {
    const secs = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
    upd.textContent = `· ${fmtAge(Math.floor(Date.now() / 1000) - secs)}`;
  }

  for (const ch of (config?.channels || [])) {
    const badge = document.getElementById(`tab-count-${ch.id}`);
    if (badge) {
      const n = channels[ch.id]?.size || 0;
      badge.textContent = n > 0 ? n : '';
    }
  }
}

function animateNum(el, from, to) {
  if (from === to) return;
  const dur   = Math.min(700, Math.abs(to - from) * 40);
  const start = performance.now();
  const step  = (now) => {
    const p     = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.classList.add('counter-pop');
  };
  requestAnimationFrame(step);
  el.addEventListener('animationend', () => el.classList.remove('counter-pop'), { once: true });
}

// ── Relay UI ───────────────────────────────────────────────────
function renderRelayList() {
  const list = document.getElementById('relay-status-list');
  if (!list || !config) return;
  list.innerHTML = config.relays.map(url => relayItemHtml(url, 'conectando')).join('');
}

function renderRelayStatus() {
  const list = document.getElementById('relay-status-list');
  if (!list || !pool) return;
  list.innerHTML = pool.status.map(({ url, status }) => relayItemHtml(url, status)).join('');
}

function relayItemHtml(url, status) {
  const dot   = status === 'connected' ? '🟢' : status === 'connecting' ? '🟡' : '🔴';
  const safeWs = url.replace(/['"<>\s]/g, '');
  return `<div class="relay-item">
    <span class="relay-dot-icon">${dot}</span>
    <span class="relay-url">${esc(url.replace('wss://', ''))}</span>
    <span class="relay-status-label">${status}</span>
    <button class="btn-copy" onclick="copyToClipboard('${safeWs}')">copiar</button>
  </div>`;
}

function updateRelayStatus() {
  if (!pool) return;
  const n     = pool.connectedCount;
  const total = config?.relays?.length || 0;
  const dot   = document.getElementById('relay-dot');
  const label = document.getElementById('relay-label');
  if (dot)   dot.className    = `relay-dot ${n > 0 ? 'connected' : 'disconnected'}`;
  if (label) label.textContent = n > 0 ? `${n}/${total} relays` : 'conectando...';
  renderRelayStatus();
}

// ── Utilities ──────────────────────────────────────────────────
window.copyToClipboard = async function(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('✓ Copiado');
  } catch {
    showToast('No se pudo copiar');
  }
};

// BON-001: favorito local (no publica nada, no requiere identidad).
window.toggleFav = function(naddr, btnEl) {
  const active = toggleFavorite(naddr);
  if (btnEl) {
    btnEl.classList.toggle('active', active);
    btnEl.textContent = active ? '⭐' : '☆';
    btnEl.title = active ? 'Quitar de favoritos' : 'Guardar en favoritos';
    btnEl.setAttribute('aria-pressed', String(active));
  }
  // Si se está viendo el filtro "Favoritos", quitar uno debe quitarlo de la vista.
  if (activeTab === 'mercado' && activeFilter === 'favoritos') renderActiveChannel();
};

// SOC-001/BON-005: hoja de compartir nativa en móvil (Telegram, WhatsApp,
// etc.) si el navegador la soporta; si no, copia al portapapeles como antes.
// Solo se comparte la URL pública (naddr/nevent vía njump, o nuestra propia
// ruta #/anuncio/) — nunca sesión, borradores ni datos de wallet.
window.shareOrCopy = async function(url, title = 'PlazaP2P') {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; /* el usuario canceló la hoja: no hacer nada */ }
  }
  window.copyToClipboard(url);
};

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(url) {
  return esc(safeHref(url, window.location.href));
}

/** Singular o plural según n. En español el plural no siempre es "+es": valoración → valoraciones (sin tilde). */
function plural(n, one, many) {
  return n === 1 ? one : many;
}

function versioned(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}v=${ASSET_VERSION}`;
}

function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function langBadge(idiom) {
  if (!idiom) return '';
  const flags = {
    es: '🇪🇸 ES',
    en: '🇬🇧 EN',
    ing: '🇬🇧 EN',
    pt: '🇵🇹 PT',
    fr: '🇫🇷 FR',
    de: '🇩🇪 DE',
    it: '🇮🇹 IT'
  };
  return String(idiom).split(/[\/,· ]+/)
    .filter(Boolean)
    .map(part => flags[part.toLowerCase()] || part.toUpperCase())
    .join(' · ');
}

function initialsFromName(name) {
  const clean = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] || '';
  const second = words.length > 1 ? words[1]?.[0] : words[0]?.[1] || '';
  return `${first}${second}`.toUpperCase();
}

function toneFromSeed(seed) {
  const tones = ['btc', 'cyan', 'green', 'purple', 'yellow'];
  const str = String(seed || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
  return tones[Math.abs(hash) % tones.length];
}

function mediaImageUrl(item) {
  return safeUrl(item?.logo_url || item?.logo || item?.imagen || item?.image || item?.avatar || '');
}

function fmtAge(ts) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60)      return 'ahora';
  if (s < 3600)    return `${Math.floor(s / 60)}m`;
  if (s < 86400)   return `${Math.floor(s / 3600)}h`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d`;
  const m = Math.floor(s / 2592000);
  return m === 1 ? '1 mes' : `${m} meses`;
}

// Texto de vista previa: sin teléfonos/correos/enlaces (maskContacts, en
// listing-utils.js, con sus tests) y escapado para insertarlo como HTML.
function sanitize(text) {
  return esc(maskContacts(text));
}

function cityOnly(raw) {
  if (!raw) return null;
  return raw.split(',')[0].trim();
}

// ── Intercambio (Mostro kind:38383) ───────────────────────────

function resolveIntercambioConfig() {
  const raw = config.intercambio?.trustedMostroInstances || [];
  trustedMostroHexPubkeys = raw.map(pk => {
    if (typeof pk !== 'string') return null;
    if (pk.startsWith('npub1')) {
      try { return decodeNpub(pk); } catch { return null; }
    }
    return /^[0-9a-f]{64}$/i.test(pk) ? pk.toLowerCase() : null;
  }).filter(Boolean);
  applyIntercambioModeUi();
}

/** W-14: sin instancias de confianza no hay «modo Comunidad» que ofrecer. */
function applyIntercambioModeUi() {
  const hasTrusted = trustedMostroHexPubkeys.length > 0;
  if (!hasTrusted) intercambioShowAll = true;
  const comunidad = document.getElementById('btn-inter-comunidad');
  const red = document.getElementById('btn-inter-red');
  comunidad?.classList.toggle('hidden', !hasTrusted);
  comunidad?.classList.toggle('active', hasTrusted && !intercambioShowAll);
  red?.classList.toggle('active', !hasTrusted || intercambioShowAll);
}

function renderIntercambioOrders(grid) {
  if (!grid) return;
  const ch = channels['intercambio'];
  if (!ch) return;

  let orders = [...ch.values()].sort((a, b) => b.publishedAt - a.publishedAt);

  // Filter by trusted instances (community mode) if list is non-empty
  const hasTrusted = trustedMostroHexPubkeys.length > 0;
  if (!intercambioShowAll && hasTrusted) {
    orders = orders.filter(o => trustedMostroHexPubkeys.includes(o.botPubkey));
  }

  // Filter by fiat currency (normalizar a mayúsculas en ambos lados)
  if (intercambioFiat) {
    const fiatUpper = intercambioFiat.toUpperCase();
    orders = orders.filter(o => o.fiat?.toUpperCase() === fiatUpper);
  }

  const buyOrders  = orders.filter(o => o.orderType === 'buy');   // maker wants to buy BTC → taker can sell
  const sellOrders = orders.filter(o => o.orderType === 'sell');  // maker wants to sell BTC → taker can buy

  const emptyCol = (label) =>
    `<div class="intercambio-col-empty">Sin órdenes de ${esc(label)} ahora mismo.</div>`;

  grid.innerHTML = `
    <div class="intercambio-book-inner">
      <div class="intercambio-col intercambio-col--buy">
        <div class="intercambio-col-header">
          <span class="intercambio-col-title">Comprar BTC</span>
          <span class="intercambio-col-count">${sellOrders.length} oferta${sellOrders.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="intercambio-col-orders">
          ${sellOrders.length ? sellOrders.map(o => renderOrderCard(o)).join('') : emptyCol('venta')}
        </div>
      </div>
      <div class="intercambio-col intercambio-col--sell">
        <div class="intercambio-col-header">
          <span class="intercambio-col-title">Vender BTC</span>
          <span class="intercambio-col-count">${buyOrders.length} oferta${buyOrders.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="intercambio-col-orders">
          ${buyOrders.length ? buyOrders.map(o => renderOrderCard(o)).join('') : emptyCol('compra')}
        </div>
      </div>
    </div>`;
}

function renderOrderCard(o) {
  const njumpUrl  = `https://njump.me/${o.naddr}`;
  const isSell    = o.orderType === 'sell';  // maker sells → taker buys
  const typeLabel = isSell ? 'VENDE BTC' : 'COMPRA BTC';
  const typeClass = isSell ? 'order-type-badge--sell' : 'order-type-badge--buy';
  const premiumSign = o.premium > 0 ? `+${o.premium}%` : o.premium < 0 ? `${o.premium}%` : '0%';
  const premiumClass = o.premium <= 0 ? 'order-premium-badge--negative' : 'order-premium-badge--positive';
  const satsText  = o.sats > 0 ? `${o.sats.toLocaleString('es-ES')} sats` : 'flexible';
  let fiatText = '';
  if (o.fiatMin != null && o.fiatMax != null) {
    fiatText = `${o.fiatMin.toLocaleString('es-ES')}–${o.fiatMax.toLocaleString('es-ES')} ${esc(o.fiat)}`;
  } else if (o.fiatMin != null) {
    fiatText = `${o.fiatMin.toLocaleString('es-ES')} ${esc(o.fiat)}`;
  }
  const payText = o.payments.slice(0, 3).map(p => esc(p)).join(' · ') || '—';
  return `<div class="order-card">
    <div class="order-card-top">
      <span class="order-type-badge ${typeClass}">${typeLabel}</span>
      <span class="order-premium-badge ${premiumClass}">${premiumSign}</span>
    </div>
    <div class="order-sats">${satsText}</div>
    ${fiatText ? `<div class="order-fiat">${fiatText}</div>` : ''}
    ${payText !== '—' ? `<div class="order-payment">⚡ ${payText}</div>` : ''}
    <div class="order-card-footer">
      <span class="order-age">${fmtAge(o.publishedAt)}</span>
      <a href="${njumpUrl}" target="_blank" rel="noopener noreferrer" class="order-take-btn">Ver oferta →</a>
    </div>
  </div>`;
}

window.setIntercambioMode = function(showAll) {
  // W-14: si no hay instancias de confianza, «Comunidad» no existe.
  if (!showAll && trustedMostroHexPubkeys.length === 0) showAll = true;
  intercambioShowAll = showAll;
  applyIntercambioModeUi();
  if (activeTab === 'intercambio') renderActiveChannel();
};

window.setIntercambioFiat = function(fiat) {
  const supported = config?.intercambio?.supportedFiat || [];
  const norm = fiat ? String(fiat).toUpperCase() : '';
  intercambioFiat = (supported.length === 0 || supported.includes(norm)) ? norm : '';
  if (activeTab === 'intercambio') renderActiveChannel();
};

// ── Static data (GitHub JSON) ──────────────────────────────────
// W-07: un fallo de red no es «no hay nada». Se devuelve un centinela para
// pintar un estado de error con Reintentar en vez de un vacío engañoso.
const STATIC_ERROR = Symbol('static-error');
let staticEventsError = false;

async function fetchStaticJson(path) {
  try {
    const res = await fetchWithTimeout(versioned(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('respuesta sin lista');
    return data;
  } catch (err) {
    console.warn(`[static] No se pudo cargar ${path}:`, err?.message || err);
    return STATIC_ERROR;
  }
}

/** Como fetchStaticJson, para un archivo que es un objeto (comunidades-2140.json). */
async function fetchStaticDoc(path) {
  try {
    const res = await fetchWithTimeout(versioned(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('respuesta sin objeto');
    return data;
  } catch (err) {
    console.warn(`[static] No se pudo cargar ${path}:`, err?.message || err);
    return STATIC_ERROR;
  }
}

function renderStaticError(targetId, label) {
  const container = document.getElementById(`channel-${targetId}`);
  if (!container) return;
  container.innerHTML = `<div class="empty-state">
    <div class="empty-icon">⚠️</div>
    <p class="empty-title">No se pudieron cargar ${esc(label)}</p>
    <p class="empty-sub">No es que el directorio esté vacío: no se pudo descargar. Comprueba tu conexión.</p>
    <button class="btn-primary" onclick="window.retryStaticData?.()">Reintentar</button>
  </div>`;
}

window.retryStaticData = function() { loadStaticData(); };

async function loadStaticData() {
  try {
    const [comunidades, herramientas, multimedia, eventosData, comunidades2140] = await Promise.all([
      fetchStaticJson('data/comunidades.json'),
      fetchStaticJson('data/herramientas.json'),
      fetchStaticJson('data/multimedia.json'),
      fetchStaticJson('data/eventos.json'),
      fetchStaticDoc('data/comunidades-2140.json'),
    ]);
    staticComunidades2140 = comunidades2140 === STATIC_ERROR ? [] : communitiesFrom(comunidades2140);
    staticComunidadesError = comunidades === STATIC_ERROR;
    staticHerramientasError = herramientas === STATIC_ERROR;
    staticMultimediaError = multimedia === STATIC_ERROR;
    staticComunidades = staticComunidadesError ? [] : comunidades.filter(c => c.aprobado);
    staticHerramientas = staticHerramientasError ? [] : herramientas.filter(h => h.aprobado);
    staticEvents = eventosData === STATIC_ERROR ? [] : eventosData.filter(e => e.aprobado);
    staticEventsError = eventosData === STATIC_ERROR;
    if (staticComunidadesError) renderStaticError('comunidades', 'las comunidades');
    else renderComunidades(staticComunidades, GITHUB_REPO_URL);
    if (staticHerramientasError) renderStaticError('herramientas', 'las herramientas');
    else renderHerramientas(staticHerramientas, GITHUB_REPO_URL);
    if (staticMultimediaError) renderStaticError('multimedia', 'los recursos multimedia');
    else renderMultimedia(multimedia.filter(m => m.aprobado), GITHUB_REPO_URL);
    if (activeTab === 'vendedores') renderSellersDirectory();
    // Eventos también: si los relays contestaron antes que eventos.json, la
    // pestaña quedaba pintada sin los eventos curados hasta otro repintado.
    if (activeTab === 'mercado' || activeTab === 'eventos' || activeTab === 'mapa') renderActiveChannel();
  } catch (err) {
    console.warn('[static] Error cargando datos estáticos:', err);
  }
  loadMantenimiento();
}

let donarState = 'loading';   // loading | ok | error — W-06

async function loadMantenimiento() {
  donarState = 'loading';
  try {
    const res = await fetchWithTimeout(versioned('data/mantenimiento.json'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ln_address && !data.btc_address) throw new Error('sin direcciones de donación');

    const addressesHtml = buildDonarAddresses(data);
    const msgHtml  = `<p>${esc(data.mensaje || '')}</p>`;
    const gracHtml = `<p class="donar-gracias">${esc(data.mensaje_gracias || '')}</p>`;

    const block = document.getElementById('donar-block');
    if (block) {
      document.getElementById('donar-mensaje').innerHTML   = msgHtml;
      document.getElementById('donar-addresses').innerHTML = addressesHtml;
      document.getElementById('donar-gracias').innerHTML   = gracHtml;
      block.style.display = '';
    }

    document.getElementById('btn-donar-header')?.style && (document.getElementById('btn-donar-header').style.display = '');
    document.getElementById('footer-donar-link')?.style && (document.getElementById('footer-donar-link').style.display = '');

    document.getElementById('modal-donar-mensaje').innerHTML   = msgHtml;
    document.getElementById('modal-donar-addresses').innerHTML = addressesHtml;
    document.getElementById('modal-donar-gracias').innerHTML   = gracHtml;
    donarState = 'ok';
    applyDonarState();
  } catch (err) {
    console.warn('[mantenimiento] No se pudo cargar:', err);
    donarState = 'error';
    applyDonarState();
  }
}

/** Muestra el error y el botón Reintentar dentro del modal, o los quita. */
function applyDonarState() {
  const err = document.getElementById('modal-donar-error');
  const retry = document.getElementById('modal-donar-retry');
  const failed = donarState === 'error';
  if (err) {
    err.textContent = failed ? 'No se pudo cargar la información de donación.' : '';
    err.classList.toggle('show', failed);
  }
  if (retry) retry.classList.toggle('hidden', !failed);
  if (failed) {
    const msg = document.getElementById('modal-donar-mensaje');
    if (msg) msg.textContent = 'No se pudo cargar. Reintentar.';
    document.getElementById('modal-donar-addresses')?.replaceChildren();
    const gracias = document.getElementById('modal-donar-gracias');
    if (gracias) gracias.textContent = '';
  }
}

window.reintentarDonar = async function() {
  const msg = document.getElementById('modal-donar-mensaje');
  if (msg) msg.textContent = 'Cargando la información de donación…';
  donarState = 'loading';
  applyDonarState();
  await loadMantenimiento();
};

function buildDonarAddresses(data) {
  let html = '';
  if (data.ln_address) {
    const lnSafe = esc(String(data.ln_address).replace(/['\\\s]/g, ''));
    html += `<div class="donar-row">
      <span class="donar-label">⚡ Lightning</span>
      <code class="donar-addr">${esc(data.ln_address)}</code>
      <button class="btn-copy" onclick="window.copyToClipboard('${lnSafe}')">Copiar</button>
    </div>`;
  }
  if (data.btc_address) {
    const btcSafe = esc(String(data.btc_address).replace(/['\\\s]/g, ''));
    html += `<div class="donar-row">
      <span class="donar-label">₿ Bitcoin</span>
      <code class="donar-addr">${esc(data.btc_address)}</code>
      <button class="btn-copy" onclick="window.copyToClipboard('${btcSafe}')">Copiar</button>
    </div>`;
  }
  return html;
}

window.openDonarModal = function() {
  // W-06: si la información no cargó, el modal no se abre vacío.
  if (donarState !== 'ok') {
    const msg = document.getElementById('modal-donar-mensaje');
    if (msg) msg.textContent = donarState === 'error'
      ? 'No se pudo cargar. Reintentar.'
      : 'Cargando la información de donación…';
    document.getElementById('modal-donar-addresses')?.replaceChildren();
    const gracias = document.getElementById('modal-donar-gracias');
    if (gracias) gracias.textContent = '';
  }
  applyDonarState();
  const overlay = document.getElementById('modal-donar-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    trapFocus(overlay.querySelector('.modal-donar') || overlay);
  }
};

window.closeDonarModal = function() {
  const overlay = document.getElementById('modal-donar-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
    releaseFocus(overlay.querySelector('.modal-donar') || overlay);
  }
};

function staticDisclaimer(label, githubUrl, templateParam) {
  const issueUrl = `${githubUrl}/issues/new?template=${templateParam}`;
  return `<div class="static-footer">
    <span class="static-disclaimer">Contenido curado por la comunidad. PlazaP2P no verifica la información listada.</span>
    <a href="${issueUrl}" target="_blank" rel="noopener noreferrer" class="btn-suggest">+ Sugerir ${label} ↗</a>
  </div>`;
}

function staticEmpty(icon, label, githubUrl, templateParam) {
  const issueUrl = `${githubUrl}/issues/new?template=${templateParam}`;
  return `<div class="empty-state">
    <div class="empty-icon">${icon}</div>
    <p class="empty-title">Sin ${label} todavía</p>
    <p class="empty-sub">Sé el primero en proponer un ${label.slice(0, -1)} para la comunidad.</p>
    <a href="${issueUrl}" target="_blank" rel="noopener noreferrer" class="btn-primary">Sugerir ${label.slice(0, -1)} en GitHub ↗</a>
  </div>`;
}

// ── Render: propuestas del directorio (W-04) ──────────────────
// Se publican desde publicar.html como kind 30402 con un tag propio. Antes
// caían en Mercado/«General» y la FAQ decía que iban por GitHub.
const PROPOSAL_COMUNIDAD = 'plazap2p-comunidad';
const PROPOSAL_HERRAMIENTA = 'plazap2p-herramienta';

function isDirectoryProposal(item) {
  return item?.kind === 30402 &&
    (item.tTags?.includes(PROPOSAL_COMUNIDAD) || item.tTags?.includes(PROPOSAL_HERRAMIENTA));
}

function directoryProposals(tag) {
  const ch = channels.mercado;
  if (!ch) return [];
  return [...ch.values()].filter(item =>
    item?.kind === 30402 && item.tTags?.includes(tag) && !isItemExpired(item));
}

const PROPOSAL_PLATS = {
  telegram: 'Telegram', nostr: 'Nostr', matrix: 'Matrix', discord: 'Discord', otro: 'Otra',
};

function proposalsNoticeHtml(text) {
  return `<div class="event-static-notice proposals-notice">
    <span class="event-static-badge">🕓 Sin revisar</span>
    <span>${text}</span>
  </div>`;
}

function renderCommunityProposalCard(p) {
  const platKey = (p.tTags || []).find(t => t !== 'plazap2p' && t !== PROPOSAL_COMUNIDAD) || 'otro';
  const platLabel = PROPOSAL_PLATS[platKey] || platKey;
  const initials = initialsFromName(p.title);
  const tone = toneFromSeed(p.title || p.naddr);
  const link = p.links?.[0];
  return `<article class="community-card directory-card">
    <div class="directory-accent"></div>
    <div class="directory-card-body">
      <div class="directory-head">
        <div class="directory-avatar directory-avatar-${tone}" aria-hidden="true">
          <span class="directory-avatar-fallback">${esc(initials)}</span>
        </div>
        <div class="directory-meta">
          <h3 class="community-name">${esc(p.title)}</h3>
          <div class="community-top">
            <span class="community-platform"><span class="community-platform-icon">💬</span>${esc(platLabel)}</span>
          </div>
        </div>
      </div>
      <p class="community-desc">${esc(p.summary || '')}</p>
      <div class="directory-footer">
        <span class="directory-chip">Sin revisar</span>
        ${link ? `<a href="${safeUrl(link)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm">Abrir propuesta ↗</a>` : ''}
      </div>
    </div>
  </article>`;
}

function renderToolProposalCard(p) {
  const platforms = (p.platforms || []).filter(Boolean);
  const link = p.links?.[0];
  return `<div class="guia-card">
    <div class="tool-header"><span class="guia-title">${esc(p.title)}</span></div>
    <div class="guia-meta">
      ${platforms.map(x => `<span class="guia-tipo-badge">${esc(x)}</span>`).join('')}
      <span class="guia-tipo-badge">Sin revisar</span>
    </div>
    <p class="guia-desc">${esc(p.summary || '')}</p>
    <div class="guia-footer">
      ${link ? `<a class="btn-link" href="${safeUrl(link)}" target="_blank" rel="noopener noreferrer">ABRIR ▸</a>` : ''}
    </div>
  </div>`;
}

// ── Render: Comunidades ────────────────────────────────────────
// ── Render: Mapa ───────────────────────────────────────────────
// Leaflet solo se descarga al abrir la pestaña (mapa.js lo importa).
let mapModule = null;
let mapRefreshTimer = null;

function mapPoints() {
  return [
    ...communityPoints(staticComunidades2140),
    ...listingPoints([...(channels.mercado?.values() || [])]),
    ...eventPoints([...(channels.eventos?.values() || [])]),
  ];
}

function renderMapa() {
  const container = document.getElementById('map-container');
  if (!container) return;
  import('./mapa.js')
    .then(m => { mapModule = m; return m.showMap(container, mapPoints); })
    .catch(e => {
      console.warn('[mapa]', e);
      const status = document.getElementById('map-status');
      if (status) status.textContent = 'No se pudo cargar el mapa. Comprueba tu conexión y vuelve a abrir la pestaña.';
    });
}

function scheduleMapRefresh() {
  clearTimeout(mapRefreshTimer);
  mapRefreshTimer = setTimeout(() => mapModule?.refreshMap(), 800);
}

window.showOnMap = function() { window.switchTab('mapa'); };

/** Comunidades locales de España (2140meetups.com): nombre, ciudad y enlaces. */
function renderLocalCommunitiesHtml(list) {
  if (!list.length) return '';
  const cards = list.map(c => {
    const links = [
      c.telegram && `<a href="${safeUrl(c.telegram)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm">Telegram ↗</a>`,
      c.web && `<a href="${safeUrl(c.web)}" target="_blank" rel="noopener noreferrer" class="btn-ghost btn-sm">Web ↗</a>`,
      c.ficha && `<a href="${safeUrl(c.ficha)}" target="_blank" rel="noopener noreferrer" class="btn-ghost btn-sm">Ficha ↗</a>`,
    ].filter(Boolean).join(' ');
    return `<article class="community-card directory-card local-community-card">
      <div class="directory-accent"></div>
      <div class="directory-card-body">
        <h3 class="community-name">${esc(c.nombre)}</h3>
        <div class="community-top">
          <span class="community-country">📍 ${esc(c.ciudad || 'España')}</span>
          ${c.npub ? '<span class="community-platform" title="Tiene cuenta Nostr">⚡ Nostr</span>' : ''}
        </div>
        <div class="directory-footer">${links}</div>
      </div>
    </article>`;
  }).join('');
  return `<div class="proposals-notice local-communities-notice">
      <strong>Comunidades locales en España</strong> (${list.length}) · fuente:
      <a href="https://2140meetups.com/comunidades/" target="_blank" rel="noopener noreferrer">2140meetups.com</a> ·
      <button type="button" class="btn-ghost btn-sm" onclick="showOnMap()">🗺 Ver en el mapa</button>
    </div>` + cards;
}

function renderComunidades(items, githubUrl) {
  const container = document.getElementById('channel-comunidades');
  if (!container) return;
  const footer = document.getElementById('comunidades-footer');
  const proposals = directoryProposals(PROPOSAL_COMUNIDAD);

  if (items.length === 0 && proposals.length === 0 && staticComunidades2140.length === 0) {
    container.innerHTML = staticEmpty('🏘', 'comunidades', githubUrl, 'comunidad.yml');
    return;
  }

  const PLAT_ICONS = { Telegram: '✈️', Nostr: '⚡', Discord: '🎮', Matrix: '🔷', Signal: '🔒', Web: '🌐', Otra: '💬' };

  const curatedHtml = items.map(c => {
    const icon = PLAT_ICONS[c.plataforma] || '💬';
    const logo = mediaImageUrl(c);
    const initials = initialsFromName(c.nombre);
    const tone = toneFromSeed(c.nombre || c.id);
    const avatar = logo
      ? `<img src="${logo}" alt="" class="directory-avatar-img" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="directory-avatar-fallback" style="display:none">${esc(initials)}</span>`
      : `<span class="directory-avatar-fallback">${esc(initials)}</span>`;

    return `<article class="community-card directory-card">
      <div class="directory-accent"></div>
      <div class="directory-card-body">
        <div class="directory-head">
          <div class="directory-avatar directory-avatar-${tone}" aria-hidden="true">${avatar}</div>
          <div class="directory-meta">
            <h3 class="community-name">${esc(c.nombre)}</h3>
            <div class="community-top">
              <span class="community-platform"><span class="community-platform-icon">${icon}</span>${esc(c.plataforma || 'Comunidad')}</span>
              ${c.pais ? `<span class="community-country">${esc(c.pais)}</span>` : ''}
            </div>
          </div>
        </div>
        <p class="community-desc">${esc(c.descripcion || '')}</p>
        <div class="directory-footer">
          ${c.idioma ? `<span class="directory-chip">${esc(langBadge(c.idioma))}</span>` : '<span></span>'}
          <a href="${safeUrl(c.link)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm">Unirse ↗</a>
        </div>
      </div>
    </article>`;
  }).join('');

  container.innerHTML = curatedHtml + renderLocalCommunitiesHtml(staticComunidades2140) + (proposals.length
    ? proposalsNoticeHtml('Propuestas publicadas desde PlazaP2P. Todavía no han pasado la revisión del directorio.') +
      proposals.map(renderCommunityProposalCard).join('')
    : '');

  if (footer) footer.innerHTML = staticDisclaimer('comunidad', githubUrl, 'comunidad.yml');
}

// ── Render: Herramientas ───────────────────────────────────────
const CAT_META = {
  p2p:        { label: 'Exchange P2P',       icon: '🔄', color: '#30d158' },
  lightning:  { label: 'Lightning',          icon: '⚡', color: '#ffd60a' },
  wallet:     { label: 'Wallets Bitcoin',    icon: '🔐', color: '#f7931a' },
  node:       { label: 'Nodos',             icon: '📡', color: '#00d4ff' },
  analytics:  { label: 'Analytics',         icon: '📊', color: '#bf5af2' },
  privacy:    { label: 'Privacidad',        icon: '🛡️', color: '#86868b' },
  nostr:      { label: 'Herramientas Nostr', icon: '🟣', color: '#bf5af2' },
  utilities:  { label: 'Utilidades',        icon: '🧰', color: '#86868b' }
};
const CAT_ORDER = ['p2p', 'lightning', 'wallet', 'node', 'nostr', 'analytics', 'privacy', 'utilities'];

function renderHerramientas(items, githubUrl) {
  const container = document.getElementById('channel-herramientas');
  if (!container) return;
  const footer = document.getElementById('herramientas-footer');
  const proposals = directoryProposals(PROPOSAL_HERRAMIENTA);

  if (items.length === 0 && proposals.length === 0) {
    container.innerHTML = staticEmpty('🔧', 'herramientas', githubUrl, 'herramienta.yml');
    return;
  }

  const grouped = {};
  for (const h of items) {
    const cat = h.categoria || 'utilities';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(h);
  }

  // Las categorías que no están en la lista fija van al final en vez de no
  // enseñarse: una herramienta curada con una categoría nueva desaparecía sin
  // aviso (VW4-10).
  const html = [...CAT_ORDER, ...Object.keys(grouped).filter(cat => !CAT_ORDER.includes(cat)).sort()]
    .filter(cat => grouped[cat]?.length)
    .map(cat => {
      const meta = CAT_META[cat] || { label: cat, icon: '🔧', color: '#86868b' };
      const tools = grouped[cat].map(h => {
        const logoHtml = h.logo && safeUrl(h.logo)
          ? `<div class="tool-logo-wrap"><img class="tool-logo" src="${safeUrl(h.logo)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`
          : '';
        const osBadge = h.open_source
          ? `<span class="guia-tipo-badge guia-badge-os">Open Source</span>`
          : '';
        return `
          <div class="guia-card">
            <div class="tool-header">
              ${logoHtml}
              <span class="guia-title">${esc(h.nombre)}</span>
            </div>
            <div class="guia-meta">
              ${h.plataforma ? `<span class="guia-tipo-badge">${esc(h.plataforma)}</span>` : ''}
              ${osBadge}
            </div>
            <p class="guia-desc">${esc(h.descripcion || '')}</p>
            <div class="guia-footer">
              <a class="btn-link" href="${safeUrl(h.link)}" target="_blank" rel="noopener noreferrer">ABRIR ▸</a>
            </div>
          </div>`;
      }).join('');
      return `<div class="tools-category">
        <div class="tools-cat-header">
          <span class="tools-cat-icon">${meta.icon}</span>
          <span class="tools-cat-label" style="color:${meta.color}">${esc(meta.label)}</span>
        </div>
        <div class="tools-cat-grid">${tools}</div>
      </div>`;
    }).join('');

  const proposalsBlock = proposals.length ? `<div class="tools-category proposals-block">
    <div class="tools-cat-header">
      <span class="tools-cat-icon">🕓</span>
      <span class="tools-cat-label">Propuestas de la comunidad (sin revisar)</span>
    </div>
    <p class="guia-desc">Publicadas desde PlazaP2P. Todavía no han pasado la revisión del directorio.</p>
    <div class="tools-cat-grid">${proposals.map(renderToolProposalCard).join('')}</div>
  </div>` : '';

  container.innerHTML = html + proposalsBlock;
  if (footer) footer.innerHTML = staticDisclaimer('herramienta', githubUrl, 'herramienta.yml');
}

// ── Render: Multimedia ─────────────────────────────────────────
function renderMultimedia(items, githubUrl) {
  const container = document.getElementById('channel-multimedia');
  if (!container) return;
  const footer = document.getElementById('multimedia-footer');

  if (items.length === 0) {
    container.innerHTML = staticEmpty('🎙', 'recursos multimedia', githubUrl, 'multimedia.yml');
    return;
  }

  const TYPE_ICONS = { perfil: '👤', podcast: '🎙', youtube: '▶', newsletter: '📰', blog: '✍', livestream: '📺', web: '🌐', x: '𝕏', twitter: '𝕏', github: '{}', pdf: 'PDF', nostr: 'N', telegram: 'TG', instagram: 'IG', linkedin: 'in', email: '@' };
  const TYPE_LABELS = { perfil: 'perfil', podcast: 'podcast', youtube: 'youtube', newsletter: 'newsletter', blog: 'blog', livestream: 'directo', web: 'web', x: 'x', twitter: 'x', github: 'github', pdf: 'pdf', nostr: 'nostr', telegram: 'telegram', instagram: 'instagram', linkedin: 'linkedin', email: 'email' };

  container.innerHTML = items.map(m => {
    const icon = TYPE_ICONS[m.tipo] || '🔗';
    const typeLabel = TYPE_LABELS[m.tipo] || m.tipo || 'recurso';
    const links = Array.isArray(m.enlaces) ? m.enlaces : (m.link ? [{ tipo: m.tipo, label: m.tipo || 'Abrir', url: m.link }] : []);
    const socialLinks = links.map(link => {
      const type = link.tipo || 'web';
      const label = link.label || TYPE_LABELS[type] || 'Abrir';
      return `<a href="${safeUrl(link.url)}" target="_blank" rel="noopener noreferrer" class="multimedia-social-link" aria-label="${esc(label)}" title="${esc(label)}">
        <span class="multimedia-social-icon">${TYPE_ICONS[type] || '↗'}</span>
      </a>`;
    }).join('');
    const logo = mediaImageUrl(m);
    const initials = initialsFromName(m.nombre);
    const tone = toneFromSeed(m.nombre || m.id);
    const mediaIcon = logo
      ? `<img src="${logo}" alt="" class="directory-avatar-img" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="directory-avatar-fallback" style="display:none">${esc(initials)}</span>`
      : `<span class="directory-avatar-fallback">${esc(initials)}</span>`;

    return `<article class="multimedia-card directory-card">
      <div class="directory-accent"></div>
      <div class="directory-card-body">
        <div class="directory-head">
          <div class="directory-avatar directory-avatar-${tone}" aria-hidden="true">${mediaIcon}</div>
          <div class="directory-meta">
            <div class="multimedia-top">
              <span class="multimedia-type">${icon} ${esc(typeLabel)}</span>
              ${m.idioma ? `<span class="multimedia-lang">${esc(langBadge(m.idioma))}</span>` : ''}
            </div>
            <h3 class="multimedia-name">${esc(m.nombre)}</h3>
          </div>
        </div>
        <p class="multimedia-desc">${esc(m.descripcion || '')}</p>
        ${socialLinks ? `<div class="multimedia-socials">${socialLinks}</div>` : ''}
      </div>
    </article>`;
  }).join('');

  if (footer) footer.innerHTML = staticDisclaimer('recurso', githubUrl, 'multimedia.yml');
}

// ── Publicación (ARC-001) ─────────────────────────────────────
// El único flujo de publicación es publicar.html (builders + firma
// verificada SEC-002). La pestaña Publicar de esta página solo enlaza allí.

// ╔══════════════════════════════════════════════════════════════╗
// ║  FASE 2 DORMIDA — Instancia Mostro propia de la comunidad   ║
// ╠══════════════════════════════════════════════════════════════╣
// ║  Para activar esta fase:                                     ║
// ║  1. Despliega un daemon mostrod en tu servidor               ║
// ║     (ver https://mostro.network/protocol/)                   ║
// ║  2. Obtén el pubkey hex del bot (el daemon lo imprime        ║
// ║     al arrancar o está en su config)                         ║
// ║  3. Añade ese pubkey a config.json:                          ║
// ║       intercambio.trustedMostroInstances: ["hex_pubkey"]     ║
// ║  4. Esto activa automáticamente el filtro de comunidad:      ║
// ║     en modo "Comunidad", solo se muestran las órdenes de     ║
// ║     ese bot. En modo "Red completa", se muestran todas.      ║
// ║                                                              ║
// ║  El código de filtrado ya está activo en resolveIntercambio  ║
// ║  Config() y renderIntercambioOrders(). Solo necesitas        ║
// ║  configurar el pubkey en config.json.                        ║
// ║                                                              ║
// ║  Requisitos del servidor:                                     ║
// ║  - Linux con Rust (cargo) instalado                          ║
// ║  - Wallet LN (CLN o LND) para gestionar el escrow           ║
// ║  - Dominio + certificado TLS para el relay propio            ║
// ║  - ~2GB RAM, 20GB disco                                      ║
// ╚══════════════════════════════════════════════════════════════╝

init();
