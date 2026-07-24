// CODE-033 — parseProfileMetadata() es la única parte pura y testeable de
// profile.js; fetchProfileMeta() depende de un RelayPool real.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProfileMetadata } from '../js/profile.js'

const kind0 = (content, created_at = 1_700_000_000) => ({ kind: 0, content, created_at, pubkey: 'a'.repeat(64) })

test('parseProfileMetadata: campos válidos', () => {
  const meta = parseProfileMetadata(kind0(JSON.stringify({
    name: 'satoshi', display_name: 'Satoshi', picture: 'https://x.example/pic.jpg',
    lud16: 'satoshi@plazap2p.example', nip05: 'satoshi@plazap2p.example',
  })))
  assert.equal(meta.name, 'satoshi')
  assert.equal(meta.displayName, 'Satoshi')
  assert.equal(meta.picture, 'https://x.example/pic.jpg')
  assert.equal(meta.lud16, 'satoshi@plazap2p.example')
  assert.equal(meta.createdAt, 1_700_000_000)
})

test('parseProfileMetadata: kind distinto de 0 → null', () => {
  assert.equal(parseProfileMetadata({ kind: 1, content: '{}' }), null)
  assert.equal(parseProfileMetadata(null), null)
})

test('parseProfileMetadata: JSON roto → null (no lanza)', () => {
  assert.equal(parseProfileMetadata(kind0('esto no es json')), null)
  assert.equal(parseProfileMetadata(kind0('null')), null)
})

test('parseProfileMetadata: picture http (no https) y lud16 mal formado se descartan', () => {
  const meta = parseProfileMetadata(kind0(JSON.stringify({
    picture: 'http://inseguro.example/pic.jpg', lud16: 'no-es-una-lightning-address',
  })))
  assert.equal(meta.picture, null)
  assert.equal(meta.lud16, null)
})

test('parseProfileMetadata: campos ausentes quedan en null, no undefined', () => {
  const meta = parseProfileMetadata(kind0('{}'))
  assert.equal(meta.name, null)
  assert.equal(meta.lud16, null)
  assert.equal(meta.picture, null)
})
