// nwc.js — Cliente Nostr Wallet Connect (NIP-47)
//
// PRINCIPIO DE SEGURIDAD: la app NUNCA custodia fondos. Solo guarda el string
// de conexión NWC (credencial revocable, limitada por el presupuesto que el
// usuario configura en SU wallet). El `secret` de la conexión es una clave
// efímera exclusiva de esta conexión — NO es la identidad Nostr del usuario.
//
// La criptografía viene del bundle pineado js/vendor/nostr-crypto.js
// (nostr-tools 2.23.5), compartido con relay-pool.js y signer.js (SEC-001/002).
//
// Protocolo: petición kind 23194 (cifrada al pubkey de la wallet) → respuesta
// kind 23195 (cifrada al pubkey del cliente) via el relay indicado en el
// string de conexión. Cifrado: NIP-44 v2 si la wallet lo anuncia en su evento
// info (kind 13194, tag 'encryption'); si no, NIP-04 (legacy, por defecto).
//
// WAL-002: toda respuesta se verifica (firma+id, autor, tags e/p y
// result_type) ANTES de descifrarse o de tocar la UI.
//
// La persistencia de la conexión vive en wallet-session.js (WAL-001) — este
// módulo no guarda nada.

import { finalizeEvent, getPublicKey, nip04, nip44, verifyEvent } from './vendor/nostr-crypto.js'

const REQUEST_TIMEOUT_MS = 10_000

// W6: códigos de error NWC → mensajes claros en español
const ERROR_ES = {
  RATE_LIMITED:        'La wallet está limitando peticiones — espera un momento',
  NOT_IMPLEMENTED:     'Tu wallet no soporta esta operación',
  INSUFFICIENT_BALANCE:'Saldo insuficiente en la wallet',
  QUOTA_EXCEEDED:      'Presupuesto de la conexión agotado — ajústalo en tu wallet',
  RESTRICTED:          'La conexión no tiene permiso para esta operación',
  UNAUTHORIZED:        'Conexión no autorizada — reconecta la wallet',
  INTERNAL:            'Error interno de la wallet',
  PAYMENT_FAILED:      'El pago falló (sin ruta o rechazado)',
  NOT_FOUND:           'Factura no encontrada',
  OTHER:               'Error desconocido de la wallet',
}

function hexToBytes(hex) {
  const m = String(hex).match(/.{2}/g) || []
  return new Uint8Array(m.map(b => parseInt(b, 16)))
}

// ── Conexión ──────────────────────────────────────────────────────────────────

/**
 * Parsea un string nostr+walletconnect://... Devuelve la conexión o lanza.
 * No re-exportamos el secret fuera de este módulo más que para persistirlo.
 */
