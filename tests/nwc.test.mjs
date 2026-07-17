// WAL-002 — validación de respuestas NWC, string de conexión y BOLT11
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConnectionString, isValidNwcResponse, decodeBolt11 } from '../js/nwc.js'
import { SK2, PK1, PK2, signWith, tampered } from './fixtures/events.mjs'

// ── isValidNwcResponse ────────────────────────────────────────────────────────
// wallet = SK2/PK2 · cliente = PK1 · petición = reqId

const reqId = 'e'.repeat(64)
const ctx = { reqId, clientPubkey: PK1, walletPubkey: PK2 }
const goodResponse = () => signWith(SK2, {
  kind: 23195,
  tags: [['e', reqId], ['p', PK1]],
  content: 'cifrado-simulado',
})

test('respuesta correcta de la wallet → válida', () => {
  assert.equal(isValidNwcResponse(goodResponse(), ctx), true)
})

test('kind incorrecto → inválida', () => {
  const ev = signWith(SK2, { kind: 23194, tags: [['e', reqId], ['p', PK1]] })
  assert.equal(isValidNwcResponse(ev, ctx), false)
})

test('autor distinto de la wallet → inválida', () => {
  const ev = signWith(SK2, { kind: 23195, tags: [['e', reqId], ['p', PK1]] })
  assert.equal(isValidNwcResponse(ev, { ...ctx, walletPubkey: 'a'.repeat(64) }), false)
})

test('sin tag e de nuestra petición → inválida (relay que ignora filtros)', () => {
  const ev = signWith(SK2, { kind: 23195, tags: [['e', 'f'.repeat(64)], ['p', PK1]] })
  assert.equal(isValidNwcResponse(ev, ctx), false)
})

test('tag p a otro cliente → inválida', () => {
  const ev = signWith(SK2, { kind: 23195, tags: [['e', reqId], ['p', 'b'.repeat(64)]] })
  assert.equal(isValidNwcResponse(ev, ctx), false)
})

test('firma adulterada → inválida', () => {
  const ev = tampered(goodResponse(), { sig: '0'.repeat(128) })
  assert.equal(isValidNwcResponse(ev, ctx), false)
})

// ── parseConnectionString ─────────────────────────────────────────────────────

const HEX = 'ab'.repeat(32)
test('string NWC válido → campos parseados', () => {
  const c = parseConnectionString(`nostr+walletconnect://${HEX}?relay=wss://relay.example.com&secret=${HEX}&lud16=user@example.com`)
  assert.equal(c.walletPubkey, HEX)
  assert.equal(c.relay, 'wss://relay.example.com')
  assert.equal(c.secret, HEX)
  assert.equal(c.lud16, 'user@example.com')
})

test('string NWC inválido → lanza', () => {
  assert.throws(() => parseConnectionString('http://loquesea'))
  assert.throws(() => parseConnectionString(`nostr+walletconnect://${HEX}?secret=${HEX}`))          // sin relay
  assert.throws(() => parseConnectionString(`nostr+walletconnect://${HEX}?relay=wss://r.com`))      // sin secret
  assert.throws(() => parseConnectionString(`nostr+walletconnect://zzzz?relay=wss://r.com&secret=${HEX}`))
})

// ── decodeBolt11 ──────────────────────────────────────────────────────────────
// Factura sintética con checksum bech32 real (mismo algoritmo del estándar),
// construida aquí para no depender de facturas externas.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
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
function bytesToWords(bytes) {
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
function intToWords(n, count = null) {
  const w = []
  let x = n
  while (x > 0) { w.unshift(x % 32); x = Math.floor(x / 32) }
  if (w.length === 0) w.push(0)
  while (count && w.length < count) w.unshift(0)
  return w
}
function taggedField(type, words) {
  return [type, ...intToWords(words.length, 2), ...words]
}

function buildTestInvoice() {
  const hrp = 'lnbc21u'   // 21 micro-BTC = 2100 sats
  const ts = 1750000000
  const data = [
    ...intToWords(ts, 7),
    ...taggedField(1, bytesToWords(new Uint8Array(32).fill(1))),                    // p — payment hash
    ...taggedField(13, bytesToWords(new TextEncoder().encode('Test PlazaP2P'))),    // d — descripción
    ...taggedField(6, intToWords(7200)),                                            // x — expiry
  ]
  return hrp + '1' + [...data, ...checksum(hrp, data)].map(v => CHARSET[v]).join('')
}

test('decodeBolt11: factura válida → importe, descripción, hash y expiración', () => {
  const dec = decodeBolt11(buildTestInvoice())
  assert.equal(dec.amountSats, 2100)
  assert.equal(dec.description, 'Test PlazaP2P')
  assert.equal(dec.timestamp, 1750000000)
  assert.equal(dec.expiry, 7200)
  assert.equal(dec.paymentHash, '01'.repeat(32))
  assert.equal(dec.expired, (1750000000 + 7200) * 1000 < Date.now())
})

test('decodeBolt11: checksum corrupto y basura → lanza', () => {
  const inv = buildTestInvoice()
  const corrupted = inv.slice(0, -1) + (inv.at(-1) === 'q' ? 'p' : 'q')
  assert.throws(() => decodeBolt11(corrupted))
  assert.throws(() => decodeBolt11('no-es-una-factura'))
  assert.throws(() => decodeBolt11(''))
})
