// signed-config.js — Configuración firmada por el mantenedor (PZ-F1-01, mismo esquema que la app
// Android: config/SignedMaintainerData.kt).
//
// El mantenedor publica el contenido de data/config.json como evento Nostr kind 30078 (NIP-78)
// con d = "plazap2p-config", firmado con su clave. Sin esa firma, quien controle la cuenta de
// GitHub decidiría a qué instancias de intercambio se marca "de confianza". El config.json del
// propio servidor sigue sirviendo para arrancar (relays), pero sus campos sensibles solo se
// aplican si es idéntico al último contenido firmado que vio este navegador.
// Procedimiento de firma: tools/publicar-config.md.

import { collectUntilEose, validateSignedEvent } from './relay-pool.js'

export const MAINTAINER_PUBKEY = 'e67420a604251e691eeb5584879b67ae4fe475749b9d25b8edf29d8b95cfbd46'
export const MAINTAINER_DATA_KIND = 30078
export const CONFIG_D_TAG = 'plazap2p-config'
const STORAGE_KEY = 'plazap2p_signed_config'

/** Campos que solo cuentan si la configuración va firmada. */
const SENSITIVE_KEYS = ['moderator_pubkeys', 'blossom_server', 'support_url', 'proposal_url', 'donation_url']

/**
 * El evento más reciente del mantenedor para ese d, o null. Se vuelve a comprobar todo (kind,
 * autor, etiqueta d, firma) aunque el pool ya lo haga.
 */
export function selectMaintainerEvent(events, dTag, maintainer = MAINTAINER_PUBKEY, verify = validateSignedEvent) {
  let best = null
  for (const ev of events) {
    if (!ev || ev.kind !== MAINTAINER_DATA_KIND) continue
    if (typeof ev.pubkey !== 'string' || ev.pubkey.toLowerCase() !== maintainer) continue
    if (!Array.isArray(ev.tags) || !ev.tags.some(t => t[0] === 'd' && t[1] === dTag)) continue
    if (!verify(ev)) continue
    if (!best || ev.created_at > best.created_at || (ev.created_at === best.created_at && ev.id < best.id)) best = ev
  }
  return best
}

/** Configuración sin firma: se quitan los campos sensibles y la lista de instancias de confianza. */
export function restrictUntrusted(config) {
  const copy = { ...config, trusted: false }
  for (const key of SENSITIVE_KEYS) delete copy[key]
  if (copy.intercambio && typeof copy.intercambio === 'object') {
    copy.intercambio = { ...copy.intercambio, trustedMostroInstances: [] }
  }
  // La clave que firma no la puede cambiar la propia configuración.
  copy.maintainer_pubkey = MAINTAINER_PUBKEY
  return copy
}

/** Con el almacenamiento bloqueado, solo leer `localStorage` ya lanza SecurityError. */
function defaultStorage() {
  try { return globalThis.localStorage } catch { return null }
}

function lastSignedContent(storage) {
  try { return storage?.getItem(STORAGE_KEY) ?? null } catch { return null }
}

/** Aplica la regla al JSON servido junto a la web (texto crudo, tal cual llegó). */
export function trustServedConfig(rawText, parsed, storage = defaultStorage()) {
  const signed = lastSignedContent(storage)
  if (signed !== null && signed === rawText) return { ...parsed, trusted: true }
  return restrictUntrusted(parsed)
}

/**
 * Busca la configuración firmada en los relays. Devuelve el objeto ya parseado (trusted = true) o
 * null si no hay ninguna válida. Guarda el contenido para reconocerlo en la próxima carga.
 */
export async function fetchSignedConfig(pool, { timeoutMs = 6000, storage = defaultStorage() } = {}) {
  const events = []
  await collectUntilEose(
    pool,
    [{ kinds: [MAINTAINER_DATA_KIND], authors: [MAINTAINER_PUBKEY], '#d': [CONFIG_D_TAG], limit: 5 }],
    { timeoutMs, prefix: 'cfg', onEvent(ev) { events.push(ev) } },
  )
  const best = selectMaintainerEvent(events, CONFIG_D_TAG)
  if (!best) return null
  let parsed
  try { parsed = JSON.parse(best.content) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  try { storage?.setItem(STORAGE_KEY, best.content) } catch { /* modo privado: no pasa nada */ }
  return { ...parsed, maintainer_pubkey: MAINTAINER_PUBKEY, trusted: true }
}
