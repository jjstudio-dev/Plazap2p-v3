// listing-utils — clasificación de anuncios, fechas NIP-52, caducidad NIP-40
// y tags de canal. Cada bloque fija un fallo real encontrado en auditoría.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectCategory, detectPayment, parseCalendarDate, calDate, isExpired, expirationTs, isItemExpired, channelTagFilters, publishedAtOf, parseOrderTags, reviveCachedItem, maskContacts } from '../js/listing-utils.js'
import { hexToNpub, hexToNote, encodeNaddr } from '../js/nostr.js'
import { buildTransaccion, buildComunidad, buildHerramienta, buildServicio } from '../js/publish-builders.js'
import { PK1 } from './fixtures/events.mjs'

const tTagsOf = built => built.unsignedEvent.tags.filter(t => t[0] === 't').map(t => t[1].toLowerCase())
const TX = { title: 'Cambio libros por sats', desc: 'Descripción suficientemente larga para validar.' }
const SERVICIO = { title: 'Clases de Bitcoin', desc: 'Formación práctica para principiantes.' }

test('detectCategory: lo que publica el asistente cae en su filtro (regresión Trueque)', () => {
  for (const [tipoTag, esperado] of [['plazap2p-venta', 'venta'], ['plazap2p-compra', 'compra'], ['plazap2p-intercambio', 'trueque']]) {
    const built = buildTransaccion({ ...TX, tipoTag }, PK1)
    assert.equal(built.ok, true)
    assert.equal(detectCategory(tTagsOf(built)), esperado, `${tipoTag} → ${esperado}`)
  }
  assert.equal(detectCategory(tTagsOf(buildServicio(SERVICIO, PK1))), 'servicio')
})

test('detectCategory: comunidades y herramientas no se confunden con anuncios genéricos', () => {
  const com = buildComunidad({ title: 'Bitcoin Valencia', desc: 'Meetup mensual abierto a todo el mundo.' }, PK1)
  const her = buildHerramienta({ title: 'Mi wallet', desc: 'Una wallet sencilla para empezar a usar sats.' }, PK1)
  assert.equal(com.ok && her.ok, true)
  assert.equal(detectCategory(tTagsOf(com)), 'comunidad')
  assert.equal(detectCategory(tTagsOf(her)), 'herramienta')
})

test('detectCategory: tags externos y sin sub-tag', () => {
  assert.equal(detectCategory(['plazap2p', 'plazap2p-trueque']), 'trueque')
  assert.equal(detectCategory(['plazap2p', 'venta']), 'venta')
  assert.equal(detectCategory(['plazap2p']), 'general')
})

test('detectPayment: por defecto Bitcoin; reconoce los métodos declarados', () => {
  assert.deepEqual(detectPayment(['plazap2p']), ['Bitcoin'])
  assert.deepEqual(detectPayment(['ln', 'efectivo']), ['Lightning', 'Efectivo'])
})

test('parseCalendarDate: el resultado sobrevive a la caché JSON y calDate() lo pinta (regresión Eventos)', () => {
  const start = parseCalendarDate(31923, '1790000000')
  assert.deepEqual(start, { ts: 1790000000 })
  const cached = JSON.parse(JSON.stringify({ start }))     // lo que hace saveToCache/loadFromCache
  const d = calDate(cached.start)
  assert.ok(d instanceof Date)
  assert.equal(d.getTime(), 1790000000 * 1000)
  assert.doesNotThrow(() => d.toLocaleDateString('es-ES', { day: '2-digit' }))
})

test('calDate: tolera la forma antigua de la caché ({ ts, date: "<string>" }) y entradas rotas', () => {
  assert.equal(calDate({ ts: 1790000000, date: '2026-09-21T10:13:20.000Z' }).getTime(), 1790000000 * 1000)
  assert.equal(calDate(null), null)
  assert.equal(calDate({}), null)
  assert.equal(calDate({ ts: 'no' }), null)
})

test('parseCalendarDate: 31922 con fecha ISO, 31922 legado con Unix y valores inválidos', () => {
  const iso = parseCalendarDate(31922, '2026-12-24')
  assert.equal(new Date(iso.ts * 1000).getDate(), 24)
  assert.deepEqual(parseCalendarDate(31922, '1790000000'), { ts: 1790000000 })
  assert.equal(parseCalendarDate(31922, 'no-es-fecha'), null)
  assert.equal(parseCalendarDate(31923, 'abc'), null)
  assert.equal(parseCalendarDate(31923, ''), null)
})

test('isExpired: solo con expiration válida y pasada', () => {
  const now = Math.floor(Date.now() / 1000)
  assert.equal(isExpired({ tags: [['expiration', String(now - 10)]] }), true)
  assert.equal(isExpired({ tags: [['expiration', String(now + 3600)]] }), false)
  assert.equal(isExpired({ tags: [['expiration', 'basura']] }), false)
  assert.equal(isExpired({ tags: [] }), false)
})

