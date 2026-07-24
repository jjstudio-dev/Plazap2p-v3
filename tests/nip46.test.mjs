// ID-001 (NIP-46 / nostrconnect / bunker) — solo las partes puras: generación
// de claves efímeras, construcción/parseo de URIs y de los sobres de
// petición/respuesta. El intercambio en vivo por WebSocket con un firmador
// remoto no se prueba aquí (igual que nwc.js: solo se testean sus helpers
// puros, no el round-trip de red).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateClientKeypair, buildNostrconnectUri, parseBunkerUri,
  buildRequestPayload, parseResponsePayload,
} from '../js/nip46.js'

test('generateClientKeypair: pubkey hex de 64 y distinta en cada llamada', () => {
  const a = generateClientKeypair()
  const b = generateClientKeypair()
  assert.match(a.pubkeyHex, /^[0-9a-f]{64}$/)
  assert.match(a.secretHex, /^[0-9a-f]{64}$/)
  assert.notEqual(a.pubkeyHex, b.pubkeyHex, 'cada sesión debe usar una clave efímera distinta')
})

test('buildNostrconnectUri: forma y parámetros correctos', () => {
  const clientPubkey = 'a'.repeat(64)
  const uri = buildNostrconnectUri({
    clientPubkey, relay: 'wss://relay.example.com', secret: 's3cret',
    name: 'PlazaP2P', url: 'https://plazap2p.example', perms: ['sign_event', 'get_public_key'],
  })
  assert.ok(uri.startsWith(`nostrconnect://${clientPubkey}?`))
  const url = new URL(uri.replace('nostrconnect://', 'http://'))
  assert.equal(url.searchParams.get('relay'), 'wss://relay.example.com')
  assert.equal(url.searchParams.get('secret'), 's3cret')
  assert.equal(url.searchParams.get('name'), 'PlazaP2P')
  assert.equal(url.searchParams.get('perms'), 'sign_event,get_public_key')
})

test('buildNostrconnectUri: rechaza pubkey/relay/secret inválidos', () => {
  assert.throws(() => buildNostrconnectUri({ clientPubkey: 'no-hex', relay: 'wss://x', secret: 's' }))
  assert.throws(() => buildNostrconnectUri({ clientPubkey: 'a'.repeat(64), relay: 'https://x', secret: 's' }))
  assert.throws(() => buildNostrconnectUri({ clientPubkey: 'a'.repeat(64), relay: 'wss://x', secret: '' }))
})

test('parseBunkerUri: extrae pubkey del firmador, relays y secret', () => {
  const signerPubkey = 'b'.repeat(64)
  const uri = `bunker://${signerPubkey}?relay=wss://r1.example&relay=wss://r2.example&secret=abc123`
  const parsed = parseBunkerUri(uri)
  assert.equal(parsed.signerPubkey, signerPubkey)
  assert.deepEqual(parsed.relays, ['wss://r1.example', 'wss://r2.example'])
  assert.equal(parsed.secret, 'abc123')
})

test('parseBunkerUri: secret es opcional; formato/pubkey/relay inválidos lanzan', () => {
  const signerPubkey = 'c'.repeat(64)
  const parsed = parseBunkerUri(`bunker://${signerPubkey}?relay=wss://r1.example`)
  assert.equal(parsed.secret, null)

  assert.throws(() => parseBunkerUri('nostrconnect://abc'))
  assert.throws(() => parseBunkerUri('bunker://no-es-hex?relay=wss://r1.example'))
  assert.throws(() => parseBunkerUri(`bunker://${signerPubkey}`), /relay/)
})

test('buildRequestPayload: method/params correctos, id aleatorio no vacío', () => {
  const p1 = buildRequestPayload('sign_event', ['{"kind":1}'])
  const p2 = buildRequestPayload('sign_event', ['{"kind":1}'])
  assert.equal(p1.method, 'sign_event')
  assert.deepEqual(p1.params, ['{"kind":1}'])
  assert.ok(p1.id && p1.id.length > 0)
  assert.notEqual(p1.id, p2.id, 'cada petición debe tener su propio id')
})

test('parseResponsePayload: resultado válido, error explícito, id no coincide, JSON roto', () => {
  assert.deepEqual(parseResponsePayload('{"id":"1","result":"ok"}', '1'), { ok: true, result: 'ok' })
  assert.deepEqual(parseResponsePayload('{"id":"1","error":"denegado"}', '1'), { ok: false, error: 'denegado' })
  assert.equal(parseResponsePayload('{"id":"2","result":"ok"}', '1').ok, false)
  assert.equal(parseResponsePayload('esto no es json', '1').ok, false)
  assert.equal(parseResponsePayload('{"id":"1"}', '1').ok, false, 'sin result ni error → inválido')
})
