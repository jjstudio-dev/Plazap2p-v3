// SEC-002 — verificación del retorno del firmador (js/signer.js)
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSignedEventJson, matchesPending, verifySignedReturn, parseToHex } from '../js/signer.js'
import { SK1, SK2, PK1, signWith, tampered } from './fixtures/events.mjs'

const now = Math.floor(Date.now() / 1000)
const TAGS = [['d', 'sec002-test'], ['t', 'plazap2p']]
const unsignedBase = { kind: 30402, created_at: now, tags: TAGS, content: 'anuncio de prueba', pubkey: PK1 }
const signedOk = signWith(SK1, { kind: 30402, created_at: now, tags: TAGS, content: 'anuncio de prueba' })

test('parseSignedEventJson: válido / basura / campos faltantes', () => {
  const parsed = parseSignedEventJson(JSON.stringify(signedOk))
  assert.equal(parsed?.step, 'signed')
  assert.equal(parsed.value.id, signedOk.id)
  assert.equal(parseSignedEventJson('esto no es json'), null)
  assert.equal(parseSignedEventJson(JSON.stringify({ ...signedOk, sig: undefined })), null)
  assert.equal(parseSignedEventJson(JSON.stringify({ ...signedOk, id: '1234' })), null)
})

test('retorno correcto → ok', () => {
  assert.deepEqual(verifySignedReturn(signedOk, unsignedBase), { ok: true })
})

test('firma falsa → badsig', () => {
  const bad = tampered(signedOk, { sig: '0'.repeat(128) })
  assert.equal(verifySignedReturn(bad, unsignedBase).code, 'badsig')
})

test('contenido distinto del enviado → mismatch', () => {
  const otherSigned = signWith(SK1, { kind: 30402, created_at: now, tags: TAGS, content: 'contenido cambiado' })
  assert.equal(verifySignedReturn(otherSigned, unsignedBase).code, 'mismatch')
})

test('tags reordenados/distintos → mismatch', () => {
  const otherSigned = signWith(SK1, { kind: 30402, created_at: now, tags: [...TAGS, ['t', 'extra']], content: 'anuncio de prueba' })
  assert.equal(verifySignedReturn(otherSigned, unsignedBase).code, 'mismatch')
})

test('fecha re-firmada fuera de tolerancia → timestamp', () => {
  const oldSigned = signWith(SK1, { kind: 30402, created_at: now - 7200, tags: TAGS, content: 'anuncio de prueba' })
  assert.equal(verifySignedReturn(oldSigned, unsignedBase).code, 'timestamp')
})

test('fecha re-firmada dentro de tolerancia (Amber) → ok', () => {
  const drifted = signWith(SK1, { kind: 30402, created_at: now + 600, tags: TAGS, content: 'anuncio de prueba' })
  assert.deepEqual(verifySignedReturn(drifted, unsignedBase), { ok: true })
})

test('otra identidad con firma válida → pubkey (decide el caller)', () => {
  const otherAccount = signWith(SK2, { kind: 30402, created_at: now, tags: TAGS, content: 'anuncio de prueba' })
  assert.equal(verifySignedReturn(otherAccount, unsignedBase).code, 'pubkey')
})

test('matchesPending compara kind/content/tags', () => {
  assert.equal(matchesPending(signedOk, unsignedBase), true)
  assert.equal(matchesPending(signedOk, { ...unsignedBase, kind: 1 }), false)
  assert.equal(matchesPending(null, unsignedBase), false)
})

test('parseToHex: npub inválido y hex válido', () => {
  assert.equal(parseToHex(PK1.toUpperCase()), PK1)
  assert.equal(parseToHex('npub1basura'), null)
  assert.equal(parseToHex(''), null)
})
