// nip46.js — Cliente NIP-46 (Nostr Connect / "bunker") — ID-001
//
// Amplía SIGN-001/SIGN-002 (NIP-07, Amber) con un tercer firmador remoto:
// una app de firmador (Amber en modo bunker, nsec.app, etc.) que vive en
// OTRO dispositivo o proceso y firma bajo petición, sin exponer nunca la
// clave privada a esta app — igual principio que NIP-07/Amber, protocolo
// distinto.
//
// Dos formas de conectar (BUD/NIP-46):
//   - nostrconnect://  — la app genera la URI (con un par de claves efímero
//     propio + un secreto aleatorio) y la muestra como QR; el firmador la
//     escanea y responde. Es el flujo que implementa este módulo primero.
//   - bunker://        — el firmador genera la URI y el usuario la pega en
//     la app. parseBunkerUri() ya la soporta; falta cablear su UI.
//
// Cifrado NIP-04 por defecto (compatibilidad más amplia hoy); NIP-44 queda
// para cuando se confirme que el firmador remoto lo soporta (mismo patrón
// de negociación que WAL-002 en nwc.js).
//
// Criptografía: mismo bundle vendorizado que nwc.js/relay-pool.js/signer.js
// (js/vendor/nostr-crypto.js) — una sola fuente para todo el proyecto.
//
// ESTADO: protocolo y parsing verificados con tests (ver tests/nip46.test.mjs).
// El intercambio en vivo con un firmador remoto real (Amber bunker, nsec.app)
// NO se ha probado en dispositivo — no cablear un botón de UI hasta hacerlo,
// para no ofrecer un flujo de identidad a medio verificar (mismo criterio
// que MED-001 con Amber).

import { finalizeEvent, getPublicKey, nip04, verifyEvent } from './vendor/nostr-crypto.js'

const KIND_NIP46 = 24133
const REQUEST_TIMEOUT_MS = 30_000 // más que NWC: aquí hay un humano escaneando un QR

function hexToBytes(hex) {
  const m = String(hex).match(/.{2}/g) || []
  return new Uint8Array(m.map(b => parseInt(b, 16)))
}

function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Par de claves efímero para esta sesión de conexión (NO es la identidad del usuario). */
export function generateClientKeypair() {
  const secretHex = randomHex(32)
  const pubkeyHex = getPublicKey(hexToBytes(secretHex))
  return { secretHex, pubkeyHex }
}

/**
 * Construye la URI nostrconnect:// que se muestra como QR. `perms` limita
 * los métodos que el firmador autoriza sin preguntar cada vez (mismo
 * espíritu que AMBER_PERMISSIONS en signer.js).
 */
