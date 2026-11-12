// Mercados externos compatibles (Mercasats y derivados).
// Los eventos de ejemplo copian el formato real de Mercasats (nostr-publish.js
// e index.html del repo Kilombino/mercasats, nov-2026).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_EXTERNAL_MARKETS, externalMarketsFrom, marketTags, marketOf, externalCategory,
  normalizeCurrency, marketListingUrl, proxiedSeller, isMarketSigned, isMarketEvent, marketRelays, MAX_MARKET_RELAYS,
} from '../js/external-markets.js'

const MARKET_PK = '0'.repeat(7) + '2' + 'a'.repeat(56)
const SELLER_PK = 'b'.repeat(64)

// Anuncio de Telegram firmado por la cuenta de Mercasats (buildMarketplaceEvent).
const telegramListing = {
  kind: 30402, pubkey: MARKET_PK, created_at: 1_790_000_000,
  content: 'Portátil\n\nCasi nuevo\n\n💰 120 €\n👤 @alguien\n🔗 https://mercasats.kilombino.com/?p=412',
  tags: [
    ['d', 'mercasats-412'], ['title', 'Portátil'], ['summary', 'Casi nuevo'],
    ['published_at', '1790000000'], ['location', 'Barcelona'], ['price', '120', 'EUR'],
    ['t', 'mercasats'], ['t', 'p2p'], ['t', 'bitcoin'], ['r', 'https://mercasats.kilombino.com/?p=412'],
    ['expiration', '1821104000'], ['t', 'informatica'], ['p', SELLER_PK, '', 'seller'],
  ],
}

// Anuncio firmado por el propio vendedor desde la web de Mercasats.
const webListing = {
  kind: 30402, pubkey: SELLER_PK, created_at: 1_790_000_100,
  content: 'Clases de guitarra\n\n🔗 https://mercasats.kilombino.com/?p=413',
  tags: [['d', 'abc'], ['title', 'Clases de guitarra'], ['price', '5000', 'SAT'], ['t', 'mercasats'], ['t', 'serveis']],
}

test('sin configuración se usa Mercasats con sus relays públicos (sin el privado)', () => {
  const markets = externalMarketsFrom({})
  assert.equal(markets, DEFAULT_EXTERNAL_MARKETS)
  assert.deepEqual(marketTags(markets), ['mercasats'])
  assert.deepEqual([...markets[0].relays], ['wss://relay.kilombino.com', 'wss://relay.minibolt.info'])
  assert.ok(!markets[0].relays.includes('wss://trobades.kilombino.com'))
})

test('la configuración se limpia: sin etiquetas de PlazaP2P, URLs raras ni relays privados', () => {
  const markets = externalMarketsFrom({ external_markets: [
    { tag: 'Derivado-Sats', label: 'Derivado', url: 'https://derivado.example/tienda', relays: ['wss://relay.derivado.example/', 'ws://inseguro.example', 'wss://localhost', 'wss://192.168.1.5'] },
    { tag: 'plazap2p-venta', label: 'Trampa' },
    { tag: 'x', label: 'corta' },
    { tag: 'derivado-sats', label: 'Repetido' },
    { tag: 'otro', url: 'javascript:alert(1)' },
    null,
  ] })
  assert.equal(markets.length, 2)
  assert.deepEqual(markets[0], { id: 'derivado-sats', tag: 'derivado-sats', label: 'Derivado', url: 'https://derivado.example', relays: ['wss://relay.derivado.example'] })
  assert.equal(markets[1].tag, 'otro')
  assert.equal(markets[1].url, null)
  // Una lista vacía en la configuración apaga los mercados externos.
  assert.deepEqual(externalMarketsFrom({ external_markets: [] }), [])
})

test('un anuncio con etiquetas de PlazaP2P es de PlazaP2P aunque lleve la de Mercasats', () => {
  const markets = externalMarketsFrom({})
  assert.equal(marketOf(['mercasats', 'informatica'], markets)?.id, 'mercasats')
  assert.equal(marketOf(['MERCASATS'], markets)?.id, 'mercasats')
  assert.equal(marketOf(['plazap2p', 'plazap2p-venta', 'mercasats'], markets), null)
  assert.equal(marketOf(['bitcoin'], markets), null)
})

