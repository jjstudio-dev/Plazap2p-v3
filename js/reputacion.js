// reputacion.js — Agregación client-side de valoraciones kind 1985 (NIP-32)
//
// Lee las valoraciones firmadas del namespace plazap2p.reputation desde los
// relays y las agrega en el cliente. Anti-spam natural: se cuenta UNA
// valoración por autor (la más reciente gana) — un mismo rater no puede
// inflar la media repitiendo eventos.

import { collectUntilEose } from './relay-pool.js'

const CACHE_TTL_MS = 5 * 60_000
const NAMESPACE = 'plazap2p.reputation'
const cache = new Map()   // rateeHex → { ts, result }

// Antigüedad mínima del valorador para que su voto cuente (misma regla que la
// app Android: ReputacionFetcher.kt). Nostr es abierto: cualquiera puede
// publicar valoraciones desde otro cliente, así que la única defensa real
// contra cuentas creadas para inflar o hundir una reputación está aquí, al
// calcular lo que se enseña.
const MIN_RATER_AGE_S = 30 * 24 * 60 * 60
const MATURITY_FILTERS_PER_QUERY = 10   // los relays limitan cuántos filtros aceptan por petición
const REPUTATION_FILTERS_PER_QUERY = 10
/** Cuántas valoraciones se piden como mucho por vendedor y relay. */
export const RATINGS_PER_SELLER = 200
const matureRaters = new Set()          // quien ya demostró antigüedad la conserva

function cached(hex) {
  const c = cache.get(hex)
  return (c && Date.now() - c.ts < CACHE_TTL_MS) ? c.result : null
}

/**
 * Reputación agregada de una pubkey.
 * @param {RelayPool} pool — pool ya conectado
 * @param {string} rateeHex — pubkey hex del valorado
 * @returns {Promise<{count:number, avg:number, aspects:Object, comments:Array}>}
 */
export async function fetchReputacion(pool, rateeHex, timeoutMs = 6000) {
  const results = await fetchReputacionBatch(pool, [rateeHex], timeoutMs)
  return results[rateeHex]
}

/**
 * Reputación agregada de VARIAS pubkeys en una sola suscripción.
 * Pensada para el directorio de vendedores: evita abrir N suscripciones.
 *
 * Espera el EOSE de todos los relays disponibles (collectUntilEose): con el
 * primer EOSE bastaba que el relay más rápido no tuviera las valoraciones
 * para devolver "sin valoraciones". Un resultado cortado por timeout puede
 * ser parcial, así que NO se cachea — la siguiente consulta lo reintenta.
 *
 * @param {RelayPool} pool — pool ya conectado
 * @param {string[]} hexes — pubkeys hex de los valorados
 * @returns {Promise<{ [hex]: {count:number, avg:number, aspects:Object, comments:Array} }>}
 */
export async function fetchReputacionBatch(pool, hexes, timeoutMs = 6000) {
  const results = {}
  const pending = []
  for (const hex of new Set(hexes)) {
    const hit = cached(hex)
    if (hit) results[hex] = hit
    else pending.push(hex)
  }
  if (pending.length === 0) return results

  const byRatee = new Map()   // rateeHex → Map(author → evento 1985 más reciente CON rating válido)
  for (const hex of pending) byRatee.set(hex, new Map())

  // UN filtro por vendedor, cada uno con su límite. Con un filtro común y un
  // límite común, quien publicara 500 valoraciones basura sobre un vendedor
  // expulsaba de la respuesta las de todos los demás, que quedaban «sin
  // valoraciones» (VW4-06). En lotes pequeños: los relays limitan cuántos
  // filtros aceptan por petición.
  let complete = true
  for (let i = 0; i < pending.length; i += REPUTATION_FILTERS_PER_QUERY) {
    const chunk = pending.slice(i, i + REPUTATION_FILTERS_PER_QUERY)
    const res = await collectUntilEose(
      pool,
      chunk.map(ratee => ({ kinds: [1985], '#p': [ratee], '#L': [NAMESPACE], limit: RATINGS_PER_SELLER })),
      {
        timeoutMs,
        prefix: 'rep',
        onEvent(ev) {
          // Verificaciones defensivas (el filtro del relay no es de fiar):
          if (ev.kind !== 1985) return
          if (!ev.tags.some(t => t[0] === 'L' && t[1] === NAMESPACE)) return
          // Un evento sin puntuación válida no debe desplazar a la valoración
          // real (más antigua) del mismo autor.
          if (!hasValidRating(ev)) return
          for (const t of ev.tags) {
            if (t[0] !== 'p') continue
            const byAuthor = byRatee.get(t[1])
            if (!byAuthor) continue
            if (ev.pubkey === t[1]) continue   // auto-valoración: ignorar
            const prev = byAuthor.get(ev.pubkey)
            if (!prev || ev.created_at > prev.created_at) byAuthor.set(ev.pubkey, ev)
          }
        },
      },
    )
    if (!res.complete) complete = false
  }

  const raters = new Set()
  for (const byAuthor of byRatee.values()) for (const author of byAuthor.keys()) raters.add(author)
  const age = await fetchMatureRaters(pool, raters, timeoutMs)

  for (const [hex, byAuthor] of byRatee) {
    const counted = new Map([...byAuthor].filter(([author]) => age.mature.has(author)))
    const result = aggregate(counted, hex)
    // Para poder decirlo en pantalla: cuántas valoraciones existen pero no cuentan.
    result.excludedRecent = byAuthor.size - counted.size
    // Para quien guarde el resultado por su cuenta: si la consulta se cortó,
    // «sin valoraciones» puede no ser verdad (VW4-07).
    result.complete = !!(complete && age.complete)
    if (result.complete) cache.set(hex, { ts: Date.now(), result })
    results[hex] = result
  }
  return results
}

