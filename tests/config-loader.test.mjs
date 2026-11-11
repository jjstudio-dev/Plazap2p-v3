// W-02: una sola carga de config.json para index.html y publicar.html.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  configUrl, loadServedConfig, FALLBACK_RELAYS, FALLBACK_CONFIG, FALLBACK_PUBLISH_CONFIG,
} from '../js/config-loader.js'

const config = (over = {}) => JSON.stringify({
  relays: ['wss://relay.ejemplo'],
  intercambio: { trustedMostroInstances: ['nostr.ejemplo'], defaultFiat: 'EUR' },
  support_url: 'https://soporte.ejemplo',
  ...over,
})

const ok = raw => async () => ({ ok: true, status: 200, text: async () => raw })

test('la URL de configuración lleva el mismo número de versión que los assets', () => {
  assert.equal(configUrl('44'), 'data/config.json?v=44')
  assert.equal(configUrl(' 44 '), 'data/config.json?v=44')
  assert.equal(configUrl(''), 'data/config.json')
  assert.equal(configUrl(null), 'data/config.json')
})

test('sin firma del mantenedor se quitan los campos sensibles y las instancias de confianza', async () => {
  const cfg = await loadServedConfig({ version: '44', fetchImpl: ok(config()), storage: { getItem: () => null } })
  assert.equal(cfg.trusted, false)
  assert.equal(cfg.support_url, undefined)
  assert.deepEqual(cfg.intercambio.trustedMostroInstances, [])
  assert.equal(cfg.intercambio.defaultFiat, 'EUR')
  assert.deepEqual(cfg.relays, ['wss://relay.ejemplo'])
})

test('si el servido es idéntico al último firmado, se aplica como de confianza', async () => {
  const raw = config()
  const cfg = await loadServedConfig({ version: '44', fetchImpl: ok(raw), storage: { getItem: () => raw } })
  assert.equal(cfg.trusted, true)
  assert.equal(cfg.support_url, 'https://soporte.ejemplo')
  assert.deepEqual(cfg.intercambio.trustedMostroInstances, ['nostr.ejemplo'])
})

test('red caída, HTTP malo o JSON ilegible: relays de reserva y configuración mínima', async () => {
  const casos = [
    async () => { throw new Error('sin red') },
    async () => ({ ok: false, status: 500, text: async () => '' }),
    ok('{no es json'),
    ok('null'),
    ok('[]'),
  ]
  for (const fetchImpl of casos) {
    const cfg = await loadServedConfig({ version: '44', fetchImpl, storage: { getItem: () => null } })
    assert.deepEqual(cfg.relays, FALLBACK_RELAYS)
    assert.equal(cfg.trusted, undefined, 'la reserva no se presenta como firmada')
  }
  assert.deepEqual(FALLBACK_CONFIG.relays, FALLBACK_RELAYS)
  assert.deepEqual(FALLBACK_PUBLISH_CONFIG.relays, FALLBACK_RELAYS)
})

test('una lista de relays vacía o mal formada cae en la reserva compartida', async () => {
  for (const relays of [[], 'wss://uno', null]) {
    const cfg = await loadServedConfig({
      version: '44', fetchImpl: ok(config({ relays })), storage: { getItem: () => null },
    })
    assert.deepEqual(cfg.relays, FALLBACK_RELAYS, JSON.stringify(relays))
  }
})

test('solo hay una lista de relays de reserva en el código de las dos páginas', async () => {
  const fs = await import('node:fs')
  for (const file of ['js/app.js', 'js/publicar-app.js']) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /wss:\/\/nostr\.mom/, `${file} no debe repetir la lista`)
  }
})
