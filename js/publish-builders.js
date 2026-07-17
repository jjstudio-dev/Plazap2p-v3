// publish-builders.js — Constructores de eventos Nostr SIN FIRMAR
//
// Port de bot/src/publish.js con un contrato distinto: aquí cada builder es
// puro y síncrono — valida el payload y devuelve el evento listo para firmar,
// pero NO firma ni publica (eso lo orquesta publicar-app.js con signer.js y
// el RelayPool). El usuario firma con SU clave, así que desaparecen los
// artefactos de identidad del bot: tg-ref, proxy/alias, plazap2p-auth y el
// tag p de atribución (el autor del evento ES el usuario).
//
// Contrato: buildX(data, userPubHex) →
//   { ok: true,  unsignedEvent, dTag }   |   { ok: false, error }
//
// unsignedEvent = { kind, created_at, tags, content, pubkey } — sin id ni sig
// (los calcula el firmador: Amber via NIP-55 o extensión NIP-07).

import { sanitizeContact, validateUrl } from './publish-utils.js'

export const CLIENT_URL = 'https://jjstudio-dev.github.io/Plazap2p-v3/'
const CLIENT_TAG = ['client', 'PlazaP2P App', CLIENT_URL]

export const VALID_CATS_SERVICIO    = ['consultoria', 'diseno', 'desarrollo', 'educacion', 'marketing', 'otros']
export const VALID_PLATS_COMUNIDAD  = ['telegram', 'nostr', 'matrix', 'discord', 'otro']
export const VALID_CATS_HERRAMIENTA = ['wallet', 'nostr', 'seguridad', 'lightning', 'educacion', 'otro']
export const VALID_TIPOS_TX         = ['plazap2p-venta', 'plazap2p-compra', 'plazap2p-intercambio']
export const VALID_ALCANCES         = ['local', 'nacional', 'internacional', 'online']
export const VALID_PLATFORMS        = ['web', 'android', 'ios', 'desktop', 'terminal']
export const VALID_CURRENCIES       = ['EUR', 'USD', 'BTC', 'SATS']

const FOOTER = '\n\n---\n📢 Publicado vía PlazaP2P'

// ── Helpers internos (misma semántica que bot/src/publish.js) ────────────────

function validateBase(data) {
  if (!data || typeof data !== 'object') return 'datos inválidos'
  return null
}

function validateTitle(title, min = 3, max = 200) {
  if (!title || typeof title !== 'string') return 'título requerido'
  const t = title.trim()
  if (t.length < min) return `título demasiado corto (mínimo ${min} caracteres)`
  if (t.length > max) return `título demasiado largo (máximo ${max} caracteres)`
  return null
}

function validateDesc(desc, min = 10, max = 2000) {
  if (!desc || typeof desc !== 'string') return 'descripción requerida'
  const d = desc.trim()
  if (d.length < min) return `descripción demasiado corta (mínimo ${min} caracteres)`
  if (d.length > max) return `descripción demasiado larga (máximo ${max} caracteres)`
  return null
}

function validatePubkey(userPubHex) {
  if (!userPubHex || !/^[0-9a-f]{64}$/i.test(String(userPubHex)))
    return 'conecta tu identidad Nostr antes de publicar'
  return null
}

/**
 * Valida un precio de formulario: numérico positivo, coma o punto decimal.
 * El wizard del bot lo garantizaba por flujo; el formulario debe validarlo.
 * Devuelve el precio normalizado (punto decimal) o null si es inválido.
 */
export function normalizePrice(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  return s
}