test('isItemExpired: un anuncio en caché deja de mostrarse cuando pasa su fecha de caducidad', () => {
  const now = 1_800_000_000
  const event = { tags: [['expiration', String(now + 100)]] }
  const cached = JSON.parse(JSON.stringify({ title: 'x', expiresAt: expirationTs(event) }))   // ida y vuelta por la caché
  assert.equal(isItemExpired(cached, now), false, 'aún vigente')
  assert.equal(isItemExpired(cached, now + 101), true, 'caducó con la pestaña abierta / en caché')
  assert.equal(isItemExpired({ title: 'sin caducidad', expiresAt: null }, now), false)
  assert.equal(isItemExpired({ title: 'caché antigua, sin el campo' }, now), false)
  assert.equal(expirationTs({ tags: [['expiration', 'basura']] }), null)
  assert.equal(expirationTs({ tags: [] }), null)
})

test('channelTagFilters: tagFilter único, lista tagFilters, ambos y ninguno', () => {
  assert.deepEqual(channelTagFilters({ tagFilter: 'plazap2p-directorio' }), ['plazap2p-directorio'])
  assert.deepEqual(
    channelTagFilters({ tagFilter: 'plazap2p-directorio', tagFilters: ['plazap2p-servicio'] }),
    ['plazap2p-servicio', 'plazap2p-directorio'])
  assert.deepEqual(channelTagFilters({ tagFilters: ['a', 'a', '', 7] }), ['a'])
  assert.equal(channelTagFilters({ kinds: [30402] }), null)
})

test('el canal Directorio de config.json recoge los servicios que publica el asistente', () => {
  const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'))
  const dir = config.channels.find(c => c.id === 'directorio')
  const tags = channelTagFilters(dir)
  assert.ok(tTagsOf(buildServicio(SERVICIO, PK1)).some(t => tags.includes(t)),
    'un Servicio del asistente debe entrar en el Directorio')
})

// ── Ronda 2 de auditoría ────────────────────────────────────────────────────

test('maskContacts: oculta teléfonos, correos y enlaces', () => {
  for (const tel of ['600123456', '600 123 456', '+34 600 123 456', '+34600123456', '(+58) 412-555.12.34', '0034 600 12 34 56', '91 123 45 67']) {
    assert.equal(maskContacts(`Llama al ${tel} ya`), 'Llama al ··· ya', tel)
  }
  assert.equal(maskContacts('Escribe a ana.perez+ventas@correo.example.com'), 'Escribe a ···')
  assert.equal(maskContacts('Mira https://t.me/estafa?x=1 y http://x.test'), 'Mira [enlace] y [enlace]')
})

test('maskContacts: no borra las cifras normales de un anuncio (regresión)', () => {
  for (const texto of [
    'Solo habrá 21.000.000 de bitcoin', 'Precio: 1.500.000.000 sats', 'Vale 100000000 sats', 'Pago de 250000000 SATS o 2.5 BTC',
    'Entrega el 2026-10-12', 'Del 12-10-2026 al 15-10-2026', 'Año 2026, lote de 12 unidades', 'Mide 120 x 80 x 40 cm',
    'Factura 1,500,000.50 USD', 'Importe 1.250.000,75 €', 'Modelo RTX 4090 de 24 GB', '1234567890123456 no es un teléfono (16 cifras)',
  ]) {
    assert.equal(maskContacts(texto), texto)
  }
})

test('maskContacts: recorta a 200 caracteres', () => {
  assert.equal(maskContacts('a'.repeat(500)).length, 200)
})

test('publishedAtOf: una fecha de publicación futura no adelanta el anuncio', () => {
  const created = 1_700_000_000
  assert.equal(publishedAtOf([['published_at', String(created - 500)]], created), created - 500, 'pasada: se respeta')
  assert.equal(publishedAtOf([['published_at', String(created + 86400 * 365)]], created), created, 'futura: se usa created_at')
  assert.equal(publishedAtOf([['published_at', 'ayer']], created), created)
  assert.equal(publishedAtOf([['published_at', '-5']], created), created)
  assert.equal(publishedAtOf([['published_at', '']], created), created)
  assert.equal(publishedAtOf([], created), created)
})

test('parseOrderTags: rango e importes múltiples dentro de UNA etiqueta (NIP-69)', () => {
  const base = [['k', 'sell'], ['f', 'eur'], ['s', 'pending'], ['amt', '0'], ['premium', '2']]
  const o = parseOrderTags([...base, ['fa', '100', '500'], ['pm', 'Bizum', 'SEPA', 'Revolut']])
  assert.deepEqual([o.fiatMin, o.fiatMax], [100, 500])
  assert.deepEqual(o.payments, ['Bizum', 'SEPA', 'Revolut'])
  assert.equal(o.fiat, 'EUR')
  // Forma antigua (una etiqueta por valor) sigue valiendo
  const legacy = parseOrderTags([...base, ['fa', '10'], ['fa', '20'], ['pm', 'Efectivo'], ['pm', '']])
  assert.deepEqual([legacy.fiatMin, legacy.fiatMax, legacy.payments], [10, 20, ['Efectivo']])
  // Importe fijo
  const fijo = parseOrderTags([...base, ['fa', '75']])
  assert.deepEqual([fijo.fiatMin, fijo.fiatMax], [75, null])
})

