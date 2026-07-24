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
