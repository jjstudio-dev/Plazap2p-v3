// publish.js — Capa de publicación: objeto de datos → eventos Nostr + persistencia KV
//
// Esta capa es el PUENTE entre el bot (wizards conversacionales) y la futura Mini App
// (formularios web que envían datos via Telegram.WebApp.sendData).
// Ambos llaman a las mismas funciones con el mismo schema de datos.
//
// Schemas documentados con JSDoc — la Mini App debe seguir el mismo contrato.

import { publishEvent } from './nostr.js'
import { hashTelegramId, sanitizeContact, validateUrl } from './utils.js'

const CLIENT_URL_FALLBACK = 'https://jjstudio-dev.github.io/Plazap2p-v3/'
function getClientTag(env) {
  const url = env?.MINI_APP_URL || CLIENT_URL_FALLBACK
  return ['client', 'PlazaP2P Bot', url]
}

const VALID_CATS_SERVICIO    = ['consultoria', 'diseno', 'desarrollo', 'educacion', 'marketing', 'otros']
const VALID_PLATS_COMUNIDAD  = ['telegram', 'nostr', 'matrix', 'discord', 'otro']
const VALID_CATS_HERRAMIENTA = ['wallet', 'nostr', 'seguridad', 'lightning', 'educacion', 'otro']
const VALID_TIPOS_TX         = ['plazap2p-venta', 'plazap2p-compra', 'plazap2p-intercambio']
const VALID_ALCANCES         = ['local', 'nacional', 'internacional', 'online']

// ── Helpers internos ──────────────────────────────────────────────────────────

/**
 * Guarda un resumen de la publicación en KV para mostrar en /misanuncios.
 * Mantiene un historial de las 10 últimas publicaciones del usuario (TTL 90 días).
 * Falla en silencio para no bloquear el flujo principal de publicación.
 */
async function savePub(env, userId, { naddr, title, kind }) {
  if (!naddr || !env?.KV_BOT) return
  try {
    const key    = `pub:${userId}`
    const raw    = await env.KV_BOT.get(key)
    let list     = []
    if (raw) {
      const parsed = JSON.parse(raw)
      list = Array.isArray(parsed) ? parsed : []
    }
    list.unshift({ naddr, title: String(title).slice(0, 60), ts: Date.now(), kind })
    if (list.length > 10) list.splice(10)
    await env.KV_BOT.put(key, JSON.stringify(list), { expirationTtl: 7776000 })
  } catch (e) { console.warn('[savePub]', e.message) }
}

/** Valida que `data` sea un objeto no nulo. Retorna mensaje de error o null si OK. */
function validateBase(data) {
  if (!data || typeof data !== 'object') return 'datos inválidos'
  return null
}

/**
 * Valida longitud del título.
 * El `min` varía por tipo de publicación (2 para herramienta, 3 para comunidad, 5 para servicio/evento).
 * Retorna mensaje de error o null si OK.
 */
function validateTitle(title, min = 3, max = 200) {
  if (!title || typeof title !== 'string') return 'título requerido'
  const t = title.trim()
  if (t.length < min) return `título demasiado corto (mínimo ${min} caracteres)`
  if (t.length > max) return `título demasiado largo (máximo ${max} caracteres)`
  return null
}

/** Valida longitud de la descripción. Retorna mensaje de error o null si OK. */
function validateDesc(desc, min = 10, max = 2000) {
  if (!desc || typeof desc !== 'string') return 'descripción requerida'
  const d = desc.trim()
  if (d.length < min) return `descripción demasiado corta (mínimo ${min} caracteres)`
  if (d.length > max) return `descripción demasiado larga (máximo ${max} caracteres)`
  return null
}

// ── publishServicio ───────────────────────────────────────────────────────────
//
// Schema (Mini App enviará este JSON via sendData):
// {
//   type: 'servicio',
//   title: string,          // 5-200 chars
//   desc: string,           // 10-2000 chars
//   catId: string,          // 'consultoria'|'diseno'|'desarrollo'|'educacion'|'marketing'|'otros'
//   imageUrl: string|null,
//   price: string|null,     // "50" / "0.001"
//   currency: string|null,  // 'EUR'|'USD'|'BTC'|'SATS'
//   alias: string|null,     // display name, max 100 chars
//   contact: string|null,   // pre-sanitized, max 200 chars
// }

