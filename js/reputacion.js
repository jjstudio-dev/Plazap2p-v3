// reputacion.js — Agregación client-side de valoraciones kind 1985 (NIP-32)
//
// Lee las valoraciones firmadas del namespace plazap2p.reputation desde los
// relays y las agrega en el cliente. Anti-spam natural: se cuenta UNA
// valoración por autor (la más reciente gana) — un mismo rater no puede
// inflar la media repitiendo eventos.

const CACHE_TTL_MS = 5 * 60_000
const cache = new Map()   // rateeHex → { ts, result }

/**
 * Reputación agregada de una pubkey.
 * @param {RelayPool} pool — pool ya conectado
 * @param {string} rateeHex — pubkey hex del valorado
 * @returns {Promise<{count:number, avg:number, aspects:Object, comments:Array}>}
 */
export function fetchReputacion(pool, rateeHex, timeoutMs = 6000) {
  const cached = cache.get(rateeHex)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return Promise.resolve(cached.result)

  return new Promise(resolve => {
    const byAuthor = new Map()   // author → evento 1985 más reciente
    // Id aleatorio (no derivado de rateeHex): RelayPool.subscribe() indexa
    // por id y sobrescribe sin avisar — dos llamadas para el MISMO rateeHex
    // que se solapen en el tiempo (p.ej. reescribir el npub dos veces antes
    // de que la primera consulta termine) se pisarían entre sí, igual que ya
    // corrige fetchReputacionBatch() con su subId aleatorio.
    const subId = `rep-${Math.random().toString(36).slice(2, 8)}`
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      pool.unsubscribe(subId)
      const result = aggregate(byAuthor, rateeHex)
      cache.set(rateeHex, { ts: Date.now(), result })
      resolve(result)
    }

    pool.subscribe(subId, [{ kinds: [1985], '#p': [rateeHex], '#L': ['plazap2p.reputation'], limit: 200 }], {
      onEvent(ev) {
        // Verificaciones defensivas (el filtro del relay no es de fiar):
        if (ev.kind !== 1985) return
        if (!ev.tags.some(t => t[0] === 'L' && t[1] === 'plazap2p.reputation')) return
        if (!ev.tags.some(t => t[0] === 'p' && t[1] === rateeHex)) return
        if (ev.pubkey === rateeHex) return   // auto-valoración: ignorar
        const prev = byAuthor.get(ev.pubkey)
        if (!prev || ev.created_at > prev.created_at) byAuthor.set(ev.pubkey, ev)
      },
      onEose: finish,
    })
    setTimeout(finish, timeoutMs)
  })
}

/**
 * Reputación agregada de VARIAS pubkeys en una sola suscripción.
 * Pensada para el directorio de vendedores: evita abrir N suscripciones.
 * Respeta la misma caché y reglas anti-spam que fetchReputacion().
 * @param {RelayPool} pool — pool ya conectado
 * @param {string[]} hexes — pubkeys hex de los valorados
 * @returns {Promise<{ [hex]: {count:number, avg:number, aspects:Object, comments:Array} }>}
 */
export function fetchReputacionBatch(pool, hexes, timeoutMs = 6000) {
  const results = {}
  const pending = []
  for (const hex of hexes) {
    const cached = cache.get(hex)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) results[hex] = cached.result
    else pending.push(hex)
  }
  if (pending.length === 0) return Promise.resolve(results)

  return new Promise(resolve => {
    const byRatee = new Map()   // rateeHex → Map(author → evento 1985 más reciente)
    for (const hex of pending) byRatee.set(hex, new Map())
    const subId = `repb-${Math.random().toString(36).slice(2, 8)}`
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      pool.unsubscribe(subId)
      for (const [hex, byAuthor] of byRatee) {
        const result = aggregate(byAuthor, hex)
        cache.set(hex, { ts: Date.now(), result })
        results[hex] = result
      }
      resolve(results)
    }

    pool.subscribe(subId, [{ kinds: [1985], '#p': pending, '#L': ['plazap2p.reputation'], limit: 500 }], {
      onEvent(ev) {
        if (ev.kind !== 1985) return
        if (!ev.tags.some(t => t[0] === 'L' && t[1] === 'plazap2p.reputation')) return
        for (const t of ev.tags) {
          if (t[0] !== 'p') continue
          const byAuthor = byRatee.get(t[1])
          if (!byAuthor) continue
          if (ev.pubkey === t[1]) continue   // auto-valoración: ignorar
          const prev = byAuthor.get(ev.pubkey)
          if (!prev || ev.created_at > prev.created_at) byAuthor.set(ev.pubkey, ev)
        }
      },
      onEose: finish,
    })
    setTimeout(finish, timeoutMs)
  })
}

function aggregate(byAuthor, rateeHex) {
  let sum = 0
  let count = 0
  const aspectSums = {}
  const aspectCounts = {}
  const comments = []

  for (const ev of byAuthor.values()) {
    const ratingTag = ev.tags.find(t => t[0] === 'l' && /^rating:[1-5]$/.test(t[1] || '') && t[2] === 'plazap2p.reputation')
    if (!ratingTag) continue
    const rating = Number(ratingTag[1].split(':')[1])
    sum += rating
    count++
    if (ev.content) comments.push({ rating, comment: ev.content.slice(0, 500), ts: ev.created_at, author: ev.pubkey })

    for (const t of ev.tags) {
      const m = t[0] === 'l' && t[2] === 'plazap2p.reputation' && /^aspecto\/([a-z_]{2,30}):([1-5])$/.exec(t[1] || '')
      if (m) {
        aspectSums[m[1]] = (aspectSums[m[1]] || 0) + Number(m[2])
        aspectCounts[m[1]] = (aspectCounts[m[1]] || 0) + 1
      }
    }
  }

  const aspects = {}
  for (const id of Object.keys(aspectSums)) aspects[id] = aspectSums[id] / aspectCounts[id]

  return {
    rateeHex,
    count,
    avg: count ? sum / count : 0,
    aspects,
    comments: comments.sort((a, b) => b.ts - a.ts).slice(0, 20),
  }
}
