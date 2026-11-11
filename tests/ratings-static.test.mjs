// W-03: la reputación sale solo de los relays (kind 1985), no de un JSON estático.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test('no queda la ruta estática data/ratings.json ni su carga', () => {
  assert.equal(fs.existsSync(new URL('../data/ratings.json', import.meta.url)), false)
  assert.doesNotMatch(read('js/app.js'), /ratings\.json/)
  assert.doesNotMatch(read('js/app.js'), /ratingsIndex/)
  assert.doesNotMatch(read('js/app.js'), /índice histórico/)
})

test('el umbral de la configuración coincide con el que aplica reputacion.js', () => {
  const cfg = JSON.parse(read('data/config.json'))
  const min = Number(read('js/reputacion.js').match(/MIN_RATINGS_FOR_AVERAGE\s*=\s*(\d+)/)[1])
  assert.equal(cfg.ratings.min_reviews_to_display, min)
})