/** d-tag único: mismo esquema que el bot pero con prefijo de la app. */
function generateDTag() {
  const randBytes = new Uint8Array(4)
  crypto.getRandomValues(randBytes)
  const rand = Array.from(randBytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `plazap2p-app-${Date.now()}-${rand}`
}

/**
 * Ensambla el evento sin firmar. Estructura heredada del bot
 * ([['d', uid], ...tags, ['status','active']]) más `published_at` (NIP-99,
 * PROT-002): en la primera publicación es "ahora"; al editar debe pasarse el
 * valor original para no perder la fecha de publicación.
 * @param {string} [dTag] — pasar un d existente para EDITAR (replaceable event)
 * @param {number} [publishedAt] — published_at original al editar (Unix segs)
 */
function assembleEvent(kind, tags, content, userPubHex, dTag = null, publishedAt = null) {
  const uid = dTag || generateDTag()
  const pubAt = (Number.isInteger(publishedAt) && publishedAt > 0)
    ? publishedAt
    : Math.floor(Date.now() / 1000)
  return {
    dTag: uid,
    unsignedEvent: {
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', uid], ['published_at', String(pubAt)], ...tags, CLIENT_TAG, ['status', 'active']],
      content,
      pubkey: String(userPubHex).toLowerCase(),
    },
  }
}

// ── buildServicio ─────────────────────────────────────────────────────────────
// Schema (mismo que publish.js del bot, sin alias):
// { title, desc, catId, imageUrl, price, currency, contact }

export function buildServicio(data, userPubHex, dTag = null, publishedAt = null) {
  const pkErr = validatePubkey(userPubHex)
  if (pkErr) return { ok: false, error: pkErr }
  const baseErr = validateBase(data)
  if (baseErr) return { ok: false, error: baseErr }
  const titleErr = validateTitle(data.title, 5)
  if (titleErr) return { ok: false, error: titleErr }
  const descErr = validateDesc(data.desc)
  if (descErr) return { ok: false, error: descErr }
  if (data.catId && !VALID_CATS_SERVICIO.includes(String(data.catId)))
    return { ok: false, error: `categoría inválida: ${data.catId}` }

  const tags = [
    ['title',        String(data.title).trim().slice(0, 200)],
    ['summary',      String(data.desc).trim().slice(0, 2000)],
    ['t',            'plazap2p'],
    ['t',            'plazap2p-servicio'],
    ['service_type', String(data.catId || 'otros')],
  ]
  applyCommonOptionalTags(tags, data)

  const { unsignedEvent, dTag: uid } = assembleEvent(30402, tags, String(data.desc) + FOOTER, userPubHex, dTag, publishedAt)
  return { ok: true, unsignedEvent, dTag: uid }
}

// ── buildEvento ───────────────────────────────────────────────────────────────
// PROT-001 (NIP-52): dos kinds según el tipo de evento de calendario.
//   - allDay  → kind 31922 (date-based):  start/end en formato YYYY-MM-DD
//   - con hora → kind 31923 (time-based): start/end en timestamp Unix
//     + start_tzid (zona IANA) para render correcto en otros clientes.
// El bug histórico (31922 con timestamp Unix) hacía los eventos ilegibles en
// clientes NIP-52 externos.
//
// Schema: { title, desc, imageUrl, location, contact,
//           allDay, startDate?, endDate?,   ← si allDay (YYYY-MM-DD)
//           dateTs?, endTs?, tzid? }        ← si con hora (Unix segs)

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function buildEvento(data, userPubHex, dTag = null, publishedAt = null) {
  const pkErr = validatePubkey(userPubHex)
  if (pkErr) return { ok: false, error: pkErr }
  const baseErr = validateBase(data)
  if (baseErr) return { ok: false, error: baseErr }
  const titleErr = validateTitle(data.title, 5)
  if (titleErr) return { ok: false, error: titleErr }
  const descErr = validateDesc(data.desc)
  if (descErr) return { ok: false, error: descErr }

  const tags = [
    ['title',   String(data.title).trim().slice(0, 200)],
    ['summary', String(data.desc).trim().slice(0, 2000)],
    ['t',       'plazap2p'],
    ['t',       'plazap2p-evento'],
  ]

  let kind
  if (data.allDay) {
    kind = 31922
    if (!ISO_DATE_RE.test(String(data.startDate || '')))
      return { ok: false, error: 'fecha de inicio requerida (formato AAAA-MM-DD)' }
    tags.push(['start', String(data.startDate)])
    if (data.endDate) {
      if (!ISO_DATE_RE.test(String(data.endDate)))
        return { ok: false, error: 'fecha de fin inválida (formato AAAA-MM-DD)' }
      if (String(data.endDate) <= String(data.startDate))
        return { ok: false, error: 'la fecha de fin debe ser posterior a la de inicio' }
      tags.push(['end', String(data.endDate)])
    }
  } else {
    kind = 31923
    const startTs = Number(data.dateTs)
    if (!Number.isInteger(startTs) || startTs <= 0)
      return { ok: false, error: 'fecha y hora de inicio requeridas' }
    tags.push(['start', String(startTs)])
    if (data.endTs != null && data.endTs !== '') {
      const endTs = Number(data.endTs)
      if (!Number.isInteger(endTs) || endTs <= startTs)
        return { ok: false, error: 'el fin del evento debe ser posterior al inicio' }
      tags.push(['end', String(endTs)])
    }
    // Zona horaria IANA (p.ej. Europe/Madrid) — solo caracteres esperables
    if (data.tzid && /^[\w+\-/]{1,64}$/.test(String(data.tzid)))
      tags.push(['start_tzid', String(data.tzid)])
  }

  if (data.location) tags.push(['location', String(data.location).slice(0, 200)])
  applyCommonOptionalTags(tags, data)

  const { unsignedEvent, dTag: uid } = assembleEvent(kind, tags, String(data.desc) + FOOTER, userPubHex, dTag, publishedAt)
  return { ok: true, unsignedEvent, dTag: uid }
}

// ── buildComunidad ────────────────────────────────────────────────────────────
// Schema: { title, desc, platId, accessUrl, imageUrl }

export function buildComunidad(data, userPubHex, dTag = null, publishedAt = null) {
  const pkErr = validatePubkey(userPubHex)
  if (pkErr) return { ok: false, error: pkErr }
  const baseErr = validateBase(data)
  if (baseErr) return { ok: false, error: baseErr }
  const titleErr = validateTitle(data.title, 3, 80)
  if (titleErr) return { ok: false, error: titleErr }
  const descErr = validateDesc(data.desc, 20, 800)
  if (descErr) return { ok: false, error: descErr }
  if (data.platId && !VALID_PLATS_COMUNIDAD.includes(String(data.platId)))
    return { ok: false, error: `plataforma inválida: ${data.platId}` }

  // Límite de longitud del accessUrl (mismo guard que comunidad.js del bot)
  if (data.accessUrl && String(data.accessUrl).length > 512)
    return { ok: false, error: 'URL de acceso demasiado larga (máximo 512 caracteres)' }

  const content = `${data.title}\n\n${data.desc}${FOOTER}`
  const tags = [
    ['title',   String(data.title).trim().slice(0, 80)],
    ['summary', String(data.desc).trim().slice(0, 800)],
    ['t',       'plazap2p'],
    ['t',       'plazap2p-comunidad'],
    ['t',       String(data.platId || 'otro')],
  ]
  if (data.accessUrl) {
    const safeUrl = validateUrl(String(data.accessUrl))
    if (safeUrl) tags.push(['r', safeUrl])
  }
  applyCommonOptionalTags(tags, { imageUrl: data.imageUrl })

  const { unsignedEvent, dTag: uid } = assembleEvent(30402, tags, content, userPubHex, dTag, publishedAt)
  return { ok: true, unsignedEvent, dTag: uid }
}

// ── buildHerramienta ──────────────────────────────────────────────────────────
// Schema: { title, desc, catId, officialUrl, platforms, imageUrl }

export function buildHerramienta(data, userPubHex, dTag = null, publishedAt = null) {
  const pkErr = validatePubkey(userPubHex)
  if (pkErr) return { ok: false, error: pkErr }
  const baseErr = validateBase(data)
  if (baseErr) return { ok: false, error: baseErr }
  const titleErr = validateTitle(data.title, 2, 80)
  if (titleErr) return { ok: false, error: titleErr }
  const descErr = validateDesc(data.desc, 20, 800)
  if (descErr) return { ok: false, error: descErr }
  if (data.catId && !VALID_CATS_HERRAMIENTA.includes(String(data.catId)))
    return { ok: false, error: `categoría inválida: ${data.catId}` }

  const content = `${data.title}\n\n${data.desc}${FOOTER}`
  const tags = [
    ['title',   String(data.title).trim().slice(0, 80)],
    ['summary', String(data.desc).trim().slice(0, 800)],
    ['t',       'plazap2p'],
    ['t',       'plazap2p-herramienta'],
    ['t',       String(data.catId || 'otro')],
  ]
  if (data.officialUrl) {
    const safeUrl = validateUrl(String(data.officialUrl))
    if (safeUrl) tags.push(['r', safeUrl])
  }
  applyCommonOptionalTags(tags, { imageUrl: data.imageUrl })
  // Normalizar SIEMPRE a minúsculas — bug histórico del bot: los ids llegaban
  // mixed-case y las plataformas nunca se añadían al evento.
  const platforms = Array.isArray(data.platforms) ? data.platforms : []
  for (const p of platforms) {
    const pLower = String(p).toLowerCase()
    if (VALID_PLATFORMS.includes(pLower)) tags.push(['platform', pLower])
  }

  const { unsignedEvent, dTag: uid } = assembleEvent(30402, tags, content, userPubHex, dTag, publishedAt)
  return { ok: true, unsignedEvent, dTag: uid }
}

// ── buildTransaccion ──────────────────────────────────────────────────────────
// Schema: { tipoTag, title, desc, price, currency, alcanceId, imageUrl, contact }
// Sin checkNpubAge: la antigüedad del autor es verificable públicamente por
// cualquiera desde su pubkey (la firma propia sustituye al aval del bot).

export function buildTransaccion(data, userPubHex, dTag = null, publishedAt = null) {
  const pkErr = validatePubkey(userPubHex)
  if (pkErr) return { ok: false, error: pkErr }
  const baseErr = validateBase(data)
  if (baseErr) return { ok: false, error: baseErr }
  const titleErr = validateTitle(data.title, 3, 150)
  if (titleErr) return { ok: false, error: titleErr }
  const descErr = validateDesc(data.desc, 20, 1500)
  if (descErr) return { ok: false, error: descErr }
  if (!VALID_TIPOS_TX.includes(String(data.tipoTag)))
    return { ok: false, error: `tipo inválido: ${data.tipoTag}` }
  if (data.alcanceId && !VALID_ALCANCES.includes(String(data.alcanceId)))
    return { ok: false, error: `alcance inválido: ${data.alcanceId}` }

  const tipoLabel = data.tipoTag === 'plazap2p-venta'  ? '📦 Venta'
                  : data.tipoTag === 'plazap2p-compra' ? '🛒 Compra'
                  : '🔄 Intercambio'
  const priceStr = data.price && data.currency
    ? `${data.price} ${data.currency}`
    : (data.price ?? '')
  const alcanceClean = String(data.alcanceId || '').trim()

  let content = String(data.desc)
  content += `\n\n---\n${tipoLabel} publicado vía PlazaP2P\n`
  if (priceStr)     content += `Precio: ${priceStr}\n`
  if (alcanceClean) content += `Zona: ${alcanceClean}\n`
  content += `⚠️ Verifica la reputación antes de operar`

  const tags = [
    ['title',   String(data.title).trim().slice(0, 150)],
    ['summary', String(data.desc).trim().slice(0, 1500)],
    ['t',       'plazap2p'],
    ['t',       String(data.tipoTag)],
  ]
  if (data.price && data.currency) tags.push(['price', String(data.price), String(data.currency)])
  else if (data.price)             tags.push(['price', String(data.price)])
  if (alcanceClean) tags.push(['location', alcanceClean])
  applyCommonOptionalTags(tags, data)

  const { unsignedEvent, dTag: uid } = assembleEvent(30402, tags, content, userPubHex, dTag, publishedAt)
  return { ok: true, unsignedEvent, dTag: uid }
}

// ── buildValoracion — kind 1985 (NIP-32) ─────────────────────────────────────
// Port de publishLabel (bot/src/nostr.js) firmado por el usuario.
// Sin tag proof (existía para trazar el Telegram ID; aquí el autor es el rater
// real). Kind 1985 NO es addressable: sin d-tag ni status.
// aspects: { comunicacion: 5, cumplimiento: 4, ... } — ids de config.json

export function buildValoracion({ rateeHex, rating, comment = '', aspects = {} }, userPubHex) {
  const pkErr = validatePubkey(userPubHex)
  if (pkErr) return { ok: false, error: pkErr }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return { ok: false, error: 'la puntuación debe ser un entero de 1 a 5' }
  if (!/^[0-9a-f]{64}$/i.test(String(rateeHex || '')))
    return { ok: false, error: 'pubkey del valorado inválida' }
  if (String(rateeHex).toLowerCase() === String(userPubHex).toLowerCase())
    return { ok: false, error: 'no puedes valorarte a ti mismo' }

  const tags = [
    ['L', 'plazap2p.reputation'],
    ['l', `rating:${rating}`, 'plazap2p.reputation'],
    ['p', String(rateeHex).toLowerCase()],
    CLIENT_TAG,
  ]
  for (const [id, score] of Object.entries(aspects)) {
    const n = Number(score)
    if (/^[a-z_]{2,30}$/.test(id) && Number.isInteger(n) && n >= 1 && n <= 5)
      tags.push(['l', `aspecto/${id}:${n}`, 'plazap2p.reputation'])
  }

  return {
    ok: true,
    unsignedEvent: {
      kind: 1985,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: String(comment || '').slice(0, 500),
      pubkey: String(userPubHex).toLowerCase(),
    },
  }
}

// ── buildRetirada — kind 5 (NIP-09) ──────────────────────────────────────────
// Solicita el borrado de un anuncio propio. Se usa JUNTO a la republicación
// con status:inactive (no todos los relays honran kind 5).

export function buildRetirada({ kind, dTag, eventId }, userPubHex) {
  const pkErr = validatePubkey(userPubHex)
  if (pkErr) return { ok: false, error: pkErr }
  if (!Number.isInteger(kind) || !dTag) return { ok: false, error: 'referencia de anuncio inválida' }

  const tags = [['a', `${kind}:${String(userPubHex).toLowerCase()}:${dTag}`]]
  if (eventId && /^[0-9a-f]{64}$/i.test(eventId)) tags.push(['e', String(eventId).toLowerCase()])

  return {
    ok: true,
    unsignedEvent: {
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: 'Anuncio retirado por el autor (PlazaP2P)',
      pubkey: String(userPubHex).toLowerCase(),
    },
  }
}

// ── helper compartido para tags opcionales image/contact ────────────────────

function applyCommonOptionalTags(tags, data) {
  const safeImg = data.imageUrl ? validateUrl(String(data.imageUrl)) : null
  if (safeImg) tags.push(['image', safeImg])
  if (data.price && data.currency && !tags.some(t => t[0] === 'price')) {
    tags.push(['price', String(data.price), String(data.currency)])
  } else if (data.price && !data.currency && !tags.some(t => t[0] === 'price')) {
    tags.push(['price', String(data.price)])
  }
  if (data.contact) {
    const safe = sanitizeContact(String(data.contact))
    if (safe) tags.push(['contact', safe])
  }
}
