// nostr.js — direcciones npub / note
import test from 'node:test'
import assert from 'node:assert/strict'
import { hexToNpub, hexToNote, decodeNpub, decodeNote } from '../js/nostr.js'
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