export function parseConnectionString(str) {
  const s = String(str || '').trim()
  if (!/^nostr\+walletconnect:\/\//i.test(s)) throw new Error('formato inválido — debe empezar por nostr+walletconnect://')
  const url = new URL(s.replace(/^nostr\+walletconnect:\/\//i, 'http://'))
  const walletPubkey = url.hostname.toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(walletPubkey)) throw new Error('pubkey de wallet inválida en el string')
  const relay = url.searchParams.get('relay')
  const secret = (url.searchParams.get('secret') || '').toLowerCase()
  if (!relay || !/^wss?:\/\//.test(relay)) throw new Error('el string no incluye un relay válido')
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('el string no incluye un secret válido')
  const lud16 = url.searchParams.get('lud16') || null
  return { walletPubkey, relay, secret, lud16 }
}

/**
 * WAL-002: valida un evento de respuesta NWC antes de usarlo.
 *   - kind 23195, autor = wallet, firma e id verificados (Schnorr)
 *   - tag `e` = id de NUESTRA petición (un relay malicioso puede ignorar
 *     los filtros del REQ, así que se re-valida sobre el evento)
 *   - tag `p` = pubkey del cliente de esta conexión
 * Exportada para poder testearla con fixtures adulterados.
 */
export function isValidNwcResponse(ev, { reqId, clientPubkey, walletPubkey }) {
  if (!ev || ev.kind !== 23195) return false
  if (typeof ev.pubkey !== 'string' || ev.pubkey.toLowerCase() !== String(walletPubkey).toLowerCase()) return false
  if (!Array.isArray(ev.tags)) return false
  if (reqId && !ev.tags.some(t => Array.isArray(t) && t[0] === 'e' && t[1] === reqId)) return false
  if (clientPubkey && !ev.tags.some(t => Array.isArray(t) && t[0] === 'p' && t[1] === clientPubkey)) return false
  try { return verifyEvent(ev) === true } catch { return false }
}

// ── Transporte: un WebSocket efímero por petición ─────────────────────────────
// El relay de la wallet es independiente del pool de la app. Una conexión
// corta por petición evita estado colgante (patrón del bot en CF Workers).

// Los rechazos de nwcRequest llevan:
//   .code  TIMEOUT | CONNECTION_LOST | RELAY_UNREACHABLE | RELAY_REJECTED |
//          WALLET_ERROR | UNREADABLE | INTERNAL
//   .sent  true si la petición YA había salido hacia el relay. Para
//          pay_invoice esa es la frontera: antes de salir no hubo pago; después,
//          y sin una respuesta explícita de la wallet, el resultado se
//          DESCONOCE (ver payInvoiceSafely).
function nwcRequest(conn, method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let ws
    let settled = false
    let sent = false
    const secretBytes = hexToBytes(conn.secret)
    const clientPubkey = getPublicKey(secretBytes)
    const useNip44 = conn.encryption === 'nip44_v2'

    // walletCode: el código que dio la propia wallet (RESTRICTED, UNAUTHORIZED…),
    // solo cuando code es WALLET_ERROR.
    const fail = (msg, code = 'INTERNAL', walletCode = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws?.close() } catch {}
      reject(Object.assign(new Error(msg), { code, sent, walletCode }))
    }
    const done = (val) => { if (!settled) { settled = true; clearTimeout(timer); try { ws?.close() } catch {} ; resolve(val) } }
    // "Fondos intactos" solo es verdad si la operación no mueve dinero: un
    // pay_invoice sin respuesta puede haberse pagado igualmente.
    const timeoutMsg = method === 'pay_invoice'
      ? 'la wallet no respondió (timeout)'
      : 'wallet no alcanzable (timeout) — fondos intactos'
    const timer = setTimeout(() => fail(timeoutMsg, 'TIMEOUT'), timeoutMs)

    const encrypt = async (plaintext) => {
      if (useNip44) return nip44.encrypt(plaintext, nip44.getConversationKey(secretBytes, conn.walletPubkey))
      return nip04.encrypt(secretBytes, conn.walletPubkey, plaintext)
    }
    const decrypt = async (payload) => {
      // Algunas wallets responden en nip04 aunque anuncien nip44: probar ambos
      try {
        if (useNip44) return nip44.decrypt(payload, nip44.getConversationKey(secretBytes, conn.walletPubkey))
        return await nip04.decrypt(secretBytes, conn.walletPubkey, payload)
      } catch {
        return useNip44
          ? nip04.decrypt(secretBytes, conn.walletPubkey, payload)
          : nip44.decrypt(payload, nip44.getConversationKey(secretBytes, conn.walletPubkey))
      }
    }

    ;(async () => {
      let reqEvent
      try {
        const content = await encrypt(JSON.stringify({ method, params }))
        const tags = [['p', conn.walletPubkey]]
        if (useNip44) tags.push(['encryption', 'nip44_v2'])
        reqEvent = finalizeEvent({
          kind: 23194,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content,
        }, secretBytes)
      } catch (e) { fail('error cifrando la petición: ' + e.message); return }

      try { ws = new WebSocket(conn.relay) } catch (e) { fail('relay de wallet inválido', 'RELAY_UNREACHABLE'); return }

      const subId = 'nwc-' + reqEvent.id.slice(0, 8)
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(['REQ', subId, { kinds: [23195], '#e': [reqEvent.id], '#p': [clientPubkey] }]))
          ws.send(JSON.stringify(['EVENT', reqEvent]))
          sent = true
        } catch (e) { fail('error enviando al relay: ' + e.message, 'RELAY_UNREACHABLE') }
      }
      ws.onerror = () => fail('no se pudo conectar con el relay de la wallet', 'RELAY_UNREACHABLE')
      // El relay corta sin que haya llegado respuesta: no esperar al timeout.
      ws.onclose = () => fail('se perdió la conexión con el relay de la wallet', 'CONNECTION_LOST')
      ws.onmessage = async ({ data }) => {
        let msg
        try { msg = JSON.parse(data) } catch { return }
        if (!Array.isArray(msg)) return
        if (msg[0] === 'OK' && msg[1] === reqEvent.id && msg[2] === false) {
          // El relay no aceptó la petición: la wallet nunca la recibió.
          fail('el relay rechazó la petición: ' + (msg[3] || ''), 'RELAY_REJECTED')
          return
        }
        if (msg[0] !== 'EVENT' || msg[1] !== subId) return
        const ev = msg[2]
        // WAL-002: firma, autor y referencias verificados antes de descifrar
        if (!isValidNwcResponse(ev, { reqId: reqEvent.id, clientPubkey, walletPubkey: conn.walletPubkey })) return
        try {
          const payload = JSON.parse(await decrypt(ev.content))
          // result_type debe corresponder al método pedido. Algunas wallets lo
          // omiten → solo rechazar (seguir esperando) si está presente y difiere.
          if (payload.result_type && payload.result_type !== method) return
          if (payload.error) {
            const code = payload.error.code || 'OTHER'
            fail(ERROR_ES[code] || payload.error.message || ERROR_ES.OTHER, 'WALLET_ERROR', code)
          } else {
            done(payload.result)
          }
        } catch (e) { fail('respuesta ilegible de la wallet: ' + e.message, 'UNREADABLE') }
      }
    })()
  })
}

