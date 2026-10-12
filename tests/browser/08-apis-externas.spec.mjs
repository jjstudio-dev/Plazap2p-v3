// APIs de terceros (mempool.space, CoinGecko, Kraken, yadio, alternative.me):
// la app las usa para precios y estadísticas, pero no las controla. Caídas,
// lentas, con JSON roto o devolviendo texto donde se espera un número, la
// página tiene que seguir en pie y no inyectar nada.

const P = campo => `<img src=x onerror="__xss.push('${campo}')">`

/** Respuestas válidas mínimas de cada API. */
const validas = () => ({
  precios: { USD: 65000, EUR: 60000, CHF: 57000 },
  altura: 900000,
  lightning: { latest: { total_capacity: 500000000000, channel_count: 50000, node_count: 15000, avg_capacity: 10000000 } },
  hashrate3d: { currentHashrate: 6.5e20, currentDifficulty: 9e13 },
  hashrate6m: { hashrates: Array.from({ length: 40 }, (_, i) => ({ timestamp: 1700000000 + i * 86400, avgHashrate: 6e20 + i * 1e18 })),
    difficulty: [], currentHashrate: 6.5e20, currentDifficulty: 9e13 },
  fees: { fastestFee: 12 },
  mempool: { count: 45000 },
  ajuste: { difficultyChange: 2.5, remainingBlocks: 800, estimatedRetargetDate: Date.now() + 5 * 86400000, previousRetarget: -1.2, progressPercent: 60, timeAvg: 590000 },
  fng: { data: [{ value: '62', value_classification: 'Greed' }] },
  moneda: { market_data: {
    current_price: { eur: 60000, usd: 65000 }, market_cap: { eur: 1.2e12, usd: 1.3e12 }, total_volume: { eur: 3e10 },
    circulating_supply: 19800000, max_supply: 21000000, price_change_percentage_24h: 1.2, price_change_percentage_7d: -3.4,
    price_change_percentage_30d: 5.6, price_change_percentage_1y: 40, high_24h: { eur: 61000 }, low_24h: { eur: 59000 },
    ath: { eur: 100000 }, ath_date: { eur: '2025-01-20T00:00:00.000Z' }, ath_change_percentage: { eur: -40 } },
    sentiment_votes_up_percentage: 70 },
  global: { data: { market_cap_percentage: { btc: 55.5 } } },
  simple: { bitcoin: { eur: 60000, usd: 65000, cny: 470000, chf: 57000 } },
  grafico: { prices: Array.from({ length: 31 }, (_, i) => [1700000000000 + i * 86400000, 60000 + i * 100]),
    total_volumes: Array.from({ length: 31 }, (_, i) => [1700000000000 + i * 86400000, 2e10]) },
  yadio: { BTC: { CNY: 470000, XAU: 25 } },
})

/** Rutas de fetch a partir de un juego de respuestas (o de una respuesta común para todas). */
function rutas(r, comun = null) {
  const de = (clave) => comun ?? { json: r[clave] }
  return [
    { match: 'mempool\\.space/api/v1/prices', ...de('precios') },
    { match: 'mempool\\.space/api/blocks/tip/height', ...de('altura') },
    { match: 'mempool\\.space/api/v1/lightning', ...de('lightning') },
    { match: 'mempool\\.space/api/v1/mining/hashrate/3d', ...de('hashrate3d') },
    { match: 'mempool\\.space/api/v1/mining/hashrate/6m', ...de('hashrate6m') },
    { match: 'mempool\\.space/api/v1/fees', ...de('fees') },
    { match: 'mempool\\.space/api/v1/difficulty-adjustment', ...de('ajuste') },
    { match: 'mempool\\.space/api/mempool', ...de('mempool') },
    { match: 'alternative\\.me/fng', ...de('fng') },
    { match: 'coingecko\\.com/api/v3/coins/bitcoin/market_chart', ...de('grafico') },
    { match: 'coingecko\\.com/api/v3/coins/bitcoin\\?', ...de('moneda') },
    { match: 'coingecko\\.com/api/v3/global', ...de('global') },
    { match: 'coingecko\\.com/api/v3/simple/price', ...de('simple') },
    { match: 'kraken\\.com', ...(comun ?? { json: { result: {} } }) },
    { match: 'yadio\\.io', ...de('yadio') },
  ]
}

