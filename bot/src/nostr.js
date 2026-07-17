// nostr.js — publicación y lectura de eventos Nostr
// Compatible con Cloudflare Workers: usa la WebSocket API global nativa (sin 'ws' ni 'fs').
//
// Patrón de WebSocket usado en todo el módulo:
//   - connectRelay() abre la conexión y mapea los listeners nativos a callbacks simples.
//   - Cada función que abre conexiones usa Promise.allSettled o un patrón manual
//     con contador de completados (completed / eoseCount) para esperar a todos los relays.
//   - Los timeouts se limpian SIEMPRE antes de resolver/rechazar para evitar callbacks tardíos.

import { finalizeEvent, nip19, verifyEvent } from 'nostr-tools'
import { escMd, sanitizeContact } from './utils.js'

export const RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
  'wss://purplepag.es',
  'wss://nostr.mom',
]

function getSecretKey(nsec) {
  if (!nsec) throw new Error('BOT_NSEC no configurado')
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('BOT_NSEC no es una clave nsec válida')
  return decoded.data
}

// WebSocket nativo (global en CF Workers y navegadores)
// usa addEventListener en vez de .on(), el mensaje llega en event.data
function connectRelay(url, onOpen, onMessage, onError) {
  const ws = new WebSocket(url)
  ws.addEventListener('open', onOpen)
  ws.addEventListener('message', (event) => {
    try { onMessage(JSON.parse(event.data)) } catch (e) { console.warn(`relay parse error [${url}]:`, e.message) }
  })
  ws.addEventListener('error', onError || (() => {}))
  ws.addEventListener('close', () => {})
  return ws
}

/**
 * Publica un evento Nostr en todos los relays configurados.
 * @param {string} botNsec       — clave privada nsec1... del bot
 * @param {Array}  tags          — tags NIP-01 del evento
 * @param {string} content       — contenido del evento
 * @param {number} kind          — kind Nostr (30402 clasificados, 31922 eventos de calendario)
 * @param {string} [userPubHex]  — si se pasa, añade ["p", userPubHex] al evento (Modo Perfil)
 */
export async function publishEvent(botNsec, tags, content, kind = 30402, userPubHex = null) {
  if (!Number.isInteger(kind) || kind < 0) throw new Error(`kind inválido: ${kind}`)
  const sk = getSecretKey(botNsec)
  const randBytes = new Uint8Array(4)
  crypto.getRandomValues(randBytes)
  const uid = `plazap2p-bot-${Date.now()}-${Array.from(randBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`

  // En Modo Perfil: añadir mención al npub del usuario para atribución pública
  const allTags = [['d', uid], ...tags, ['status', 'active']]
  if (userPubHex && /^[0-9a-f]{64}$/.test(userPubHex)) {
    allTags.push(['p', userPubHex])
    allTags.push(['plazap2p-auth', 'challenge-verified'])
  }

  const event = finalizeEvent({
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: allTags,
    content,
  }, sk)

  const results = await Promise.allSettled(
    RELAYS.map(url => new Promise((resolve, reject) => {
      let ws
      const timeout = setTimeout(() => { ws?.close(); reject(new Error('timeout')) }, 8000)
      ws = connectRelay(url,
        () => {
          try { ws.send(JSON.stringify(['EVENT', event])) }
          catch (err) { clearTimeout(timeout); reject(err) }
        },
        (msg) => {
          if (msg[0] === 'OK') {
            clearTimeout(timeout)
            ws.close()
            msg[2] ? resolve('ok') : reject(new Error(msg[3] || 'rejected'))
          }
        },
        (err) => { clearTimeout(timeout); reject(err) }
      )
    }))
  )

  const published = results.filter(r => r.status === 'fulfilled').length

  let naddr = null
  if (kind >= 30000 && kind <= 39999) {
    try {
      naddr = nip19.naddrEncode({
        identifier: uid,
        pubkey: event.pubkey,
        kind,
        relays: RELAYS.slice(0, 3),
      })
    } catch (e) { console.warn('[nostr] naddr encode error:', e.message) }
  }

  return { event, published, total: RELAYS.length, naddr }
}

/**
 * Publica una valoración como evento Nostr kind 1985 (NIP-32 label).
 * Permite verificación pública e independiente de las valoraciones en PlazaP2P.
 * @param {string} botNsec    — clave del bot para firmar
 * @param {string} rateeHex   — pubkey hex de quien es valorado
 * @param {number} rating     — entero 1-5
 * @param {string} comment    — comentario opcional (ya sanitizado)
 * @param {string} proofHash  — hash SHA-256(userId:rateeHex) — no reversible
 */