export async function publishServicio(data, botNsec, env, userId, userPubHex = null) {
  const baseErr  = validateBase(data)
  if (baseErr)  return { ok: false, error: baseErr }
  const titleErr = validateTitle(data.title, 5)
  if (titleErr) return { ok: false, error: titleErr }
  const descErr  = validateDesc(data.desc)
  if (descErr)  return { ok: false, error: descErr }
  if (data.catId && !VALID_CATS_SERVICIO.includes(String(data.catId)))
    return { ok: false, error: `categoría inválida: ${data.catId}` }

  const idHash  = await hashTelegramId(userId)
  const alias   = data.alias ? String(data.alias).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100) : null
  const content = String(data.desc) + (alias
    ? `\n\n---\n📢 Publicado vía PlazaP2P Bot · de parte de ${alias}`
    : `\n\n---\n📢 Publicado vía PlazaP2P Bot · ref:${idHash.slice(0, 8)}`)

  const tags = [
    ['title',        String(data.title).trim().slice(0, 200)],
    ['summary',      String(data.desc).trim().slice(0, 2000)],
    ['t',            'plazap2p'],
    ['t',            'plazap2p-servicio'],
    ['service_type', String(data.catId || 'otros')],
    getClientTag(env),
    ['tg-ref',       idHash.slice(0, 16)],
  ]
  const safeImgS = data.imageUrl ? validateUrl(String(data.imageUrl)) : null
  if (safeImgS)                    tags.push(['image',   safeImgS])
  if (data.price && data.currency) tags.push(['price',   String(data.price), String(data.currency)])
  else if (data.price)             tags.push(['price',   String(data.price)])
  if (data.contact)                tags.push(['contact', sanitizeContact(String(data.contact))])
  if (alias)                       tags.push(['proxy',   alias, 'plazap2p-bot'])

  try {
    const result = await publishEvent(botNsec, tags, content, 30402, userPubHex)
    await savePub(env, userId, { naddr: result.naddr, title: data.title, kind: 30402 })
    return { ok: true, ...result }
  } catch (e) { return { ok: false, error: e.message } }
}

// ── publishEvento ─────────────────────────────────────────────────────────────
//
// Schema:
// {
//   type: 'evento',
//   title: string,          // 5-200 chars
//   desc: string,           // 10-2000 chars
//   imageUrl: string|null,
//   dateTs: number|null,    // unix timestamp
//   location: string|null,  // max 200 chars
//   alias: string|null,
//   contact: string|null,
// }

export async function publishEvento(data, botNsec, env, userId, userPubHex = null) {
  const baseErr  = validateBase(data)
  if (baseErr)  return { ok: false, error: baseErr }
  const titleErr = validateTitle(data.title, 5)
  if (titleErr) return { ok: false, error: titleErr }
  const descErr  = validateDesc(data.desc)
  if (descErr)  return { ok: false, error: descErr }

  const idHash  = await hashTelegramId(userId)
  const alias   = data.alias ? String(data.alias).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100) : null
  const content = String(data.desc) + (alias
    ? `\n\n---\n📢 Publicado vía PlazaP2P Bot · de parte de ${alias}`
    : `\n\n---\n📢 Publicado vía PlazaP2P Bot · ref:${idHash.slice(0, 8)}`)

  const tags = [
    ['title',   String(data.title).trim().slice(0, 200)],
    ['summary', String(data.desc).trim().slice(0, 2000)],
    ['t',       'plazap2p'],
    ['t',       'plazap2p-evento'],
    getClientTag(env),
    ['tg-ref',  idHash.slice(0, 16)],
  ]
  const safeImgE = data.imageUrl ? validateUrl(String(data.imageUrl)) : null
  if (safeImgE)                                           tags.push(['image',    safeImgE])
  if (data.dateTs && Number.isInteger(Number(data.dateTs))) tags.push(['start',  String(data.dateTs)])
  if (data.location)                                      tags.push(['location', String(data.location).slice(0, 200)])
  if (data.contact)                                       tags.push(['contact',  sanitizeContact(String(data.contact))])
  if (alias)                                              tags.push(['proxy',    alias, 'plazap2p-bot'])

  try {
    const result = await publishEvent(botNsec, tags, content, 31922, userPubHex)
    await savePub(env, userId, { naddr: result.naddr, title: data.title, kind: 31922 })
    return { ok: true, ...result }
  } catch (e) { return { ok: false, error: e.message } }
}

