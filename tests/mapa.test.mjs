// Mapa: geohash, comunidades de 2140meetups, puntos de cada capa y BTC Map.
import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeGeohash, encodeGeohash, mostPreciseGeohash, EXACT_GEOHASH_PRECISION } from '../js/geohash.js'
import { cleanCommunity, communitiesFrom, sameCommunityName, samePlaceWords } from '../js/comunidades-2140.js'
import { communityPoints, listingPoints, eventPoints, btcmapPoints, directionsLinks, btcmapSearchUrl, LAYERS } from '../js/map-data.js'

test('geohash: decodificar devuelve el centro de la celda y su tamaño', () => {
  const madrid = encodeGeohash(40.4168, -3.7038, EXACT_GEOHASH_PRECISION)
  const cell = decodeGeohash(madrid)
  assert.ok(Math.abs(cell.lat - 40.4168) < 0.0001 && Math.abs(cell.lon + 3.7038) < 0.0001)
  assert.ok(cell.latErr < 0.0001)
  assert.ok(decodeGeohash('ezjmg').latErr > 0.01, 'una celda de 5 es de kilómetros')
  assert.equal(decodeGeohash('ab!'), null)
  assert.equal(decodeGeohash(''), null)
  assert.equal(mostPreciseGeohash([['g', 'ezj'], ['g', 'ezjmgq'], ['g', 'x!'], ['t', 'zzzzzzzz']]), 'ezjmgq')
  assert.equal(mostPreciseGeohash([]), null)
})

test('comunidades de 2140meetups: solo lo que se usa y validado', () => {
  const c = cleanCommunity({
    id: 7852, title: { rendered: 'Alkarria &amp; BTC' }, ciudad: 'Guadalajara', direccion: 'Pl. Mayor',
    lat: '40.6337428', lon: '-3.1668978', telegram: 'https://t.me/alkarriabtc', enlace: 'https://t.me/alkarriabtc',
    lightning_address: 'AlkarriaBTC@jabato.space', email: 'alguien@ejemplo.test',
    nostr: 'npub1uay28kq0hq8xr98k2uqk0vjrzqz8fdjh38esz4acdtk045lmgzpqn9naxf', link: 'https://2140meetups.com/comunidad/7852/',
  })
  assert.deepEqual(c, {
    id: '7852', nombre: 'Alkarria & BTC', ciudad: 'Guadalajara', direccion: 'Pl. Mayor', lat: 40.633743, lon: -3.166898,
    telegram: 'https://t.me/alkarriabtc', web: null, lightning: 'alkarriabtc@jabato.space',
    npub: 'npub1uay28kq0hq8xr98k2uqk0vjrzqz8fdjh38esz4acdtk045lmgzpqn9naxf', ficha: 'https://2140meetups.com/comunidad/7852/',
    btcmap: null, foto: null, destacada: false, exacta: true, fuentes: ['2140meetups'],
  })
  assert.ok(!('email' in c), 'el email no se guarda')
  const raro = cleanCommunity({ title: 'X', lat: '40', lon: '-3', telegram: 'http://t.me/x', enlace: 'javascript:alert(1)', nostr: 'npub1corto', link: 'https://otro.example/c/1' })
  assert.equal(raro.telegram, null)
  assert.equal(raro.web, null)
  assert.equal(raro.npub, null)
  assert.equal(raro.ficha, null)
  assert.equal(cleanCommunity({ title: 'Sin sitio', lat: '', lon: '' }), null)
  assert.equal(cleanCommunity({ title: '', lat: '40', lon: '-3' }), null)
  assert.deepEqual(communitiesFrom({ comunidades: [c, null, { nombre: 'mal' }] }).map(x => x.nombre), ['Alkarria & BTC'])
  assert.deepEqual(communitiesFrom(null), [])
})

test('capas: una comunidad es un punto con su perfil Nostr', () => {
  const [p] = communityPoints([{ id: '1', nombre: 'Bitcoin Murcia', ciudad: 'Murcia', lat: 37.98, lon: -1.13, telegram: 'https://t.me/x', npub: 'npub1abc' }])
  assert.equal(p.layer, 'comunidades')
  assert.equal(p.exact, true)
  assert.ok(p.links.some(l => l.url === 'https://njump.me/npub1abc'))
})

test('capas: los anuncios de particulares son zona; solo un comercio con punto exacto es punto', () => {
  const exacto = encodeGeohash(40.4168, -3.7038, 9)
  const pts = listingPoints([
    { naddr: 'n1', title: 'Bici', geohash: 'ezjmg', isCommerce: false },
    { naddr: 'n2', title: 'Tienda', geohash: exacto, isCommerce: true },
    // Un particular que publicó un punto exacto (otra app) no se enseña como punto.
    { naddr: 'n3', title: 'Sofá', geohash: exacto, isCommerce: false },
    // Un «comercio» con solo zona aproximada no es un punto de venta localizable.
    { naddr: 'n4', title: 'Tienda sin dirección', geohash: 'ezjmg', isCommerce: true },
    { naddr: 'n5', title: 'Sin zona' },
  ])
  assert.deepEqual(pts.map(p => [p.naddr, p.layer, p.exact]), [
    ['n1', 'anuncios', false], ['n2', 'comercios', true], ['n3', 'anuncios', false], ['n4', 'anuncios', false],
  ])
})

test('capas: eventos exactos o aproximados según su zona', () => {
  const pts = eventPoints([
    { naddr: 'e1', title: 'Meetup', geohash: 'ezjmg' },
    { naddr: 'e2', title: 'Charla en el local', geohash: encodeGeohash(39.47, -0.376, 9) },
    { naddr: 'e3', title: 'Online' },
  ])
  assert.deepEqual(pts.map(p => [p.naddr, p.exact]), [['e1', false], ['e2', true]])
})