test('categoría: servicio si es de servicios, venta en el resto', () => {
  assert.equal(externalCategory(['mercasats', 'serveis']), 'servicio')
  assert.equal(externalCategory(['mercasats', 'Serveis'.toLowerCase()]), 'servicio')
  assert.equal(externalCategory(['mercasats', 'informatica']), 'venta')
})

test('moneda: SAT y sats pasan a SATS; el resto se conserva acotado', () => {
  assert.equal(normalizeCurrency('SAT'), 'SATS')
  assert.equal(normalizeCurrency('sats'), 'SATS')
  assert.equal(normalizeCurrency('eur'), 'EUR')
  assert.equal(normalizeCurrency('BTC'), 'BTC')
  assert.equal(normalizeCurrency('丰'), '丰')
  assert.equal(normalizeCurrency(undefined), '')
})

test('enlace a la web del mercado: etiqueta r o URL del texto, solo de esa web', () => {
  const [m] = externalMarketsFrom({})
  assert.equal(marketListingUrl(telegramListing, m), 'https://mercasats.kilombino.com/?p=412')
  assert.equal(marketListingUrl(webListing, m), 'https://mercasats.kilombino.com/?p=413')
  const phishing = { tags: [['r', 'https://mercasats.kilombino.com.evil.example/?p=1']], content: 'http://mercasats.kilombino.com/?p=2 https://otro.example' }
  assert.equal(marketListingUrl(phishing, m), null)
  assert.equal(marketListingUrl(webListing, { ...m, url: null }), null)
})

test('vendedor representado: solo cuando firma la cuenta del mercado', () => {
  assert.equal(proxiedSeller(telegramListing), SELLER_PK)
  assert.equal(proxiedSeller(webListing), null)
  const selfTagged = { ...webListing, tags: [...webListing.tags, ['p', SELLER_PK, '', 'seller']] }
  assert.equal(proxiedSeller(selfTagged), null)
})

test('firmado por la cuenta del mercado: con p seller o con su etiqueta r (los de Telegram)', () => {
  const [m] = externalMarketsFrom({})
  assert.ok(isMarketSigned(telegramListing, m))
  // 48 de los anuncios reales de Telegram no llevan `p … seller`, solo la `r`.
  const sinP = { ...telegramListing, tags: telegramListing.tags.filter(t => t[0] !== 'p') }
  assert.ok(isMarketSigned(sinP, m))
  // El del vendedor desde la web solo trae el enlace en el texto.
  assert.ok(!isMarketSigned(webListing, m))
  const rAjena = { ...webListing, tags: [...webListing.tags, ['r', 'https://otra.example/x']] }
  assert.ok(!isMarketSigned(rAjena, m))
})

test('a los relays del mercado van los anuncios y sus borrados, nada más', () => {
  assert.ok(isMarketEvent({ kind: 30402, tags: [] }))
  assert.ok(isMarketEvent({ kind: 5, tags: [['a', `30402:${SELLER_PK}:d1`], ['e', 'f'.repeat(64)]] }))
  assert.ok(!isMarketEvent({ kind: 5, tags: [['a', `31923:${SELLER_PK}:ev`]] }))
  assert.ok(!isMarketEvent({ kind: 1, tags: [['t', 'plazap2p']] }))
  assert.ok(!isMarketEvent({ kind: 1985, tags: [] }))
  assert.ok(!isMarketEvent(null))
})

test('relays de mercados: sin repetir los de PlazaP2P y con tope', () => {
  const markets = externalMarketsFrom({})
  assert.deepEqual(marketRelays(markets, ['wss://nos.lol']), ['wss://relay.kilombino.com', 'wss://relay.minibolt.info'])
  assert.deepEqual(marketRelays(markets, ['wss://relay.kilombino.com/']), ['wss://relay.minibolt.info'])
  const many = externalMarketsFrom({ external_markets: [
    { tag: 'uno', relays: ['wss://a.example', 'wss://b.example', 'wss://c.example'] },
    { tag: 'dos', relays: ['wss://d.example', 'wss://e.example'] },
  ] })
  assert.equal(marketRelays(many).length, MAX_MARKET_RELAYS)
})
