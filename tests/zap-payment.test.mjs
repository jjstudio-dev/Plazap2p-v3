// Zap: la factura que se paga debe ser EXACTAMENTE la pedida.
//
// El servidor LNURL lo elige el receptor (su lud16). Antes de la auditoría
// sendZap() pagaba lo que ese servidor devolviera, sin decodificarlo: un
// vendedor podía responder con una factura mayor y cobrarla hasta agotar el
// presupuesto de la conexión NWC del comprador.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sendZap, verifyZapInvoice } from '../js/zaps.js'
import { lnAddressToInvoice } from '../js/nwc.js'
import { SK1, PK1, PK2, signWith } from './fixtures/events.mjs'
import { buildInvoice } from './fixtures/bolt11.mjs'

test('verifyZapInvoice: acepta solo el importe exacto, con importe y sin caducar', () => {
  assert.deepEqual(verifyZapInvoice(buildInvoice({ hrp: 'lnbc210n' }), 21_000), { ok: true })

  const mayor = verifyZapInvoice(buildInvoice({ hrp: 'lnbc10m' }), 21_000)       // 1.000.000 sats por 21
  assert.equal(mayor.ok, false)
  assert.match(mayor.error, /1\.000\.000 sats en vez de los 21 solicitados/)

  assert.equal(verifyZapInvoice(buildInvoice({ hrp: 'lnbc200n' }), 21_000).ok, false, 'tampoco una factura menor')
  assert.equal(verifyZapInvoice(buildInvoice({ hrp: 'lnbc' }), 21_000).ok, false, 'sin importe')
  assert.equal(verifyZapInvoice('lnbc-basura', 21_000).ok, false, 'ilegible')
  assert.equal(verifyZapInvoice(buildInvoice({ hrp: 'lnbc210n', timestamp: 1_600_000_000 }), 21_000).ok, false, 'caducada')
})

/** Sustituye globalThis.fetch por un servidor LNURL simulado que devuelve `invoice`. */
function withLnurlServer(t, invoice, { allowsNostr = true } = {}) {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const calls = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    calls.push(u)
    const json = u.includes('/.well-known/lnurlp/')
      ? { tag: 'payRequest', callback: 'https://ln.example/cb', minSendable: 1000, maxSendable: 10_000_000_000, ...(allowsNostr ? { allowsNostr: true, nostrPubkey: PK2 } : {}) }
      : { pr: invoice }
    return { ok: true, status: 200, json: async () => json }
  }
  return calls
}

const zapArgs = { recipientHex: PK2, recipientLud16: 'vendedor@ln.example', amountMsats: 21_000, relays: ['wss://r.example'] }
const sign = async unsigned => signWith(SK1, unsigned)

test('sendZap: si el servidor devuelve una factura mayor, NO se paga', async (t) => {
  withLnurlServer(t, buildInvoice({ hrp: 'lnbc10m' }))     // pide 21 sats, devuelve 1.000.000
  let paid = 0
  await assert.rejects(
    sendZap(zapArgs, PK1, sign, null, async () => { paid++; return { preimage: 'x' } }),
    /pago cancelado/,
  )
  assert.equal(paid, 0, 'la wallet no debe recibir ninguna orden de pago')
})

test('sendZap: factura sin importe o ilegible tampoco se paga', async (t) => {
  let paid = 0
  const pay = async () => { paid++; return {} }
  withLnurlServer(t, buildInvoice({ hrp: 'lnbc' }))
  await assert.rejects(sendZap(zapArgs, PK1, sign, null, pay), /sin importe/)
  globalThis.fetch = (f => async (url) => {
    const r = await f(url)
    return String(url).includes('lnurlp') ? r : { ok: true, status: 200, json: async () => ({ pr: 'lnbc1basura' }) }
  })(globalThis.fetch)
  await assert.rejects(sendZap(zapArgs, PK1, sign, null, pay), /ilegible/)
  assert.equal(paid, 0)
})

test('sendZap: con la factura correcta paga exactamente esa factura', async (t) => {
  const invoice = buildInvoice({ hrp: 'lnbc210n' })
  const calls = withLnurlServer(t, invoice)
  const paidInvoices = []
  const res = await sendZap(zapArgs, PK1, sign, null, async (_conn, bolt11) => { paidInvoices.push(bolt11); return { preimage: 'abc' } })
  assert.deepEqual(paidInvoices, [invoice])
  assert.equal(res.payResult.preimage, 'abc')
  assert.equal(res.zapRequest.kind, 9734)
  const cb = new URL(calls[1])
  assert.equal(cb.searchParams.get('amount'), '21000')
  assert.ok(cb.searchParams.get('nostr'), 'el zap request firmado viaja en el callback')
})

test('sendZap: si el servidor no admite zaps, no se pide firma ni se paga', async (t) => {
  const calls = withLnurlServer(t, buildInvoice({ hrp: 'lnbc210n' }), { allowsNostr: false })
  let signed = 0
  let paid = 0
  await assert.rejects(
    sendZap(zapArgs, PK1, async u => { signed++; return sign(u) }, null, async () => { paid++; return { preimage: 'x' } }),
    /no admite zaps/,
  )
  assert.equal(signed, 0, 'no se pide una firma que no serviría para nada')
  assert.equal(paid, 0, 'no se paga como si fuera un zap')
  assert.equal(calls.length, 1, 'tampoco se pide la factura')
})

test('lnAddressToInvoice: rechaza una factura que no coincide con el importe pedido', async (t) => {
  withLnurlServer(t, buildInvoice({ hrp: 'lnbc10m' }))
  await assert.rejects(lnAddressToInvoice('vendedor@ln.example', 21), /no coincide con el importe/)
  withLnurlServer(t, buildInvoice({ hrp: 'lnbc210n' }))
  assert.ok((await lnAddressToInvoice('vendedor@ln.example', 21)).startsWith('lnbc210n1'))
})
