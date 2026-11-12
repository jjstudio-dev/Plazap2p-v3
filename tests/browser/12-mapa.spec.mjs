// Pestaña Mapa: capas por grupo, comunidades de 2140meetups, puntos de venta
// con «Cómo llegar» y anuncios de particulares como zona aproximada.
import { listing, calendar, SK2 } from './fixtures.mjs'
import { encodeGeohash } from '../../js/geohash.js'

const gTags = gh => Array.from({ length: gh.length - 2 }, (_, i) => ['g', gh.slice(0, gh.length - i)])

export const tests = [
  {
    name: 'Mapa: capas, comunidades, punto de venta con «Cómo llegar» y particulares como zona',
    async run(t) {
      const server = await t.server()
      const tienda = listing({
        d: 'tienda-1', title: 'Tienda de prueba', t: ['plazap2p', 'plazap2p-venta', 'plazap2p-comercio'],
        extraTags: gTags(encodeGeohash(40.4168, -3.7038, 9)),
      })
      const particular = listing({
        sk: SK2, d: 'bici-1', title: 'Bici de particular', extraTags: gTags('ezjmg'),
      })
      const evento = calendar({ d: 'ev-1', title: 'Meetup con zona' })
      evento.tags.push(...gTags('ezjmg'))
      const page = await t.open({ scenario: { events: [tienda, particular, evento] } })
      await page.goto(server.origin + '/index.html?tab=mapa')
      await page.waitFor(`document.querySelector('#map-container .leaflet-pane')`, { timeout: 10000, label: 'Leaflet cargado' })
      await page.waitFor(`/🏪 1/.test(document.getElementById('map-status').textContent)`, { timeout: 10000, label: 'punto de venta en el mapa' })
      const status = await page.text('#map-status')
      t.assert.match(status, /🏘 \d{2}/, 'las comunidades de España')
      t.assert.match(status, /🛒 1/, 'el particular como zona')

      const layers = await page.evaluate(`[...document.querySelectorAll('#map-layer-chips .map-layer-chip')].map(b => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? ' ✓' : ''))`)
      t.assert.deepEqual(layers, ['🏘 Comunidades ✓', '📅 Eventos ✓', '🏪 Puntos de venta ✓', '🛒 Anuncios (zona aproximada) ✓', '₿ Comercios BTC Map'])

      // Punto de venta: punto con «Cómo llegar».
      await page.evaluate(`[...document.querySelectorAll('#map-container path.leaflet-interactive')].find(p => p.getAttribute('fill') === '#30d158').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
      await page.waitFor(`document.querySelector('.leaflet-popup-content')?.textContent.includes('Tienda de prueba')`)
      const popup = await page.text('.leaflet-popup-content')
      t.assert.match(popup, /Cómo llegar/)
      t.assert.ok(await page.evaluate(`!!document.querySelector('.leaflet-popup-content a[href^="geo:40.41"]')`), 'enlace para la app de mapas')
      t.assert.ok(await page.evaluate(`!!document.querySelector('.leaflet-popup-content a[href^="https://www.google.com/maps/dir/"]')`))

      // Particular: zona aproximada, sin «Cómo llegar».
      await page.evaluate(`[...document.querySelectorAll('#map-container path.leaflet-interactive')].find(p => p.getAttribute('fill') === '#0a84ff').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
      await page.waitFor(`document.querySelector('.leaflet-popup-content')?.textContent.includes('Bici de particular')`)
      const popup2 = await page.text('.leaflet-popup-content')
      t.assert.match(popup2, /Zona aproximada/)
      t.assert.doesNotMatch(popup2, /Cómo llegar/)

      // Apagar una capa se recuerda.
      await page.evaluate(`document.querySelector('#map-layer-chips .map-layer-chip[data-layer="comunidades"]').click()`)
      await page.waitFor(`/🏘 –/.test(document.getElementById('map-status').textContent)`, { label: 'capa apagada en el contador' })
      t.assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem('plazap2p_mapa_capas')).comunidades`), false)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'Comunidades: salen las comunidades locales de España con su fuente',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [] } })
      await page.goto(server.origin + '/index.html?tab=comunidades')
      await page.waitFor(`document.querySelectorAll('#channel-comunidades .local-community-card').length > 15`, { timeout: 10000, label: 'comunidades locales' })
      const txt = await page.text('#channel-comunidades')
      t.assert.match(txt, /Comunidades locales en España/)
      t.assert.match(txt, /2140meetups\.com/)
      t.assert.match(txt, /Sevilla Bitcoin Only/)
      t.assert.match(await page.text('#channel-comunidades .community-card'), /Valencia Bitcoin Plebs/, 'Valencia la primera')
      const names = await page.evaluate(`[...document.querySelectorAll('#channel-comunidades .community-name')].map(n => n.textContent.replace('destacada', '').trim())`)
      t.assert.equal(names.filter(n => n === 'Valencia Bitcoin Plebs').length, 1, 'sin repetir las del directorio curado')
      t.assert.ok(await page.evaluate(`[...document.querySelectorAll('#channel-comunidades .local-community-card img')].every(i => i.src.startsWith('https://2140meetups.com/') || i.src.startsWith('https://static.btcmap.org/'))`), 'fotos solo de 2140meetups o BTC Map')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
]
