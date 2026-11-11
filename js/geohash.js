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
