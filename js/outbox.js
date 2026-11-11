// outbox.js — F7-04 (NIP-65, modelo «outbox»)
//
// Muchas apps Nostr (Amethyst, Coracle, Primal…) buscan lo que publica cada
// persona en SUS relays de escritura, los de su lista kind 10002, no en los
// de PlazaP2P. Tras publicar en los relays de la configuración, el evento se
// manda también a esos relays para que esas apps lo encuentren.

/** Máximo de relays propios a los que se reenvía (no inundar la red). */
export const MAX_OUTBOX_RELAYS = 4

const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)|\.(local|onion|internal)$/i

/** wss://host[/ruta] normalizado (sin barra final, host en minúsculas) o null. */
export function normalizeRelayUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 256) return null
  let u
  try { u = new URL(raw.trim()) } catch { return null }
  if (u.protocol !== 'wss:' || u.username || u.password || u.search || u.hash) return null
  if (PRIVATE_HOST_RE.test(u.hostname)) return null
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')
  return `wss://${u.host.toLowerCase()}${path}`
}

/**
 * Relays de escritura de una lista kind 10002: etiquetas `r` sin marcador o
 * con marcador `write` (las `read` son para leer, no para publicar). Se
 * quitan los que ya están en `exclude` (los de la configuración) y los
 * repetidos, hasta MAX_OUTBOX_RELAYS.
 */
export function writeRelaysFrom(event, exclude = []) {
  if (!event || event.kind !== 10002 || !Array.isArray(event.tags)) return []
  const skip = new Set(exclude.map(normalizeRelayUrl).filter(Boolean))
  const out = []
  for (const t of event.tags) {
    if (!Array.isArray(t) || t[0] !== 'r') continue
    if (t[2] && t[2] !== 'write') continue
    const url = normalizeRelayUrl(t[1])
    if (!url || skip.has(url)) continue
    skip.add(url)
    out.push(url)
    if (out.length >= MAX_OUTBOX_RELAYS) break
  }
  return out
}
