// zaps.js — Tips Lightning con recibo Nostr firmado (NIP-57) — ZAP-001/002.
//
// Un zap NO es solo un pago: es un pago Lightning con un evento Nostr
// público adjunto que dice "quién le mandó cuánto a quién". El recibo lo
// firma la wallet del RECEPTOR (o su proveedor LNURL), nunca esta app — por
// eso hay que verificarlo (ZAP-002) antes de mostrarlo o sumarlo a un total.
//
// Cada función de este archivo hace UNA cosa y no depende de estado global:
// se pueden sustituir, testear o arreglar por separado (p.ej. cambiar solo
// requestZapInvoice si un proveedor LNURL concreto da problemas, sin tocar
// buildZapRequest ni validateZapReceipt).
//
// Flujo de envío (ZAP-001): lud16ToUrl → fetchLnurlPayParams →
//   buildZapRequest (sin firmar) → firmar con la IDENTIDAD (NIP-07/Amber,
//   nunca con la wallet) → requestZapInvoice → pagar vía NWC
//   (nwc.payInvoice ya existente, ver js/nwc.js).
//
// Verificación de recibos (ZAP-002): validateZapReceipt().

import { verifyEvent } from './vendor/nostr-crypto.js'
import { decodeBolt11 } from './nwc.js'
import { collectUntilEose } from './relay-pool.js'

const WELL_KNOWN_TIMEOUT_MS = 8000
const INVOICE_TIMEOUT_MS = 15000

