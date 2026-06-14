import { finalizeEvent, nip19 } from 'nostr-tools'
import WebSocket from 'ws'
import { readFileSync } from 'fs'
import { escMd } from './utils.js'

// Load relay list from shared data/config.json; fall back to hardcoded list
const FALLBACK_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
  'wss://purplepag.es',
  'wss://nostr.mom',
]

let _relays = FALLBACK_RELAYS
try {
  const cfgPath = new URL('../../data/config.json', import.meta.url)
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
  if (Array.isArray(cfg.relays) && cfg.relays.length > 0) _relays = cfg.relays
} catch {}

export const RELAYS = _relays

function getSecretKey() {
  const nsec = process.env.BOT_NSEC
  if (!nsec) throw new Error('BOT_NSEC no está configurado')
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('BOT_NSEC no es una clave nsec válida')
  return decoded.data
}

function connectRelay(url, onOpen, onMessage, onError) {
  const ws = new WebSocket(url)
  ws.on('open', onOpen)
  ws.on('message', (data) => {
    try { onMessage(JSON.parse(data.toString())) } catch (e) { console.warn(`relay msg parse error [${url}]:`, e.message) }
  })
  ws.on('error', onError || (() => {}))
  ws.on('close', () => {})
  return ws
}

export async function publishEvent(tags, content, kind = 30402) {
  const sk = getSecretKey()
  const uid = `plazap2p-bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  const event = finalizeEvent({
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', uid], ...tags, ['status', 'active']],
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

  // Build naddr for addressable events (kind 30000–39999)
  let naddr = null
  if (kind >= 30000 && kind <= 39999) {
    try {
      naddr = nip19.naddrEncode({
        identifier: uid,
        pubkey: event.pubkey,
        kind,
        relays: RELAYS.slice(0, 3),
      })
    } catch {}
  }

  return { event, published, total: RELAYS.length, naddr }
}

export async function fetchOffers(limit = 10) {
  const FETCH_RELAYS = RELAYS.slice(0, 4)
  const subId = `ppfeed-${Date.now()}`
  const events = []
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
              '#t': ['plazap2p-venta', 'plazap2p-compra'],
              limit,
            }]))
          } catch { eoseCount++; if (eoseCount >= FETCH_RELAYS.length) { clearTimeout(timeout); finish() } }
        },
        (msg) => {
          if (msg[0] === 'EVENT' && msg[1] === subId) {
            const ev = msg[2]
            // Validate event structure before using
            if (ev && typeof ev === 'object' && ev.id && Array.isArray(ev.tags) && ev.created_at) {
              events.push(ev)
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
  const contact  = get('contact')
  const subTag   = event.tags.find(t => t[0] === 't' && t[1]?.startsWith('plazap2p-'))?.[1] ?? ''
  const tipo     = subTag.replace('plazap2p-', '') || 'anuncio'
  const fecha    = new Date(event.created_at * 1000).toLocaleDateString('es-ES')

  let text = `🏷 *${escMd(title)}*`
  if (price) text += `\n💰 ${escMd(price)} ${escMd(currency)}`
  if (location) text += `\n📍 ${escMd(location)}`
  if (contact) text += `\n📞 ${escMd(contact)}`
  text += `\n🔖 ${tipo} · ${fecha}`
  return text
}
