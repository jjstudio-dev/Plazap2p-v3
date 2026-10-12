// PUB-BASE-001 / PROT-002 — constructores 30402, valoración y utilidades
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildServicio, buildTransaccion, buildValoracion, buildRetirada, buildReporte, normalizePrice,
} from '../js/publish-builders.js'
import { PK1, PK2 } from './fixtures/events.mjs'

const tag = (ev, name) => ev.tags.find(t => t[0] === name)?.[1]
const now = Math.floor(Date.now() / 1000)

test('buildServicio válido: kind, tags esperados y published_at ≈ ahora', () => {
  const r = buildServicio({ title: 'Diseño gráfico', desc: 'Identidad visual para proyectos.', catId: 'diseno' }, PK1)
  assert.equal(r.ok, true)
  const ev = r.unsignedEvent
  assert.equal(ev.kind, 30402)
  assert.equal(ev.pubkey, PK1)
  assert.equal(tag(ev, 'title'), 'Diseño gráfico')
  assert.equal(tag(ev, 'service_type'), 'diseno')
  assert.equal(tag(ev, 'status'), 'active')
  assert.ok(ev.tags.some(t => t[0] === 't' && t[1] === 'plazap2p'))
  const pubAt = Number(tag(ev, 'published_at'))
  assert.ok(Math.abs(pubAt - now) < 10, 'published_at debe ser ~ahora')
  assert.ok(r.dTag.startsWith('plazap2p-app-'))
})

test('buildServicio: título corto, categoría inválida y sin pubkey → error', () => {
  assert.equal(buildServicio({ title: 'ab', desc: 'x'.repeat(20) }, PK1).ok, false)
  assert.equal(buildServicio({ title: 'Título ok', desc: 'x'.repeat(20), catId: 'inventada' }, PK1).ok, false)
  assert.equal(buildServicio({ title: 'Título ok', desc: 'x'.repeat(20) }, null).ok, false)
})

test('buildTransaccion: venta válida y tipo inválido', () => {
  const r = buildTransaccion({
    tipoTag: 'plazap2p-venta', title: 'Antminer S19', desc: 'Minero usado, funciona perfecto, se entrega en mano.',
    price: '650', currency: 'EUR', alcanceId: 'local',
  }, PK1)
  assert.equal(r.ok, true)
  assert.ok(r.unsignedEvent.tags.some(t => t[0] === 't' && t[1] === 'plazap2p-venta'))
  const price = r.unsignedEvent.tags.find(t => t[0] === 'price')
  assert.deepEqual(price, ['price', '650', 'EUR'])

  assert.equal(buildTransaccion({ tipoTag: 'otra-cosa', title: 'abc', desc: 'x'.repeat(30) }, PK1).ok, false)
})

test('edición: published_at explícito se conserva', () => {
  const r = buildTransaccion({
    tipoTag: 'plazap2p-venta', title: 'Antminer S19', desc: 'Descripción suficientemente larga para pasar.',
  }, PK1, 'd-anterior', 1690000000)
  assert.equal(tag(r.unsignedEvent, 'published_at'), '1690000000')
  assert.equal(r.dTag, 'd-anterior')
})

test('buildValoracion: auto-valoración rechazada; rating fuera de rango rechazado', () => {
  assert.equal(buildValoracion({ rateeHex: PK1, rating: 5 }, PK1).ok, false)
  assert.equal(buildValoracion({ rateeHex: PK2, rating: 0 }, PK1).ok, false)
  const ok = buildValoracion({ rateeHex: PK2, rating: 4, comment: 'Todo bien', aspects: { comunicacion: 5, malicioso$: 3 } }, PK1)
  assert.equal(ok.ok, true)
  assert.equal(ok.unsignedEvent.kind, 1985)
  assert.ok(ok.unsignedEvent.tags.some(t => t[0] === 'l' && t[1] === 'rating:4'))
  assert.ok(ok.unsignedEvent.tags.some(t => t[0] === 'l' && t[1] === 'aspecto/comunicacion:5'))
  assert.ok(!ok.unsignedEvent.tags.some(t => String(t[1]).includes('malicioso')), 'ids de aspecto no validados no entran')
})