/** user@dominio.com → URL LNURL-pay bien-known. Lanza si el formato no es válido. */
export function lud16ToUrl(lud16) {
  const s = String(lud16 || '').trim()
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(s)
  if (!m) throw new Error('lightning address inválida (formato usuario@dominio)')
  const [, user, domain] = m
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error('dominio de lightning address inválido')
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`
}

/** Valida la forma de una respuesta LNURL-pay ya descargada (no hace la petición). */
export function validateLnurlPayParams(params) {
  if (!params || typeof params !== 'object') return { ok: false, error: 'respuesta LNURL vacía' }
  if (params.tag !== 'payRequest') return { ok: false, error: 'no es un LNURL-pay (tag distinto de payRequest)' }
  if (!params.callback || !/^https:\/\//i.test(params.callback)) return { ok: false, error: 'callback LNURL inválido' }
  if (!Number.isInteger(params.minSendable) || !Number.isInteger(params.maxSendable) || params.minSendable > params.maxSendable)
    return { ok: false, error: 'límites de importe ausentes o inconsistentes' }
  return { ok: true, allowsNostr: params.allowsNostr === true, nostrPubkey: params.nostrPubkey || null }
}

/** Construye el evento kind 9734 (zap request) SIN FIRMAR — lo firma la identidad, no la wallet. */
export function buildZapRequest({ recipientHex, amountMsats, relays, comment = '', eventRef = null, addressableRef = null }, senderPubHex) {
  if (!/^[0-9a-f]{64}$/i.test(String(recipientHex || ''))) throw new Error('pubkey del receptor inválida')
  if (!/^[0-9a-f]{64}$/i.test(String(senderPubHex || ''))) throw new Error('pubkey del remitente inválida')
  if (!Number.isInteger(amountMsats) || amountMsats <= 0) throw new Error('importe inválido (msats enteros > 0)')
  if (!Array.isArray(relays) || relays.length === 0) throw new Error('faltan relays donde publicar el recibo')

  const tags = [
    ['relays', ...relays],
    ['amount', String(amountMsats)],
    ['p', String(recipientHex).toLowerCase()],
  ]
  if (eventRef && /^[0-9a-f]{64}$/i.test(eventRef)) tags.push(['e', eventRef.toLowerCase()])
  if (addressableRef) tags.push(['a', String(addressableRef)])

  return {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: String(comment || '').slice(0, 300),
    pubkey: String(senderPubHex).toLowerCase(),
  }
}

/**
 * ZAP-002 — valida un recibo 9735 antes de contarlo o mostrarlo. Nunca
 * confiar en un recibo solo porque el relay lo entregó: hay que comprobar
 * firma, destinatario y (si se conoce) que lo emitió el proveedor LNURL
 * correcto — cualquiera puede publicar un evento kind 9735 falso.
 */
export function validateZapReceipt(receipt, { expectedRecipientHex, expectedSenderHex = null, lnurlProviderPubkey = null } = {}) {
  if (!receipt || receipt.kind !== 9735) return { ok: false, error: 'no es un recibo de zap (kind 9735)' }

  let sigOk = false
  try { sigOk = verifyEvent(receipt) === true } catch { sigOk = false }
  if (!sigOk) return { ok: false, error: 'firma del recibo inválida' }

  const pTag = receipt.tags?.find(t => t[0] === 'p')?.[1]
  if (!pTag || pTag.toLowerCase() !== String(expectedRecipientHex || '').toLowerCase())
    return { ok: false, error: 'el recibo no está dirigido al receptor esperado' }

  if (lnurlProviderPubkey && receipt.pubkey.toLowerCase() !== String(lnurlProviderPubkey).toLowerCase())
    return { ok: false, error: 'el recibo no lo firmó el proveedor LNURL del receptor' }

  // 'description' trae el zap request original (algunas wallets lo omiten):
  // si está, también se verifica — es la única forma de saber quién zapeó.
  const descriptionRaw = receipt.tags?.find(t => t[0] === 'description')?.[1]
  let zapRequest = null
  if (descriptionRaw) {
    try { zapRequest = JSON.parse(descriptionRaw) } catch { zapRequest = null }
    if (zapRequest) {
      let reqSigOk = false
      try { reqSigOk = verifyEvent(zapRequest) === true } catch { reqSigOk = false }
      if (!reqSigOk) return { ok: false, error: 'el zap request incrustado tiene firma inválida' }
      if (expectedSenderHex && zapRequest.pubkey.toLowerCase() !== String(expectedSenderHex).toLowerCase())
        return { ok: false, error: 'el zap request incrustado no es del remitente esperado' }
    }
  }

  const amountTag = zapRequest?.tags?.find(t => t[0] === 'amount')?.[1]
  return {
    ok: true,
    senderHex: zapRequest?.pubkey || null,
    amountMsats: amountTag ? Number(amountTag) : null,
    comment: zapRequest?.content || '',
    bolt11: receipt.tags?.find(t => t[0] === 'bolt11')?.[1] || null,
    createdAt: receipt.created_at,
  }
}

/**
 * Comprueba que la factura devuelta por el servidor LNURL es EXACTAMENTE por
 * el importe pedido y que no ha caducado. Ese servidor lo elige el receptor
 * (su lud16): sin esta comprobación podría devolver una factura mayor y la
 * wallet la pagaría hasta agotar el presupuesto de la conexión NWC.
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function verifyZapInvoice(bolt11, expectedMsats) {
  let dec
  try { dec = decodeBolt11(bolt11) } catch { return { ok: false, error: 'el servidor devolvió una factura ilegible — pago cancelado' } }
  if (dec.amountMsats == null) return { ok: false, error: 'el servidor devolvió una factura sin importe — pago cancelado' }
  if (dec.amountMsats !== expectedMsats) {
    return { ok: false, error: `el servidor devolvió una factura de ${Math.ceil(dec.amountMsats / 1000).toLocaleString('es-ES')} sats en vez de los ${Math.floor(expectedMsats / 1000).toLocaleString('es-ES')} solicitados — pago cancelado` }
  }
  if (dec.expired) return { ok: false, error: 'el servidor devolvió una factura caducada — pago cancelado' }
  return { ok: true }
}

/**
 * Recibo contable: además de validateZapReceipt(), exige lo necesario para
 * poder sumarlo — zap request incrustado dirigido al mismo receptor, e importe
 * de la factura coherente con el declarado. (Sin conocer el pubkey del
 * proveedor LNURL esto NO prueba el pago: ver el aviso en fetchZapReceipts.)
 * @returns {object|null} el recibo validado con amountMsats fiable, o null
 */
export function countableZapReceipt(receipt, recipientHex) {
  const r = validateZapReceipt(receipt, { expectedRecipientHex: recipientHex })
  if (!r.ok || !r.senderHex) return null
  const descriptionRaw = receipt.tags.find(t => t[0] === 'description')?.[1]
  let zapRequest
  try { zapRequest = JSON.parse(descriptionRaw) } catch { return null }
  if (zapRequest?.kind !== 9734) return null
  const reqP = zapRequest.tags?.find(t => t[0] === 'p')?.[1]
  if (!reqP || reqP.toLowerCase() !== String(recipientHex).toLowerCase()) return null
  if (!r.bolt11) return null
  let invoiceMsats
  try { invoiceMsats = decodeBolt11(r.bolt11).amountMsats } catch { return null }
  if (!Number.isInteger(invoiceMsats) || invoiceMsats <= 0) return null
  if (r.amountMsats != null && r.amountMsats !== invoiceMsats) return null
  return { ...r, amountMsats: invoiceMsats }
}

// ── Orquestación de red (no testeable con node:test sin mocks — ver el
//    resto del proyecto, que tampoco simula relays/HTTP reales) ──────────────

export async function fetchLnurlPayParams(lud16, timeoutMs = WELL_KNOWN_TIMEOUT_MS) {
  const url = lud16ToUrl(lud16)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`la lightning address respondió ${res.status}`)
    const json = await res.json()
    const v = validateLnurlPayParams(json)
    if (!v.ok) throw new Error(v.error)
    return { ...json, allowsNostr: v.allowsNostr, nostrPubkey: v.nostrPubkey }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('la lightning address no respondió a tiempo')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export async function requestZapInvoice(params, signedZapRequest, amountMsats, timeoutMs = INVOICE_TIMEOUT_MS) {
  const url = new URL(params.callback)
  url.searchParams.set('amount', String(amountMsats))
  if (params.allowsNostr) url.searchParams.set('nostr', JSON.stringify(signedZapRequest))
  // Con tiempo límite: con el servidor colgado, el botón se quedaba girando
  // para siempre (VW2-05). Aquí todavía no se ha pagado nada.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url.toString(), { signal: ctrl.signal })
    if (!res.ok) throw new Error(`el servidor de la lightning address rechazó la petición (${res.status})`)
    const json = await res.json()
    if (json.status === 'ERROR') throw new Error(json.reason || 'error del servidor LNURL')
    if (!json.pr) throw new Error('respuesta sin factura (pr)')
    return json.pr
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('el servidor de la lightning address no devolvió la factura a tiempo; no se ha pagado nada')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * ZAP-002 — trae los recibos (kind 9735) dirigidos a una pubkey y devuelve
 * solo los que pasan countableZapReceipt().
 *
 * LÍMITE CONOCIDO: aquí no se contrasta que el recibo lo firmó el proveedor
 * LNURL del receptor (haría falta pedir su lud16 a un servidor que él
 * controla, cada vez que alguien abre su anuncio). Sin eso, firma y formato
 * son válidos pero cualquiera puede publicar un recibo: la interfaz debe
 * presentarlo como "recibos públicos", nunca como pagos verificados. Por eso
 * no se devuelve ninguna suma: el propio receptor puede publicar un recibo
 * con la factura que quiera, y una cifra de dinero daría a entender un pago.
 * @returns {Promise<{receipts:Array}>}
 */
export async function fetchZapReceipts(pool, recipientHex, timeoutMs = 6000) {
  if (!pool || !recipientHex) return { receipts: [] }
  const valid = []
  const seenIds = new Set()
  await collectUntilEose(pool, [{ kinds: [9735], '#p': [recipientHex], limit: 200 }], {
    timeoutMs,
    prefix: 'zaps',
    onEvent(ev) {
      if (seenIds.has(ev.id)) return
      seenIds.add(ev.id)
      const r = countableZapReceipt(ev, recipientHex)
      if (r) valid.push(r)
    },
  })
  return { receipts: valid }
}

/**
 * Orquesta el envío completo de un zap. `sign` firma con la IDENTIDAD
 * (signer.nip07Sign, normalmente) — NUNCA con la wallet. `payInvoice` es
 * nwc.payInvoice ya existente, inyectado para no acoplar este módulo a NWC.
 */
export async function sendZap({ recipientHex, recipientLud16, amountMsats, relays, comment = '', eventRef = null, addressableRef = null }, senderPubHex, sign, nwcConn, payInvoice) {
  const params = await fetchLnurlPayParams(recipientLud16)
  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    throw new Error(`importe fuera de rango (${Math.ceil(params.minSendable / 1000)}-${Math.floor(params.maxSendable / 1000)} sats)`)
  }
  // Sin soporte de zaps el servidor cobraría un pago normal, sin recibo público:
  // se avisa antes de pedir una firma que no serviría y de mover dinero.
  if (!params.allowsNostr) {
    throw new Error('el servidor de esta lightning address no admite zaps: no habría recibo público. Puedes pagarle desde tu wallet como un pago normal.')
  }
  const unsigned = buildZapRequest({ recipientHex, amountMsats, relays, comment, eventRef, addressableRef }, senderPubHex)
  const signed = await sign(unsigned)
  const bolt11 = await requestZapInvoice(params, signed, amountMsats)
  // A partir de aquí se mueve dinero: la factura viene de un servidor ajeno.
  const invoiceCheck = verifyZapInvoice(bolt11, amountMsats)
  if (!invoiceCheck.ok) throw new Error(invoiceCheck.error)
  const payResult = await payInvoice(nwcConn, bolt11)
  return { bolt11, payResult, zapRequest: signed }
}
