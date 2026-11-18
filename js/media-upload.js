// media-upload.js — Subida de imágenes a Blossom (MED-001, BUD-01/BUD-02).
//
// Requisitos (2026-11-18): JPG, PNG, WebP, AVIF o HEIC (si el navegador lo
// abre) de hasta 40 MB, que se reduce a ≤1600 px y JPEG ≤4 MB antes de
// subir; GIF de hasta 10 MB, tal cual. Firmador NIP-07 e identidad conectada.
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

// Se prueban en orden: si el primero falla (caído, rechaza, no contesta), se
// intenta con el siguiente con la misma autorización firmada (no nombra
// servidor). nostr.build ya no va aquí: su /upload es la web, no Blossom
// (comprobado el 2026-11-18); blossom.band admite hasta 20 MiB.
export const BLOSSOM_SERVERS = ['https://blossom.primal.net', 'https://blossom.band']
// Lo que puede pesar el archivo ELEGIDO: las fotos (no los GIF) se reducen
// antes de subirlas, así que una foto de móvil de 15-25 MB vale.
export const MAX_BYTES = 40 * 1024 * 1024
// Los GIF no se redibujan (perderían la animación): se suben tal cual.
export const MAX_GIF_BYTES = 10 * 1024 * 1024
// Lo que sale tras reducir — igual que la app Android (ImageCompression.kt):
// lado largo ≤1600 px, JPEG y como mucho 4 MB.
export const MAX_DIMENSION = 1600
export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const JPEG_QUALITY = 0.82
const MIN_JPEG_QUALITY = 0.5
const UPLOAD_TIMEOUT_MS = 60000
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif']

/** Tipo del archivo; Windows y algunos móviles dan '' para HEIC: se mira la extensión. */
export function fileType(file) {
  const t = String(file?.type || '').toLowerCase()
  if (t) return t
  const ext = String(file?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return ({ heic: 'image/heic', heif: 'image/heif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' })[ext] || ''
}

/** @param {{size:number, type:string, name?:string}} file — objeto File real o equivalente para test. */
export function validateFile(file, { maxBytes = MAX_BYTES, allowedTypes = ALLOWED_TYPES } = {}) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) return 'archivo vacío o inválido'
  const type = fileType(file)
  const limit = type === 'image/gif' ? Math.min(maxBytes, MAX_GIF_BYTES) : maxBytes
  if (file.size > limit) return `archivo demasiado grande (máx. ${Math.round(limit / 1024 / 1024)} MB${type === 'image/gif' ? ' para GIF' : ''})`
  if (!allowedTypes.includes(type)) return `tipo de archivo no admitido (${type || 'desconocido'}) — usa JPG, PNG, WebP o GIF`
  return null
}

/** Tamaño de destino: cabe en max×max sin deformar y nunca se agranda. */
export function fitWithin(width, height, max = MAX_DIMENSION) {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height))
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
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
export async function uploadBlob(server, file, signedAuthEvent, { expectedSha256 = null, timeoutMs = UPLOAD_TIMEOUT_MS } = {}) {
  const authHeader = 'Nostr ' + utf8ToBase64(JSON.stringify(signedAuthEvent))
  // Con tiempo límite: con el servidor colgado, «Subiendo…» no terminaba (VW3-10).
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await fetch(`${String(server).replace(/\/$/, '')}/upload`, {
      method: 'PUT',
      headers: { 'Authorization': authHeader, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
      signal: ctrl.signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('el servidor de imágenes no respondió a tiempo')
    throw e
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.message || '' } catch { /* respuesta no-JSON: usar solo el status */ }
    if (!detail) detail = res.headers?.get?.('x-reason') || ''
    const why = res.status === 413 ? 'la imagen pesa demasiado para este servidor' : `el servidor rechazó la subida (${res.status})`
    throw new Error(`${why}${detail ? ': ' + detail : ''}`)
  }
  const descriptor = await res.json()
  if (!descriptor?.url) throw new Error('respuesta del servidor sin URL')
  // La huella que devuelve el servidor tiene que ser la de la foto enviada:
  // si no, la dirección apunta a otro archivo (VW3-07).
  if (expectedSha256 && String(descriptor.sha256 || '').toLowerCase() !== String(expectedSha256).toLowerCase()) {
    throw new Error('el servidor devolvió un archivo que no es la foto enviada')
  }
  return descriptor.url
}

/**
 * Redibuja la imagen en un lienzo, reducida a MAX_DIMENSION de lado largo, y
 * la devuelve como JPEG de MAX_OUTPUT_BYTES como mucho. Una foto de móvil
 * suele llevar dentro el lugar, la fecha y el modelo de teléfono; lo que sale
 * del lienzo son solo los píxeles (con la orientación ya aplicada).
 * Reducirla además evita los fallos con fotos de 48-200 Mpx: el lienzo del
 * móvil no admite tantos píxeles (en iPhone, ~16 Mpx) y el redibujado salía
 * vacío («no se pudo procesar la imagen»).
 * Los GIF se devuelven tal cual: redibujarlos los dejaría sin animación.
 */
export async function stripImageMetadata(file) {
  const type = fileType(file)
  if (type === 'image/gif') return file
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(type === 'image/heic' || type === 'image/heif'
      ? 'este navegador no sabe abrir fotos HEIC — en el iPhone elige «Más compatible» en Ajustes › Cámara › Formatos, o conviértela a JPG'
      : 'no se pudo abrir la imagen (¿archivo dañado o formato raro?) — prueba con un JPG')
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    // JPEG no tiene transparencia: un PNG con fondo transparente saldría negro.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    let quality = JPEG_QUALITY
    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    while (blob && blob.size > MAX_OUTPUT_BYTES && quality > MIN_JPEG_QUALITY) {
      quality = Math.max(MIN_JPEG_QUALITY, quality - 0.1)
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    }
    if (!blob) throw new Error('no se pudo procesar la imagen (¿demasiado grande para este móvil?)')
    if (blob.size > MAX_OUTPUT_BYTES) throw new Error('la imagen sigue pesando demasiado tras reducirla')
    return blob
  } finally {
    bitmap.close?.()
  }
}

/**
 * Orquesta el flujo completo: valida → redibuja (quita los datos ocultos y la
 * reduce) → hashea → construye el evento de autorización → lo firma (vía el
 * callback `sign`, normalmente signer.nip07Sign) → sube → devuelve la URL.
 * `servers` es uno o varios: si uno falla se prueba el siguiente con la misma
 * firma. Si la imagen no se puede redibujar no se sube nada: nunca se envía
 * el original. No hace nada con Amber: el llamador decide si ofrece esta
 * función según `signer.detectSigner()`.
 */
export async function uploadImage(file, pubkeyHex, sign, servers = BLOSSOM_SERVERS, { reencode = stripImageMetadata } = {}) {
  const err = validateFile(file)
  if (err) throw new Error(err)
  if (!/^[0-9a-f]{64}$/i.test(String(pubkeyHex || ''))) throw new Error('conecta tu identidad Nostr antes de subir la foto')
  const clean = await reencode(file)
  const buf = await clean.arrayBuffer()
  const hash = await sha256Hex(buf)
  const unsigned = buildBlossomAuthEvent(hash, pubkeyHex)
  const signed = await sign(unsigned)
  const list = (Array.isArray(servers) ? servers : [servers]).filter(Boolean)
  let lastError = new Error('no hay servidor de imágenes configurado')
  for (const server of list) {
    try {
      return await uploadBlob(server, clean, signed, { expectedSha256: hash })
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}
