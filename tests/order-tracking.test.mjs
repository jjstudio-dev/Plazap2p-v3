// order-tracking.test.mjs — BON-010
import test from 'node:test'
import assert from 'node:assert/strict'
import { setStatus, getStatus, listAll, VALID_STATUSES } from '../js/order-tracking.js'

// localStorage simulado en memoria (Node no lo tiene por defecto)
function installFakeLocalStorage() {
  const store = new Map()
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: k => { store.delete(k) },
    clear: () => store.clear(),
  }
  return () => store.clear()
}
const resetStorage = installFakeLocalStorage()

test.beforeEach(() => resetStorage())

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

test('setStatus/getStatus: CRUD básico', () => {
  assert.equal(getStatus(PK_A, 'd1'), null)
  setStatus(PK_A, 'd1', 'pagado')
  const s = getStatus(PK_A, 'd1')
  assert.equal(s.status, 'pagado')
  assert.ok(Number.isInteger(s.updatedAt))
})

test('setStatus con status inválido no escribe nada', () => {
  setStatus(PK_A, 'd1', 'estado-inventado')
  assert.equal(getStatus(PK_A, 'd1'), null)
})

test('setStatus(status=null) borra la entrada', () => {
  setStatus(PK_A, 'd1', 'entregado')
  assert.ok(getStatus(PK_A, 'd1'))
  setStatus(PK_A, 'd1', null)
  assert.equal(getStatus(PK_A, 'd1'), null)
})

test('la clave es pubkey:dTag — NO depende de una lista de relays (a diferencia de naddr)', () => {
  // Mismo pubkey+dTag, sin pasar nunca por encodeNaddr — la clave interna
  // no tiene ningún parámetro de relays que pueda hacerla variar.
  setStatus(PK_A, 'mismo-dtag', 'pendiente')
  setStatus(PK_A, 'mismo-dtag', 'pagado') // segunda llamada, mismo coordinate
  const all = listAll()
  const entries = all.filter(e => e.pubkey === PK_A.toLowerCase() && e.dTag === 'mismo-dtag')
  assert.equal(entries.length, 1, 'debe ser una sola entrada, no duplicada')
  assert.equal(entries[0].status, 'pagado')
})

test('pubkeys distintos con el mismo dTag no colisionan', () => {
  setStatus(PK_A, 'd1', 'pendiente')
  setStatus(PK_B, 'd1', 'entregado')
  assert.equal(getStatus(PK_A, 'd1').status, 'pendiente')
  assert.equal(getStatus(PK_B, 'd1').status, 'entregado')
})

test('listAll refleja todas las entradas guardadas', () => {
  setStatus(PK_A, 'd1', 'pendiente')
  setStatus(PK_A, 'd2', 'pagado')
  const all = listAll()
  assert.equal(all.length, 2)
})

test('sin pubkey o dTag no hace nada (no lanza)', () => {
  assert.doesNotThrow(() => setStatus(null, 'd1', 'pagado'))
  assert.doesNotThrow(() => setStatus(PK_A, null, 'pagado'))
  assert.equal(getStatus(null, 'd1'), null)
})

test('VALID_STATUSES contiene exactamente los 4 estados del plan', () => {
  assert.deepEqual([...VALID_STATUSES].sort(), ['cancelado', 'entregado', 'pagado', 'pendiente'])
})
