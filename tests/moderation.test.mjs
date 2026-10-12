// MOD-001 / BON-017 — moderación local (bloqueo por usuario) y su
// exportación/importación portable.
import test from 'node:test'
import assert from 'node:assert/strict'

function makeLocalStorageStub() {
  const store = new Map()
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: k => { store.delete(k) },
  }
}
globalThis.localStorage = makeLocalStorageStub()

const { isBlocked, blockPubkey, unblockPubkey, listBlocked, exportBlocked, importBlocked } = await import('../js/moderation.js')

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

test('blockPubkey + isBlocked: round-trip básico', () => {
  globalThis.localStorage = makeLocalStorageStub()
  assert.equal(isBlocked(PK_A), false)
  blockPubkey(PK_A)
  assert.equal(isBlocked(PK_A), true)
  assert.equal(isBlocked(PK_B), false)
})

test('blockPubkey: ignora pubkeys inválidas (no ensucia la lista)', () => {
  globalThis.localStorage = makeLocalStorageStub()
  blockPubkey('no-es-hex')
  blockPubkey('')
  blockPubkey(null)
  assert.deepEqual(listBlocked(), [])
})

test('blockPubkey: no duplica si ya estaba bloqueada', () => {
  globalThis.localStorage = makeLocalStorageStub()
  blockPubkey(PK_A)
  blockPubkey(PK_A.toUpperCase()) // mayúsculas → misma pubkey normalizada
  assert.deepEqual(listBlocked(), [PK_A])
})

test('unblockPubkey: elimina de la lista', () => {
  globalThis.localStorage = makeLocalStorageStub()
  blockPubkey(PK_A)
  blockPubkey(PK_B)
  unblockPubkey(PK_A)
  assert.deepEqual(listBlocked().sort(), [PK_B])
})

test('exportBlocked/importBlocked: round-trip completo', () => {
  globalThis.localStorage = makeLocalStorageStub()
  blockPubkey(PK_A)
  blockPubkey(PK_B)
  const json = exportBlocked()

  globalThis.localStorage = makeLocalStorageStub() // simula "otro dispositivo"
  const added = importBlocked(json)
  assert.equal(added, 2)
  assert.deepEqual(listBlocked().sort(), [PK_A, PK_B].sort())
})

test('importBlocked: fusiona sin duplicar y solo cuenta las nuevas', () => {
  globalThis.localStorage = makeLocalStorageStub()
  blockPubkey(PK_A)
  const added = importBlocked(JSON.stringify({ plazap2p_blocked_pubkeys: [PK_A, PK_B] }))
  assert.equal(added, 1, 'PK_A ya estaba; solo PK_B es nueva')
  assert.deepEqual(listBlocked().sort(), [PK_A, PK_B].sort())
})

test('importBlocked: JSON roto o formato no reconocido lanza sin tocar la lista', () => {
  globalThis.localStorage = makeLocalStorageStub()
  blockPubkey(PK_A)
  assert.throws(() => importBlocked('esto no es json'))
  assert.throws(() => importBlocked(JSON.stringify({ otraCosa: [] })))
  assert.deepEqual(listBlocked(), [PK_A], 'la lista original no debe alterarse si la importación falla')
})

test('importBlocked: filtra entradas que no son pubkeys hex válidas', () => {
  globalThis.localStorage = makeLocalStorageStub()
  const added = importBlocked(JSON.stringify({ plazap2p_blocked_pubkeys: [PK_A, 'basura', 123, null] }))
  assert.deepEqual(listBlocked(), [PK_A])
  // El número devuelto es el que se le dice al usuario ("N vendedores añadidos"):
  // solo cuentan los válidos. (Sin esta aserción, quitar el filtro de
  // importBlocked() no hacía fallar ningún test: load() filtra al leer.)
  assert.equal(added, 1)
  assert.equal(JSON.parse(globalThis.localStorage.getItem('plazap2p_blocked_pubkeys')).length, 1, 'tampoco se guarda la basura')
})
