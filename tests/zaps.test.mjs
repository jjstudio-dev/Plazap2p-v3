// ZAP-001/002 — solo las partes puras: URL de lightning address, request sin
// firmar, validación de parámetros LNURL y verificación de recibos. El
// fetch real a un servidor LNURL y el pago vía NWC no se prueban aquí
// (mismo criterio que el resto del proyecto con red real).
import test from 'node:test'
import assert from 'node:assert/strict'
import { lud16ToUrl, buildZapRequest, validateLnurlPayParams, validateZapReceipt } from '../js/zaps.js'
import { SK1, SK2, PK1, PK2, signWith, tampered } from './fixtures/events.mjs'

test('lud16ToUrl: forma correcta y rechazo de formato inválido', () => {
  assert.equal(lud16ToUrl('satoshi@plazap2p.example'), 'https://plazap2p.example/.well-known/lnurlp/satoshi')
  assert.throws(() => lud16ToUrl('no-es-una-address'))
  assert.throws(() => lud16ToUrl('user@dominio-sin-tld'))
  assert.throws(() => lud16ToUrl(''))
})

test('buildZapRequest: kind 9734, tags relays/amount/p correctos', () => {
  const ev = buildZapRequest({ recipientHex: PK2, amountMsats: 21000, relays: ['wss://relay.example'] }, PK1)
  assert.equal(ev.kind, 9734)
  assert.equal(ev.pubkey, PK1)
  assert.deepEqual(ev.tags.find(t => t[0] === 'amount'), ['amount', '21000'])
  assert.deepEqual(ev.tags.find(t => t[0] === 'p'), ['p', PK2])
  assert.deepEqual(ev.tags.find(t => t[0] === 'relays'), ['relays', 'wss://relay.example'])
})

test('buildZapRequest: valida importe, receptor, remitente y relays', () => {
  assert.throws(() => buildZapRequest({ recipientHex: 'no-hex', amountMsats: 1000, relays: ['wss://r'] }, PK1))
  assert.throws(() => buildZapRequest({ recipientHex: PK2, amountMsats: 0, relays: ['wss://r'] }, PK1))
  assert.throws(() => buildZapRequest({ recipientHex: PK2, amountMsats: 1000, relays: [] }, PK1))
  assert.throws(() => buildZapRequest({ recipientHex: PK2, amountMsats: 1000, relays: ['wss://r'] }, 'no-hex'))
})

test('buildZapRequest: referencias e/a opcionales', () => {
  const withE = buildZapRequest({ recipientHex: PK2, amountMsats: 1000, relays: ['wss://r'], eventRef: 'a'.repeat(64) }, PK1)
  assert.deepEqual(withE.tags.find(t => t[0] === 'e'), ['e', 'a'.repeat(64)])
  const withA = buildZapRequest({ recipientHex: PK2, amountMsats: 1000, relays: ['wss://r'], addressableRef: `30402:${PK2}:d-1` }, PK1)
  assert.deepEqual(withA.tags.find(t => t[0] === 'a'), ['a', `30402:${PK2}:d-1`])
})

test('validateLnurlPayParams: forma válida, tag/callback/límites incorrectos', () => {
  const good = { tag: 'payRequest', callback: 'https://x.example/cb', minSendable: 1000, maxSendable: 100000, allowsNostr: true, nostrPubkey: PK2 }
  const v = validateLnurlPayParams(good)
  assert.equal(v.ok, true)
  assert.equal(v.allowsNostr, true)
  assert.equal(v.nostrPubkey, PK2)

  assert.equal(validateLnurlPayParams(null).ok, false)
  assert.equal(validateLnurlPayParams({ ...good, tag: 'withdrawRequest' }).ok, false)
  assert.equal(validateLnurlPayParams({ ...good, callback: 'http://inseguro.example' }).ok, false)
  assert.equal(validateLnurlPayParams({ ...good, minSendable: 5000, maxSendable: 1000 }).ok, false)
})

test('validateZapReceipt: recibo válido con zap request incrustado', () => {
  const zapRequest = signWith(SK1, {
    kind: 9734,
    tags: [['relays', 'wss://relay.example'], ['amount', '21000'], ['p', PK2]],
    content: 'Gracias!',
  })
  const receipt = signWith(SK2, {
    kind: 9735,
    tags: [['p', PK2], ['bolt11', 'lnbc210n1...'], ['description', JSON.stringify(zapRequest)]],
    content: '',
  })
  const r = validateZapReceipt(receipt, { expectedRecipientHex: PK2, expectedSenderHex: PK1, lnurlProviderPubkey: PK2 })
  assert.equal(r.ok, true)
  assert.equal(r.senderHex, PK1)
  assert.equal(r.amountMsats, 21000)
  assert.equal(r.comment, 'Gracias!')
})

test('validateZapReceipt: kind incorrecto, firma adulterada, destinatario equivocado', () => {
  const notAReceipt = signWith(SK2, { kind: 1, tags: [['p', PK2]] })
  assert.equal(validateZapReceipt(notAReceipt, { expectedRecipientHex: PK2 }).ok, false)

  const receipt = signWith(SK2, { kind: 9735, tags: [['p', PK2]] })
  const bad = tampered(receipt, { content: 'contenido alterado tras firmar' })
  assert.equal(validateZapReceipt(bad, { expectedRecipientHex: PK2 }).ok, false)

  const wrongRecipient = signWith(SK2, { kind: 9735, tags: [['p', PK1]] })
  assert.equal(validateZapReceipt(wrongRecipient, { expectedRecipientHex: PK2 }).ok, false)
})

test('validateZapReceipt: exige que lo firme el proveedor LNURL esperado, si se conoce', () => {
  const receipt = signWith(SK1, { kind: 9735, tags: [['p', PK2]] }) // firmado por SK1, no por el proveedor esperado (PK2)
  const r = validateZapReceipt(receipt, { expectedRecipientHex: PK2, lnurlProviderPubkey: PK2 })
  assert.equal(r.ok, false)
})

test('validateZapReceipt: zap request incrustado con firma inválida invalida todo el recibo', () => {
  const zapRequest = tampered(signWith(SK1, { kind: 9734, tags: [['p', PK2]] }), { content: 'adulterado' })
  const receipt = signWith(SK2, { kind: 9735, tags: [['p', PK2], ['description', JSON.stringify(zapRequest)]] })
  assert.equal(validateZapReceipt(receipt, { expectedRecipientHex: PK2 }).ok, false)
})

test('validateZapReceipt: sin description (wallet que lo omite) sigue siendo válido pero sin datos del remitente', () => {
  const receipt = signWith(SK2, { kind: 9735, tags: [['p', PK2], ['bolt11', 'lnbc1...']] })
  const r = validateZapReceipt(receipt, { expectedRecipientHex: PK2 })
  assert.equal(r.ok, true)
  assert.equal(r.senderHex, null)
  assert.equal(r.amountMsats, null)
  assert.equal(r.bolt11, 'lnbc1...')
})
