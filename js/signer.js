// signer.js — Abstracción de firma delegada: NIP-07 (extensión) y NIP-55 web (Amber)
//
// La app NUNCA maneja claves privadas. Construye el evento sin firmar y lo
// delega:
//   - NIP-07 (desktop): window.nostr.signEvent() — resuelve en la misma página.
//   - NIP-55 web (Android/Amber): navegación a nostrsigner:… con callbackUrl;
//     Amber devuelve el resultado como query param al recargar la página.
//     Fallback: sin retorno automático, Amber copia el resultado al
//     portapapeles y el usuario lo pega manualmente.
//
// El estado pendiente (formulario + evento sin firmar) se guarda en
// sessionStorage ANTES de navegar a Amber y se restaura al volver.

import { decodeNpub, hexToNpub } from './nostr.js'
import { verifyEvent } from './vendor/nostr-crypto.js'

const LS_PUBKEY   = 'plazap2p_pubkey'
const SS_PENDING  = 'plazap2p_pending_sign'
const SS_PROCESSED = 'plazap2p_processed_ids'

// Kinds que la app pide pre-autorizar en Amber (evita un prompt por firma)
const AMBER_PERMISSIONS = JSON.stringify([
  { type: 'sign_event', kind: 30402 },
  { type: 'sign_event', kind: 31922 },
  { type: 'sign_event', kind: 31923 },
  { type: 'sign_event', kind: 1985 },
  { type: 'sign_event', kind: 5 },
])

// ── Detección ─────────────────────────────────────────────────────────────────

/** @returns {'nip07'|'nip55'|null} firmador disponible en este entorno */
export function detectSigner() {
  if (typeof window !== 'undefined' && window.nostr) return 'nip07'
  if (/android/i.test(navigator.userAgent)) return 'nip55'
  return null
}

// ── Identidad persistida ──────────────────────────────────────────────────────

/** Pubkey hex guardada, validada, o null. */
export function getStoredPubkey() {
  try {
    const v = localStorage.getItem(LS_PUBKEY)
    return v && /^[0-9a-f]{64}$/.test(v) ? v : null
  } catch { return null }
}

export function storePubkey(hex) {
  if (!/^[0-9a-f]{64}$/i.test(String(hex))) throw new Error('pubkey inválida')
  localStorage.setItem(LS_PUBKEY, String(hex).toLowerCase())
}

export function clearPubkey() {
  try { localStorage.removeItem(LS_PUBKEY) } catch { /* privado/lleno: ignorar */ }
}

/** Acepta npub1... o hex y devuelve hex en minúsculas, o null. */
export function parseToHex(input) {
  const s = String(input || '').trim()
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase()
  if (s.startsWith('npub1')) {
    try { return decodeNpub(s).toLowerCase() } catch { return null }
  }
  return null
}

// ── NIP-07 (extensión de navegador) ───────────────────────────────────────────

export async function nip07GetPubkey() {
  if (!window.nostr) throw new Error('extensión NIP-07 no disponible')
  const hex = await window.nostr.getPublicKey()
  if (!/^[0-9a-f]{64}$/i.test(String(hex))) throw new Error('la extensión devolvió una pubkey inválida')
  return String(hex).toLowerCase()
}

export async function nip07Sign(unsignedEvent) {
  if (!window.nostr) throw new Error('extensión NIP-07 no disponible')
  const signed = await window.nostr.signEvent(unsignedEvent)
  if (!signed?.sig || !signed?.id) throw new Error('la extensión no devolvió un evento firmado')
  return signed
}

// ── NIP-55 web (Amber) ────────────────────────────────────────────────────────

/** URL absoluta de publicar.html para el callback de Amber. */
function callbackBase(extraParam) {
  const url = new URL('publicar.html', window.location.href)
  url.search = ''
  url.hash = ''
  return `${url.href}?${extraParam}&res=`
}

/**
 * Guarda el estado pendiente (para restaurarlo tras el round-trip a Amber).
 * @param {object} pending — { step, unsignedEvent?, formSnapshot?, meta? }
 */
export function savePending(pending) {
  sessionStorage.setItem(SS_PENDING, JSON.stringify({ ...pending, ts: Date.now() }))
}

export function loadPending() {
  try {
    const raw = sessionStorage.getItem(SS_PENDING)
    if (!raw) return null
    const p = JSON.parse(raw)
    // Estado pendiente más viejo de 15 min: descartar (evita replays confusos)
    if (!p.ts || Date.now() - p.ts > 15 * 60_000) { clearPending(); return null }
    return p
  } catch { return null }
}

export function clearPending() {
  try { sessionStorage.removeItem(SS_PENDING) } catch { /* ignorar */ }
}

/**
 * Navega a Amber para obtener la pubkey (get_public_key).
 * DEBE llamarse desde un handler de click (Chrome bloquea custom schemes
 * sin gesto de usuario). No retorna: la página se recarga via callback.
 */
export function amberConnect() {
  savePending({ step: 'pubkey' })
  const uri = 'nostrsigner:?compressionType=none&returnType=signature&type=get_public_key'
    + `&permissions=${encodeURIComponent(AMBER_PERMISSIONS)}`
    + `&callbackUrl=${encodeURIComponent(callbackBase('amber=pubkey'))}`
  window.location.href = uri
}

/**
 * Navega a Amber para firmar un evento (sign_event).
 * El caller debe haber guardado antes el pending completo con savePending().
 */
