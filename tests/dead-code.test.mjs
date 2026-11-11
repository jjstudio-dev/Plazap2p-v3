// W-15: limpieza de código y datos sin lector.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const exists = f => fs.existsSync(new URL(`../${f}`, import.meta.url))

test('data/config.json no lleva campos que ningún módulo lee', () => {
  const cfg = JSON.parse(read('data/config.json'))
  for (const key of ['_setup', 'curated_list_naddr', 'publish_clients', 'nostr_clients', 'wallets', 'categories', 'maintainer_npub']) {
    assert.equal(cfg[key], undefined, `${key} sigue en config.json`)
  }
  assert.equal(cfg.intercambio.defaultFiat, undefined, 'defaultFiat no tiene lector')
})

test('no quedan exportaciones ni helpers sin uso', () => {
  assert.doesNotMatch(read('js/drafts.js'), /export function hasDraft/)
  assert.doesNotMatch(read('js/favorites.js'), /export function (listFavorites|favoritesCount)/)
  assert.doesNotMatch(read('js/nwc.js'), /export (const|async function|function) (getInfo|lnAddressToInvoice)/)
  assert.doesNotMatch(read('js/publish-utils.js'), /export function (parseEventDate|formatStars)/)
  assert.doesNotMatch(read('js/nostr.js'), /export function decodeNote/)
  assert.doesNotMatch(read('js/wallet-session.js'), /export function isPersisted/)
  assert.doesNotMatch(read('js/app.js'), /function hideSkeletons/)
})

test('las plantillas y el registro de claves no se publican', () => {
  assert.equal(exists('data/multimedia-TEMPLATE.json'), false)
  assert.ok(exists('tools/multimedia-TEMPLATE.json'))
  assert.equal(exists('js/storage-keys.js'), false)
  assert.ok(exists('tools/storage-keys.js'), 'W-31 lo devolverá a js/ cuando se conecte')
})

test('ningún comentario remite al plan de verificación retirado', () => {
  for (const file of ['js/app-shell.js', 'js/drafts.js', 'js/router.js']) {
    assert.doesNotMatch(read(file), /PLAN_VERIFICACION_APP_PURA/, file)
  }
})
