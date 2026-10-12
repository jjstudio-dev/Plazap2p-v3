// CODE-016 — router hash: solo se prueban las funciones puras (parseHash,
// destRoute, resolveHash, routeForTab); initRouter() usa window/document y
// se verifica manualmente en navegador (ver checklist §12 del plan).
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHash, destRoute, resolveHash, routeForTab, parseAnuncioHash, anuncioRoute } from '../js/router.js'

test('parseHash: hash vacío, solo destino, destino+sub y barra final', () => {
  assert.deepEqual(parseHash(''), { dest: null, sub: null })
  assert.deepEqual(parseHash('#/'), { dest: null, sub: null })
  assert.deepEqual(parseHash('#/plaza'), { dest: 'plaza', sub: null })
  assert.deepEqual(parseHash('#/plaza/mercado'), { dest: 'plaza', sub: 'mercado' })
  assert.deepEqual(parseHash('#/perfil/relays/'), { dest: 'perfil', sub: 'relays' })
})

test('destRoute: usa forma corta para el tab por defecto del grupo', () => {
  assert.equal(destRoute('plaza', 'mercado'), '#/plaza')
  assert.equal(destRoute('plaza', 'intercambio'), '#/plaza/intercambio')
  assert.equal(destRoute('explorar', 'feed'), '#/explorar')
  assert.equal(destRoute('explorar', 'eventos'), '#/explorar/eventos')
})

test('destRoute: destino externo (actividad → publicar.html) no tiene hash propio', () => {
  assert.equal(destRoute('actividad', 'anuncios'), null)
})

test('destRoute: destino desconocido devuelve null', () => {
  assert.equal(destRoute('inexistente', 'x'), null)
})

test('resolveHash: hash válido con sub-tab conocido', () => {
  assert.deepEqual(resolveHash('#/explorar/eventos'), { dest: 'explorar', tab: 'eventos' })
})

test('resolveHash: hash con solo destino cae al tab por defecto del grupo', () => {
  assert.deepEqual(resolveHash('#/perfil'), { dest: 'perfil', tab: 'acerca' })
})

test('resolveHash: sub-tab que no pertenece al grupo cae al tab por defecto (no crashea)', () => {
  assert.deepEqual(resolveHash('#/plaza/eventos'), { dest: 'plaza', tab: 'mercado' })
})

test('resolveHash: destino externo o desconocido → null (no navega)', () => {
  assert.equal(resolveHash('#/actividad'), null)
  assert.equal(resolveHash('#/no-existe'), null)
  assert.equal(resolveHash(''), null)
})

test('routeForTab: resuelve el destino correcto a partir del tab (misma fuente que app-shell GROUPS)', () => {
  assert.equal(routeForTab('mercado'), '#/plaza')
  assert.equal(routeForTab('herramientas'), '#/explorar/herramientas')
  assert.equal(routeForTab('relays'), '#/perfil/relays')
})

test('routeForTab: tab que no pertenece a ningún grupo → null', () => {
  assert.equal(routeForTab('tab-inexistente'), null)
})

test('parseAnuncioHash: reconoce naddr1... y rechaza otros hashes', () => {
  assert.equal(parseAnuncioHash('#/anuncio/naddr1qqxnzd3cxg6nywfk8qcrjwfhxs6z6wpkxu6rvv3c'), 'naddr1qqxnzd3cxg6nywfk8qcrjwfhxs6z6wpkxu6rvv3c')
  assert.equal(parseAnuncioHash('#/plaza'), null)
  assert.equal(parseAnuncioHash('#/plaza/mercado'), null)
  assert.equal(parseAnuncioHash(''), null)
  assert.equal(parseAnuncioHash('#/anuncio/'), null)
})

test('anuncioRoute: genera el hash canónico a partir del naddr', () => {
  assert.equal(anuncioRoute('naddr1abc'), '#/anuncio/naddr1abc')
})

test('anuncioRoute → parseAnuncioHash: round-trip', () => {
  const naddr = 'naddr1qqxnzd3cxg6nywfk8qcrjwfhxs6z6wpkxu6rvv3c'
  assert.equal(parseAnuncioHash(anuncioRoute(naddr)), naddr)
})

test('resolveHash: un nombre heredado de Object (#/constructor) no es un destino', () => {
  for (const hash of ['#/constructor', '#/toString', '#/__proto__', '#/hasOwnProperty/x']) {
    assert.equal(resolveHash(hash), null, hash)
  }
})
