// collectUntilEose — las consultas puntuales (reputación, perfil, zaps) deben
// esperar a TODOS los relays disponibles, no al primero que conteste.
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectUntilEose } from '../js/relay-pool.js'
import { fakePool, flush } from './fixtures/fake-pool.mjs'

test('no termina con el primer EOSE si quedan relays por contestar', async () => {
  const pool = fakePool(['wss://rapido', 'wss://lento'])
  const got = []
  let done = null
  collectUntilEose(pool, [{ kinds: [1] }], { onEvent: ev => got.push(ev.id), timeoutMs: 2000 }).then(r => { done = r })

  pool.eose('wss://rapido')            // el relay rápido no tiene nada
  await flush()
  assert.equal(done, null, 'sigue esperando al relay lento')
  assert.equal(pool.subs.size, 1)

  pool.emit({ id: 'ev-1' }, 'wss://lento')
  pool.eose('wss://lento')
  await flush()
  assert.deepEqual(done, { complete: true, answered: 2 })
  assert.deepEqual(got, ['ev-1'])
  assert.equal(pool.subs.size, 0, 'la suscripción se cierra al terminar')
})

test('EOSE repetido del mismo relay no cuenta dos veces', async () => {
  const pool = fakePool(['wss://a', 'wss://b'])
  let done = null
  collectUntilEose(pool, [{ kinds: [1] }], { timeoutMs: 2000 }).then(r => { done = r })
  pool.eose('wss://a'); pool.eose('wss://a')
  await flush()
  assert.equal(done, null)
  pool.eose('wss://b')
  await flush()
  assert.deepEqual(done, { complete: true, answered: 2 })
})

test('timeout → complete:false (el resultado puede ser parcial)', async () => {
  const pool = fakePool(['wss://a', 'wss://mudo'])
  const r = collectUntilEose(pool, [{ kinds: [1] }], { timeoutMs: 60 })
  pool.eose('wss://a')
  assert.deepEqual(await r, { complete: false, answered: 1 })
  assert.equal(pool.subs.size, 0)
})

test('un relay que se cae deja de esperarse sin agotar el timeout', async () => {
  const pool = fakePool(['wss://a', 'wss://caido'])
  const t0 = Date.now()
  const r = collectUntilEose(pool, [{ kinds: [1] }], { timeoutMs: 5000 })
  pool.eose('wss://a')
  pool.drop('wss://caido')
  assert.deepEqual(await r, { complete: true, answered: 1 })
  assert.ok(Date.now() - t0 < 2000, 'se resuelve por la re-evaluación periódica, no por el timeout')
})

test('eventos que llegan después de terminar se ignoran', async () => {
  const pool = fakePool(['wss://a'])
  const got = []
  let handlers = null
  const subscribe = pool.subscribe.bind(pool)
  pool.subscribe = (id, filters, h) => { handlers = h; subscribe(id, filters, h) }
  const r = collectUntilEose(pool, [{ kinds: [1] }], { onEvent: ev => got.push(ev.id), timeoutMs: 2000 })
  pool.eose('wss://a')
  await r
  handlers.onEvent({ id: 'tardio' }, 'wss://a')
  assert.deepEqual(got, [])
})

// ── Ronda 2: un relay que rechaza la suscripción (CLOSED) ya ha contestado ──

test('RelayPool: CLOSED cuenta como respuesta del relay (no se espera su EOSE)', async () => {
  const { RelayPool } = await import('../js/relay-pool.js')
  const sockets = []
  const RealWS = globalThis.WebSocket
  globalThis.WebSocket = class {
    static CONNECTING = 0
    static OPEN = 1
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this) }
    send(data) { this.sent.push(JSON.parse(data)) }
    close() { this.readyState = 3 }
    open() { this.readyState = 1; this.onopen?.() }
    recv(msg) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  }
  const warn = console.warn
  console.warn = () => {}
  try {
    const pool = new RelayPool(['wss://normal', 'wss://exige-auth'])
    pool.connect()
    sockets.forEach(s => s.open())
    let done = null
    collectUntilEose(pool, [{ kinds: [1985] }], { timeoutMs: 3000 }).then(r => { done = r })
    const subId = sockets[0].sent.find(m => m[0] === 'REQ')[1]

    sockets[0].recv(['EOSE', subId])
    await flush()
    assert.equal(done, null, 'falta el otro relay')
    sockets[1].recv(['CLOSED', subId, 'auth-required: identifícate'])
    await flush()
    assert.deepEqual(done, { complete: true, answered: 2 }, 'no hay que agotar el timeout')
    pool.close()
  } finally {
    console.warn = warn
    globalThis.WebSocket = RealWS
  }
})
