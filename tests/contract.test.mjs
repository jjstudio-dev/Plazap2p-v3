// Contrato web ↔ Android (ver tests/fixtures/contract/generate.mjs).
//
// La web y la app Android publican en la misma red y se leen la una a la
// otra. Las dos tienen su propia copia de los builders; ya divergieron una
// vez (la web publicaba `plazap2p-intercambio` y buscaba `plazap2p-trueque`;
// Android no ponía caducidad a los anuncios y la web sí). Este test fija lo
// que la web genera; BuildersContractTest.kt, en Android, comprueba contra el
// MISMO JSON que allí sale igual.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { generate, serialize } from './fixtures/contract/generate.mjs'

const saved = readFileSync(new URL('./fixtures/contract/builders.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('el contrato guardado es lo que los builders de la web generan hoy', () => {
  assert.equal(saved, serialize(generate()),
    'los builders han cambiado: regenera con `node tests/fixtures/contract/generate.mjs` y copia builders.json también al repo Android')
})

test('cada caso del contrato cae en la categoría que el usuario eligió', () => {
  const porNombre = Object.fromEntries(JSON.parse(saved).cases.map(c => [c.name, c.expected]))
  const esperado = {
    'servicio completo': 'servicio', 'venta': 'venta', 'compra sin moneda': 'compra',
    'intercambio a negociar': 'trueque', 'comunidad': 'comunidad', 'herramienta': 'herramienta',
  }
  for (const [nombre, categoria] of Object.entries(esperado)) assert.equal(porNombre[nombre].category, categoria, nombre)
  assert.equal(porNombre['evento con hora'].kind, 31923)
  assert.equal(porNombre['evento de día completo'].kind, 31922)
  assert.equal(porNombre['retirada'].kind, 5)
  assert.equal(porNombre['valoración mínima'].kind, 1985)
})

test('la copia del contrato en el repo Android es idéntica (si el repo está al lado)', (t) => {
  const android = new URL('../../Plazap2p-android/core/core-builders/src/test/resources/contract/builders.json', import.meta.url)
  if (!existsSync(android)) { t.skip('repo Android no disponible junto a este'); return }
  assert.equal(readFileSync(android, 'utf8').replace(/\r\n/g, '\n'), saved,
    'las dos copias de builders.json difieren: copia la de este repo al de Android')
})