// ── publishComunidad ──────────────────────────────────────────────────────────
//
// Schema:
// {
//   type: 'comunidad',
//   title: string,          // 3-80 chars
//   desc: string,           // 20-800 chars
//   platId: string,         // 'telegram'|'nostr'|'matrix'|'discord'|'otro'
//   accessUrl: string|null, // validated https/http URL
//   imageUrl: string|null,
// }

export async function publishComunidad(data, botNsec, env, userId, userPubHex = null) {
  const baseErr  = validateBase(data)
  if (baseErr)  return { ok: false, error: baseErr }
  const titleErr = validateTitle(data.title, 3, 80)
  if (titleErr) return { ok: false, error: titleErr }
  const descErr  = validateDesc(data.desc, 20, 800)
  if (descErr)  return { ok: false, error: descErr }
  if (data.platId && !VALID_PLATS_COMUNIDAD.includes(String(data.platId)))
    return { ok: false, error: `plataforma inválida: ${data.platId}` }

  const idHash       = await hashTelegramId(userId)
  const isPerfilMode = !!userPubHex
  const content      = `${data.title}\n\n${data.desc}` +
    (isPerfilMode
      ? `\n\n---\n🏘 Publicado vía PlazaP2P Bot`
      : `\n\n---\n🏘 Publicado vía PlazaP2P Bot · ref:${idHash.slice(0, 8)}`)

  const tags = [
    ['title',   String(data.title).trim().slice(0, 80)],
    ['summary', String(data.desc).trim().slice(0, 800)],
    ['t',       'plazap2p'],
    ['t',       'plazap2p-comunidad'],
    ['t',       String(data.platId || 'otro')],
    getClientTag(env),
    ['tg-ref',  idHash.slice(0, 16)],
  ]
  if (data.accessUrl) {
    const safeUrl = validateUrl(String(data.accessUrl))
    if (safeUrl) tags.push(['r', safeUrl])
  }
  const safeImgC = data.imageUrl ? validateUrl(String(data.imageUrl)) : null
  if (safeImgC) tags.push(['image', safeImgC])

  try {
    const result = await publishEvent(botNsec, tags, content, 30402, userPubHex)
    await savePub(env, userId, { naddr: result.naddr, title: data.title, kind: 30402 })
    return { ok: true, ...result }
  } catch (e) { return { ok: false, error: e.message } }
}

// ── publishHerramienta ────────────────────────────────────────────────────────
//
// Schema:
// {
//   type: 'herramienta',
//   title: string,          // 2-80 chars
//   desc: string,           // 20-800 chars
//   catId: string,          // 'wallet'|'nostr'|'seguridad'|'lightning'|'educacion'|'otro'
//   officialUrl: string|null,
//   platforms: string[],    // subset of ['web','android','ios','desktop']
// }

export async function publishHerramienta(data, botNsec, env, userId, userPubHex = null) {
  const baseErr  = validateBase(data)
  if (baseErr)  return { ok: false, error: baseErr }
  const titleErr = validateTitle(data.title, 2, 80)
  if (titleErr) return { ok: false, error: titleErr }
  const descErr  = validateDesc(data.desc, 20, 800)
  if (descErr)  return { ok: false, error: descErr }
  if (data.catId && !VALID_CATS_HERRAMIENTA.includes(String(data.catId)))
    return { ok: false, error: `categoría inválida: ${data.catId}` }

  const idHash  = await hashTelegramId(userId)
  const content = `${data.title}\n\n${data.desc}\n\n---\n🔧 Publicado vía PlazaP2P Bot · ref:${idHash.slice(0, 8)}`

  const tags = [
    ['title',   String(data.title).trim().slice(0, 80)],
    ['summary', String(data.desc).trim().slice(0, 800)],
    ['t',       'plazap2p'],
    ['t',       'plazap2p-herramienta'],
    ['t',       String(data.catId || 'otro')],
    getClientTag(env),
    ['tg-ref',  idHash.slice(0, 16)],
  ]
  if (data.officialUrl) {
    const safeUrl = validateUrl(String(data.officialUrl))
    if (safeUrl) tags.push(['r', safeUrl])
  }
  const safeImgH = data.imageUrl ? validateUrl(String(data.imageUrl)) : null
  if (safeImgH) tags.push(['image', safeImgH])
  const VALID_PLATFORMS = ['web', 'android', 'ios', 'desktop', 'terminal']
  const platforms = Array.isArray(data.platforms) ? data.platforms : []
  for (const p of platforms) {
    const pLower = String(p).toLowerCase()
    if (VALID_PLATFORMS.includes(pLower)) tags.push(['platform', pLower])
  }

  try {
    const result = await publishEvent(botNsec, tags, content, 30402, userPubHex)
    await savePub(env, userId, { naddr: result.naddr, title: data.title, kind: 30402 })
    return { ok: true, ...result }
  } catch (e) { return { ok: false, error: e.message } }
}

