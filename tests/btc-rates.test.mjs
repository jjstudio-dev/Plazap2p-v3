// btc-rates — las tasas de cambio vienen de APIs de terceros y deciden
// importes: solo valen números finitos y positivos, y cada consulta refresca
// de verdad (regresión: CNY y oro se quedaban con el valor de la primera carga).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeRates, finiteNumber, onlyNumbers } from '../js/btc-rates.js'

const MP = { USD: 65000, EUR: 60000, CHF: 57000 }
const CG = { bitcoin: { usd: 64000, eur: 59000, cny: 470000, chf: 56000 } }
const YD = { BTC: { CNY: 471000, XAU: 25 } }

test('prioridad: mempool para USD/EUR/CHF, CoinGecko de reserva, yadio para oro', () => {
  const { rates, refreshed } = mergeRates({}, { mempool: MP, coingecko: CG, yadio: YD })
  assert.deepEqual(rates, { USD: 65000, EUR: 60000, CHF: 57000, CNY: 470000, XAU: 25, USDT: 65000, USDC: 65000 })
  assert.deepEqual(refreshed.sort(), ['CHF', 'CNY', 'EUR', 'USD', 'XAU'])
})

test('sin mempool, CoinGecko cubre USD/EUR/CHF', () => {
  const { rates } = mergeRates({}, { mempool: null, coingecko: CG, yadio: null })
  assert.deepEqual([rates.USD, rates.EUR, rates.CHF, rates.CNY], [64000, 59000, 56000, 470000])
  assert.equal(rates.XAU, undefined)
})

test('cada ronda refresca TODAS las monedas, no solo las que faltaban (regresión)', () => {
  const primera = mergeRates({}, { mempool: MP, coingecko: CG, yadio: YD }).rates
  const segunda = mergeRates(primera, {
    mempool: { USD: 70000, EUR: 64000, CHF: 60000 },
    coingecko: { bitcoin: { usd: 69000, eur: 63000, cny: 500000, chf: 59000 } },
    yadio: { BTC: { CNY: 501000, XAU: 27 } },
  }).rates
  assert.equal(segunda.CNY, 500000, 'el yuan se actualiza')
  assert.equal(segunda.XAU, 27, 'el oro se actualiza')
  assert.equal(segunda.USDT, 70000, 'las estables siguen al dólar nuevo')
})

test('si mempool cae en una ronda posterior, USD/EUR pasan a CoinGecko en vez de quedarse viejos', () => {
  const primera = mergeRates({}, { mempool: MP, coingecko: CG, yadio: YD }).rates
  const segunda = mergeRates(primera, { mempool: null, coingecko: { bitcoin: { usd: 69000, eur: 63000 } }, yadio: null })
  assert.deepEqual([segunda.rates.USD, segunda.rates.EUR], [69000, 63000])
  assert.equal(segunda.rates.CHF, 57000, 'lo que nadie refresca se conserva')
  assert.deepEqual(segunda.refreshed.sort(), ['EUR', 'USD'])
})

test('una ronda fallida entera conserva lo anterior y no declara nada refrescado', () => {
  const primera = mergeRates({}, { mempool: MP, coingecko: CG, yadio: YD }).rates
  const { rates, refreshed } = mergeRates(primera, {})
  assert.deepEqual(rates, primera)
  assert.deepEqual(refreshed, [])
})

test('tasas negativas, cero, texto, null u objetos no se aceptan', () => {
  const { rates, refreshed } = mergeRates({}, {
    mempool: { USD: -65000, EUR: 0, CHF: 'NaN' },
    coingecko: { bitcoin: { eur: 'gratis', usd: null, cny: -1, chf: {} } },
    yadio: { BTC: { CNY: '<img src=x>', XAU: { rate: -5 } } },
  })
  assert.deepEqual(rates, {})
  assert.deepEqual(refreshed, [])
})

test('respuestas con forma inesperada (null, listas, texto, objetos vacíos) no lanzan', () => {
  for (const raro of [null, undefined, [], [1, 2], 'texto', 42, {}, { bitcoin: null }, { BTC: 'x' }, { rates: [] }]) {
    assert.doesNotThrow(() => mergeRates({ EUR: 1 }, { mempool: raro, coingecko: raro, yadio: raro }))
    assert.deepEqual(mergeRates({ EUR: 1 }, { mempool: raro, coingecko: raro, yadio: raro }).rates, { EUR: 1 })
  }
})

test('yadio: acepta tasa plana, { rate } y los formatos rates/BTC', () => {
  assert.equal(mergeRates({}, { yadio: { rates: { XAU: 30 } } }).rates.XAU, 30)
  assert.equal(mergeRates({}, { yadio: { BTC: { XAU: { rate: 31 } } } }).rates.XAU, 31)
  assert.equal(mergeRates({}, { yadio: { XAU: { ask: 32 } } }).rates.XAU, 32)
  assert.equal(mergeRates({}, { yadio: { BTC: { XAU: '33.5' } } }).rates.XAU, 33.5, 'texto numérico')
})

test('finiteNumber / onlyNumbers: solo sobreviven los números', () => {
  assert.equal(finiteNumber(900000), 900000)
  assert.equal(finiteNumber('900000'), 900000)
  for (const v of ['<img src=x onerror=alert(1)>', '', ' ', null, undefined, {}, [], true, NaN, Infinity]) {
    assert.equal(finiteNumber(v), null, String(v))
  }
  assert.deepEqual(
    onlyNumbers({ a: 1, b: '<b>', c: { d: 2, e: null, f: 'x' }, g: [3, 'y', { h: 4 }], i: true, j: Infinity }),
    { a: 1, b: null, c: { d: 2, e: null, f: null }, g: [3, null, { h: 4 }], i: null, j: null },
  )
})
