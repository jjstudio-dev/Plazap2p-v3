// BON-001 — favoritos locales (por naddr)
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

const { isFavorite, addFavorite, removeFavorite, toggleFavorite, listFavorites, favoritesCount } = await import('../js/favorites.js')

const N1 = 'naddr1qqxnzd3cxg6nywfk8qcrjwfhxs6z6wpkxu6rvv3c'
const N2 = 'naddr1qqzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'

test('addFavorite + isFavorite: round-trip básico', () => {
  globalThis.localStorage = makeLocalStorageStub()
  assert.equal(isFavorite(N1), false)
  addFavorite(N1)
  assert.equal(isFavorite(N1), true)
  assert.equal(isFavorite(N2), false)
})

test('addFavorite: no duplica el mismo naddr', () => {
  globalThis.localStorage = makeLocalStorageStub()
  addFavorite(N1)
  addFavorite(N1)
  assert.equal(favoritesCount(), 1)
})

test('removeFavorite: quita de la lista', () => {
  globalThis.localStorage = makeLocalStorageStub()
  addFavorite(N1)
  addFavorite(N2)
  removeFavorite(N1)
  assert.deepEqual(listFavorites(), [N2])
})

test('toggleFavorite: alterna y devuelve el nuevo estado', () => {
  globalThis.localStorage = makeLocalStorageStub()
  assert.equal(toggleFavorite(N1), true)
  assert.equal(isFavorite(N1), true)
  assert.equal(toggleFavorite(N1), false)
  assert.equal(isFavorite(N1), false)
})

test('addFavorite/removeFavorite/isFavorite: ignoran naddr vacío sin lanzar', () => {
  globalThis.localStorage = makeLocalStorageStub()
  addFavorite('')
  addFavorite(null)
  assert.equal(favoritesCount(), 0)
  assert.equal(isFavorite(''), false)
  assert.equal(isFavorite(null), false)
})