// ── publishTransaccion ────────────────────────────────────────────────────────
//
// Schema:
// {
//   type: 'venta'|'compra'|'intercambio',
//   tipoTag: string,        // 'plazap2p-venta'|'plazap2p-compra'|'plazap2p-intercambio'
//   title: string,          // 3-150 chars
//   desc: string,           // 20-1500 chars
//   price: string|null,     // numeric string or "A negociar"
//   currency: string|null,  // 'EUR'|'USD'|'BTC'|'SATS'
//   alcanceId: string,      // 'local'|'nacional'|'internacional'|'online'
//   alcanceLabel: string,   // human-readable label (e.g. "🌍 Internacional")
//   imageUrl: string|null,
//   contact: string|null,   // pre-validated: @alias, email, or npub
//   ageDays: number|null,   // npub age verification result
// }
// NOTA: userPubHex es requerido — transacciones solo disponibles en Modo Perfil

export async function publishTransaccion(data, botNsec, env, userId, userPubHex) {
  const baseErr  = validateBase(data)
  if (baseErr)  return { ok: false, error: baseErr }

  // userPubHex es obligatorio y debe ser hex válido de 64 chars
  if (!userPubHex || !/^[0-9a-f]{64}$/.test(String(userPubHex)))
    return { ok: false, error: 'transacciones requieren identidad Nostr verificada (Modo Perfil)' }

  const titleErr = validateTitle(data.title, 3, 150)
  if (titleErr) return { ok: false, error: titleErr }
  const descErr  = validateDesc(data.desc, 20, 1500)
  if (descErr)  return { ok: false, error: descErr }
  if (!VALID_TIPOS_TX.includes(String(data.tipoTag)))
    return { ok: false, error: `tipo inválido: ${data.tipoTag}` }
  if (data.alcanceId && !VALID_ALCANCES.includes(String(data.alcanceId)))
    return { ok: false, error: `alcance inválido: ${data.alcanceId}` }

  const idHash    = await hashTelegramId(userId)
  const tipoLabel = data.tipoTag === 'plazap2p-venta'       ? '📦 Venta'
                  : data.tipoTag === 'plazap2p-compra'      ? '🛒 Compra'
                  : '🔄 Intercambio'
  const priceStr  = data.price && data.currency
    ? `${data.price} ${data.currency}`
    : (data.price ?? '')
  // alcanceId ya validado contra VALID_ALCANCES — usarlo directamente para el tag
  const alcanceClean = String(data.alcanceId || '').trim()

  let content = String(data.desc)
  content += `\n\n---\n${tipoLabel} publicado vía PlazaP2P Bot\n`
  if (priceStr)    content += `Precio: ${priceStr}\n`
  if (alcanceClean) content += `Zona: ${alcanceClean}\n`
  content += `⚠️ Verifica la reputación antes de operar`

  const tags = [
    ['title',   String(data.title).trim().slice(0, 150)],
    ['summary', String(data.desc).trim().slice(0, 1500)],
    ['t',       'plazap2p'],
    ['t',       String(data.tipoTag)],
    getClientTag(env),
    ['tg-ref',  idHash.slice(0, 16)],
  ]
  if (data.price && data.currency) tags.push(['price',    String(data.price), String(data.currency)])
  else if (data.price)             tags.push(['price',    String(data.price)])
  tags.push(['location', alcanceClean || String(data.alcanceId || '')])
  const safeImgT = data.imageUrl ? validateUrl(String(data.imageUrl)) : null
  if (safeImgT) tags.push(['image', safeImgT])
  if (data.contact)  tags.push(['contact', sanitizeContact(String(data.contact))])
  if (data.ageDays != null && Number.isInteger(Number(data.ageDays)))
    tags.push(['npub-age', String(data.ageDays)])

  try {
    const result = await publishEvent(botNsec, tags, content, 30402, userPubHex)
    await savePub(env, userId, { naddr: result.naddr, title: data.title, kind: 30402 })
    return { ok: true, ...result }
  } catch (e) { return { ok: false, error: e.message } }
}
