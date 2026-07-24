// backup.test.mjs — BON-013
import test from 'node:test'
import assert from 'node:assert/strict'
import { exportConfig, importConfig } from '../js/backup.js'
import { EXPORTABLE, SENSITIVE, CACHE_ONLY } from '../js/storage-keys.js'

function installFakeLocalStorage() {
  const store = new Map()
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  }
  return store
}
const store = installFakeLocalStorage()
test.beforeEach(() => store.clear())

test('exportConfig: nunca incluye claves SENSITIVE ni CACHE_ONLY aunque estén presentes en localStorage', () => {
  store.set('plazap2p_sort', '{"mercado":"newest"}')
  store.set('plazap2p_pubkey', 'a'.repeat(64))
  store.set('plazap2p_nwc_persist', '{"secret":"muy-secreto"}')
  store.set('plazap2p_nwc', '{"secret":"legado-secreto"}')
  store.set('plazap2p_v3', '{"data":{"mercado":[]}}')

  const exp = exportConfig()
  for (const sensitiveKey of SENSITIVE) assert.ok(!(sensitiveKey in exp.data), `SENSITIVE ${sensitiveKey} no debe exportarse`)
  for (const cacheKey of CACHE_ONLY) assert.ok(!(cacheKey in exp.data), `CACHE_ONLY ${cacheKey} no debe exportarse`)
  assert.equal(exp.data['plazap2p_sort'], '{"mercado":"newest"}')
  assert.equal(exp.data['plazap2p_pubkey'], 'a'.repeat(64))
})

test('exportConfig: solo exporta claves realmente presentes en localStorage (no rellena con undefined)', () => {
  store.set('plazap2p_pubkey', 'a'.repeat(64))
  const exp = exportConfig()
  assert.ok('plazap2p_pubkey' in exp.data)
  assert.ok(!('plazap2p_sort' in exp.data))
})

test('importConfig: JSON inválido o sin campo data → error, no lanza', () => {
  assert.equal(importConfig('esto no es json').ok, false)
  assert.equal(importConfig('{}').ok, false)
  assert.equal(importConfig('{"data": "no es un objeto"}').ok, false)
})

test('importConfig: ignora silenciosamente claves que no estén en EXPORTABLE (defensa contra backup manipulado)', () => {
  const malicious = { formatVersion: 1, data: { 'plazap2p_nwc_persist': '{"secret":"robado"}', 'plazap2p_v3': '{"fake":"listing"}', 'plazap2p_sort': '{"mercado":"oldest"}' } }
  const res = importConfig(malicious)
  assert.equal(res.ok, true)
  assert.ok(!res.applied.includes('plazap2p_nwc_persist'))
  assert.ok(!res.applied.includes('plazap2p_v3'))
  assert.ok(res.applied.includes('plazap2p_sort'))
  assert.equal(store.get('plazap2p_nwc_persist'), undefined, 'NUNCA debe escribirse una clave sensible')
  assert.equal(store.get('plazap2p_v3'), undefined, 'NUNCA debe escribirse el caché de eventos')
})

test('importConfig: cambio de pubkey requiere onIdentityChange, no se aplica en silencio', () => {
  store.set('plazap2p_pubkey', 'a'.repeat(64))
  const backup = { formatVersion: 1, data: { plazap2p_pubkey: 'b'.repeat(64) } }

  const resDenied = importConfig(backup, { onIdentityChange: () => false })
  assert.ok(!resDenied.applied.includes('plazap2p_pubkey'))
  assert.equal(store.get('plazap2p_pubkey'), 'a'.repeat(64), 'la identidad actual no debe cambiar si se deniega')

  const resAccepted = importConfig(backup, { onIdentityChange: () => true })
  assert.ok(resAccepted.applied.includes('plazap2p_pubkey'))
  assert.equal(store.get('plazap2p_pubkey'), 'b'.repeat(64))
})

test('importConfig: sin onIdentityChange, un pubkey distinto NO se aplica por defecto (fail-safe)', () => {
  store.set('plazap2p_pubkey', 'a'.repeat(64))
  const backup = { formatVersion: 1, data: { plazap2p_pubkey: 'b'.repeat(64) } }
  const res = importConfig(backup)
  assert.ok(!res.applied.includes('plazap2p_pubkey'))
  assert.equal(store.get('plazap2p_pubkey'), 'a'.repeat(64))
})

test('importConfig: mismo pubkey no dispara onIdentityChange', () => {
  store.set('plazap2p_pubkey', 'a'.repeat(64))
  let called = false
  const backup = { formatVersion: 1, data: { plazap2p_pubkey: 'a'.repeat(64) } }
  const res = importConfig(backup, { onIdentityChange: () => { called = true; return true } })
  assert.equal(called, false)
  assert.ok(res.applied.includes('plazap2p_pubkey'))
})

test('roundtrip: exportConfig → importConfig preserva los valores', () => {
  store.set('plazap2p_sort', '{"mercado":"oldest"}')
  store.set('plazap2p_orders', '{"a:d1":{"status":"pagado","updatedAt":123}}')
  const exported = exportConfig()
  store.clear()
  const res = importConfig(exported)
  assert.equal(res.ok, true)
  assert.equal(store.get('plazap2p_sort'), '{"mercado":"oldest"}')
  assert.equal(store.get('plazap2p_orders'), '{"a:d1":{"status":"pagado","updatedAt":123}}')
})
