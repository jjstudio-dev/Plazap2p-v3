// profile.js — Lectura de perfiles Nostr (kind 0, NIP-01) — CODE-033.
//
// Módulo pequeño a propósito: solo parsea metadata y la trae de los relays.
// No decide identidad (eso es signer.js) ni pinta UI (eso lo hace cada
// pantalla) — así se puede cambiar de dónde se leen los perfiles sin tocar
// nada más.

import { collectUntilEose } from './relay-pool.js'

/** Parsea el content (JSON) de un evento kind 0 — pura, testeable sin red. */
export function parseProfileMetadata(event) {
  if (!event || event.kind !== 0) return null
  let meta
  try { meta = JSON.parse(event.content) } catch { return null }
  if (!meta || typeof meta !== 'object') return null
  return {
    name: typeof meta.name === 'string' ? meta.name.slice(0, 80) : null,
    displayName: typeof meta.display_name === 'string' ? meta.display_name.slice(0, 80) : null,
    picture: typeof meta.picture === 'string' && /^https:\/\//i.test(meta.picture) ? meta.picture : null,
    // lud16 (Lightning address) es lo único que necesita el flujo de zaps —
    // lud06 (LNURL bech32 crudo) se acepta pero zaps.js hoy solo resuelve lud16.
    lud16: typeof meta.lud16 === 'string' && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(meta.lud16) ? meta.lud16 : null,
    nip05: typeof meta.nip05 === 'string' ? meta.nip05 : null,
    createdAt: event.created_at,
  }
}

/**
 * Trae el perfil más reciente de una pubkey. Resuelve con `null` si no hay
 * perfil publicado o los relays no responden a tiempo — nunca lanza (un
 * perfil ausente es un estado normal, no un error).
 */
export async function fetchProfileMeta(pool, pubkeyHex, timeoutMs = 6000) {
  if (!pool || !pubkeyHex) return null
  let best = null
  // Todos los relays, no solo el primero en contestar: el más rápido puede
  // no tener el kind 0 (o tener una versión antigua sin lud16).
  await collectUntilEose(pool, [{ kinds: [0], authors: [pubkeyHex], limit: 1 }], {
    timeoutMs,
    prefix: 'profile',
    onEvent(ev) {
      if (ev.kind !== 0 || ev.pubkey !== pubkeyHex) return
      if (best && ev.created_at <= best.createdAt) return
      const parsed = parseProfileMetadata(ev)
      if (parsed) best = parsed
    },
  })
  return best
}
