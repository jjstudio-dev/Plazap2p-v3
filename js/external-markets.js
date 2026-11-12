// external-markets.js — mercados Nostr externos compatibles (Mercasats y derivados)
//
// Mercasats (https://github.com/Kilombino/mercasats) publica sus anuncios como
// clasificados NIP-99 (kind 30402) con la etiqueta `t mercasats`. PlazaP2P:
//   - los LEE y los enseña en el Mercado con la marca «vía Mercasats»;
//   - ENVÍA sus propios anuncios (y sus retiradas) también a los relays
//     públicos de ese mercado, para que estén donde se mueve esa comunidad.
// Mercasats no lee anuncios de Nostr (los recoge de su web y de Telegram):
// estar en su relay no hace que salgan en su web.
//
// Un derivado (fork) que conserve la etiqueta entra solo; uno que la cambie se
// añade en data/config.json → external_markets sin tocar código.

import { normalizeRelayUrl } from './outbox.js'

/** Lo que se usa si la configuración no trae (o trae mal) `external_markets`. */
export const DEFAULT_EXTERNAL_MARKETS = Object.freeze([
  Object.freeze({
    id: 'mercasats',
    tag: 'mercasats',
    label: 'Mercasats',
    url: 'https://mercasats.kilombino.com',
    // trobades.kilombino.com también lo usa Mercasats, pero exige autenticación
    // (relay de comunidad): no acepta eventos de fuera.
    relays: Object.freeze(['wss://relay.kilombino.com', 'wss://relay.minibolt.info']),
  }),
])

/** Máximo de relays de mercados externos a los que se envía cada anuncio. */
export const MAX_MARKET_RELAYS = 4

const TAG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/
const ID_RE = /^[a-z0-9-]{1,40}$/

function cleanMarket(raw) {
  if (!raw || typeof raw !== 'object') return null
  const tag = typeof raw.tag === 'string' ? raw.tag.trim().toLowerCase() : ''
  if (!TAG_RE.test(tag) || tag.startsWith('plazap2p')) return null
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : tag
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 40) : tag
  let url = null
  try {
    const u = new URL(raw.url)
    if (u.protocol === 'https:' && !u.username && !u.password) url = u.origin
  } catch { /* sin web: el anuncio se enseña igual, sin enlace */ }
  const relays = [...new Set((Array.isArray(raw.relays) ? raw.relays : []).map(normalizeRelayUrl).filter(Boolean))]
  return { id, tag, label, url, relays }
}

/** Mercados válidos de la configuración, o los de por defecto. */
export function externalMarketsFrom(config) {
  const raw = config?.external_markets
  if (!Array.isArray(raw)) return DEFAULT_EXTERNAL_MARKETS
  const seen = new Set()
  const out = []
  for (const m of raw.map(cleanMarket)) {
    if (!m || seen.has(m.tag)) continue
    seen.add(m.tag)
    out.push(m)
  }
  return out
}

/** Etiquetas `t` que hay que pedir a los relays para el canal Mercado. */
export function marketTags(markets) {
  return markets.map(m => m.tag)
}

/**
 * El mercado externo de un anuncio, o null. Un anuncio con etiquetas de
 * PlazaP2P es de PlazaP2P aunque además lleve la de otro mercado.
 */
export function marketOf(tTags, markets) {
  const tags = (tTags || []).map(t => String(t).toLowerCase())
  if (tags.some(t => t.startsWith('plazap2p'))) return null
  return markets.find(m => tags.includes(m.tag)) || null
}

/** Mercasats es un mercado de compraventa: todo es venta salvo los servicios. */
export function externalCategory(tTags) {
  const tags = (tTags || []).map(t => String(t).toLowerCase())
  return tags.includes('serveis') || tags.includes('servicios') || tags.includes('servicio') ? 'servicio' : 'venta'
}

/** Mercasats escribe la moneda `SAT` o `sats`; PlazaP2P usa `SATS`. */
export function normalizeCurrency(currency) {
  const c = String(currency || '').trim()
  if (/^(sat|sats|satoshis?)$/i.test(c)) return 'SATS'
  if (/^(eur|usd|btc)$/i.test(c)) return c.toUpperCase()
  return c.slice(0, 10)
}

/**
 * Enlace al anuncio en la web del mercado: la etiqueta `r` o, si no la hay, la
 * primera URL del texto que sea de esa web. null si no hay ninguna.
 */
export function marketListingUrl(event, market) {
  if (!market?.url) return null
  const sameSite = (raw) => {
    try {
      const u = new URL(raw)
      return u.protocol === 'https:' && u.origin === market.url ? u.href : null
    } catch { return null }
  }
  for (const t of event?.tags || []) {
    if (Array.isArray(t) && t[0] === 'r') {
      const ok = sameSite(t[1])
      if (ok) return ok
    }
  }
  for (const m of String(event?.content || '').matchAll(/https:\/\/[^\s<>"')]+/g)) {
    const ok = sameSite(m[0])
    if (ok) return ok
  }
  return null
}

/**
 * Pubkey del vendedor que el mercado dice representar (`p <hex> <relay> seller`)
 * cuando el anuncio lo firma la cuenta del propio mercado. null si lo firma
 * el vendedor o no hay etiqueta.
 */
export function proxiedSeller(event) {
  const p = (event?.tags || []).find(t => Array.isArray(t) && t[0] === 'p' && t[3] === 'seller')
  const pk = p?.[1]
  return typeof pk === 'string' && pk !== event.pubkey ? pk : null
}

/**
 * ¿Lo firma la cuenta del mercado en nombre de otro vendedor? Mercasats lo hace
 * con los anuncios que llegan de Telegram (buildMarketplaceEvent): llevan la
 * etiqueta `r` con el enlace a su web, y a veces `p … seller`. Los que firma
 * el vendedor desde la web de Mercasats no llevan ninguna de las dos.
 */
export function isMarketSigned(event, market) {
  if (proxiedSeller(event)) return true
  if (!market?.url) return false
  return (event?.tags || []).some(t => {
    if (!Array.isArray(t) || t[0] !== 'r') return false
    try { return new URL(t[1]).origin === market.url } catch { return false }
  })
}

/** ¿Hay que mandar también este evento a los relays de los mercados externos? */
export function isMarketEvent(event) {
  if (!event) return false
  if (event.kind === 30402) return true
  // La petición de borrado de un anuncio: si no, en esos relays quedaría vivo.
  return event.kind === 5 && (event.tags || []).some(t => Array.isArray(t) && t[0] === 'a' && String(t[1]).startsWith('30402:'))
}

/** Relays de mercados externos (sin los que ya usa PlazaP2P), hasta MAX_MARKET_RELAYS. */
export function marketRelays(markets, exclude = []) {
  const skip = new Set(exclude.map(normalizeRelayUrl).filter(Boolean))
  const out = []
  for (const m of markets) {
    for (const url of m.relays) {
      if (skip.has(url)) continue
      skip.add(url)
      out.push(url)
      if (out.length >= MAX_MARKET_RELAYS) return out
    }
  }
  return out
}
