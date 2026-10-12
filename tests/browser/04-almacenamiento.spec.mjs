// Almacenamiento local: corrupto, lleno, denegado o desfasado respecto a la
// red. La app tiene que arrancar siempre y no enseñar lo que ya no existe.

import { listing, note, article, calendar, order, PK2, SK2, now } from './fixtures.mjs'

const cards = `document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length`
const titulos = `[...document.querySelectorAll('#channel-mercado .card-title')].map(e => e.textContent).sort()`
const listo = `document.getElementById('relay-status-list').children.length > 0`

const CACHES_ROTAS = {
  'texto que no es JSON': 'esto no es json',
  'JSON vacío': '{}',
  'sin datos': JSON.stringify({ ts: Date.now(), data: null }),
  'datos como texto': JSON.stringify({ ts: Date.now(), data: 'x' }),
  'canal como texto': JSON.stringify({ ts: Date.now(), data: { mercado: 'x' } }),
  'entradas nulas': JSON.stringify({ ts: Date.now(), data: { mercado: [null, 5, ['k'], ['k2', null]] } }),
  'anuncio sin campos': JSON.stringify({ ts: Date.now(), data: { mercado: [['k', { kind: 30402 }]] } }),
  'tipos equivocados': JSON.stringify({ ts: Date.now(), data: { mercado: [['k', {
    kind: 30402, title: 7, summary: {}, location: [], category: null, payment: 'Bitcoin', price: {}, currency: 3,
    publishedAt: 'ayer', naddr: 12, npub: null, pubkeyHex: {}, created_at: 'x' }]],
  feed: [['k', { kind: 1, content: null, npub: 5, note: {}, publishedAt: null }]],
  eventos: [['k', { kind: 31923, title: null, links: 'no-lista', start: 'mañana', end: 5, npub: null }]],
  intercambio: [['k', { kind: 38383, orderType: 5, payments: 'x', sats: 'muchos', premium: null, fiat: 3 }]] } }),
  'canal desconocido': JSON.stringify({ ts: Date.now(), data: { inventado: [['k', { kind: 1 }]], __proto__: [['k', {}]] } }),
  'marca de tiempo absurda': JSON.stringify({ ts: 'ayer', data: {} }),
}

