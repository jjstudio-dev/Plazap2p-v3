// Facturas BOLT11 sintéticas para los tests: checksum bech32 real y la misma
// estructura que una factura de verdad (timestamp + campos etiquetados +
// 104 words de firma). La firma NO es válida — decodeBolt11() no la
// comprueba (lo hace la wallet al pagar), solo necesita que esté donde debe.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
export const SIG_WORDS = 104

function polymod(values) {
  let c = 1
  for (const v of values) {
    const c0 = c >>> 25
    c = ((c & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((c0 >> i) & 1) c ^= GEN[i]
  }
  return c
}
function hrpExpand(hrp) {
  const r = []
  for (const ch of hrp) r.push(ch.charCodeAt(0) >> 5)
  r.push(0)
  for (const ch of hrp) r.push(ch.charCodeAt(0) & 31)
  return r
}
function checksum(hrp, data) {
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1
  return Array.from({ length: 6 }, (_, p) => (mod >> 5 * (5 - p)) & 31)
}
export function bytesToWords(bytes) {
  const words = []
  let acc = 0, bits = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) { bits -= 5; words.push((acc >> bits) & 31) }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31)
  return words
}
export function intToWords(n, count = null) {
  const w = []
  let x = n
  while (x > 0) { w.unshift(x % 32); x = Math.floor(x / 32) }
  if (w.length === 0) w.push(0)
  while (count && w.length < count) w.unshift(0)
  return w
}
export function taggedField(type, words) {
  return [type, ...intToWords(words.length, 2), ...words]
}

/**
 * @param {object} o
 * @param {string} [o.hrp]       — p.ej. 'lnbc21u' (2100 sats), 'lnbc' (sin importe)
 * @param {number} [o.timestamp] — Unix segs (por defecto: ahora, factura vigente)
 * @param {number|null} [o.expiry] — campo x en segundos; null = no declararlo
 * @param {string} [o.description]
 * @param {number[]} [o.sigWords] — los 104 words de la "firma"
 */
export function buildInvoice({
  hrp = 'lnbc21u',
  timestamp = Math.floor(Date.now() / 1000),
  expiry = 7200,
  description = 'Test PlazaP2P',
  sigWords = Array(SIG_WORDS).fill(0),
} = {}) {
  if (sigWords.length !== SIG_WORDS) throw new Error('la firma debe tener 104 words')
  const data = [
    ...intToWords(timestamp, 7),
    ...taggedField(1, bytesToWords(new Uint8Array(32).fill(1))),          // p — payment hash
    ...taggedField(13, bytesToWords(new TextEncoder().encode(description))), // d — descripción
    ...(expiry == null ? [] : taggedField(6, intToWords(expiry))),         // x — expiry
    ...sigWords,
  ]
  return hrp + '1' + [...data, ...checksum(hrp, data)].map(v => CHARSET[v]).join('')
}
