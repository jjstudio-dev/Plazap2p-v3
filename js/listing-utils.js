// listing-utils.js — Lógica PURA de lectura de publicaciones (sin DOM ni estado).
//
// Vivía dentro de app.js, que no se puede cargar en node:test (toca el DOM al
// importarse). Aquí estas funciones tienen test propio
// (tests/listing-utils.test.mjs): clasificar un anuncio, leer fechas NIP-52,
// caducidad NIP-40 y los tags de un canal.

import { getTagValue } from './nostr.js'

// Tags específicos de un canal: `tagFilters` (lista) y/o `tagFilter` (único,
// formato original). null = el canal usa los community_tags generales.
export function channelTagFilters(ch) {
  const list = [
    ...(Array.isArray(ch.tagFilters) ? ch.tagFilters : []),
    ...(typeof ch.tagFilter === 'string' ? [ch.tagFilter] : []),
  ].filter(t => typeof t === 'string' && t);
  return list.length ? [...new Set(list)] : null;
}

// Tag opcional ['expiration', '<unix segs>']. Timestamp inválido (no
// numérico, negativo) se ignora en vez de tratarse como "ya caducado" —
// un tag malformado no debe ocultar un anuncio válido.
export function isExpired(event) {
  const ts = expirationTs(event);
  return ts != null && ts < Math.floor(Date.now() / 1000);
}

/** Timestamp (segundos Unix) del tag `expiration`, o null si no hay uno válido. */
export function expirationTs(event) {
  const raw = getTagValue(event.tags, 'expiration');
  if (!raw) return null;
  const ts = parseInt(raw, 10);
  return (Number.isFinite(ts) && ts > 0) ? ts : null;
}

/**
 * ¿Ha caducado ya un item YA parseado (lleva `expiresAt`)? isExpired() solo se
 * evalúa cuando el evento llega del relay; un anuncio que caduca después —
 * mientras está en la caché de localStorage o en una pestaña que sigue
 * abierta — necesita esta comprobación en el momento de mostrarlo.
 */
export function isItemExpired(item, nowSec = Math.floor(Date.now() / 1000)) {
  const ts = Number(item?.expiresAt);
  return Number.isFinite(ts) && ts > 0 && ts < nowSec;
}

