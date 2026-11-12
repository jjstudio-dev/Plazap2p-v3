// geohash.js — F7-07: zona aproximada de un evento (etiqueta `g` de NIP-52)
//
// Codificación geohash estándar. Con precisión 5 la celda mide unos 5 × 5 km:
// basta para que los buscadores de quedadas por cercanía encuentren el evento
// sin publicar una dirección exacta.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

/** Precisión que usa el formulario de eventos (≈5 km). */
export const EVENT_GEOHASH_PRECISION = 5

export const GEOHASH_RE = /^[0-9bcdefghjkmnpqrstuvwxyz]{3,9}$/

export function encodeGeohash(lat, lon, precision = EVENT_GEOHASH_PRECISION) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const latR = [-90, 90]
  const lonR = [-180, 180]
  let hash = ''
  let bits = 0
  let ch = 0
  let even = true
  while (hash.length < precision) {
    const r = even ? lonR : latR
    const v = even ? lon : lat
    const mid = (r[0] + r[1]) / 2
    ch <<= 1
    if (v >= mid) { ch |= 1; r[0] = mid } else { r[1] = mid }
    even = !even
    if (++bits === 5) { hash += BASE32[ch]; bits = 0; ch = 0 }
  }
  return hash
}

/** Precisión de una ubicación exacta (comercios, eventos con dirección): ≈5 m. */
export const EXACT_GEOHASH_PRECISION = 9

/** Desde esta longitud un geohash se trata como punto exacto (celda ≤ ~150 m). */
export const EXACT_FROM_LENGTH = 7

/**
 * Centro y medio tamaño (en grados) de la celda de un geohash, o null si no es
 * válido. Con la mitad de la celda se dibuja la zona aproximada.
 */
export function decodeGeohash(hash) {
  if (typeof hash !== 'string' || !/^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(hash)) return null
  const latR = [-90, 90]
  const lonR = [-180, 180]
  let even = true
  for (const c of hash) {
    const v = BASE32.indexOf(c)
    for (let bit = 4; bit >= 0; bit--) {
      const r = even ? lonR : latR
      const mid = (r[0] + r[1]) / 2
      if ((v >> bit) & 1) r[0] = mid; else r[1] = mid
      even = !even
    }
  }
  return {
    lat: (latR[0] + latR[1]) / 2,
    lon: (lonR[0] + lonR[1]) / 2,
    latErr: (latR[1] - latR[0]) / 2,
    lonErr: (lonR[1] - lonR[0]) / 2,
  }
}

/** La etiqueta `g` más precisa de un evento Nostr (las apps ponen varias). */
export function mostPreciseGeohash(tags) {
  let best = null
  for (const t of tags || []) {
    if (Array.isArray(t) && t[0] === 'g' && typeof t[1] === 'string' && /^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(t[1])) {
      if (!best || t[1].length > best.length) best = t[1]
    }
  }
  return best
}
