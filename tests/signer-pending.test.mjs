// signer — el estado pendiente de firma no puede depender de que
// sessionStorage funcione: con NIP-07 todo ocurre en la misma página, así que
// con el almacenamiento lleno o bloqueado hay que poder firmar y publicar.
import test from 'node:test'
import assert from 'node:assert/strict'

function installStorage(mode) {
  const mem = new Map()
  const storage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { if (mode === 'quota') throw new Error('QuotaExceededError'); mem.set(k, String(v)) },
    removeItem: k => { mem.delete(k) },
  }
  const define = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, ...value })
  if (mode === 'denied') {
    const denied = { get() { throw new Error('SecurityError') } }
    define('sessionStorage', denied); define('localStorage', denied)
  } else {
    define('sessionStorage', { value: storage, writable: true }); define('localStorage', { value: storage, writable: true })
  }
}

const signer = await import('../js/signer.js')
const PENDING = { step: 'sign', unsignedEvent: { kind: 30402, tags: [], content: '', created_at: 1 }, meta: { type: 'venta' } }
const HEX = 'a'.repeat(64)

for (const mode of ['quota', 'denied']) {
  test(`almacenamiento ${mode}: el pendiente de firma se conserva en memoria`, () => {
    installStorage(mode)
    signer.clearPending()
    assert.doesNotThrow(() => signer.savePending(PENDING))
    assert.deepEqual(signer.loadPending()?.unsignedEvent, PENDING.unsignedEvent)
    signer.clearPending()
    assert.equal(signer.loadPending(), null)
  })

  test(`almacenamiento ${mode}: guardar la identidad no lanza`, () => {
    installStorage(mode)
    assert.doesNotThrow(() => signer.storePubkey(HEX))
    assert.throws(() => signer.storePubkey('no-es-hex'), /inválida/)
  })
}

test('almacenamiento normal: el pendiente sobrevive en sessionStorage y caduca a los 15 min', () => {
  installStorage('ok')
  signer.savePending(PENDING)
  assert.equal(JSON.parse(sessionStorage.getItem('plazap2p_pending_sign')).step, 'sign')
  const viejo = { ...PENDING, ts: Date.now() - 16 * 60_000 }
  sessionStorage.setItem('plazap2p_pending_sign', JSON.stringify(viejo))
  assert.equal(signer.loadPending(), null)
})
