// geo-cities.test.mjs — BON-003 (alcance MVP: aproximación por ciudad, sin geocodificación real)
import test from 'node:test'
import assert from 'node:assert/strict'
import { approximateCityCoords, osmLinkForLocation } from '../js/geo-cities.js'

test('approximateCityCoords: ciudad exacta reconocida', () => {
  const coords = approximateCityCoords('Madrid')
  assert.ok(coords)
  assert.equal(coords.length, 2)
  assert.ok(Math.abs(coords[0] - 40.4168) < 0.01)
})

test('approximateCityCoords: insensible a mayúsculas y tildes', () => {
  assert.deepEqual(approximateCityCoords('MÁLAGA'), approximateCityCoords('malaga'))
  assert.ok(approximateCityCoords('málaga'))
})

test('approximateCityCoords: "Ciudad zona" (texto libre con sufijo) hace match por prefijo', () => {
  assert.ok(approximateCityCoords('Valencia centro'))
  assert.deepEqual(approximateCityCoords('Valencia centro'), approximateCityCoords('Valencia'))
})

test('approximateCityCoords: NO hace match si la ciudad no está al principio del texto (evita falsos positivos)', () => {
  assert.equal(approximateCityCoords('Cerca de Madrid pero en otra provincia'), null)
})

test('approximateCityCoords: ciudad desconocida o vacío → null', () => {
  assert.equal(approximateCityCoords('Villalejo del Monte'), null)
  assert.equal(approximateCityCoords(''), null)
  assert.equal(approximateCityCoords(null), null)
  assert.equal(approximateCityCoords(undefined), null)
})

test('osmLinkForLocation: URL bien formada para ciudad conocida', () => {
  const url = osmLinkForLocation('Madrid')
  assert.match(url, /^https:\/\/www\.openstreetmap\.org\/\?mlat=40\.4168&mlon=-3\.7038#map=11\/40\.4168\/-3\.7038$/)
})

test('osmLinkForLocation: null para ciudad no reconocida (nunca inventa coordenadas)', () => {
  assert.equal(osmLinkForLocation('Un pueblo cualquiera'), null)
})
