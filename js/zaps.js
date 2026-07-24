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

const WELL_KNOWN_TIMEOUT_MS = 8000

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

export async function requestZapInvoice(params, signedZapRequest, amountMsats) {
  const url = new URL(params.callback)
  url.searchParams.set('amount', String(amountMsats))
  if (params.allowsNostr) url.searchParams.set('nostr', JSON.stringify(signedZapRequest))
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`el servidor de la lightning address rechazó la petición (${res.status})`)
  const json = await res.json()
  if (json.status === 'ERROR') throw new Error(json.reason || 'error del servidor LNURL')
  if (!json.pr) throw new Error('respuesta sin factura (pr)')
  return json.pr
}

/**
 * ZAP-002 — trae y valida los recibos (kind 9735) recibidos por una pubkey.
 * Cada evento pasa por validateZapReceipt() antes de contarse: un relay
 * podría entregar un 9735 falso o mal dirigido, y esta función nunca lo
 * suma al total ni lo devuelve como válido.
 * @returns {Promise<{totalMsats:number, receipts:Array}>}
 */
export function fetchZapReceipts(pool, recipientHex, timeoutMs = 6000) {
  return new Promise(resolve => {
    if (!pool || !recipientHex) { resolve({ totalMsats: 0, receipts: [] }); return }
    const valid = []
    const seenIds = new Set()
    const subId = `zaps-${recipientHex.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      pool.unsubscribe(subId)
      const totalMsats = valid.reduce((sum, r) => sum + (r.amountMsats || 0), 0)
      resolve({ totalMsats, receipts: valid })
    }
    pool.subscribe(subId, [{ kinds: [9735], '#p': [recipientHex], limit: 200 }], {
      onEvent(ev) {
        if (seenIds.has(ev.id)) return
        seenIds.add(ev.id)
        const r = validateZapReceipt(ev, { expectedRecipientHex: recipientHex })
        if (r.ok) valid.push(r)
      },
      onEose: finish,
    })
    setTimeout(finish, timeoutMs)
  })
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
  const unsigned = buildZapRequest({ recipientHex, amountMsats, relays, comment, eventRef, addressableRef }, senderPubHex)
  const signed = await sign(unsigned)
  const bolt11 = await requestZapInvoice(params, signed, amountMsats)
  const payResult = await payInvoice(nwcConn, bolt11)
  return { bolt11, payResult, zapRequest: signed }
}