/**
 * ¿Qué valoradores llevan al menos MIN_RATER_AGE_S en Nostr? Basta una prueba
 * de existencia: algún evento suyo, de cualquier kind, anterior al corte. (No
 * se puede usar "cuándo publicó su perfil": los relays solo guardan la última
 * versión del kind 0.) Un filtro POR autor con limit 1 — con un filtro común,
 * un solo valorador muy activo agotaría el límite y los demás parecerían
 * recién llegados.
 *
 * Falla abierto: si ningún relay contesta, no se descarta a nadie — un
 * problema de red no debe dejar la reputación en blanco.
 */
async function fetchMatureRaters(pool, raters, timeoutMs) {
  const mature = new Set()
  const pending = []
  for (const r of raters) {
    if (matureRaters.has(r)) mature.add(r)
    else pending.push(r)
  }
  let complete = true
  const cutoff = Math.floor(Date.now() / 1000) - MIN_RATER_AGE_S

  for (let i = 0; i < pending.length; i += MATURITY_FILTERS_PER_QUERY) {
    const chunk = pending.slice(i, i + MATURITY_FILTERS_PER_QUERY)
    const inChunk = new Set(chunk)
    const found = new Set()
    const res = await collectUntilEose(
      pool,
      chunk.map(author => ({ authors: [author], until: cutoff, limit: 1 })),
      {
        timeoutMs,
        prefix: 'age',
        // El relay puede ignorar `until`: se comprueba sobre el propio evento.
        onEvent(ev) { if (inChunk.has(ev.pubkey) && ev.created_at <= cutoff) found.add(ev.pubkey) },
      },
    )
    if (res.answered === 0) {            // nadie contestó: no se sabe nada de este lote
      for (const r of chunk) mature.add(r)
      complete = false
      continue
    }
    if (!res.complete) complete = false
    for (const r of found) { mature.add(r); matureRaters.add(r) }
  }
  return { mature, complete }
}

function hasValidRating(ev) {
  return ev.tags.some(t => t[0] === 'l' && /^rating:[1-5]$/.test(t[1] || '') && t[2] === NAMESPACE)
}

/** Solo para tests: vacía la caché en memoria. */
export function _clearReputacionCache() { cache.clear(); matureRaters.clear() }

/**
 * Agrega los eventos 1985 ya filtrados/deduplicados de un valorado.
 * Exportada para test (REP-003: sirve tanto a fetchReputacion como a un
 * eventual recálculo desde fixtures, sin depender de una suscripción real).
 */
export function aggregate(byAuthor, rateeHex) {
  let sum = 0
  let count = 0
  const aspectSums = {}
  const aspectCounts = {}
  const comments = []
  // REP-003: distribución (cuántas de 1★ a 5★), no solo la media — dos
  // vendedores con avg=4.0 pueden tener historiales muy distintos (20
  // valoraciones de 4★ frente a 10 de 5★ + 10 de 3★).
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }

  for (const ev of byAuthor.values()) {
    const ratingTag = ev.tags.find(t => t[0] === 'l' && /^rating:[1-5]$/.test(t[1] || '') && t[2] === 'plazap2p.reputation')
    if (!ratingTag) continue
    const rating = Number(ratingTag[1].split(':')[1])
    sum += rating
    count++
    distribution[rating]++
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
    distribution,
    comments: comments.sort((a, b) => b.ts - a.ts).slice(0, 20),
  }
}