export function amberSign(unsignedEvent) {
  const npub = hexToNpub(unsignedEvent.pubkey)
  const uri = `nostrsigner:${encodeURIComponent(JSON.stringify(unsignedEvent))}`
    + '?compressionType=none&returnType=event&type=sign_event'
    + (npub ? `&current_user=${npub}` : '')
    + `&callbackUrl=${encodeURIComponent(callbackBase('amber=signed'))}`
  window.location.href = uri
}

/**
 * Parsea el retorno de Amber desde los query params de la URL actual.
 * Amber añade el resultado al final del callbackUrl (param `res`; algunas
 * versiones usan `event`). Devuelve:
 *   { step: 'pubkey', value: '<hex>' }
 *   { step: 'signed', value: {evento firmado} }
 *   null si la URL no es un callback de Amber o el contenido no es válido.
 */
export function parseAmberCallback(searchParams) {
  const step = searchParams.get('amber')
  if (step !== 'pubkey' && step !== 'signed') return null
  const raw = searchParams.get('res') ?? searchParams.get('event')
  if (!raw) return null

  if (step === 'pubkey') {
    const hex = parseToHex(raw.trim())
    return hex ? { step, value: hex } : null
  }
  return parseSignedEventJson(raw)
}

/**
 * Parsea un evento firmado en JSON (del callback o pegado del portapapeles).
 * Estructura mínima verificada; la verificación de integridad contra el
 * pending la hace el caller.
 */
export function parseSignedEventJson(raw) {
  try {
    const ev = JSON.parse(String(raw).trim())
    if (!ev || typeof ev !== 'object') return null
    if (!/^[0-9a-f]{64}$/i.test(ev.id || '') || !/^[0-9a-f]{128}$/i.test(ev.sig || '')) return null
    if (!/^[0-9a-f]{64}$/i.test(ev.pubkey || '') || !Number.isInteger(ev.kind)) return null
    if (!Array.isArray(ev.tags) || typeof ev.content !== 'string') return null
    return { step: 'signed', value: ev }
  } catch { return null }
}

/**
 * Verificación de integridad del round-trip: el evento que firmó Amber debe
 * ser EXACTAMENTE el que enviamos (mismo kind, content y tags). Un mismatch
 * indica manipulación o una carrera entre dos pestañas → abortar.
 */
export function matchesPending(signedEvent, unsignedEvent) {
  if (!signedEvent || !unsignedEvent) return false
  return signedEvent.kind === unsignedEvent.kind
    && signedEvent.content === unsignedEvent.content
    && JSON.stringify(signedEvent.tags) === JSON.stringify(unsignedEvent.tags)
}

// Tolerancia de re-timestamp del firmador (Amber firma minutos después de
// construir el evento; el pending caduca a los 15 min → 30 min cubre el peor
// caso sin permitir eventos backdateados que manipulen semántica replaceable).
const SIGNED_TS_DRIFT_S = 1800

/**
 * SEC-002: verificación completa del evento devuelto por el firmador.
 * Un "evento firmado" pegado del portapapeles o inyectado en el callback de
 * Amber podría tener firma falsa, otro contenido u otra fecha — nada de eso
 * debe llegar a los relays.
 *
 * Códigos de rechazo:
 *   'badsig'    — id/firma Schnorr inválidos (siempre fatal)
 *   'mismatch'  — kind/content/tags distintos de lo enviado a firmar (fatal)
 *   'timestamp' — created_at fuera de tolerancia (fatal)
 *   'pubkey'    — firma criptográficamente válida pero de OTRA identidad;
 *                 el caller decide (flujo de cambio de cuenta con confirmación)
 *
 * @returns {{ ok: true } | { ok: false, code: string, error: string }}
 */
export function verifySignedReturn(signedEvent, unsignedEvent) {
  if (!signedEvent || !unsignedEvent)
    return { ok: false, code: 'mismatch', error: 'falta el evento firmado o el original' }

  let sigOk = false
  try { sigOk = verifyEvent(signedEvent) === true } catch { sigOk = false }
  if (!sigOk)
    return { ok: false, code: 'badsig', error: 'la firma del evento devuelto no es válida' }

  if (!matchesPending(signedEvent, unsignedEvent))
    return { ok: false, code: 'mismatch', error: 'el contenido firmado no coincide con el enviado a firmar' }

  if (!Number.isInteger(signedEvent.created_at)
    || Math.abs(signedEvent.created_at - unsignedEvent.created_at) > SIGNED_TS_DRIFT_S)
    return { ok: false, code: 'timestamp', error: 'la fecha del evento firmado no corresponde a esta sesión de firma' }

  if (String(signedEvent.pubkey).toLowerCase() !== String(unsignedEvent.pubkey).toLowerCase())
    return { ok: false, code: 'pubkey', error: 'el evento está firmado por una identidad distinta a la conectada' }

  return { ok: true }
}

// ── Anti doble-publicación (F2) ───────────────────────────────────────────────
// Si el usuario refresca publicar.html?amber=signed&res=..., el mismo evento
// volvería a procesarse. Registramos los ids ya publicados en esta sesión.

export function wasProcessed(eventId) {
  try {
    const list = JSON.parse(sessionStorage.getItem(SS_PROCESSED) || '[]')
    return Array.isArray(list) && list.includes(eventId)
  } catch { return false }
}

export function markProcessed(eventId) {
  try {
    const list = JSON.parse(sessionStorage.getItem(SS_PROCESSED) || '[]')
    const arr = Array.isArray(list) ? list : []
    arr.push(eventId)
    sessionStorage.setItem(SS_PROCESSED, JSON.stringify(arr.slice(-20)))
  } catch { /* ignorar */ }
}