// Devuelve SOLO { ts } (segundos Unix): los items parseados se guardan en la
// caché de localStorage como JSON, y un objeto Date volvería de ahí convertido
// en string — al pintarlo, .toLocaleDateString() lanzaba y dejaba la pestaña
// Eventos (y con ?tab=eventos, todo el arranque) rota. El Date se construye
// al renderizar con calDate().
export function parseCalendarDate(kind, value) {
  if (!value) return null;
  if (kind === 31922) {
    // Legado PROT-001: eventos 31922 antiguos publicados con timestamp Unix
    // (bug corregido en el builder) — tolerarlos solo en lectura.
    if (/^\d{9,}$/.test(value)) {
      const ts = Number(value);
      return Number.isNaN(new Date(ts * 1000).getTime()) ? null : { ts };
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return { ts: Math.floor(date.getTime() / 1000) };
  }

  const ts = Number(value);
  if (!Number.isFinite(ts)) return null;
  if (Number.isNaN(new Date(ts * 1000).getTime())) return null;
  return { ts };
}

/** Fecha AAAA-MM-DD desplazada `days` días (en calendario, sin zonas horarias). '' si no es válida. */
export function shiftIsoDate(iso, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

/**
 * Último día de un evento de todo el día (kind 31922), a partir de su etiqueta
 * `end`. En NIP-52 `end` es EXCLUSIVO: el día siguiente al último. Devuelve ''
 * si no hay fin o si el evento dura un solo día.
 */
export function allDayLastDay(endIso, startIso) {
  const last = shiftIsoDate(endIso, -1)
  if (!last || !/^\d{4}-\d{2}-\d{2}$/.test(String(startIso || ''))) return ''
  return last > startIso ? last : ''
}

/** { ts } de parseCalendarDate → Date válido, o null. */
export function calDate(point) {
  const ts = Number(point?.ts);
  if (!Number.isFinite(ts)) return null;
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function detectCategory(tTags) {
  // Sub-tags tienen prioridad — el tag define la categoría
  if (tTags.includes('plazap2p-venta'))    return 'venta';
  if (tTags.includes('plazap2p-compra'))   return 'compra';
  if (tTags.includes('plazap2p-servicio')) return 'servicio';
  // El asistente de publicar.html etiqueta los intercambios como
  // 'plazap2p-intercambio'; 'plazap2p-trueque' es el tag documentado para
  // clientes externos. Ambos son la misma categoría.
  if (tTags.includes('plazap2p-trueque') || tTags.includes('plazap2p-intercambio')) return 'trueque';
  if (tTags.includes('plazap2p-evento'))      return 'evento';
  if (tTags.includes('plazap2p-comunidad'))   return 'comunidad';
  if (tTags.includes('plazap2p-herramienta')) return 'herramienta';
  // Compatibilidad: tags de categoría sueltos (NIP-99 legacy)
  for (const cat of ['venta', 'compra', 'servicio', 'trueque']) {
    if (tTags.includes(cat)) return cat;
  }
  // Sin sub-tag → General (aparece en "General" y en todos los demás)
  return 'general';
}

export function detectPayment(tTags) {
  const methods = [];
  if (tTags.some(t => ['bitcoin', 'btc', 'onchain'].includes(t)))   methods.push('Bitcoin');
  if (tTags.some(t => ['lightning', 'ln', 'lnbc'].includes(t)))     methods.push('Lightning');
  if (tTags.some(t => ['cashu', 'ecash'].includes(t)))              methods.push('Cashu');
  if (tTags.some(t => ['efectivo', 'cash'].includes(t)))            methods.push('Efectivo');
  return methods.length ? methods : ['Bitcoin'];
}

/**
 * Texto de vista previa (resumen de un anuncio, nota del feed): sin teléfonos,
 * correos, enlaces (con o sin https), usuarios @ ni direcciones nostr:, y
 * recortado a 200 caracteres. El contacto completo está
 * en el evento Nostr; aquí solo se evita que la tarjeta sirva de escaparate
 * para sacar la conversación a un canal de phishing.
 *
 * Un teléfono son de 9 a 15 dígitos seguidos o separados. NO lo son las
 * cifras normales de un anuncio, que la versión anterior también borraba
 * (cualquier tira de 8 dígitos/espacios/puntos/guiones): "21.000.000",
 * "100000000 sats", "2026-10-12", "1.500,00 €".
 */
export function maskContacts(text) {
  const src = String(text);
  return src
    .replace(/\(?\+?\d[\d\s().-]{6,}\d/g, (m, offset) => looksLikePhone(m, src.slice(offset + m.length)) ? '···' : m)
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, '···')
    .replace(/https?:\/\/\S+/g, '[enlace]')
    .replace(/nostr:\S+/gi, '[enlace]')
    .replace(/www\.\S+/gi, '[enlace]')
    // dominio sin https seguido de una ruta: t.me/usuario, tienda.example/pago
    .replace(/(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S+/gi, '[enlace]')
    // @usuario (Telegram, X…): la arroba pegada a un nombre, no una suelta
    .replace(/(^|\s)@\w{3,}/g, '$1···')
    .slice(0, 200);
}

function looksLikePhone(match, after) {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return false;
  const m = match.trim();
  if (!/^\(?\+/.test(m)) {
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(m) || /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(m)) return false;   // miles: 1.000.000.000
    if (/^\s*(sats?|msats?|btc|eur|euros?|usd|€|\$|₿)(?![a-z])/i.test(after)) return false;            // importe: 100000000 sats
  }
  return true;
}

/**
 * `published_at` (NIP-99/NIP-23) es la fecha de la PRIMERA publicación, así
 * que nunca puede ser posterior al `created_at` de la versión que lo declara.
 * Un valor futuro o ilegible se sustituye por `created_at`: sin este tope, un
 * anuncio se quedaba fijado arriba del todo (y con la marca "nuevo") con solo
 * declarar una fecha de dentro de cinco años.
 */
export function publishedAtOf(tags, created_at) {
  const ts = parseInt(getTagValue(tags, 'published_at') ?? '', 10);
  return (Number.isFinite(ts) && ts > 0 && ts <= created_at) ? ts : created_at;
}

/**
 * Campos de una orden Mostro (NIP-69, kind 38383), o null si no es una orden
 * creíble. En NIP-69 el rango de importe y los medios de pago van como varios
 * valores DENTRO de una sola etiqueta — `["fa","100","500"]`,
 * `["pm","Bizum","SEPA"]` — no como etiquetas repetidas; se aceptan ambas
 * formas.
 */
export function parseOrderTags(tags) {
  const values = name => tags.filter(t => t[0] === name).flatMap(t => t.slice(1)).filter(v => typeof v === 'string' && v !== '');
  const orderType = (getTagValue(tags, 'k') || '').toLowerCase();   // 'sell' | 'buy'
  if (orderType !== 'buy' && orderType !== 'sell') return null;

  const sats = parseInt(getTagValue(tags, 'amt') || '0', 10);
  if (!Number.isFinite(sats) || sats < 0 || sats > 21_000_000_000_000) return null;

  const fiatAmts = values('fa').map(Number);
  if (fiatAmts.some(n => !Number.isFinite(n) || n < 0)) return null;
  const fiatMin = fiatAmts.length ? fiatAmts[0] : null;
  const fiatMax = fiatAmts.length > 1 ? fiatAmts[1] : null;
  if (fiatMin != null && fiatMax != null && fiatMax < fiatMin) return null;

  const premium = parseFloat(getTagValue(tags, 'premium') || '0');
  if (!Number.isFinite(premium) || premium < -99 || premium > 10000) return null;

  return {
    orderType,
    fiat: (getTagValue(tags, 'f') || '').toUpperCase(),
    sats, fiatMin, fiatMax,
    payments: values('pm'),
    premium,
    status: getTagValue(tags, 's') || 'pending',
  };
}

// ── Caché local ────────────────────────────────────────────────────────────
// Lo que app.js guarda en localStorage son items YA parseados, y al volver a
// cargarlos van directos a la pantalla. Un item con la forma equivocada (una
// versión anterior de la app, un guardado a medias, otra página del mismo
// origen) hacía fallar el pintado de toda la pestaña — y como la caché se
// reescribe en cada visita, el fallo no caducaba nunca. reviveCachedItem()
// devuelve el item solo si tiene exactamente la forma que produce el parser
// de su kind; si no, null y se descarta.

const BECH32 = '[02-9ac-hj-np-z]';
const RE_NADDR = new RegExp(`^naddr1${BECH32}+$`);
const RE_NOTE  = new RegExp(`^note1${BECH32}{58}$`);
const RE_NPUB  = new RegExp(`^npub1${BECH32}{58}$`);
const RE_HEX64 = /^[0-9a-f]{64}$/;
const CATEGORIES = new Set(['venta', 'compra', 'servicio', 'trueque', 'evento', 'comunidad', 'herramienta', 'general']);
const PAYMENTS   = new Set(['Bitcoin', 'Lightning', 'Cashu', 'Efectivo']);

const isStr     = v => typeof v === 'string';
const isTs      = v => Number.isInteger(v) && v > 0;
const isNum     = v => typeof v === 'number' && Number.isFinite(v);
// Texto que ya pasó por el escapado de app.js: nunca puede traer marcado.
const isEscaped = v => isStr(v) && !/[<>]/.test(v);
const isCalPoint = v => v == null || (typeof v === 'object' && isNum(v.ts));
const isStrList = v => Array.isArray(v) && v.every(isStr);

export function reviveCachedItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (!isTs(item.created_at)) return null;

  switch (item.kind) {
    case 30402:
      return (isStr(item.title) && isEscaped(item.summary)
        && (item.location == null || isStr(item.location))
        && CATEGORIES.has(item.category)
        && Array.isArray(item.payment) && item.payment.length > 0 && item.payment.every(p => PAYMENTS.has(p))
        && isStr(item.price) && isStr(item.currency) && isStr(item.status)
        && isTs(item.publishedAt)
        && isStr(item.naddr) && RE_NADDR.test(item.naddr)
        && isStr(item.npub) && RE_NPUB.test(item.npub)
        && isStr(item.pubkeyHex) && RE_HEX64.test(item.pubkeyHex)
        && (item.expiresAt == null || isTs(item.expiresAt))) ? item : null;

    case 30023:
      return (isStr(item.title) && isEscaped(item.summary)
        && (item.image == null || isStr(item.image))
        && isTs(item.publishedAt)
        && isStr(item.naddr) && RE_NADDR.test(item.naddr)
        && isStr(item.npub) && RE_NPUB.test(item.npub)) ? item : null;

    case 31922:
    case 31923:
      return (isStr(item.title) && isEscaped(item.summary) && isStr(item.location)
        && isCalPoint(item.start) && isCalPoint(item.end)
        && isStr(item.tzid) && isStrList(item.links) && isStr(item.status)
        && isNum(item.publishedAt)
        && isStr(item.naddr) && RE_NADDR.test(item.naddr)
        && isStr(item.npub) && RE_NPUB.test(item.npub)) ? item : null;

    case 38383:
      return ((item.orderType === 'buy' || item.orderType === 'sell')
        && isStr(item.fiat) && isNum(item.sats) && item.sats >= 0
        && (item.fiatMin == null || isNum(item.fiatMin))
        && (item.fiatMax == null || isNum(item.fiatMax))
        && isStrList(item.payments) && isNum(item.premium) && isStr(item.status)
        && isStr(item.botPubkey) && RE_HEX64.test(item.botPubkey)
        && isTs(item.publishedAt)
        && isStr(item.naddr) && RE_NADDR.test(item.naddr)) ? item : null;

    default:   // notas (kind 1) y cualquier otro kind genérico
      return (Number.isInteger(item.kind) && isEscaped(item.content)
        && isTs(item.publishedAt)
        && isStr(item.npub) && RE_NPUB.test(item.npub)
        && isStr(item.note) && RE_NOTE.test(item.note)) ? item : null;
  }
}

/**
 * Dirección que se puede poner en un enlace o una imagen, o '' si no.
 * Solo http(s). Los identificadores Nostr sueltos se llevan a njump.me.
 *
 * Una dirección de la propia web solo se acepta sin parámetros: los datos
 * vienen de eventos ajenos, y un enlace a `publicar.html?amber=…` o `?dev=1`
 * haría que quien lo pulse cambie su identidad guardada o publique oculto
 * (VW4-03). Ruta y fragmento sí: son navegación normal.
 */
export function safeHref(url, baseHref) {
  if (!url) return ''
  try {
    url = String(url).trim()
    if (/^(npub|nprofile|note|nevent|naddr)1/i.test(url)) {
      url = `https://njump.me/${url}`
    }
    const base = new URL(baseHref)
    const u = new URL(url, base)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''
    if (u.origin === base.origin) {
      if (u.search) return ''
      return u.pathname + u.hash
    }
    return url
  } catch { return '' }
}
