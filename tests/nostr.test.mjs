// nostr.js — direcciones npub / note
import test from 'node:test'
import { bech32Encode, bytesToWords } from './fixtures/bolt11.mjs'
import assert from 'node:assert/strict'
import { hexToNpub, hexToNote, decodeNpub, decodeNote, decodeNaddr, encodeNaddr } from '../js/nostr.js'
import { PK1 } from './fixtures/events.mjs'

// 20 bytes (no 32) con suma de control bech32 válida.
const SHORT_NPUB = 'npub1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5kzfrkn'
const SHORT_NOTE = 'note1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5t9388s'

test('npub y note válidos van y vuelven', () => {
  assert.equal(decodeNpub(hexToNpub(PK1)), PK1)
  assert.equal(decodeNote(hexToNote(PK1)), PK1)
})

test('npub con suma de control válida pero que no mide 32 bytes → rechazado', () => {
  assert.throws(() => decodeNpub(SHORT_NPUB))
})

test('note con suma de control válida pero que no mide 32 bytes → rechazado', () => {
  assert.throws(() => decodeNote(SHORT_NOTE))
})

test('prefijo equivocado → rechazado', () => {
  assert.throws(() => decodeNpub(hexToNote(PK1)))
  assert.throws(() => decodeNote(hexToNpub(PK1)))
})

// ── naddr (VW1-01, VW1-02) ───────────────────────────────────────────────────

const naddrOf = bytes => bech32Encode('naddr', bytesToWords(bytes))

test('naddr válido va y vuelve, con sus relays', () => {
  const naddr = encodeNaddr({ kind: 30402, pubkey: PK1, identifier: 'anuncio-1', relays: ['wss://nos.lol'] })
  assert.deepEqual(decodeNaddr(naddr), { identifier: 'anuncio-1', pubkey: PK1, kind: 30402, relays: ['wss://nos.lol'] })
})

test('naddr con autor que no mide 32 bytes o tipo que no mide 4 se rechaza', () => {
  const autor32 = Array(32).fill(7)
  assert.throws(() => decodeNaddr(naddrOf([0, 1, 120, 2, 5, 1, 2, 3, 4, 5, 3, 4, 0, 0, 118, 194])), /author/)
  assert.throws(() => decodeNaddr(naddrOf([0, 1, 120, 2, 32, ...autor32, 3, 2, 118, 194])), /kind/)
  assert.equal(decodeNaddr(naddrOf([0, 1, 120, 2, 32, ...autor32, 3, 4, 0, 0, 118, 194])).kind, 30402)
})

test('encodeNaddr omite un relay de más de 255 bytes en vez de corromper la dirección', () => {
  const largo = 'wss://' + 'a'.repeat(300) + '.example'
  const naddr = encodeNaddr({ kind: 30402, pubkey: PK1, identifier: 'x', relays: [largo, 'wss://nos.lol', ''] })
  assert.deepEqual(decodeNaddr(naddr), { identifier: 'x', pubkey: PK1, kind: 30402, relays: ['wss://nos.lol'] })
})