export async function publishLabel(botNsec, rateeHex, rating, comment, proofHash) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('rating inválido')
  if (!/^[0-9a-f]{64}$/.test(rateeHex)) throw new Error('rateeHex inválido')

  const sk = getSecretKey(botNsec)
  const tags = [
    ['L', 'plazap2p.reputation'],
    ['l', `rating:${rating}`, 'plazap2p.reputation'],
    ['p', rateeHex],
    ['proof', proofHash],
  ]

  const event = finalizeEvent({
    kind: 1985,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: comment || '',
  }, sk)

  // Publicar en los primeros 5 relays (suficiente para verificabilidad)
  await Promise.allSettled(
    RELAYS.slice(0, 5).map(url => new Promise((resolve, reject) => {
      let ws
      const timeout = setTimeout(() => { ws?.close(); reject(new Error('timeout')) }, 6000)
      ws = connectRelay(url,
        () => { try { ws.send(JSON.stringify(['EVENT', event])) } catch (err) { clearTimeout(timeout); reject(err) } },
        (msg) => { if (msg[0] === 'OK') { clearTimeout(timeout); ws.close(); msg[2] ? resolve('ok') : reject(new Error(msg[3] || 'rejected')) } },
        (err) => { clearTimeout(timeout); reject(err) }
      )
    }))
  )
  return event
}

/**
 * Comprueba si el npub tiene un perfil (kind 0) publicado en los relays.
 * Devuelve el número de días desde la publicación del perfil, o null si no se encuentra.
 *
 * Se usa como proxy de antigüedad de la cuenta — kind 0 es lo primero que publica un usuario
 * en Nostr, y tener ≥30 días reduce el riesgo de cuentas creadas expresamente para scam.
 *
 * Lógica de resolución:
 *   - Se consultan los primeros 4 relays en paralelo.
 *   - Se toma el kind 0 con el timestamp MÁS ANTIGUO (menor created_at) como referencia.
 *   - Si ningún relay responde en 7 s, devuelve null → el flujo llamante lo trata como fallo.
 *
 * @param {string} pubkeyHex — clave pública hex de 64 chars
 * @returns {Promise<number|null>} días desde la publicación del perfil, o null si no se encontró
 */
