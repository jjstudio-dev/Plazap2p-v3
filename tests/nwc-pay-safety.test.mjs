// payInvoiceSafely — un pago cuyo resultado no se conoce no puede presentarse
// como "no pagado". Antes, un timeout de pay_invoice decía "fondos intactos":
// en un zap, repetir el intento pide una factura nueva y se paga dos veces.
//
// Se prueba contra una wallet NWC simulada (cifra y firma de verdad) servida
// por un WebSocket falso — sin red.
import test from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, getPublicKey, nip04 } from '../js/vendor/nostr-crypto.js'
import { payInvoiceSafely, payInvoice, PAYMENT_STATE_UNKNOWN_MSG } from '../js/nwc.js'
import { buildInvoice } from './fixtures/bolt11.mjs'

const SKW = Uint8Array.from({ length: 32 }, (_, i) => i + 50)
const SKC = Uint8Array.from({ length: 32 }, (_, i) => i + 150)
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('')
const conn = { walletPubkey: getPublicKey(SKW), relay: 'wss://wallet.test', secret: hex(SKC), encryption: 'nip04' }
const INVOICE = buildInvoice({ hrp: 'lnbc210n' })

/**
 * Instala un WebSocket falso. `behaviors[método]` decide la respuesta:
 *   { result } | { error } | 'drop' (el relay corta tras recibir la petición)
 *   | 'reject' (el relay responde OK=false) | 'unreachable' (no conecta)
 */
function installWallet(t, behaviors) {
  const Real = globalThis.WebSocket
  t.after(() => { globalThis.WebSocket = Real })
  const calls = []
  globalThis.WebSocket = class {
    constructor() {
      this.readyState = 0
      queueMicrotask(() => {
        if (behaviors.connect === 'unreachable') { this.onerror?.({}); return }
        this.readyState = 1
        this.onopen?.({})
      })
    }
    close() { this.readyState = 3 }
    send(data) {
      const msg = JSON.parse(data)
      if (msg[0] === 'REQ') { this.subId = msg[1]; return }
      if (msg[0] !== 'EVENT') return
      const req = msg[1]
      queueMicrotask(async () => {
        const { method } = JSON.parse(await nip04.decrypt(SKW, req.pubkey, req.content))
        calls.push(method)
        const b = behaviors[method]
        if (b === 'reject') { this.onmessage?.({ data: JSON.stringify(['OK', req.id, false, 'blocked: no admitido']) }); return }
        if (b === 'drop' || !b) { this.readyState = 3; this.onclose?.({}); return }
        const body = JSON.stringify(b.error ? { result_type: method, error: b.error } : { result_type: method, result: b.result })
        const resp = JSON.parse(JSON.stringify(finalizeEvent({
          kind: 23195, created_at: Math.floor(Date.now() / 1000),
          tags: [['p', req.pubkey], ['e', req.id]], content: await nip04.encrypt(SKW, req.pubkey, body),
        }, SKW)))
        this.onmessage?.({ data: JSON.stringify(['EVENT', this.subId, resp]) })
      })
    }
  }
  return calls
}

test('pago confirmado por la wallet → devuelve su resultado', async (t) => {
  const calls = installWallet(t, { pay_invoice: { result: { preimage: 'ab'.repeat(32) } } })
  assert.deepEqual(await payInvoiceSafely(conn, INVOICE), { preimage: 'ab'.repeat(32) })
  assert.deepEqual(calls, ['pay_invoice'])
})

test('rechazo explícito de la wallet → se puede reintentar: no es "estado desconocido"', async (t) => {
  const calls = installWallet(t, { pay_invoice: { error: { code: 'INSUFFICIENT_BALANCE' } } })
  await assert.rejects(payInvoiceSafely(conn, INVOICE), e => e.code === 'WALLET_ERROR' && /Saldo insuficiente/.test(e.message))
  assert.deepEqual(calls, ['pay_invoice'], 'no hace falta consultar nada')
})

test('el relay rechaza la petición → la wallet nunca la recibió: tampoco es desconocido', async (t) => {
  installWallet(t, { pay_invoice: 'reject' })
  await assert.rejects(payInvoiceSafely(conn, INVOICE), e => e.code === 'RELAY_REJECTED')
})

test('no se pudo conectar → la petición no salió: tampoco es desconocido', async (t) => {
  const calls = installWallet(t, { connect: 'unreachable' })
  await assert.rejects(payInvoiceSafely(conn, INVOICE), e => e.code === 'RELAY_UNREACHABLE' && e.sent === false)
  assert.deepEqual(calls, [])
})

test('la respuesta se pierde y la wallet confirma el pago al consultarla → pagado', async (t) => {
  const calls = installWallet(t, { pay_invoice: 'drop', lookup_invoice: { result: { state: 'settled', preimage: 'cd'.repeat(32) } } })
  const res = await payInvoiceSafely(conn, INVOICE)
  assert.equal(res.recovered, true)
  assert.equal(res.preimage, 'cd'.repeat(32))
  assert.deepEqual(calls, ['pay_invoice', 'lookup_invoice'], 'se consulta; NO se reintenta el pago')
})

test('la respuesta se pierde y la consulta no confirma → estado DESCONOCIDO, con aviso de verificar', async (t) => {
  for (const lookup of [{ result: { state: 'pending' } }, 'drop', { error: { code: 'NOT_FOUND' } }]) {
    const calls = installWallet(t, { pay_invoice: 'drop', lookup_invoice: lookup })
    await assert.rejects(payInvoiceSafely(conn, INVOICE), e => {
      assert.equal(e.code, 'PAYMENT_STATE_UNKNOWN')
      assert.equal(e.message, PAYMENT_STATE_UNKNOWN_MSG)
      assert.doesNotMatch(e.message, /intactos/)
      return true
    })
    assert.equal(calls.filter(m => m === 'pay_invoice').length, 1)
  }
})

test('el mensaje de un pago sin respuesta nunca afirma que los fondos están intactos', async (t) => {
  installWallet(t, { pay_invoice: 'drop' })
  await assert.rejects(payInvoice(conn, INVOICE), e => e.sent === true && !/intactos/.test(e.message))
})