/**
 * Lee el evento info (kind 13194) de la wallet: métodos soportados y esquema
 * de cifrado. Actualiza conn.encryption / conn.methods. W5: negociación.
 */
export function fetchWalletInfo(conn, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let ws
    let settled = false
    const fail = (m) => { if (!settled) { settled = true; try { ws?.close() } catch {} ; reject(new Error(m)) } }
    const done = (v) => { if (!settled) { settled = true; try { ws?.close() } catch {} ; resolve(v) } }
    const timer = setTimeout(() => fail('la wallet no publicó su info (¿relay correcto?)'), timeoutMs)

    try { ws = new WebSocket(conn.relay) } catch { clearTimeout(timer); fail('relay de wallet inválido'); return }
    ws.onopen = () => {
      try { ws.send(JSON.stringify(['REQ', 'nwc-info', { kinds: [13194], authors: [conn.walletPubkey], limit: 1 }])) }
      catch (e) { clearTimeout(timer); fail(e.message) }
    }
    ws.onerror = () => { clearTimeout(timer); fail('no se pudo conectar con el relay de la wallet') }
    // Si el relay corta, se sabe ya: antes se esperaban los 8 s completos (VW2-04).
    ws.onclose = () => { clearTimeout(timer); fail('el relay de la wallet cerró la conexión') }
    ws.onmessage = ({ data }) => {
      let msg
      try { msg = JSON.parse(data) } catch { return }
      if (!Array.isArray(msg)) return   // `null` o un objeto: no es un mensaje de relay
      if (msg[0] === 'EVENT' && msg[1] === 'nwc-info' && msg[2]?.kind === 13194) {
        const ev = msg[2]
        // WAL-002: el info debe estar firmado por la wallet — un relay no
        // puede inventar métodos ni degradar el cifrado a NIP-04.
        let sigOk = false
        try { sigOk = ev.pubkey === conn.walletPubkey && verifyEvent(ev) === true } catch { sigOk = false }
        if (!sigOk) return
        clearTimeout(timer)
        const methods = String(ev.content || '').trim().split(/\s+/).filter(Boolean)
        const encTag = ev.tags?.find(t => t[0] === 'encryption')?.[1] || ''
        const encryption = /nip44[_-]?v2/i.test(encTag) ? 'nip44_v2' : 'nip04'
        done({ methods, encryption })
      } else if (msg[0] === 'EOSE' && msg[1] === 'nwc-info') {
        clearTimeout(timer)
        fail('la wallet no publicó su evento info en este relay')
      }
    }
  })
}