export function buildNostrconnectUri({ clientPubkey, relay, secret, name, url, perms = [] }) {
  if (!/^[0-9a-f]{64}$/i.test(String(clientPubkey))) throw new Error('clientPubkey inválida')
  if (!relay || !/^wss?:\/\//i.test(relay)) throw new Error('relay inválido')
  if (!secret) throw new Error('falta el secret de la sesión')
  const params = new URLSearchParams()
  params.set('relay', relay)
  params.set('secret', secret)
  if (name) params.set('name', name)
  if (url) params.set('url', url)
  if (perms.length) params.set('perms', perms.join(','))
  return `nostrconnect://${clientPubkey}?${params.toString()}`
}

/** Parsea una URI bunker://<pubkey-firmador>?relay=...&secret=... (flujo alternativo, pegar en vez de escanear). */
export function parseBunkerUri(str) {
  const s = String(str || '').trim()
  if (!/^bunker:\/\//i.test(s)) throw new Error('formato inválido — debe empezar por bunker://')
  const url = new URL(s.replace(/^bunker:\/\//i, 'http://'))
  const signerPubkey = url.hostname.toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(signerPubkey)) throw new Error('pubkey de firmador inválida en la URI')
  const relays = url.searchParams.getAll('relay').filter(r => /^wss?:\/\//i.test(r))
  if (relays.length === 0) throw new Error('la URI no incluye ningún relay válido')
  const secret = url.searchParams.get('secret') || null
  return { signerPubkey, relays, secret }
}

/** Construye el sobre { id, method, params } de una petición NIP-46 (sin cifrar). */
export function buildRequestPayload(method, params = []) {
  return { id: randomHex(8), method, params }
}

/**
 * Interpreta la respuesta YA descifrada de un firmador remoto.
 * @returns {{ok:true, result:any}|{ok:false, error:string}}
 */
export function parseResponsePayload(json, expectedId) {
  let payload
  try { payload = JSON.parse(json) } catch { return { ok: false, error: 'respuesta ilegible del firmador' } }
  if (expectedId && payload.id !== expectedId) return { ok: false, error: 'respuesta de otra petición (id no coincide)' }
  if (payload.error) return { ok: false, error: String(payload.error) }
  if (payload.result === undefined) return { ok: false, error: 'respuesta sin resultado ni error' }
  return { ok: true, result: payload.result }
}

// ── Transporte: WebSocket efímero por petición (mismo patrón que nwc.js) ──────

function nip46Request(session, method, params = [], { timeoutMs = REQUEST_TIMEOUT_MS, expectFrom = null } = {}) {
  return new Promise((resolve, reject) => {
    let ws
    let settled = false
    const secretBytes = hexToBytes(session.clientSecretHex)
    const fail = (msg) => { if (!settled) { settled = true; try { ws?.close() } catch {} ; reject(new Error(msg)) } }
    const done = (val) => { if (!settled) { settled = true; try { ws?.close() } catch {} ; resolve(val) } }
    const timer = setTimeout(() => fail('el firmador remoto no respondió a tiempo'), timeoutMs)
    const target = expectFrom || session.signerPubkey
    const { id, method: m, params: p } = buildRequestPayload(method, params)

    ;(async () => {
      let reqEvent
      try {
        const content = await nip04.encrypt(secretBytes, target, JSON.stringify({ id, method: m, params: p }))
        reqEvent = finalizeEvent({
          kind: KIND_NIP46,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', target]],
          content,
        }, secretBytes)
      } catch (e) { clearTimeout(timer); fail('error cifrando la petición: ' + e.message); return }

      try { ws = new WebSocket(session.relay) } catch { clearTimeout(timer); fail('relay inválido'); return }

      const subId = 'nip46-' + reqEvent.id.slice(0, 8)
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(['REQ', subId, { kinds: [KIND_NIP46], '#p': [session.clientPubkey] }]))
          ws.send(JSON.stringify(['EVENT', reqEvent]))
        } catch (e) { clearTimeout(timer); fail('error enviando al relay: ' + e.message) }
      }
      ws.onerror = () => { clearTimeout(timer); fail('no se pudo conectar con el relay del firmador') }
      ws.onmessage = async ({ data }) => {
        let msg
        try { msg = JSON.parse(data) } catch { return }
        if (!Array.isArray(msg) || msg[0] !== 'EVENT' || msg[1] !== subId) return
        const ev = msg[2]
        if (!ev || ev.kind !== KIND_NIP46) return
        if (expectFrom && ev.pubkey !== expectFrom) return // esperando un remitente concreto (ya conectado)
        let sigOk = false
        try { sigOk = verifyEvent(ev) === true } catch { sigOk = false }
        if (!sigOk) return
        try {
          const plaintext = await nip04.decrypt(secretBytes, ev.pubkey, ev.content)
          const parsed = parseResponsePayload(plaintext, id)
          if (!parsed.ok) return // puede ser un evento de OTRA sesión/petición — seguir esperando
          clearTimeout(timer)
          done({ result: parsed.result, fromPubkey: ev.pubkey })
        } catch { /* no descifra con nuestra clave: no es para nosotros, seguir esperando */ }
      }
    })()
  })
}

/**
 * Flujo nostrconnect://: crea la sesión, espera a que el firmador remoto
 * escanee el QR y responda, y resuelve la pubkey de identidad real del
 * usuario (get_public_key). El llamador es responsable de mostrar
 * buildNostrconnectUri(...) como QR mientras esta promesa está pendiente.
 */
export async function connectNostrconnect({ relay, name, url, perms = ['sign_event', 'get_public_key'] }, timeoutMs = 120_000) {
  const { secretHex: clientSecretHex, pubkeyHex: clientPubkey } = generateClientKeypair()
  const secret = randomHex(16)
  const uri = buildNostrconnectUri({ clientPubkey, relay, secret, name, url, perms })
  const session = { clientSecretHex, clientPubkey, relay, signerPubkey: null }

  // El firmador, al escanear, nos envía un 'connect' cuyo `result` debe ser
  // exactamente nuestro `secret` — así sabemos que respondió a ESTA sesión y
  // no a una QR vieja reutilizada por error.
  const ack = await nip46Request(session, 'connect', [clientPubkey, secret, perms.join(',')], { timeoutMs })
  if (ack.result !== secret) throw new Error('el firmador no confirmó el secreto de conexión esperado')
  session.signerPubkey = ack.fromPubkey

  const pk = await nip46Request(session, 'get_public_key', [], { timeoutMs: REQUEST_TIMEOUT_MS, expectFrom: session.signerPubkey })
  if (!/^[0-9a-f]{64}$/i.test(String(pk.result))) throw new Error('el firmador devolvió una pubkey inválida')

  return { uri, session, userPubkey: String(pk.result).toLowerCase() }
}

/** Firma un evento sin firmar a través del firmador remoto ya conectado. */
export async function nip46Sign(session, unsignedEvent) {
  const res = await nip46Request(session, 'sign_event', [JSON.stringify(unsignedEvent)], { expectFrom: session.signerPubkey })
  let signed
  try { signed = JSON.parse(res.result) } catch { throw new Error('el firmador devolvió un evento ilegible') }
  if (!signed?.sig || !signed?.id) throw new Error('el firmador no devolvió un evento firmado válido')
  return signed
}
