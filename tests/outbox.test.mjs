// F7-04 — relays de escritura de la lista NIP-65 (kind 10002)
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeRelaysFrom, normalizeRelayUrl, MAX_OUTBOX_RELAYS } from '../js/outbox.js'

const list = tags => ({ kind: 10002, tags })

test('solo relays de escritura (sin marcador o write), sin los de la configuración ni repetidos', () => {
  const ev = list([
    ['r', 'wss://Mi-Relay.test/'], ['r', 'wss://solo-lectura.test', 'read'], ['r', 'wss://escritura.test', 'write'],
    ['r', 'wss://nos.lol'], ['r', 'wss://mi-relay.test'], ['p', 'x'],
  ])
  assert.deepEqual(writeRelaysFrom(ev, ['wss://nos.lol/']), ['wss://mi-relay.test', 'wss://escritura.test'])
})

test('descarta lo que no es wss público y respeta el máximo', () => {
  for (const bad of ['ws://plano.test', 'https://web.test', 'wss://localhost:7777', 'wss://192.168.1.5', 'wss://algo.onion', 'wss://u:p@x.test', 'basura', 42])
    assert.equal(normalizeRelayUrl(bad), null, String(bad))
  const muchos = list(Array.from({ length: 9 }, (_, i) => ['r', `wss://r${i}.test`]))
  assert.equal(writeRelaysFrom(muchos).length, MAX_OUTBOX_RELAYS)
  assert.deepEqual(writeRelaysFrom({ kind: 3, tags: [['r', 'wss://x.test']] }), [])
  assert.deepEqual(writeRelaysFrom(null), [])
})
