// config-loader.js — Carga de data/config.json para index.html y publicar.html (W-02).
//
// Antes cada página tenía su propia copia: app.js aplicaba la configuración
// firmada (PZ-F1-01) y publicar-app.js se creía el JSON servido tal cual, con
// otra lista de relays de reserva. Aquí vive una sola versión: la URL va
// versionada, el contenido pasa por trustServedConfig() y, si algo falla, se
// usan los mismos relays de reserva en ambas páginas.

import { trustServedConfig } from './signed-config.js'

/** Relays de reserva cuando no hay config.json (los usan las dos páginas). */
export const FALLBACK_RELAYS = [
  'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io',
  'wss://nostr.mom',
]

/** Configuración mínima de index.html si no se puede leer el archivo. */
export const FALLBACK_CONFIG = {
  community_tags: ['plazap2p'],
  relays: [...FALLBACK_RELAYS],
  channels: [
    { id: 'mercado',   kinds: [30402], label: 'Mercado',   icon: '🛒' },
    { id: 'feed',      kinds: [1],     label: 'Feed',      icon: '💬' },
    { id: 'articulos', kinds: [30023], label: 'Artículos', icon: '📄' },
    { id: 'eventos',   kinds: [31922, 31923], label: 'Eventos', icon: '📅' },
  ],
  refresh_interval_ms: 300000,
  categories: [
    { id: 'venta',    label: 'Venta',    color: '#00d4ff' },
    { id: 'compra',   label: 'Compra',   color: '#30d158' },
    { id: 'servicio', label: 'Servicio', color: '#bf5af2' },
    { id: 'trueque',  label: 'Intercambio',  color: '#ffd60a' },
  ],
  publish_clients: [], nostr_clients: [], wallets: [],
}

/** Configuración mínima de publicar.html si no se puede leer el archivo. */
export const FALLBACK_PUBLISH_CONFIG = {
  relays: [...FALLBACK_RELAYS],
  ratings: { aspects: [] },
}

/** URL de la configuración con el mismo número de versión que los assets. */
export function configUrl(version) {
  const v = String(version ?? '').trim()
  return v ? `data/config.json?v=${encodeURIComponent(v)}` : 'data/config.json'
}

/**
 * Descarga y aplica la configuración servida. Devuelve siempre un objeto
 * utilizable: si la red, el JSON o los relays fallan, devuelve `fallback`.
 */
export async function loadServedConfig({
  version = '',
  timeoutMs = 0,
  fallback = FALLBACK_CONFIG,
  fetchImpl = globalThis.fetch,
  storage,
} = {}) {
  const url = configUrl(version)
  const ctrl = timeoutMs > 0 ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = await res.text()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('config ilegible')
    if (!Array.isArray(parsed.relays) || parsed.relays.length === 0) parsed.relays = [...FALLBACK_RELAYS]
    // PZ-F1-01: sin firma del mantenedor no se aplican los campos sensibles.
    return trustServedConfig(raw, parsed, storage)
  } catch (err) {
    console.error(`[config] No se pudo cargar ${url}, usando mínimos:`, err)
    return { ...fallback, relays: [...FALLBACK_RELAYS] }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
