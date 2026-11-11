// PUB-BASE-001 / PROT-002 — constructores 30402, valoración y utilidades
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildServicio, buildTransaccion, buildValoracion, buildRetirada, buildReporte, normalizePrice, durationDaysOf,
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

test('ADS-002 / F7-01: buildServicio y buildTransaccion caducan por defecto a los 90 días; buildValoracion/buildRetirada no', () => {
  const s = buildServicio({ title: 'Diseño gráfico', desc: 'Identidad visual para proyectos.', catId: 'diseno' }, PK1)
  const expS = Number(tag(s.unsignedEvent, 'expiration'))
  assert.ok(Math.abs(expS - (now + 90 * 86400)) < 10, 'servicio: expiration ≈ ahora + 90 días')

  const t = buildTransaccion({
    tipoTag: 'plazap2p-venta', title: 'Antminer S19', desc: 'Minero usado, funciona perfecto, se entrega en mano.',
  }, PK1)
  const expT = Number(tag(t.unsignedEvent, 'expiration'))
  assert.ok(Math.abs(expT - (now + 90 * 86400)) < 10, 'transacción: expiration ≈ ahora + 90 días')

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

test('F7-01: duración elegida, sin caducidad y valor inválido', () => {
  const base = { tipoTag: 'plazap2p-venta', title: 'Antminer S19', desc: 'Minero usado, funciona perfecto, se entrega en mano.' }
  for (const days of [30, 90, 180, 365]) {
    const r = buildTransaccion({ ...base, durationDays: String(days) }, PK1)
    assert.ok(Math.abs(Number(tag(r.unsignedEvent, 'expiration')) - (now + days * 86400)) < 10, `${days} días`)
    assert.equal(durationDaysOf(r.unsignedEvent), days, `durationDaysOf recupera ${days}`)
  }
  const sin = buildServicio({ title: 'Diseño gráfico', desc: 'Identidad visual para proyectos.', durationDays: 0 }, PK1)
  assert.equal(tag(sin.unsignedEvent, 'expiration'), undefined, 'sin caducidad → sin etiqueta')
  assert.equal(durationDaysOf(sin.unsignedEvent), 0)
  assert.equal(buildTransaccion({ ...base, durationDays: 45 }, PK1).ok, false, '45 no es una opción')
  // Anuncios antiguos de 60 días: al renovar pasan a la opción más cercana (empate → la larga).
  assert.equal(durationDaysOf({ created_at: 1000, tags: [['expiration', String(1000 + 60 * 86400)]] }), 90)
})

test('F7-02: una venta lleva type simple/physical; compra e intercambio no', () => {
  const base = { title: 'Antminer S19', desc: 'Minero usado, funciona perfecto, se entrega en mano.' }
  const venta = buildTransaccion({ ...base, tipoTag: 'plazap2p-venta' }, PK1)
  assert.deepEqual(venta.unsignedEvent.tags.find(t => t[0] === 'type'), ['type', 'simple', 'physical'])
  for (const tipoTag of ['plazap2p-compra', 'plazap2p-intercambio']) {
    const r = buildTransaccion({ ...base, tipoTag }, PK1)
    assert.equal(r.unsignedEvent.tags.find(t => t[0] === 'type'), undefined, tipoTag)
  }
})

test('F7-03: comunidades y herramientas piden a las tiendas no listarlas; los anuncios no', async () => {
  const { buildComunidad, buildHerramienta } = await import('../js/publish-builders.js')
  const desc = 'Descripción suficientemente larga para pasar la validación.'
  const vis = r => r.unsignedEvent.tags.find(t => t[0] === 'visibility')
  assert.deepEqual(vis(buildComunidad({ title: 'Bitcoin Sevilla', desc }, PK1)), ['visibility', 'hidden'])
  assert.deepEqual(vis(buildHerramienta({ title: 'Mi wallet', desc }, PK1)), ['visibility', 'hidden'])
  assert.equal(vis(buildTransaccion({ tipoTag: 'plazap2p-venta', title: 'Mesa', desc }, PK1)), undefined)
  assert.equal(vis(buildServicio({ title: 'Diseño gráfico', desc }, PK1)), undefined)
})

test('F7-05: buildAvisoMuro — nota kind 1 con título, precio, enlace y referencia `a`', async () => {
  const { buildAvisoMuro, CLIENT_URL } = await import('../js/publish-builders.js')
  const naddr = 'naddr1qqxyz'
  const r = buildAvisoMuro({ kind: 30402, dTag: 'plazap2p-app-1-ab', naddr, title: 'Vendo bici', price: '100', currency: 'EUR' }, PK1)
  assert.equal(r.ok, true)
  assert.equal(r.unsignedEvent.kind, 1)
  assert.equal(r.unsignedEvent.content, `📢 Vendo bici — 100 EUR\n\n${CLIENT_URL}#/anuncio/${naddr}\n\n#plazap2p`)
  assert.deepEqual(r.unsignedEvent.tags.find(t => t[0] === 'a'), ['a', `30402:${PK1}:plazap2p-app-1-ab`])
  assert.ok(r.unsignedEvent.tags.some(t => t[0] === 't' && t[1] === 'plazap2p'), 'el hashtag del texto lleva su etiqueta t')
  assert.equal(buildAvisoMuro({ kind: 1985, dTag: 'x', naddr, title: 'x' }, PK1).ok, false, 'solo anuncios y eventos')
  assert.equal(buildAvisoMuro({ kind: 30402, dTag: 'x', naddr: 'javascript:1', title: 'x' }, PK1).ok, false)
})

test('F7-07: evento con zona (g por precisión) y petición de entrar en el calendario', async () => {
  const { buildEvento, PLAZA_CALENDAR_D } = await import('../js/publish-builders.js')
  const { encodeGeohash } = await import('../js/geohash.js')
  assert.equal(encodeGeohash(57.64911, 10.40744, 11), 'u4pruydqqvj', 'ejemplo clásico de geohash')
  assert.equal(encodeGeohash(57.64911, 10.40744), 'u4pru')
  assert.equal(encodeGeohash(91, 0), null)
  const coord = `31924:${PK2}:${PLAZA_CALENDAR_D}`
  const base = { title: 'Meetup Bitcoin', desc: 'Quedada mensual para hablar de Bitcoin.', allDay: true, startDate: '2099-05-01' }
  const r = buildEvento({ ...base, geohash: 'u4pru', calendarCoord: coord }, PK1)
  assert.deepEqual(r.unsignedEvent.tags.filter(t => t[0] === 'g'), [['g', 'u4pru'], ['g', 'u4pr'], ['g', 'u4p']])
  assert.deepEqual(r.unsignedEvent.tags.find(t => t[0] === 'a'), ['a', coord])
  assert.equal(buildEvento({ ...base, geohash: 'zzzzza' }, PK1).ok, false, 'a no es un carácter de geohash')
  const sin = buildEvento({ ...base, calendarCoord: '30402:x:y' }, PK1)
  assert.equal(sin.unsignedEvent.tags.some(t => t[0] === 'a' || t[0] === 'g'), false, 'sin zona ni calendario válido no hay etiquetas')
})