// ── Permisos de la conexión ───────────────────────────────────────────────────

/**
 * ¿Anuncia la wallet que esta conexión puede consultar el saldo? Una conexión
 * que solo permite pagar no lo anuncia. Sin lista de métodos no se sabe: se
 * intenta.
 */
export function announcesBalance(methods) {
  return !Array.isArray(methods) || methods.length === 0 || methods.includes('get_balance')
}

/**
 * La wallet contestó que esta conexión no puede hacer esa operación. Es una
 * respuesta cifrada y firmada por la wallet, así que la conexión funciona: solo
 * le falta ese permiso. UNAUTHORIZED no cuenta: ahí es la conexión la que no vale.
 */
export function isOperationNotAllowed(e) {
  return e?.code === 'WALLET_ERROR' &&
    (e.walletCode === 'RESTRICTED' || e.walletCode === 'NOT_IMPLEMENTED')
}

// ── Métodos NWC ───────────────────────────────────────────────────────────────

export const getBalance   = (conn) => nwcRequest(conn, 'get_balance')                    // → { balance } msats
export const getInfo      = (conn) => nwcRequest(conn, 'get_info')
export const makeInvoice  = (conn, amountSats, description = '') =>
  nwcRequest(conn, 'make_invoice', { amount: Math.round(amountSats * 1000), description })  // → { invoice, ... }
export const payInvoice   = (conn, bolt11) =>
  nwcRequest(conn, 'pay_invoice', { invoice: bolt11 }, 30_000)                           // → { preimage }
export const lookupInvoice = (conn, { paymentHash = null, invoice = null } = {}) =>
  nwcRequest(conn, 'lookup_invoice', paymentHash ? { payment_hash: paymentHash } : { invoice })

export const PAYMENT_STATE_UNKNOWN_MSG =
  '⚠️ No se pudo confirmar el pago — VERIFICA EN TU WALLET antes de reintentar (riesgo de doble pago)'

/**
 * pay_invoice con el resultado dicho con verdad. Tres desenlaces:
 *   - pagado          → { preimage, … } (o { recovered:true } si la respuesta
 *                       se perdió pero lookup_invoice confirma el pago)
 *   - NO pagado       → lanza el error de la wallet / del relay (se puede reintentar)
 *   - no se sabe      → lanza un Error con code 'PAYMENT_STATE_UNKNOWN'
 *
 * El tercero es el que importa: si la petición salió y la respuesta no llegó
 * (timeout, conexión cortada, respuesta ilegible), decir "fondos intactos"
 * invita a repetir el pago. En un zap cada intento pide una factura NUEVA,
 * así que repetir es pagar dos veces.
 */
