// ADS-002 — aviso de caducidad próxima en "Mis anuncios"
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatExpiration } from '../js/mis-anuncios.js'

const DAY = 86400
const NOW = 1_700_000_000

test('sin tag expiration → null (anuncio sin caducidad, p.ej. comunidad/herramienta)', () => {
  assert.equal(formatExpiration(null, NOW), null)
  assert.equal(formatExpiration(undefined, NOW), null)
  assert.equal(formatExpiration('', NOW), null)
})

test('timestamp inválido o no numérico → null (no se oculta un anuncio válido por un tag malformado)', () => {
  assert.equal(formatExpiration('no-es-numero', NOW), null)
  assert.equal(formatExpiration('-100', NOW), null)
  assert.equal(formatExpiration('0', NOW), null)
})

test('ya pasado → "caducado"', () => {
  assert.equal(formatExpiration(String(NOW - DAY), NOW), 'caducado')
})

test('caduca hoy (dentro de las próximas 24h) → "caduca hoy"', () => {
  assert.equal(formatExpiration(String(NOW + 3600), NOW), 'caduca hoy')
})

test('caduca en 1-7 días → aviso con singular/plural correcto', () => {
  assert.equal(formatExpiration(String(NOW + DAY), NOW), 'caduca en 1 día')
  assert.equal(formatExpiration(String(NOW + 3 * DAY), NOW), 'caduca en 3 días')
  assert.equal(formatExpiration(String(NOW + 7 * DAY), NOW), 'caduca en 7 días')
})

test('faltan más de 7 días → null (sin ruido innecesario)', () => {
  assert.equal(formatExpiration(String(NOW + 8 * DAY), NOW), null)
  assert.equal(formatExpiration(String(NOW + 60 * DAY), NOW), null)
})