export const tests = [
  ...Object.entries(CACHES_ROTAS).map(([nombre, valor]) => ({
    name: `caché local corrupta (${nombre}): la página arranca y pinta lo de los relays`,
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [listing({ title: 'Anuncio real' }), note()], localStorage: { plazap2p_v3: valor } } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 1`, { label: 'el anuncio real en pantalla' })
      t.assert.deepEqual(await page.evaluate(titulos), ['Anuncio real'])
      for (const tab of ['feed', 'eventos', 'intercambio', 'directorio', 'vendedores', 'mercado']) {
        await page.click(`.nav-tab[data-tab="${tab}"]`)
        await page.sleep(40)
        const texto = await page.evaluate(`document.getElementById('tab-${tab}').innerText`)
        t.assert.doesNotMatch(texto, /undefined|NaN|\[object Object\]|Invalid Date/, `texto roto en ${tab}`)
      }
      t.assert.equal(await page.text('#listing-count'), '2', 'el contador solo cuenta publicaciones reales')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  })),
  {
    name: 'preferencias, favoritos y lista de ocultos corruptos no impiden arrancar',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [listing()], localStorage: {
        plazap2p_sort: '{"mercado":"<img src=x onerror=__xss.push(1)>"}', plazap2p_favorites: '{"no":"lista"}',
        plazap2p_blocked_pubkeys: '"texto"', plazap2p_nwc_meta: 'x', plazap2p_nwc_persist: '{', plazap2p_pubkey: '<b>',
      } } })
      for (const p of ['/index.html', '/publicar.html']) {
        await page.goto(server.origin + p)
        await page.sleep(500)
        t.assert.deepEqual(t.appErrors(page), [], p)
        t.assert.deepEqual(await page.evaluate('window.__xss'), [])
      }
    },
  },
  ...['quota', 'denied'].map(storage => ({
    name: `almacenamiento ${storage === 'quota' ? 'lleno' : 'bloqueado por el navegador'}: las dos páginas funcionan`,
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [listing({ title: 'Anuncio real' })], storage } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 1`, { label: 'el anuncio en pantalla' })
      await page.click('#channel-mercado .card-fav-btn')
      await page.click('#channel-mercado .listing-card')
      await page.waitFor(`!document.getElementById('listing-modal').classList.contains('hidden')`)
      await page.sleep(900)   // deja pasar el guardado diferido de la caché
      t.assert.deepEqual(t.appErrors(page), [], 'index.html')
      await page.goto(server.origin + '/publicar.html')
      await page.sleep(600)
      t.assert.deepEqual(t.appErrors(page), [], 'publicar.html')
      const visible = await page.evaluate(`document.body.innerText.trim().length`)
      t.assert.ok(visible > 50, 'publicar.html no puede quedar en blanco')
    },
  })),
  {
    name: 'un anuncio que los relays ya no devuelven deja de mostrarse en la siguiente visita',
    async run(t) {
      const server = await t.server()
      const queda = listing({ d: 'queda', title: 'Sigue publicado' })
      const borrado = listing({ d: 'borrado', title: 'Borrado por su autor' })
      const page = await t.open({ scenario: { eventsByLoad: [[queda, borrado], [queda]] } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 2`)
      await page.sleep(1000)   // la caché se guarda con retardo
      await page.reload()
      await page.waitFor(listo)
      await page.sleep(700)    // todos los relays han contestado ya
      t.assert.deepEqual(await page.evaluate(titulos), ['Sigue publicado'])
      // Y tampoco vuelve desde la caché en la visita siguiente.
      await page.sleep(1000)
      await page.reload()
      await page.waitFor(listo)
      await page.sleep(300)
      t.assert.deepEqual(await page.evaluate(titulos), ['Sigue publicado'])
    },
  },
  {
    // Doble función: (1) sin relays, lo cacheado no se borra; (2) lo que la app
    // guarda de verdad, de TODOS los kinds, pasa su propia validación al
    // recargarse — si un parser cambia de forma y reviveCachedItem() no, esta
    // prueba falla.
    name: 'sin respuesta de los relays, lo guardado en caché (todos los tipos) se sigue mostrando',
    async run(t) {
      const server = await t.server()
      const mundo = [
        listing({ d: 'a', title: 'Anuncio en caché', summary: `It's "barato" <ya>`, extraTags: [['expiration', String(now() + 9999)]] }),
        listing({ d: 's', title: 'Servicio en caché', t: ['plazap2p', 'plazap2p-servicio'] }),
        note({ content: 'Nota en caché' }), article({ title: 'Artículo en caché', image: 'https://ejemplo.test/a.png' }),
        calendar({ title: 'Evento con hora' }), calendar({ d: 'dia', kind: 31922, title: 'Evento de día', start: '2099-05-01', end: '2099-05-02' }),
        order({ fa: ['100', '500'], pm: ['Bizum', 'SEPA'] }),
      ]
      const page = await t.open({ scenario: { events: mundo } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 2`)
      await page.sleep(1000)
      // Segunda visita sin conexión a ningún relay.
      const offline = await t.open({ scenario: { relays: { '*': { mode: 'down' } },
        localStorage: { plazap2p_v3: await page.evaluate(`localStorage.getItem('plazap2p_v3')`) } } })
      await offline.goto(server.origin + '/index.html')
      await offline.waitFor(`${cards} === 2`)
      await offline.sleep(6600)   // pasa el margen de espera: lo cacheado no puede borrarse
      t.assert.deepEqual(await offline.evaluate(titulos), ['Anuncio en caché', 'Servicio en caché'])
      for (const [tab, sel, n] of [['feed', '.feed-card', 1], ['articulos', '.article-card', 1], ['eventos', '.event-card', 2],
        ['intercambio', '.order-card', 1], ['directorio', '.dir-card', 1]]) {
        await offline.click(`.nav-tab[data-tab="${tab}"]`)
        t.assert.equal(await offline.count(`#channel-${tab} ${sel}`), n, `${tab} desde la caché`)
      }
      t.assert.deepEqual(t.appErrors(offline), [])
    },
  },
  {
    name: 'importar una lista de ocultos quita sus publicaciones al momento y tras recargar',
    async run(t) {
      const server = await t.server()
      const events = [listing({ d: 'mio', title: 'De otro vendedor' }), listing({ sk: SK2, d: 'oculto', title: 'Del vendedor oculto' })]
      const page = await t.open({ scenario: { events, dialogs: { prompt: JSON.stringify({ plazap2p_blocked_pubkeys: [PK2] }) } } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 2`)
      await page.sleep(1000)
      await page.click('.nav-tab[data-tab="acerca"]')
      await page.click('#btn-import-blocked')
      await page.click('.nav-tab[data-tab="mercado"]')
      t.assert.deepEqual(await page.evaluate(titulos), ['De otro vendedor'], 'nada más importar')
      await page.sleep(1000)
      await page.reload()
      await page.waitFor(listo)
      await page.sleep(500)
      t.assert.deepEqual(await page.evaluate(titulos), ['De otro vendedor'], 'tras recargar')
    },
  },
  {
    name: 'el contador de portada no cuenta dos veces un servicio (está en Mercado y en Directorio)',
    async run(t) {
      const server = await t.server()
      const events = [listing({ d: 's', t: ['plazap2p', 'plazap2p-servicio'] }), listing({ d: 'v' }), note()]
      const page = await t.open({ scenario: { events } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 2`)
      await page.sleep(900)   // termina la animación del contador
      t.assert.equal(await page.text('#listing-count'), '3')
    },
  },
  {
    name: 'caché de hace más de 30 minutos se ignora',
    async run(t) {
      const server = await t.server()
      const viejo = { kind: 30402, title: 'Muy antiguo', summary: '', location: null, category: 'venta', payment: ['Bitcoin'],
        price: '', currency: '', publishedAt: now() - 99999, status: 'active', naddr: 'naddr1qqqq', npub: 'npub1qqqq', pubkeyHex: 'a'.repeat(64), created_at: now() - 99999 }
      const page = await t.open({ scenario: { events: [], localStorage: {
        plazap2p_v3: JSON.stringify({ ts: Date.now() - 31 * 60 * 1000, data: { mercado: [['k', viejo]] } }) } } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(listo)
      await page.sleep(400)
      t.assert.equal(await page.evaluate(cards), 0)
    },
  },
]