test('REP-002: buildValoracion añade referencia a/e opcional, o la ignora si es irreconocible', () => {
  const withA = buildValoracion({ rateeHex: PK2, rating: 5, refTag: `30402:${PK2}:plazap2p-app-123` }, PK1)
  assert.deepEqual(withA.unsignedEvent.tags.find(t => t[0] === 'a'), ['a', `30402:${PK2}:plazap2p-app-123`])

  const withE = buildValoracion({ rateeHex: PK2, rating: 5, refTag: 'a'.repeat(64) }, PK1)
  assert.deepEqual(withE.unsignedEvent.tags.find(t => t[0] === 'e'), ['e', 'a'.repeat(64)])

  const withBad = buildValoracion({ rateeHex: PK2, rating: 5, refTag: 'no-es-ni-a-ni-e' }, PK1)
  assert.equal(withBad.ok, true, 'una referencia irreconocible no debe fallar la valoración')
  assert.ok(!withBad.unsignedEvent.tags.some(t => t[0] === 'a' || t[0] === 'e'))

  const withNone = buildValoracion({ rateeHex: PK2, rating: 5 }, PK1)
  assert.ok(!withNone.unsignedEvent.tags.some(t => t[0] === 'a' || t[0] === 'e'))
})

test('buildRetirada referencia kind:pubkey:dTag y e opcional', () => {
  const r = buildRetirada({ kind: 30402, dTag: 'd-1', eventId: 'a'.repeat(64) }, PK1)
  assert.equal(r.ok, true)
  assert.equal(r.unsignedEvent.kind, 5)
  assert.deepEqual(r.unsignedEvent.tags[0], ['a', `30402:${PK1}:d-1`])
  // NIP-09: el kind de lo que se borra va en una etiqueta `k` (igual que en Android)
  assert.deepEqual(r.unsignedEvent.tags[1], ['k', '30402'])
  assert.deepEqual(r.unsignedEvent.tags[2], ['e', 'a'.repeat(64)])
  const sinEvento = buildRetirada({ kind: 31923, dTag: 'd-2' }, PK1)
  assert.deepEqual(sinEvento.unsignedEvent.tags, [['a', `31923:${PK1}:d-2`], ['k', '31923']])
})

test('ADS-002: buildServicio y buildTransaccion añaden expiration ≈ 60 días; buildValoracion/buildRetirada no', () => {
  const s = buildServicio({ title: 'Diseño gráfico', desc: 'Identidad visual para proyectos.', catId: 'diseno' }, PK1)
  const expS = Number(tag(s.unsignedEvent, 'expiration'))
  assert.ok(Math.abs(expS - (now + 60 * 86400)) < 10, 'servicio: expiration ≈ ahora + 60 días')

  const t = buildTransaccion({
    tipoTag: 'plazap2p-venta', title: 'Antminer S19', desc: 'Minero usado, funciona perfecto, se entrega en mano.',
  }, PK1)
  const expT = Number(tag(t.unsignedEvent, 'expiration'))
  assert.ok(Math.abs(expT - (now + 60 * 86400)) < 10, 'transacción: expiration ≈ ahora + 60 días')

  const v = buildValoracion({ rateeHex: PK2, rating: 4 }, PK1)
  assert.equal(tag(v.unsignedEvent, 'expiration'), undefined, 'valoración no caduca')
  const r = buildRetirada({ kind: 30402, dTag: 'd-1', eventId: 'a'.repeat(64) }, PK1)
  assert.equal(tag(r.unsignedEvent, 'expiration'), undefined, 'retirada no caduca')
})

test('MOD-002: buildReporte — kind 1984, tipo válido, auto-reporte y tipo inválido rechazados', () => {
  const r = buildReporte({ reportedHex: PK2, reportType: 'spam', comment: 'anuncios repetidos' }, PK1)
  assert.equal(r.ok, true)
  assert.equal(r.unsignedEvent.kind, 1984)
  assert.deepEqual(r.unsignedEvent.tags.find(t => t[0] === 'p'), ['p', PK2, 'spam'])

  assert.equal(buildReporte({ reportedHex: PK1, reportType: 'spam' }, PK1).ok, false, 'auto-reporte rechazado')
  assert.equal(buildReporte({ reportedHex: PK2, reportType: 'no-existe' }, PK1).ok, false, 'tipo inválido rechazado')
})

test('buildReporte: referencia a/e opcional al anuncio reportado, con el mismo tipo en el tag', () => {
  const withA = buildReporte({ reportedHex: PK2, reportType: 'illegal', refTag: `30402:${PK2}:d-1` }, PK1)
  assert.deepEqual(withA.unsignedEvent.tags.find(t => t[0] === 'a'), ['a', `30402:${PK2}:d-1`, 'illegal'])

  const sinRef = buildReporte({ reportedHex: PK2, reportType: 'illegal' }, PK1)
  assert.ok(!sinRef.unsignedEvent.tags.some(t => t[0] === 'a' || t[0] === 'e'))
})

test('normalizePrice: coma, punto y basura', () => {
  assert.equal(normalizePrice('12,5'), '12.5')
  assert.equal(normalizePrice('0.001'), '0.001')
  assert.equal(normalizePrice('12abc'), null)
  assert.equal(normalizePrice(''), null)
  assert.equal(normalizePrice('-5'), null)
})
