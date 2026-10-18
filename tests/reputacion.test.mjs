// REP-003 — agregación de reputación: media, tamaño de muestra y
// distribución. Solo se prueba aggregate() (pura); fetchReputacion/Batch
// dependen de un RelayPool real y no se testean aquí.
import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregate } from '../js/reputacion.js'
import { PK1, PK2 } from './fixtures/events.mjs'

const RATEE = 'e'.repeat(64)
const ratingEvent = (author, rating, { aspects = {}, content = '', ts = 1_700_000_000 } = {}) => ({
  kind: 1985,
  pubkey: author,
  created_at: ts,
  content,
  tags: [
    ['L', 'plazap2p.reputation'],
    ['l', `rating:${rating}`, 'plazap2p.reputation'],
    ['p', RATEE],
    ...Object.entries(aspects).map(([id, v]) => ['l', `aspecto/${id}:${v}`, 'plazap2p.reputation']),
  ],
})

test('aggregate: media, count y distribución con varias valoraciones', () => {
  const byAuthor = new Map([
    [PK1, ratingEvent(PK1, 5)],
    [PK2, ratingEvent(PK2, 3)],
  ])
  const r = aggregate(byAuthor, RATEE)
  assert.equal(r.count, 2)
  assert.equal(r.avg, 4)
  assert.deepEqual(r.distribution, { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 })
})

test('aggregate: sin valoraciones → count 0, avg 0, distribución en cero', () => {
  const r = aggregate(new Map(), RATEE)
  assert.equal(r.count, 0)
  assert.equal(r.avg, 0)
  assert.deepEqual(r.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
})

test('aggregate: promedia aspectos por separado del rating general', () => {
  const byAuthor = new Map([
    [PK1, ratingEvent(PK1, 5, { aspects: { comunicacion: 5, rapidez: 4 } })],
    [PK2, ratingEvent(PK2, 3, { aspects: { comunicacion: 3 } })],
  ])
  const r = aggregate(byAuthor, RATEE)
  assert.equal(r.aspects.comunicacion, 4) // (5+3)/2
  assert.equal(r.aspects.rapidez, 4)      // solo un dato
})

test('aggregate: evento sin tag de rating válido se ignora (no cuenta ni distorsiona)', () => {
  const sinRating = { kind: 1985, pubkey: PK1, created_at: 1, content: '', tags: [['p', RATEE]] }
  const byAuthor = new Map([[PK1, sinRating]])
  const r = aggregate(byAuthor, RATEE)
  assert.equal(r.count, 0)
})

test('aggregate: comentarios ordenados del más reciente al más antiguo, máx 20', () => {
  const byAuthor = new Map()
  for (let i = 0; i < 25; i++) {
    byAuthor.set(`author-${i}`, ratingEvent(`author-${i}`, (i % 5) + 1, { content: `comentario ${i}`, ts: 1000 + i }))
  }
  const r = aggregate(byAuthor, RATEE)
  assert.equal(r.comments.length, 20)
  assert.equal(r.comments[0].comment, 'comentario 24', 'el más reciente va primero')
})

// ── PZ-F8-01: red de confianza ────────────────────────────────
import { trustedFromFollowLists, fetchReputacionBatch, MIN_RATINGS_FOR_AVERAGE, _clearReputacionCache } from '../js/reputacion.js'

test('red de confianza: raíces y su kind 3 más reciente', () => {
  const me = 'a'.repeat(64)
  const m = 'b'.repeat(64)
  const ev = (pubkey, ts, ...ps) => ({ kind: 3, pubkey, created_at: ts, tags: [...ps.map(p => ['p', p]), ['p', 'no-hex']] })
  const trusted = trustedFromFollowLists(
    [ev(me, 1, 'c'.repeat(64)), ev(me, 2, 'd'.repeat(64)), ev(m, 1, 'f'.repeat(64)), ev('9'.repeat(64), 5, '8'.repeat(64))],
    [me, m],
  )
  assert.deepEqual([...trusted].sort(), [me, m, 'd'.repeat(64), 'f'.repeat(64)].sort())
})

// Pool de prueba: responde EVENT + EOSE a cada suscripción con lo que diga `respond`.
function fakePool(respond) {
  return {
    expectedCount: 1,
    subscribe(id, filters, { onEvent, onEose }) {
      setTimeout(() => { for (const ev of respond(filters)) onEvent(ev, 'wss://x'); onEose('wss://x') }, 0)
    },
    unsubscribe() {},
  }
}

test('claves nuevas antedatadas fuera de la red no suman a la media', async () => {
  _clearReputacionCache()
  const sybils = Array.from({ length: 20 }, (_, i) => (i + 1).toString(16).padStart(64, '9'))
  const friend = PK1
  const ratings = [...sybils.map(s => ratingEvent(s, 1)), ratingEvent(friend, 5)]
  const pool = fakePool(filters => {
    if (filters[0].kinds?.[0] === 1985) return ratings
    // prueba de antigüedad: todos tienen eventos "antiguos" (antedatados)
    return filters.flatMap(f => (f.authors || []).map(a => ({ kind: 1, pubkey: a, created_at: 1, tags: [], content: '' })))
  })
  const res = await fetchReputacionBatch(pool, [RATEE], 1000, { trustedRaters: new Set([friend]) })
  assert.equal(res[RATEE].count, 1)
  assert.equal(res[RATEE].avg, 5)
  assert.equal(res[RATEE].unknownCount, 20)
  assert.equal(res[RATEE].showsAverage, false)
  assert.equal(MIN_RATINGS_FOR_AVERAGE, 3)
})

test('sin respuesta en la prueba de antigüedad se falla cerrado', async () => {
  _clearReputacionCache()
  const pool = {
    expectedCount: 1,
    subscribe(id, filters, { onEvent, onEose }) {
      if (filters[0].kinds?.[0] === 1985) setTimeout(() => { onEvent(ratingEvent(PK2, 4), 'wss://x'); onEose('wss://x') }, 0)
      // la consulta de antigüedad nunca contesta
    },
    unsubscribe() {},
  }
  const res = await fetchReputacionBatch(pool, [RATEE], 300, { trustedRaters: new Set() })
  assert.equal(res[RATEE].unknownCount, 0)
  assert.equal(res[RATEE].complete, false)
})
