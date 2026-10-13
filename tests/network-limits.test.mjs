// Peticiones a servicios ajenos: tiempo límite, cortes de conexión y
// respuestas que no son las pedidas (VW2-04, VW2-05, VW2-07, VW3-07, VW3-10).
// Se sustituyen fetch y WebSocket globales por dobles; ninguna sale a la red.
import test from 'node:test'
import assert from 'node:assert/strict'
import { requestZapInvoice } from '../js/zaps.js'
import { uploadBlob } from '../js/media-upload.js'
import { fetchWalletInfo, decodeBolt11 } from '../js/nwc.js'
import { buildInvoice } from './fixtures/bolt11.mjs'

const realFetch = globalThis.fetch
const realWebSocket = globalThis.WebSocket
const restore = () => { globalThis.fetch = realFetch; globalThis.WebSocket = realWebSocket }

/** fetch que no contesta nunca, pero respeta la señal de aborto como el real. */
const hangingFetch = () => (_url, init = {}) => new Promise((_, reject) => {
  init.signal?.addEventListener('abort', () => {
    const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
  })
})
const jsonFetch = (body, status = 200) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const FILE = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
const AUTH = { id: 'a'.repeat(64), kind: 24242, tags: [], content: '', sig: 'b'.repeat(128), pubkey: 'c'.repeat(64), created_at: 1 }

test('zap: si el servidor no devuelve la factura a tiempo, se corta y se dice que no se pagó', async t => {
  t.after(restore)
  globalThis.fetch = hangingFetch()
  const inicio = Date.now()
  await assert.rejects(
    requestZapInvoice({ callback: 'https://pagos.test/cb', allowsNostr: false }, null, 21000, 60),
    /no devolvió la factura a tiempo; no se ha pagado nada/)
  assert.ok(Date.now() - inicio < 2000)
})

test('zap: una respuesta normal sigue devolviendo la factura', async t => {
  t.after(restore)
  globalThis.fetch = jsonFetch({ pr: 'lnbc1factura' })
  assert.equal(await requestZapInvoice({ callback: 'https://pagos.test/cb', allowsNostr: false }, null, 21000), 'lnbc1factura')
})

test('foto: si el servidor de imágenes no responde, la subida se corta', async t => {
  t.after(restore)
  globalThis.fetch = hangingFetch()
  await assert.rejects(uploadBlob('https://fotos.test', FILE, AUTH, { timeoutMs: 60 }), /no respondió a tiempo/)
})

test('foto: la huella que devuelve el servidor tiene que ser la de la foto enviada', async t => {
  t.after(restore)
  const mia = 'a'.repeat(64)
  globalThis.fetch = jsonFetch({ url: 'https://fotos.test/otra.jpg', sha256: 'b'.repeat(64) })
  await assert.rejects(uploadBlob('https://fotos.test', FILE, AUTH, { expectedSha256: mia }), /no es la foto enviada/)

  globalThis.fetch = jsonFetch({ url: 'https://fotos.test/sin-huella.jpg' })
  await assert.rejects(uploadBlob('https://fotos.test', FILE, AUTH, { expectedSha256: mia }), /no es la foto enviada/)

  globalThis.fetch = jsonFetch({ url: 'https://fotos.test/mia.jpg', sha256: mia.toUpperCase() })
  assert.equal(await uploadBlob('https://fotos.test', FILE, AUTH, { expectedSha256: mia }), 'https://fotos.test/mia.jpg')
})

test('factura de una red de pruebas no se acepta como si fuera dinero real', () => {
  assert.equal(decodeBolt11(buildInvoice({ hrp: 'lnbc21u' })).amountSats, 2100)
  for (const hrp of ['lntb21u', 'lnbcrt21u', 'lntbs21u']) {
    assert.throws(() => decodeBolt11(buildInvoice({ hrp })), /red de pruebas/, hrp)
  }
})

/** WebSocket que conecta y luego hace lo que diga `script(ws)`. */
function fakeWebSocket(script) {
  return class {
    constructor() { queueMicrotask(() => { this.onopen?.(); script(this) }) }
    send() {}
    close() {}
  }
}
const CONN = { relay: 'wss://wallet.test', walletPubkey: 'd'.repeat(64) }

test('wallet: si el relay corta, conectar falla enseguida en vez de esperar el tiempo límite', async t => {
  t.after(restore)
  globalThis.WebSocket = fakeWebSocket(ws => ws.onclose?.())
  const inicio = Date.now()
  await assert.rejects(fetchWalletInfo(CONN, 5000), /cerró la conexión/)
  assert.ok(Date.now() - inicio < 1000, 'no espera los 5 s')
})

test('wallet: un mensaje del relay que no es una lista se ignora sin romper', async t => {
  t.after(restore)
  globalThis.WebSocket = fakeWebSocket(ws => {
    for (const raro of ['null', '{"a":1}', '7', '"texto"', 'no es json']) ws.onmessage?.({ data: raro })
    ws.onmessage?.({ data: JSON.stringify(['EOSE', 'nwc-info']) })
  })
  await assert.rejects(fetchWalletInfo(CONN, 5000), /no publicó su evento info/)
})