export async function checkNpubAge(pubkeyHex) {
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) return null
  const CHECK_RELAYS = RELAYS.slice(0, 4)
  let profileTs = null

  return new Promise((resolve) => {
    const finish = () => resolve(
      profileTs ? Math.floor((Date.now() / 1000 - profileTs) / 86400) : null
    )
    const timeout = setTimeout(finish, 7000)
    let completed = 0

    CHECK_RELAYS.forEach(url => {
      const subId = `age-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const ws = connectRelay(url,
        () => {
          try {
            ws.send(JSON.stringify(['REQ', subId, {
              kinds: [0],
              authors: [pubkeyHex],
              limit: 1,
            }]))
          } catch {
            ws.close(); completed++
            if (completed >= CHECK_RELAYS.length) { clearTimeout(timeout); finish() }
          }
        },
        (msg) => {
          if (msg[0] === 'EVENT' && msg[2]?.created_at) {
            if (!profileTs || msg[2].created_at < profileTs) profileTs = msg[2].created_at
          }
          if (msg[0] === 'EOSE') {
            ws.close(); completed++
            if (completed >= CHECK_RELAYS.length) { clearTimeout(timeout); finish() }
          }
        },
        () => {
          ws.close(); completed++
          if (completed >= CHECK_RELAYS.length) { clearTimeout(timeout); finish() }
        }
      )
    })
  })
}

/**
 * Verifica si un npub publicó recientemente una nota con el código de challenge exacto.
 * Se usa en el flujo de vinculación de identidad Nostr (wizard /vincular).
 *
 * Seguridad:
 *   - Verifica la firma criptográfica del evento con verifyEvent() para evitar que
 *     un relay malicioso inyecte notas falsas.
 *   - Compara el contenido completo (trim) con el código generado por el bot.
 *   - `sinceTs` limita la búsqueda a la ventana de 15 min del challenge (challengeTs - 60s).
 *
 * @param {string} pubkeyHex  — hex de la clave pública a verificar
 * @param {string} code       — texto exacto del challenge (ej: "plazap2p-verify-AB12CD34EF56")
 * @param {number} sinceTs    — timestamp UNIX desde el que buscar
 * @returns {Promise<boolean>} true si se encontró y verificó la nota
 */
export async function verifyChallenge(pubkeyHex, code, sinceTs) {
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) return false
  const CHECK_RELAYS = RELAYS.slice(0, 5)
  let found = false

  return new Promise((resolve) => {
    const finish = () => resolve(found)
    const timeout = setTimeout(finish, 10000)
    let completed = 0

    CHECK_RELAYS.forEach(url => {
      const subId = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const ws = connectRelay(url,
        () => {
          try {
            ws.send(JSON.stringify(['REQ', subId, {
              kinds: [1],
              authors: [pubkeyHex],
              since: sinceTs,
              limit: 20,
            }]))
          } catch {
            ws.close(); completed++
            if (completed >= CHECK_RELAYS.length) { clearTimeout(timeout); finish() }
          }
        },
        (msg) => {
          if (msg[0] === 'EVENT' && msg[2]?.content?.trim() === code) {
            try { if (verifyEvent(msg[2])) found = true } catch {}
            if (found) { clearTimeout(timeout); resolve(true) }
          }
          if (msg[0] === 'EOSE') {
            ws.close(); completed++
            if (completed >= CHECK_RELAYS.length && !found) { clearTimeout(timeout); finish() }
          }
        },
        () => {
          ws.close(); completed++
          if (completed >= CHECK_RELAYS.length && !found) { clearTimeout(timeout); finish() }
        }
      )
    })
  })
}

export async function fetchOffers(limit = 10, tagFilter = null) {
  const FETCH_RELAYS = RELAYS.slice(0, 4)
  const subId = `ppfeed-${Date.now()}`
  const events = []
  const MAX_EVENTS = limit * 4
  let eoseCount = 0

  return new Promise((resolve) => {
    const finish = () => {
      const seen = new Set()
      const result = events
        .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true })
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit)
      resolve(result)
    }

    const timeout = setTimeout(finish, 7000)

    FETCH_RELAYS.forEach(url => {
      const ws = connectRelay(url,
        () => {
          try {
            ws.send(JSON.stringify(['REQ', subId, {
              kinds: [30402],
              '#t': tagFilter ? [tagFilter] : ['plazap2p'],
              limit,
            }]))
          } catch {
            // Cerrar el WebSocket para evitar que EOSE posterior duplique el contador
            ws.close()
            eoseCount++
            if (eoseCount >= FETCH_RELAYS.length) { clearTimeout(timeout); finish() }
          }
        },
        (msg) => {
          if (msg[0] === 'EVENT' && msg[1] === subId) {
            const ev = msg[2]
            if (ev && typeof ev === 'object' && ev.id && Array.isArray(ev.tags) && ev.created_at) {
              try { if (!verifyEvent(ev)) return } catch { return }
              // Verificar post-relay que el evento tiene el tag esperado (relay malicioso)
              const requiredTag = tagFilter || 'plazap2p'
              if (!ev.tags.some(t => t[0] === 't' && t[1] === requiredTag)) return
              if (events.length < MAX_EVENTS) events.push(ev)
            }
          }
          if (msg[0] === 'EOSE') {
            ws.close()
            eoseCount++
            if (eoseCount >= FETCH_RELAYS.length) { clearTimeout(timeout); finish() }
          }
        },
        () => {
          ws.close()
          eoseCount++
          if (eoseCount >= FETCH_RELAYS.length) { clearTimeout(timeout); finish() }
        }
      )
    })
  })
}

export function formatOffer(event) {
  const get = (key) => event.tags.find(t => t[0] === key)?.[1] ?? ''
  const title    = get('title') || event.content.slice(0, 60)
  const price    = get('price')
  const currency = event.tags.find(t => t[0] === 'price')?.[2] ?? ''
  const location = get('location')
  const contact  = sanitizeContact(get('contact'))
  const subTag   = event.tags.find(t => t[0] === 't' && t[1]?.startsWith('plazap2p-'))?.[1] ?? ''
  const tipo     = subTag.replace('plazap2p-', '') || 'anuncio'
  const fecha    = new Date(event.created_at * 1000).toLocaleDateString('es-ES')

  let text = `🏷 *${escMd(title)}*`
  if (price) text += `\n💰 ${escMd(price)} ${escMd(currency)}`
  if (location) text += `\n📍 ${escMd(location)}`
  if (contact) text += `\n📞 _${escMd(contact)}_ \\(no verificado\\)`
  text += `\n🔖 ${tipo} · ${fecha}`
  return text
}