test('BTC Map: se ignora lo malformado y solo se enlazan webs http(s)', () => {
  const pts = btcmapPoints([
    { id: 263, lat: 40.43, lon: -3.67, name: 'GBTC Finance', address: 'Calle 1', website: 'https://gbtc.example/' },
    { id: 2, lat: 'x', lon: 1, name: 'Mal' },
    { id: 3, lat: 1, lon: 1, name: '' },
    { id: 4, lat: 1, lon: 1, name: 'Truco', website: 'javascript:alert(1)' },
  ])
  assert.equal(pts.length, 2)
  assert.deepEqual(pts[0].links.map(l => l.url), ['https://gbtc.example/', 'https://btcmap.org/merchant/263'])
  assert.deepEqual(pts[1].links.map(l => l.url), ['https://btcmap.org/merchant/4'])
  assert.deepEqual(btcmapPoints({ no: 'lista' }), [])
  assert.match(btcmapSearchUrl(40.41681, -3.70379, 500), /lat=40\.4168&lon=-3\.7038&radius_km=50$/)
  assert.match(btcmapSearchUrl(40, -3, 0.2), /radius_km=1$/)
})

test('cómo llegar: app de mapas (geo:), Google Maps y OpenStreetMap', () => {
  const d = directionsLinks(40.4168, -3.7038, 'Tienda & Co')
  assert.equal(d.geo, 'geo:40.416800,-3.703800?q=40.416800,-3.703800(Tienda%20%26%20Co)')
  assert.equal(d.google, 'https://www.google.com/maps/dir/?api=1&destination=40.416800,-3.703800')
  assert.match(d.osm, /^https:\/\/www\.openstreetmap\.org\/directions\?to=40\.416800,-3\.703800/)
  assert.equal(directionsLinks(NaN, 1), null)
})

test('las capas tienen BTC Map apagada por defecto (llama a un servicio externo)', () => {
  assert.deepEqual(LAYERS.map(l => l.id), ['comunidades', 'eventos', 'comercios', 'anuncios', 'btcmap'])
  assert.equal(LAYERS.find(l => l.id === 'btcmap').defaultOn, false)
})

test('comunidades: la dirección repetida de 2140meetups se limpia', () => {
  const c = cleanCommunity({ title: 'X', lat: '37.3', lon: '-5.9', direccion: 'Sevilla, Sevilla, España, Sevilla, España' })
  assert.equal(c.direccion, 'Sevilla, España')
})

test('comunidades: foto solo de 2140meetups y marca de destacada', () => {
  const base = { title: 'X', lat: '39.4', lon: '-0.3' }
  assert.equal(cleanCommunity({ ...base, foto: 'https://2140meetups.com/wp-content/uploads/2023/02/a.jpg' }).foto, 'https://2140meetups.com/wp-content/uploads/2023/02/a.jpg')
  assert.equal(cleanCommunity({ ...base, foto: 'https://otro.example/wp-content/uploads/a.jpg' }).foto, null)
  assert.equal(cleanCommunity({ ...base, foto: 'https://2140meetups.com/wp-content/uploads/a.svg' }).foto, null, 'un SVG puede llevar código')
  assert.equal(cleanCommunity({ ...base, foto: 'javascript:alert(1)' }).foto, null)
  assert.equal(cleanCommunity({ ...base, destacada: true }).destacada, true)
  assert.equal(cleanCommunity({ ...base, destacada: 'sí' }).destacada, false)
})

test('BTC Map: foto de static.btcmap.org, su ficha y zona aproximada en el mapa', () => {
  const c = cleanCommunity({ id: 'btcmap-bitcoin-txoko', nombre: 'Bitcoin Txoko', lat: 43.3, lon: -2.0, exacta: false, fuentes: ['btcmap', 'inventada'],
    btcmap: 'https://btcmap.org/community/bitcoin-txoko', foto: 'https://static.btcmap.org/images/communities/bitcoin-txoko.jpg' })
  assert.equal(c.foto, 'https://static.btcmap.org/images/communities/bitcoin-txoko.jpg')
  assert.equal(c.btcmap, 'https://btcmap.org/community/bitcoin-txoko')
  assert.deepEqual(c.fuentes, ['btcmap'])
  assert.equal(cleanCommunity({ nombre: 'X', lat: 40, lon: -3, btcmap: 'https://btcmap.org.evil.example/community/x' }).btcmap, null)
  const [p] = communityPoints([c])
  assert.equal(p.exact, false, 'una zona de BTC Map no es un sitio al que ir')
  assert.ok(p.links.some(l => l.label === 'Ficha en BTC Map'))
})

test('misma comunidad: nombre igual o, si es la única, el mismo sitio', () => {
  assert.ok(sameCommunityName('Pontevedra 2140 / Vigo Bitcoin P2P', 'Pontevedra _2140_'))
  assert.ok(!sameCommunityName('2140 Tenerife', 'Tenerife 2140'))
  assert.ok(samePlaceWords('2140 Tenerife', 'Tenerife 2140'))
  assert.ok(samePlaceWords('Bitcoin Cádiz', 'BTC CADIZ'))
  assert.ok(!samePlaceWords('Bitcoin Canarias', 'Bitcanario'))
  assert.ok(!samePlaceWords('Bitcoin', 'BTC 2140'), 'sin sitio en el nombre no se junta')
})