test('parseOrderTags: tipo en mayúsculas se normaliza; valores imposibles se descartan', () => {
  const ok = (extra, k = 'BUY') => parseOrderTags([['k', k], ['f', 'EUR'], ...extra])
  assert.equal(ok([]).orderType, 'buy')
  assert.equal(ok([], 'regalo'), null)
  assert.equal(ok([['amt', '-1']]), null)
  assert.equal(ok([['amt', '99999999999999999']]), null)
  assert.equal(ok([['fa', 'cien']]), null)
  assert.equal(ok([['fa', '500', '100']]), null, 'máximo menor que mínimo')
  assert.equal(ok([['premium', '99999']]), null)
  assert.equal(ok([['premium', 'mucho']]), null)
})

test('reviveCachedItem: acepta la forma exacta de cada kind y rechaza lo demás', () => {
  const npub = hexToNpub(PK1)
  const note = hexToNote('a'.repeat(64))
  const naddr = encodeNaddr({ kind: 30402, pubkey: PK1, identifier: 'x' })
  const listing = { kind: 30402, title: 'T', summary: 'a &lt;b&gt;', location: null, category: 'venta', payment: ['Bitcoin'],
    price: '10', currency: 'EUR', publishedAt: 100, status: 'active', naddr, npub, pubkeyHex: PK1, created_at: 100, expiresAt: null }
  const post = { kind: 1, content: 'hola', npub, note, publishedAt: 100, created_at: 100 }
  const article = { kind: 30023, title: 'A', summary: '', image: null, publishedAt: 100, naddr, npub, created_at: 100 }
  const cal = { kind: 31923, title: 'E', summary: '', location: '', start: { ts: 200 }, end: null, tzid: '', links: [], naddr,
    status: 'active', npub, publishedAt: 200, created_at: 100 }
  const order = { kind: 38383, orderType: 'sell', fiat: 'EUR', sats: 0, fiatMin: 10, fiatMax: null, payments: ['Bizum'], premium: 1,
    status: 'pending', dTag: 'd', botPubkey: PK1, naddr, publishedAt: 100, created_at: 100 }
  for (const item of [listing, post, article, cal, order]) assert.equal(reviveCachedItem(item), item, `kind ${item.kind}`)

  // Forma antigua de los eventos de calendario (con un Date serializado): la marca de tiempo sigue valiendo
  assert.ok(reviveCachedItem({ ...cal, start: { ts: 200, date: '2026-01-01T00:00:00.000Z' } }))

  const malos = [
    null, 5, 'x', [], {},
    { ...listing, payment: 'Bitcoin' }, { ...listing, payment: [] }, { ...listing, payment: ['<b>'] },
    { ...listing, category: 'inventada' }, { ...listing, title: 7 }, { ...listing, summary: '<img src=x>' },
    { ...listing, naddr: "naddr1x');alert(1);//" }, { ...listing, npub: 'npub1corto' }, { ...listing, pubkeyHex: 'zz' },
    { ...listing, publishedAt: 'ayer' }, { ...listing, created_at: null }, { ...listing, expiresAt: 'nunca' },
    { ...post, content: '<script>' }, { ...post, note: "note1');x" }, { ...post, npub: 5 },
    { ...article, image: {} }, { ...cal, links: 'no-lista' }, { ...cal, start: 'mañana' }, { ...cal, start: { ts: 'x' } },
    { ...order, orderType: 'regalo' }, { ...order, payments: 'x' }, { ...order, sats: 'muchos' }, { ...order, botPubkey: 'x' },
  ]
  for (const item of malos) assert.equal(reviveCachedItem(item), null, JSON.stringify(item)?.slice(0, 90))
})

test('maskContacts: tampoco deja pasar contactos sin https, usuarios ni direcciones nostr', () => {
  assert.equal(maskContacts('Háblame en t.me/estafa_bot ya'), 'Háblame en [enlace] ya')
  assert.equal(maskContacts('Web: www.tienda-falsa.example'), 'Web: [enlace]')
  assert.equal(maskContacts('Entra en tienda-falsa.example/pago?x=1'), 'Entra en [enlace]')
  assert.equal(maskContacts('Telegram @vendedor_btc o Signal'), 'Telegram ··· o Signal')
  assert.equal(maskContacts('Perfil nostr:npub1qqqsyqcyq5rqwzqfpg9scrgwpugpzysn y más'), 'Perfil [enlace] y más')
})

test('maskContacts: los puntos y arrobas normales de un texto no se tocan (regresión)', () => {
  for (const texto of ['Vendo p.ej. una radio. Funciona.', 'Cambio 2 @ 3 piezas', 'Versión 2.0 del firmware', 'Acepto BTC/EUR y sats/kWh']) {
    assert.equal(maskContacts(texto), texto)
  }
})
