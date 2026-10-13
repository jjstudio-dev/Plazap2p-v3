// WAL-002 — validación de respuestas NWC, string de conexión y BOLT11
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseConnectionString, isValidNwcResponse, decodeBolt11, announcesBalance, isOperationNotAllowed,
} from '../js/nwc.js'
import { buildInvoice, SIG_WORDS } from './fixtures/bolt11.mjs'
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
// Facturas sintéticas con checksum bech32 real y la estructura completa
// (campos + 104 words de firma): ver tests/fixtures/bolt11.mjs.

test('decodeBolt11: factura válida → importe, descripción, hash y expiración', () => {
  const dec = decodeBolt11(buildInvoice({ timestamp: 1750000000 }))
  assert.equal(dec.amountSats, 2100)
  assert.equal(dec.amountMsats, 2_100_000)
  assert.equal(dec.description, 'Test PlazaP2P')
  assert.equal(dec.timestamp, 1750000000)
  assert.equal(dec.expiry, 7200)
  assert.equal(dec.paymentHash, '01'.repeat(32))
  assert.equal(dec.expired, (1750000000 + 7200) * 1000 < Date.now())
})

test('decodeBolt11: importe exacto en msats para cada multiplicador', () => {
  assert.equal(decodeBolt11(buildInvoice({ hrp: 'lnbc1' })).amountMsats, 1e11)        // 1 BTC
  assert.equal(decodeBolt11(buildInvoice({ hrp: 'lnbc2m' })).amountMsats, 2e8)        // 2 mBTC
  assert.equal(decodeBolt11(buildInvoice({ hrp: 'lnbc2500u' })).amountMsats, 2.5e8)   // 250.000 sats
  assert.equal(decodeBolt11(buildInvoice({ hrp: 'lnbc210n' })).amountMsats, 21_000)   // 21 sats
  assert.equal(decodeBolt11(buildInvoice({ hrp: 'lnbc15n' })).amountMsats, 1500)      // 1,5 sats: no se redondea
  assert.equal(decodeBolt11(buildInvoice({ hrp: 'lnbc10p' })).amountMsats, 1)         // 1 msat
  const sinImporte = decodeBolt11(buildInvoice({ hrp: 'lnbc' }))
  assert.equal(sinImporte.amountMsats, null)
  assert.equal(sinImporte.amountSats, null)
})

test('decodeBolt11: la firma no se interpreta como campos etiquetados (regresión)', () => {
  // Firma cuyos primeros words imitan un campo x (expiry) de valor 1 seguido
  // de un campo d (descripción). Antes del fix el expiry salía 1 (factura
  // "caducada" al instante) y la descripción quedaba pisada con basura.
  const sigWords = [6, 0, 1, 1, 13, 0, 2, 12, 12, ...Array(SIG_WORDS - 9).fill(0)]
  const sinExpiry = decodeBolt11(buildInvoice({ expiry: null, sigWords }))
  assert.equal(sinExpiry.expiry, 3600, 'sin campo x rige el valor por defecto de BOLT11')
  assert.equal(sinExpiry.description, 'Test PlazaP2P')
  assert.equal(sinExpiry.expired, false)
  const conExpiry = decodeBolt11(buildInvoice({ expiry: 7200, sigWords }))
  assert.equal(conExpiry.expiry, 7200)
})

test('decodeBolt11: checksum corrupto y basura → lanza', () => {
  const inv = buildInvoice()
  const corrupted = inv.slice(0, -1) + (inv.at(-1) === 'q' ? 'p' : 'q')
  assert.throws(() => decodeBolt11(corrupted))
  assert.throws(() => decodeBolt11('no-es-una-factura'))
  assert.throws(() => decodeBolt11(''))
})

// ── Permisos de la conexión (VW2-01) ─────────────────────────────────────────

test('announcesBalance: una conexión solo de pago no anuncia el saldo', () => {
  assert.equal(announcesBalance(['pay_invoice']), false)
  assert.equal(announcesBalance(['pay_invoice', 'get_balance']), true)
})

test('announcesBalance: sin lista de métodos no se sabe, así que se intenta', () => {
  assert.equal(announcesBalance([]), true)
  assert.equal(announcesBalance(undefined), true)
  assert.equal(announcesBalance(null), true)
})

test('isOperationNotAllowed: solo cuando la wallet contesta que falta ese permiso', () => {
  const walletError = walletCode => Object.assign(new Error('x'), { code: 'WALLET_ERROR', walletCode })
  assert.equal(isOperationNotAllowed(walletError('RESTRICTED')), true)
  assert.equal(isOperationNotAllowed(walletError('NOT_IMPLEMENTED')), true)
  // La conexión no vale, o el fallo es otro: no se puede dar por buena.
  assert.equal(isOperationNotAllowed(walletError('UNAUTHORIZED')), false)
  assert.equal(isOperationNotAllowed(walletError('INTERNAL')), false)
  assert.equal(isOperationNotAllowed(Object.assign(new Error('x'), { code: 'TIMEOUT', walletCode: null })), false)
  assert.equal(isOperationNotAllowed(Object.assign(new Error('x'), { code: 'TIMEOUT', walletCode: 'RESTRICTED' })), false)
  assert.equal(isOperationNotAllowed(null), false)
})