export async function payInvoiceSafely(conn, bolt11) {
  try {
    return await payInvoice(conn, bolt11)
  } catch (e) {
    const explicitNo = e.code === 'WALLET_ERROR' || e.code === 'RELAY_REJECTED'
    if (explicitNo || !e.sent) throw e   // la wallet dijo que no, o la petición no llegó a salir

    let paymentHash = null
    try { paymentHash = decodeBolt11(bolt11).paymentHash } catch { /* sin hash no se puede consultar */ }
    if (paymentHash) {
      try {
        const st = await lookupInvoice(conn, { paymentHash })
        if (st?.preimage || st?.settled_at || st?.state === 'settled') {
          return { ...st, preimage: st.preimage ?? null, recovered: true }
        }
      } catch { /* la consulta tampoco respondió: sigue sin saberse */ }
    }
    throw Object.assign(new Error(PAYMENT_STATE_UNKNOWN_MSG), { code: 'PAYMENT_STATE_UNKNOWN', cause: e })
  }
}

// ── Decodificador BOLT11 mínimo (W4) ─────────────────────────────────────────
// Solo extrae lo necesario para la pantalla de confirmación: importe,
// descripción, timestamp y expiración. Sin verificación de firma (la hace la
// wallet al pagar) pero SÍ verificación de checksum bech32.

const B32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const B32_MAP = Object.fromEntries([...B32_CHARSET].map((c, i) => [c, i]))
const B32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function b32Polymod(values) {
  let c = 1
  for (const v of values) {
    const c0 = c >>> 25
    c = ((c & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((c0 >> i) & 1) c ^= B32_GEN[i]
  }
  return c
}

function b32HrpExpand(hrp) {
  const r = []
  for (const ch of hrp) r.push(ch.charCodeAt(0) >> 5)
  r.push(0)
  for (const ch of hrp) r.push(ch.charCodeAt(0) & 31)
  return r
}

/**
 * Decodifica una factura BOLT11 (solo campos de UI).
 * @returns {{ amountSats:number|null, amountMsats:number|null, description:string, timestamp:number, expiry:number, expired:boolean, paymentHash:string|null }}
 * @throws si el formato o el checksum no son válidos
 */
export function decodeBolt11(invoice) {
  const s = String(invoice || '').trim().toLowerCase().replace(/^lightning:/, '')
  const pos = s.lastIndexOf('1')
  if (pos < 1) throw new Error('factura inválida')
  const hrp = s.slice(0, pos)
  const dataChars = s.slice(pos + 1)
  const data = []
  for (const ch of dataChars) {
    const v = B32_MAP[ch]
    if (v === undefined) throw new Error('factura inválida (caracteres)')
    data.push(v)
  }
  if (b32Polymod([...b32HrpExpand(hrp), ...data]) !== 1) throw new Error('factura inválida (checksum)')

  const m = /^ln(bc|tb|tbs|bcrt)(\d*)([munp]?)$/.exec(hrp)
  if (!m) throw new Error('no es una factura Lightning')
  // Testnet, signet y regtest no mueven dinero real: enseñar su importe en
  // sats como si fuera una factura normal es engañoso (VW2-07).
  if (m[1] !== 'bc') throw new Error('factura de una red de pruebas: no es dinero real')

  // Importe: hrp → msats exactos (m=milli, u=micro, n=nano, p=pico de BTC).
  // 1 BTC = 1e11 msat; se opera en enteros para poder comparar con el
  // importe solicitado sin errores de coma flotante.
  let amountMsats = null
  let amountSats = null
  if (m[2]) {
    const msatPerUnit = { '': 1e11, m: 1e8, u: 1e5, n: 1e2, p: 0.1 }[m[3] ?? '']
    amountMsats = m[3] === 'p' ? Number(m[2]) / 10 : Number(m[2]) * msatPerUnit
    amountSats = Math.round(amountMsats / 1000)
  }

  // Los últimos 104 words son la firma (520 bits): NO son campos etiquetados.
  // Leerlos como tales corrompía expiry/descripción/payment hash cuando los
  // primeros words de la firma coincidían con un tipo conocido.
  const SIG_WORDS = 104
  const withSig = data.slice(0, -6)   // sin checksum
  if (withSig.length < 7 + SIG_WORDS) throw new Error('factura truncada')
  const payload = withSig.slice(0, -SIG_WORDS)
  let timestamp = 0
  for (let i = 0; i < 7; i++) timestamp = timestamp * 32 + payload[i]

  // Campos etiquetados: [tipo(1), len(2), datos(len)]
  let expiry = 3600   // default BOLT11
  let description = ''
  let paymentHash = null
  let i = 7
  while (i + 3 <= payload.length) {
    const type = payload[i]
    const len = payload[i + 1] * 32 + payload[i + 2]
    const words = payload.slice(i + 3, i + 3 + len)
    i += 3 + len
    if (words.length < len) break
    if (type === 6) {          // x — expiry
      expiry = words.reduce((acc, w) => acc * 32 + w, 0)
    } else if (type === 13) {  // d — description
      description = wordsToUtf8(words)
    } else if (type === 1) {   // p — payment hash
      paymentHash = wordsToHex(words).slice(0, 64)
    }
  }

  return {
    amountSats, amountMsats, description, timestamp, expiry, paymentHash,
    expired: (timestamp + expiry) * 1000 < Date.now(),
  }
}

function wordsToBytes(words) {
  const bytes = []
  let acc = 0, bits = 0
  for (const w of words) {
    acc = (acc << 5) | w
    bits += 5
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff) }
  }
  return bytes
}
const wordsToUtf8 = w => { try { return new TextDecoder().decode(new Uint8Array(wordsToBytes(w))) } catch { return '' } }
const wordsToHex = w => wordsToBytes(w).map(b => b.toString(16).padStart(2, '0')).join('')

