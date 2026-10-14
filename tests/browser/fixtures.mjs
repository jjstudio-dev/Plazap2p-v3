// Eventos firmados de verdad para los escenarios de navegador. Reutiliza las
// claves y el firmado de tests/fixtures/events.mjs (mismo bundle criptográfico
// que la app), así el relay simulado entrega eventos que pasan la verificación
// real de relay-pool.js.

import { signWith, SK1, SK2, PK1, PK2 } from '../fixtures/events.mjs'

export { signWith, SK1, SK2, PK1, PK2 }

export const now = () => Math.floor(Date.now() / 1000)
export const skHex = sk => [...sk].map(b => b.toString(16).padStart(2, '0')).join('')

/** Anuncio kind 30402 (NIP-99). `over` sustituye o añade tags por nombre. */
export function listing({
  sk = SK1, d = 'anuncio-1', title = 'Bicicleta de montaña', summary = 'En buen estado',
  location = 'Madrid, España', t = ['plazap2p', 'plazap2p-venta'], price = ['100', 'EUR'],
  status = null, created_at = now() - 120, extraTags = [], content = 'Descripción larga',
} = {}) {
  const tags = [['d', d], ['title', title], ['summary', summary], ['location', location],
    ...t.map(x => ['t', x]), ...(price ? [['price', ...price]] : []),
    ...(status ? [['status', status]] : []), ...extraTags]
  return signWith(sk, { kind: 30402, created_at, tags, content })
}

export function note({ sk = SK1, content = 'Hola plaza', t = ['plazap2p'], created_at = now() - 60 } = {}) {
  return signWith(sk, { kind: 1, created_at, tags: t.map(x => ['t', x]), content })
}

export function article({ sk = SK1, d = 'art-1', title = 'Guía P2P', summary = 'Resumen', image = null, created_at = now() - 300 } = {}) {
  const tags = [['d', d], ['title', title], ['summary', summary], ['t', 'plazap2p'], ...(image ? [['image', image]] : [])]
  return signWith(sk, { kind: 30023, created_at, tags, content: 'Cuerpo del artículo' })
}

/** Evento de calendario NIP-52: 31923 (con hora) o 31922 (todo el día). */
export function calendar({
  sk = SK1, kind = 31923, d = 'evento-1', title = 'Meetup Bitcoin', summary = 'Charla',
  location = 'Valencia', start = String(now() + 86400), end = null, tzid = 'Europe/Madrid',
  links = [], status = null, created_at = now() - 200,
} = {}) {
  const tags = [['d', d], ['title', title], ['summary', summary], ['location', location], ['start', start],
    ...(end ? [['end', end]] : []), ...(kind === 31923 && tzid ? [['start_tzid', tzid]] : []),
    ...links.map(l => ['r', l]), ...(status ? [['status', status]] : []), ['t', 'plazap2p']]
  return signWith(sk, { kind, created_at, tags, content: '' })
}

/** Orden Mostro (NIP-69, kind 38383). */
export function order({
  sk = SK2, d = 'orden-1', k = 'sell', f = 'EUR', s = 'pending', amt = '0', fa = ['100'],
  pm = ['Bizum'], premium = '1', created_at = now() - 90,
} = {}) {
  const tags = [['d', d], ['k', k], ['f', f], ['s', s], ['amt', amt], ['fa', ...fa], ['pm', ...pm],
    ['premium', premium], ['y', 'mostro'], ['z', 'order']]
  return signWith(sk, { kind: 38383, created_at, tags, content: '' })
}

/** Valoración kind 1985 (NIP-32) del espacio de nombres de la app. */
export function rating({ sk = SK2, ratee = PK1, stars = 5, comment = 'Todo bien', aspects = {}, created_at = now() - 50, extraTags = [] } = {}) {
  const NS = 'plazap2p.reputation'
  const tags = [['L', NS], ['l', `rating:${stars}`, NS], ['p', ratee],
    ...Object.entries(aspects).map(([k, v]) => ['l', `${k}:${v}`, NS]), ...extraTags]
  return signWith(sk, { kind: 1985, created_at, tags, content: comment })
}

export function profile({ sk = SK1, meta = { name: 'Vendedor', lud16: 'vendedor@ejemplo.test' }, created_at = now() - 1000 } = {}) {
  return signWith(sk, { kind: 0, created_at, tags: [], content: JSON.stringify(meta) })
}

/**
 * Un evento de hace 60 días de `sk`: lo que la app busca para dar por buena la
 * antigüedad de un valorador (sus votos solo cuentan con 30 días de historial).
 */
export const historial = (sk = SK2) => profile({ sk, meta: { name: 'veterano' }, created_at: now() - 60 * 86400 })

/** Relays de data/config.json — el doble de WebSocket responde por cualquiera de ellos. */
export const RELAYS = [
  'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io', 'wss://nostr.bitcoiner.social',
  'wss://relay.snort.social', 'wss://nostr.mom',
]
