// PZ-F1-01: configuración firmada por el mantenedor (kind 30078).
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectMaintainerEvent, restrictUntrusted, trustServedConfig, MAINTAINER_PUBKEY, CONFIG_D_TAG } from '../js/signed-config.js'

const ev = (over = {}) => ({ id: '1'.repeat(64), pubkey: MAINTAINER_PUBKEY, created_at: 10, kind: 30078, tags: [['d', CONFIG_D_TAG]], content: '{}', sig: '2'.repeat(128), ...over })

test('solo vale el último evento del mantenedor con el d pedido', () => {
  const best = selectMaintainerEvent([
    ev({ created_at: 5 }),
    ev({ created_at: 9, id: '3'.repeat(64) }),
    ev({ pubkey: 'b'.repeat(64), created_at: 99 }),
    ev({ kind: 1, created_at: 99 }),
    ev({ tags: [['d', 'otro']], created_at: 99 }),
  ], CONFIG_D_TAG, MAINTAINER_PUBKEY, () => true)
  assert.equal(best.created_at, 9)
  assert.equal(selectMaintainerEvent([ev()], CONFIG_D_TAG, MAINTAINER_PUBKEY, () => false), null)
})

test('sin firma no se marcan instancias de confianza ni se cambia el mantenedor', () => {
  const r = restrictUntrusted({ relays: ['wss://a'], intercambio: { trustedMostroInstances: ['x'], defaultFiat: 'EUR' }, maintainer_pubkey: 'f'.repeat(64), support_url: 'https://evil' })
  assert.deepEqual(r.intercambio.trustedMostroInstances, [])
  assert.equal(r.intercambio.defaultFiat, 'EUR')
  assert.equal(r.maintainer_pubkey, MAINTAINER_PUBKEY)
  assert.equal(r.support_url, undefined)
  assert.deepEqual(r.relays, ['wss://a'])
})

test('el config servido solo es de fiar si es idéntico al último firmado', () => {
  const raw = '{"intercambio":{"trustedMostroInstances":["x"]}}'
  const storage = { getItem: () => raw }
  assert.equal(trustServedConfig(raw, JSON.parse(raw), storage).trusted, true)
  const other = '{"intercambio":{"trustedMostroInstances":["evil"]}}'
  const r = trustServedConfig(other, JSON.parse(other), storage)
  assert.equal(r.trusted, false)
  assert.deepEqual(r.intercambio.trustedMostroInstances, [])
})
