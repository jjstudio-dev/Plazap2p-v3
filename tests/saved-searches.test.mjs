// saved-searches.test.mjs — BON-002
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  saveSearch, listSearches, removeSearch, matchesFilterState, matchesSearch,
  wasAlerted, markAlerted,
} from '../js/saved-searches.js'

function installFakeStorages() {
  const mk = () => {
    const store = new Map()
    return { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() }
  }
  globalThis.localStorage = mk()
  globalThis.sessionStorage = mk()
}
installFakeStorages()
test.beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

test('saveSearch/listSearches/removeSearch: CRUD básico', () => {
  assert.deepEqual(listSearches(), [])
  const id = saveSearch({ filter: 'venta', location: 'Madrid', query: 'antminer', label: 'Antminers en Madrid' })
  const all = listSearches()
  assert.equal(all.length, 1)
  assert.equal(all[0].id, id)
  assert.equal(all[0].label, 'Antminers en Madrid')
  removeSearch(id)
  assert.deepEqual(listSearches(), [])
})

test('matchesFilterState: filtro de categoría', () => {
  const item = { title: 'Antminer S19', summary: '', content: '', location: 'Madrid', category: 'venta' }
  assert.equal(matchesFilterState({ filter: 'venta' }, item), true)
  assert.equal(matchesFilterState({ filter: 'compra' }, item), false)
  assert.equal(matchesFilterState({ filter: 'all' }, item), true)
  assert.equal(matchesFilterState({}, item), true)
})

test('matchesFilterState: zona (igualdad exacta, no fuzzy)', () => {
  const item = { title: 'x', summary: '', content: '', location: 'Madrid', category: 'venta' }
  assert.equal(matchesFilterState({ location: 'Madrid' }, item), true)
  assert.equal(matchesFilterState({ location: 'madrid' }, item), false, 'debe ser exacto, igual que activeLocation en app.js')
  assert.equal(matchesFilterState({ location: 'all' }, item), true)
})

test('matchesFilterState: texto libre — mismo predicado que renderActiveChannel (title+summary+content+location, lowercase, includes)', () => {
  const item = { title: 'Antminer S19', summary: 'Minero usado', content: '', location: 'Valencia centro', category: 'venta' }
  assert.equal(matchesFilterState({ query: 'antminer' }, item), true)
  assert.equal(matchesFilterState({ query: 'ANTMINER' }, item), true)
  assert.equal(matchesFilterState({ query: 'valencia' }, item), true, 'debe buscar también en location')
  assert.equal(matchesFilterState({ query: 'bitaxe' }, item), false)
})

test('matchesFilterState combina filtro+zona+texto (AND, no OR)', () => {
  const item = { title: 'Antminer S19', summary: '', content: '', location: 'Madrid', category: 'venta' }
  assert.equal(matchesFilterState({ filter: 'venta', location: 'Madrid', query: 'antminer' }, item), true)
  assert.equal(matchesFilterState({ filter: 'compra', location: 'Madrid', query: 'antminer' }, item), false)
})

test('matchesSearch es un alias directo de matchesFilterState', () => {
  const item = { title: 'x', summary: '', content: '', location: 'Madrid', category: 'venta' }
  const search = { filter: 'venta' }
  assert.equal(matchesSearch(search, item), matchesFilterState(search, item))
})

test('wasAlerted/markAlerted: deduplicación por (searchId, eventKey)', () => {
  assert.equal(wasAlerted('ss-1', 'pubkeyA:dtag1'), false)
  markAlerted('ss-1', 'pubkeyA:dtag1')
  assert.equal(wasAlerted('ss-1', 'pubkeyA:dtag1'), true)
  // otra búsqueda o otro evento no debe verse afectada
  assert.equal(wasAlerted('ss-2', 'pubkeyA:dtag1'), false)
  assert.equal(wasAlerted('ss-1', 'pubkeyA:dtag2'), false)
})