/** Sustituye en profundidad cada valor hoja por una carga hostil con su ruta como etiqueta. */
function envenenar(v, ruta = '') {
  if (Array.isArray(v)) return v.slice(0, 3).map((x, i) => envenenar(x, `${ruta}[${i}]`))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, envenenar(x, `${ruta}.${k}`)]))
  return P(ruta)
}

async function recorrer(t, page) {
  for (const tab of ['bitcoin', 'conversor', 'mercado']) {
    await page.click(`.nav-tab[data-tab="${tab}"]`)
    await page.sleep(80)
  }
  t.assert.deepEqual(await page.evaluate('window.__xss'), [], 'código ejecutado desde una respuesta de API')
  const inyectado = await page.evaluate(`[...document.querySelectorAll('img[src="x"]')].length`)
  t.assert.equal(inyectado, 0, 'marcado inyectado desde una respuesta de API')
}

export const tests = [
  {
    name: 'respuestas válidas: precios, estadísticas, gráfico y conversor se pintan',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { fetch: rutas(validas()) } })
      await page.goto(server.origin + '/index.html?tab=bitcoin')
      await page.waitFor(`document.querySelector('#btc-market-data .bm-halving-card')`, { label: 'panel de mercado' })
      await page.waitFor(`document.querySelector('#btc-price-chart svg')`, { label: 'gráfico de precio' })
      t.assert.equal(await page.text('#stat-block-val'), '#900.000')
      t.assert.equal(await page.text('#stat-price-val'), '$65,000')
      t.assert.match(await page.text('#hc-price'), /60\.000 €/)
      await page.click('.nav-tab[data-tab="conversor"]')
      await page.fill('#conv-btc', '0.5')
      t.assert.equal(await page.evaluate(`document.getElementById('conv-eur').value`), '30000.00')
      t.assert.equal(await page.evaluate(`document.getElementById('conv-sats').value`), '50000000')
      t.assert.equal(await page.evaluate(`document.getElementById('conv-cny').value`), '235000.00')
      await page.fill('#conv-eur', '600')
      t.assert.equal(await page.evaluate(`document.getElementById('conv-btc').value`), '0.01000000')
      t.assert.deepEqual(t.appErrors(page), [])
      await t.shot(page, 'conversor')
    },
  },
  {
    name: 'todas las APIs devuelven texto hostil en cada campo: nada se ejecuta',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { fetch: rutas(envenenar(validas())) } })
      await page.goto(server.origin + '/index.html?tab=bitcoin')
      await page.sleep(900)
      await recorrer(t, page)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'un solo campo hostil entre datos válidos (el resto del panel sí se pinta): nada se ejecuta',
    async run(t) {
      const server = await t.server()
      // Uno a uno: así el render no aborta antes de llegar al campo envenenado.
      const base = validas()
      const mutaciones = []
      const visitar = (obj, ruta, raiz) => {
        for (const [k, v] of Object.entries(obj)) {
          if (v && typeof v === 'object' && !Array.isArray(v)) visitar(v, `${ruta}.${k}`, raiz)
          else if (!Array.isArray(v)) mutaciones.push({ raiz, ruta: `${ruta}.${k}` })
        }
      }
      for (const raiz of Object.keys(base)) {
        if (typeof base[raiz] === 'object') visitar(base[raiz], raiz, raiz)
        else mutaciones.push({ raiz, ruta: raiz })
      }
      for (const m of mutaciones) {
        const r = validas()
        const partes = m.ruta.split('.')
        if (partes.length === 1) r[m.raiz] = P(m.ruta)
        else { let o = r; for (const p of partes.slice(0, -1)) o = o[p]; o[partes.at(-1)] = P(m.ruta) }
        const page = await t.open({ scenario: { fetch: rutas(r) } })
        await page.goto(server.origin + '/index.html?tab=bitcoin')
        await page.waitFor(`document.getElementById('btc-market-data').children.length > 0`, { label: `panel (${m.ruta})` })
        await page.sleep(250)
        t.assert.deepEqual(await page.evaluate('window.__xss'), [], `campo ${m.ruta}`)
        t.assert.equal(await page.count('img[src="x"]'), 0, `marcado inyectado por ${m.ruta}`)
        await page.close()
      }
    },
  },
  ...[
    ['caídas (error de red)', { fail: true }],
    ['con error 500', { status: 500, json: { error: 'x' } }],
    ['con error 429 y cuerpo JSON', { status: 429, json: { status: { error_code: 429 } } }],
    ['devolviendo HTML en vez de JSON', { text: '<html><body>Mantenimiento</body></html>', type: 'text/html' }],
    ['devolviendo JSON vacío', { json: {} }],
    ['devolviendo null', { json: null }],
    ['devolviendo listas', { json: [1, 2, 3] }],
  ].map(([nombre, comun]) => ({
    name: `todas las APIs ${nombre}: la página sigue en pie y lo dice`,
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { fetch: rutas({}, comun) } })
      await page.goto(server.origin + '/index.html?tab=bitcoin')
      await page.waitFor(`document.getElementById('btc-market-data').innerText.trim().length > 0`, { label: 'el panel de mercado dice algo' })
      await page.waitFor(`document.getElementById('btc-price-chart').innerText.includes('Sin datos')`, { label: 'aviso del gráfico' })
      await recorrer(t, page)
      // El conversor BTC↔sats no necesita ninguna API.
      await page.click('.nav-tab[data-tab="conversor"]')
      await page.fill('#conv-btc', '0.5')
      t.assert.equal(await page.evaluate(`document.getElementById('conv-sats').value`), '50000000')
      const texto = await page.evaluate(`document.body.innerText`)
      t.assert.doesNotMatch(texto, /NaN|undefined|\[object Object\]|Infinity/, 'texto roto a la vista')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  })),
  {
    name: 'con las APIs colgadas, el conversor de la cabecera responde desde el primer momento',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { fetch: rutas({}, { hang: true }) } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.getElementById('relay-status-list').children.length > 0`)
      await page.click('#hc-swap')
      t.assert.equal(await page.text('#hc-left-lbl'), 'sats', 'el botón de cambiar unidad funciona sin esperar a las APIs')
    },
  },
  {
    name: 'el conversor de cabecera se vacía al elegir una moneda sin tasa',
    async run(t) {
      const server = await t.server()
      const r = validas()
      r.yadio = { BTC: { CNY: 470000 } }                 // sin tasa para el oro
      const page = await t.open({ scenario: { fetch: rutas(r) } })
      await page.goto(server.origin + '/index.html')
      await page.fill('#hc-left', '1')
      await page.waitFor(`Number(document.getElementById('hc-right').value) > 1000`, { label: 'importe en EUR' })
      await page.evaluate(`(() => { const s = document.getElementById('hc-right-cur'); s.value = 'XAU'; s.dispatchEvent(new Event('change')) })()`)
      t.assert.equal(await page.evaluate(`document.getElementById('hc-right').value`), '', 'no queda la cifra en euros con la etiqueta del oro')
    },
  },
  {
    name: 'tasas negativas, nulas o absurdas no se usan para convertir',
    async run(t) {
      const server = await t.server()
      const r = validas()
      r.precios = { USD: -65000, EUR: 0, CHF: 'NaN' }
      r.simple = { bitcoin: { eur: 'gratis', usd: null, cny: -1, chf: {} } }
      r.yadio = { BTC: { CNY: 'x', XAU: { rate: -5 } } }
      const page = await t.open({ scenario: { fetch: rutas(r) } })
      await page.goto(server.origin + '/index.html?tab=conversor')
      await page.waitFor(`document.getElementById('conv-error-banner').style.display !== 'none'`, { label: 'aviso de que no hay tasas' })
      await page.fill('#conv-btc', '1')
      const fiat = await page.evaluate(`['eur', 'usd', 'cny', 'chf', 'xau'].map(c => document.getElementById('conv-' + c).value)`)
      t.assert.deepEqual(fiat, ['', '', '', '', ''], 'ningún importe calculado con una tasa inválida')
    },
  },
]
