// wallet-session — dónde vive el secret de la conexión NWC (una credencial
// con capacidad de gasto). Sin tests hasta la ronda 2.
import test from 'node:test'
import assert from 'node:assert/strict'

function memoryStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: k => { m.delete(k) }, _m: m }
}
function install({ denied = false } = {}) {
  const session = memoryStorage(), local = memoryStorage()
  const def = (name, storage) => Object.defineProperty(globalThis, name, denied
    ? { configurable: true, get() { throw new Error('SecurityError') } }
    : { configurable: true, value: storage, writable: true })
  def('sessionStorage', session); def('localStorage', local)
  return { session, local }
}

install()
const ws = await import('../js/wallet-session.js')
const CONN = { walletPubkey: 'a'.repeat(64), relay: 'wss://relay.test', secret: 'b'.repeat(64), encryption: 'nip04', methods: ['get_balance'] }

test('por defecto el secret solo vive en la sesión; los metadatos persistidos no lo llevan', () => {
  const { session, local } = install()
  ws.save(CONN)
  assert.deepEqual(ws.load(), CONN)
  assert.ok(session.getItem('plazap2p_nwc_session').includes(CONN.secret))
  assert.equal(local.getItem('plazap2p_nwc_persist'), null)
  assert.ok(!local.getItem('plazap2p_nwc_meta').includes(CONN.secret), 'el secret no puede acabar en localStorage')
  assert.equal(ws.isPersisted(), false)
  assert.equal(ws.loadMeta().walletPubkey, CONN.walletPubkey)
})

test('con "recordar" se persiste; sin él, una persistencia anterior se borra', () => {
  const { local } = install()
  ws.save(CONN, { remember: true })
  assert.equal(ws.isPersisted(), true)
  ws.save(CONN, { remember: false })
  assert.equal(local.getItem('plazap2p_nwc_persist'), null)
})

test('cerrar la pestaña (se pierde sessionStorage): sin "recordar" no queda conexión', () => {
  const { session } = install()
  ws.save(CONN)
  session._m.clear()
  assert.equal(ws.load(), null)
  assert.equal(ws.loadMeta().walletPubkey, CONN.walletPubkey, 'sí se recuerda QUÉ wallet era, sin el secret')
})

test('una conexión guardada sin secret, pubkey o relay válidos no se acepta y se elimina', () => {
  for (const mala of [
    { ...CONN, secret: 'corto' }, { ...CONN, secret: undefined }, { ...CONN, walletPubkey: 'zz' },
    { ...CONN, relay: 'https://no-es-ws.test' }, { ...CONN, relay: 5 }, 'texto', null, [],
  ]) {
    const { session, local } = install()
    session.setItem('plazap2p_nwc_session', JSON.stringify(mala))
    local.setItem('plazap2p_nwc_persist', JSON.stringify(mala))
    assert.equal(ws.load(), null, JSON.stringify(mala))
    assert.equal(session.getItem('plazap2p_nwc_session'), null, 'el dato corrupto no se deja almacenado')
  }
  assert.throws(() => ws.save({ ...CONN, secret: 'x' }), /inválida/)
})

test('clear() borra sesión, persistencia, metadatos y la clave antigua', () => {
  const { session, local } = install()
  local.setItem('plazap2p_nwc', JSON.stringify(CONN))
  ws.save(CONN, { remember: true })
  ws.clear()
  assert.deepEqual([session.getItem('plazap2p_nwc_session'), local.getItem('plazap2p_nwc_persist'), local.getItem('plazap2p_nwc_meta'), local.getItem('plazap2p_nwc')], [null, null, null, null])
})

test('migración: la clave antigua (secret en localStorage) pasa a la sesión y desaparece', () => {
  const { session, local } = install()
  local.setItem('plazap2p_nwc', JSON.stringify(CONN))
  assert.deepEqual(ws.load(), CONN)
  assert.equal(local.getItem('plazap2p_nwc'), null)
  assert.ok(session.getItem('plazap2p_nwc_session').includes(CONN.secret))
})

test('almacenamiento bloqueado por el navegador: nada lanza', () => {
  install({ denied: true })
  assert.doesNotThrow(() => ws.save(CONN))
  assert.equal(ws.load(), null)
  assert.equal(ws.loadMeta(), null)
  assert.equal(ws.isPersisted(), false)
  assert.doesNotThrow(() => ws.clear())
})
