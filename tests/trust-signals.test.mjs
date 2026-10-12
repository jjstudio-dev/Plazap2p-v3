// SPAM-001/REP-001 — niveles de confianza explicados (no una protección real)
import test from 'node:test'
import assert from 'node:assert/strict'
import { trustLevel, compareSellersByRating } from '../js/trust-signals.js'

test('trustLevel: umbrales sin_datos/bajo/medio/alto', () => {
  assert.equal(trustLevel(0).level, 'sin_datos')
  assert.equal(trustLevel(1).level, 'bajo')
  assert.equal(trustLevel(2).level, 'bajo')
  assert.equal(trustLevel(3).level, 'medio')
  assert.equal(trustLevel(9).level, 'medio')
  assert.equal(trustLevel(10).level, 'alto')
  assert.equal(trustLevel(500).level, 'alto')
})

test('trustLevel: valores no numéricos/negativos se tratan como 0', () => {
  assert.equal(trustLevel(undefined).level, 'sin_datos')
  assert.equal(trustLevel(null).level, 'sin_datos')
  assert.equal(trustLevel(-5).level, 'sin_datos')
  assert.equal(trustLevel(NaN).level, 'sin_datos')
})

test('trustLevel: cada nivel trae label y note no vacíos (nunca promete "seguro")', () => {
  for (const n of [0, 1, 5, 50]) {
    const r = trustLevel(n)
    assert.ok(r.label.length > 0)
    assert.ok(r.note.length > 0)
    assert.doesNotMatch(r.note.toLowerCase(), /\bseguro\b|\bgarantizado\b|\bverificado\b/, 'nunca debe sonar a garantía')
  }
})

test('compareSellersByRating: muchas valoraciones buenas van antes que una sola perfecta', () => {
  const muchas = { rating: { avg: 4.8, n: 50 } }
  const una = { rating: { avg: 5, n: 1 } }
  const sin = { rating: null }
  const pocasMalas = { rating: { avg: 1, n: 2 } }
  const orden = [sin, una, pocasMalas, muchas].sort(compareSellersByRating)
  assert.deepEqual(orden, [muchas, una, pocasMalas, sin])
})

test('compareSellersByRating: a igual número de valoraciones gana la nota más alta', () => {
  const a = { rating: { avg: 4.9, n: 10 } }
  const b = { rating: { avg: 4.2, n: 10 } }
  assert.deepEqual([b, a].sort(compareSellersByRating), [a, b])
})
