// UX-002 — borradores locales. Node no trae localStorage por defecto: se usa
// un stub mínimo en memoria (mismo contrato: getItem/setItem/removeItem),
// suficiente porque drafts.js solo llama a esos tres métodos.
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

const { saveDraft, loadDraft, deleteDraft, hasDraft, isSnapshotMeaningful } = await import('../js/drafts.js')

const snap = (fields) => ({ fields, pills: {}, checks: [], platforms: [], selectedType: 'servicio', editingDTag: null, editingPublishedAt: null })

test('isSnapshotMeaningful: vacío o solo espacios → false; con contenido → true', () => {
  assert.equal(isSnapshotMeaningful(null), false)
  assert.equal(isSnapshotMeaningful(snap({})), false)
  assert.equal(isSnapshotMeaningful(snap({ 's-title': '' })), false)
  assert.equal(isSnapshotMeaningful(snap({ 's-title': '   ' })), false)
  assert.equal(isSnapshotMeaningful(snap({ 's-title': 'Diseño gráfico' })), true)
})

test('saveDraft rechaza snapshots vacíos (no ensucia el storage)', () => {
  globalThis.localStorage = makeLocalStorageStub()
  assert.equal(saveDraft('servicio', snap({})), false)
  assert.equal(hasDraft('servicio'), false)
})

test('saveDraft + loadDraft: round-trip conserva el snapshot', () => {
  globalThis.localStorage = makeLocalStorageStub()
  const s = snap({ 's-title': 'Diseño gráfico', 's-desc': 'Identidad visual' })
  assert.equal(saveDraft('servicio', s), true)
  const loaded = loadDraft('servicio')
  assert.ok(loaded)
  assert.equal(loaded.snapshot.fields['s-title'], 'Diseño gráfico')
  assert.equal(typeof loaded.savedAt, 'number')
})

test('deleteDraft elimina y hasDraft pasa a false', () => {
  globalThis.localStorage = makeLocalStorageStub()
  saveDraft('evento', snap({ 'e-title': 'Meetup' }))
  assert.equal(hasDraft('evento'), true)
  deleteDraft('evento')
  assert.equal(hasDraft('evento'), false)
  assert.equal(loadDraft('evento'), null)
})

test('loadDraft: JSON corrupto o de otro esquema → null (no lanza, no restaura basura)', () => {
  globalThis.localStorage = makeLocalStorageStub()
  globalThis.localStorage.setItem('plazap2p_draft_servicio', '{not json')
  assert.equal(loadDraft('servicio'), null)

  globalThis.localStorage.setItem('plazap2p_draft_servicio', JSON.stringify({ v: 999, snapshot: {} }))
  assert.equal(loadDraft('servicio'), null)
})

test('los borradores son independientes por tipo', () => {
  globalThis.localStorage = makeLocalStorageStub()
  saveDraft('servicio', snap({ 's-title': 'A' }))
  saveDraft('venta', snap({ 'tx-title': 'B' }))
  assert.equal(loadDraft('servicio').snapshot.fields['s-title'], 'A')
  assert.equal(loadDraft('venta').snapshot.fields['tx-title'], 'B')
  deleteDraft('servicio')
  assert.equal(hasDraft('servicio'), false)
  assert.equal(hasDraft('venta'), true)
})