// ── LNURL-pay (lud16) para el botón "⚡ Pagar" en anuncios ───────────────────

/**
 * Resuelve una Lightning address (user@dominio) a una factura BOLT11.
 * @returns {Promise<string>} bolt11
 */
export async function lnAddressToInvoice(lud16, amountSats, comment = '') {
  const m = /^([\w.+-]+)@([\w.-]+\.[a-z]{2,})$/i.exec(String(lud16 || '').trim())
  if (!m) throw new Error('Lightning address inválida')
  const metaRes = await fetch(`https://${m[2]}/.well-known/lnurlp/${m[1]}`)
  if (!metaRes.ok) throw new Error('el servidor LNURL no respondió')
  const meta = await metaRes.json()
  if (meta.status === 'ERROR') throw new Error(meta.reason || 'error LNURL')
  const msats = Math.round(amountSats * 1000)
  if (msats < meta.minSendable || msats > meta.maxSendable)
    throw new Error(`importe fuera de rango (${Math.ceil(meta.minSendable / 1000)}–${Math.floor(meta.maxSendable / 1000)} sats)`)
  const cbUrl = new URL(meta.callback)
  // Solo https: por http en claro, cualquiera en la ruta de red podría cambiar
  // la factura por una suya del mismo importe (misma regla que zaps.js y Android).
  if (cbUrl.protocol !== 'https:') throw new Error('callback LNURL inválido')
  cbUrl.searchParams.set('amount', String(msats))
  if (comment && meta.commentAllowed) cbUrl.searchParams.set('comment', comment.slice(0, meta.commentAllowed))
  const invRes = await fetch(cbUrl)
  if (!invRes.ok) throw new Error('el servidor LNURL no emitió la factura')
  const inv = await invRes.json()
  if (inv.status === 'ERROR' || !inv.pr) throw new Error(inv.reason || 'el servidor LNURL no emitió la factura')
  // El servidor es de la otra parte: nunca devolver una factura cuyo importe
  // no sea exactamente el solicitado.
  if (decodeBolt11(inv.pr).amountMsats !== msats) throw new Error('la factura recibida no coincide con el importe solicitado')
  return inv.pr
}
