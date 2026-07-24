// media-upload.js — Subida de imágenes a Blossom (MED-001, BUD-01/BUD-02).
//
// Solo disponible con firmador NIP-07 (en página): el evento de autorización
// (kind 24242) necesita firmarse igual que cualquier evento Nostr, y el
// salto de Amber (NIP-55) está diseñado para el flujo de publicación
// principal, no para un paso intermedio de subida — con Amber (u otro
// firmador sin NIP-07), el campo de URL manual sigue disponible tal cual
// estaba: esto SUMA una ruta, no quita la que ya había.
//
// Blossom no está en los relays configurados — son servidores HTTP
// independientes que el usuario elige (mismo principio que las wallets NWC:
// el cliente no impone infraestructura propia).

export const BLOSSOM_SERVERS = ['https://blossom.primal.net', 'https://nostr.build']
export const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** @param {{size:number, type:string}} file — objeto File real o equivalente para test. */
export function validateFile(file, { maxBytes = MAX_BYTES, allowedTypes = ALLOWED_TYPES } = {}) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) return 'archivo vacío o inválido'
  if (file.size > maxBytes) return `archivo demasiado grande (máx. ${Math.round(maxBytes / 1024 / 1024)} MB)`
  if (!allowedTypes.includes(file.type)) return `tipo de archivo no admitido (${file.type || 'desconocido'})`
  return null
}

export async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Mismo patrón que bot/github.js usaba (ver historial): TextEncoder en vez
// de unescape()+encodeURIComponent (deprecated) para btoa seguro con UTF-8.
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** BUD-02: evento kind 24242 sin firmar, autoriza subir UN blob concreto por su hash. */
export function buildBlossomAuthEvent(sha256, pubkeyHex, ttlSeconds = 300) {
  const now = Math.floor(Date.now() / 1000)
  return {
    kind: 24242,
    created_at: now,
    pubkey: String(pubkeyHex).toLowerCase(),
    content: 'Subir imagen a PlazaP2P',
    tags: [
      ['t', 'upload'],
      ['x', String(sha256).toLowerCase()],
      ['expiration', String(now + ttlSeconds)],
    ],
  }
}

/** Sube el blob ya autorizado (evento kind 24242 YA firmado); devuelve la URL pública o lanza. */
export async function uploadBlob(server, file, signedAuthEvent) {
  const authHeader = 'Nostr ' + utf8ToBase64(JSON.stringify(signedAuthEvent))
  const res = await fetch(`${String(server).replace(/\/$/, '')}/upload`, {
    method: 'PUT',
    headers: { 'Authorization': authHeader, 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.message || '' } catch { /* respuesta no-JSON: usar solo el status */ }
    throw new Error(`el servidor rechazó la subida (${res.status})${detail ? ': ' + detail : ''}`)
  }
  const descriptor = await res.json()
  if (!descriptor?.url) throw new Error('respuesta del servidor sin URL')
  return descriptor.url
}

/**
 * Orquesta el flujo completo: valida → hashea → construye el evento de
 * autorización → lo firma (vía el callback `sign`, normalmente
 * signer.nip07Sign) → sube → devuelve la URL. No hace nada con Amber: el
 * llamador decide si ofrece esta función según `signer.detectSigner()`.
 */
export async function uploadImage(file, pubkeyHex, sign, server = BLOSSOM_SERVERS[0]) {
  const err = validateFile(file)
  if (err) throw new Error(err)
  const buf = await file.arrayBuffer()
  const hash = await sha256Hex(buf)
  const unsigned = buildBlossomAuthEvent(hash, pubkeyHex)
  const signed = await sign(unsigned)
  return uploadBlob(server, file, signed)
}
