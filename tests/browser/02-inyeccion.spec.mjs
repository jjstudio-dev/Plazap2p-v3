// Inyección: ningún texto que venga de fuera (relays, JSON de data/, caché)
// puede convertirse en marcado o en código. Cada carga hostil, si llegara a
// ejecutarse, escribe en window.__xss.

import { listing, note, article, calendar, order, rating, historial, signWith, SK1, SK2, PK1, PK2, now } from './fixtures.mjs'

// Variantes que rompen cada contexto: HTML, atributo con ", atributo con ',
// cadena JS dentro de onclick='…', y esquema de URL.
const P = campo => [
  `<img src=x onerror="__xss.push('${campo}:img')">`,
  `"><svg onload="__xss.push('${campo}:svg')">`,
  `'-__xss.push('${campo}:comilla')-'`,
  `');__xss.push('${campo}:js');//`,
  `</p><script>__xss.push('${campo}:script')</script>`,
].join(' ')
const JS_URL = campo => `javascript:__xss.push('${campo}:url')`

/** Comprobaciones comunes tras pintar: nada ejecutado y nada inyectado en el DOM. */
async function assertLimpio(t, page, donde) {
  t.assert.deepEqual(await page.evaluate('window.__xss'), [], `código ejecutado en ${donde}`)
  const inyectado = await page.evaluate(`[...document.querySelectorAll(
    'img[src="x"], svg[onload], script:not([src]):not([type])'
  )].filter(el => /__xss/.test(el.outerHTML)).map(el => el.outerHTML.slice(0, 120))`)
  t.assert.deepEqual(inyectado, [], `marcado inyectado en ${donde}`)
  const urls = await page.evaluate(`[...document.querySelectorAll('a[href], img[src], iframe[src]')]
    .map(el => el.getAttribute('href') ?? el.getAttribute('src'))
    .filter(u => /^\\s*(javascript|data:text\\/html|vbscript):/i.test(u))`)
  t.assert.deepEqual(urls, [], `URL ejecutable en ${donde}`)
  // Manejadores con la carga dentro. Un onclick de la app puede llevarla como
  // texto inerte dentro de una cadena JS: se pulsa y se comprueba que no se
  // ejecuta. Cualquier otro manejador (onerror, onload…) con la carga es
  // marcado inyectado.
  const manejadores = await page.evaluate(`(() => {
    const otros = []
    for (const el of [...document.querySelectorAll('*')]) {
      for (const a of [...el.attributes]) {
        if (!/^on/i.test(a.name) || !/__xss/.test(a.value)) continue
        if (a.name.toLowerCase() === 'onclick') { try { el.click() } catch {} }
        else otros.push(a.name + '=' + a.value.slice(0, 80))
      }
    }
    return otros
  })()`)
  t.assert.deepEqual(manejadores, [], `manejador inyectado en ${donde}`)
  t.assert.deepEqual(await page.evaluate('window.__xss'), [], `código ejecutado al pulsar en ${donde}`)
}

const mundoHostil = () => [
  listing({
    d: `d${P('d')}`, title: P('titulo'), summary: P('resumen'), location: P('zona'),
    price: [P('precio'), P('moneda')], t: ['plazap2p', 'plazap2p-venta', P('tag')],
    extraTags: [['image', JS_URL('imagen')], ['published_at', P('fecha')], ['expiration', P('caduca')]],
  }),
  listing({ d: 'servicio-hostil', title: P('dir-titulo'), summary: P('dir-resumen'), location: P('dir-zona'),
    price: [P('dir-precio'), P('dir-moneda')], t: ['plazap2p', 'plazap2p-servicio'] }),
  note({ content: P('nota') }),
  article({ title: P('art-titulo'), summary: P('art-resumen'), image: JS_URL('art-imagen') }),
  article({ d: 'art-2', title: 'Imagen con comillas', image: `https://ejemplo.test/a.png" onerror="__xss.push('art-img-attr')` }),
  calendar({ title: P('ev-titulo'), summary: P('ev-resumen'), location: P('ev-lugar'), tzid: P('ev-tz'),
    links: [JS_URL('ev-enlace'), `https://ejemplo.test/" onclick="__xss.push('ev-enlace-attr')`] }),
  calendar({ d: 'ev-2', kind: 31922, title: P('ev2-titulo'), start: P('ev2-inicio'), end: P('ev2-fin') }),
  order({ pm: [P('pago'), P('pago2')], fa: ['100', '500'], f: 'EUR' }),
  order({ d: 'orden-2', f: 'EUR', k: 'buy', premium: '5', pm: [P('pago-compra')] }),
  rating({ sk: SK2, ratee: PK1, comment: P('comentario'), aspects: { [P('aspecto')]: '5', comunicacion: '4' } }),
  historial(SK2),   // para que la valoración de arriba cuente y su comentario llegue a pintarse
]

export const tests = [
  {
    name: 'eventos hostiles de un relay no ejecutan código en ninguna pestaña ni en los modales',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: mundoHostil() } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length >= 1`)
      await assertLimpio(t, page, 'mercado')

      const tabs = await page.evaluate(`[...document.querySelectorAll('.nav-tab')].map(b => b.dataset.tab)`)
      for (const tab of tabs) {
        await page.click(`.nav-tab[data-tab="${tab}"]`)
        await page.sleep(40)
        await assertLimpio(t, page, `pestaña ${tab}`)
      }
      // Cada canal tiene que haber pintado algo: si no, la prueba no prueba nada.
      for (const [tab, sel] of [['feed', '.feed-card'], ['articulos', '.article-card'], ['eventos', '.event-card'],
        ['intercambio', '.order-card'], ['directorio', '.dir-card']]) {
        await page.click(`.nav-tab[data-tab="${tab}"]`)
        await page.waitFor(`document.querySelectorAll('#channel-${tab} ${sel}').length >= 1`, { label: `tarjetas en ${tab}` })
      }

      // Modal del anuncio
      await page.click('.nav-tab[data-tab="mercado"]')
      await page.click('#channel-mercado .listing-card')
      await page.waitFor(`!document.getElementById('listing-modal').classList.contains('hidden')`)
      await assertLimpio(t, page, 'modal de anuncio')
      // Todos los botones del modal, uno a uno (los onclick llevan datos del anuncio).
      await page.evaluate(`document.querySelector('#listing-modal .card-fav-btn').click()`)
      await page.evaluate(`document.querySelector('#listing-modal .modal-hide-seller-btn').click()`)
      await assertLimpio(t, page, 'acciones del modal')

      // Modal de reputación (comentarios firmados por terceros)
      await page.evaluate(`window.openReputacionModal(${JSON.stringify(PK1)})`)
      await page.waitFor(`document.querySelector('#listing-modal .modal-rating-header')`, { timeout: 9000 })
      t.assert.ok(await page.count('#listing-modal .modal-notice') >= 1, 'el comentario hostil tiene que haberse pintado')
      await assertLimpio(t, page, 'modal de reputación')

      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'clic en cada tarjeta y botón generado a partir de datos hostiles',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: mundoHostil() } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length >= 1`)
      for (const tab of ['mercado', 'feed', 'articulos', 'eventos', 'intercambio', 'directorio', 'vendedores']) {
        await page.click(`.nav-tab[data-tab="${tab}"]`)
        await page.sleep(60)
        // Pulsa cada elemento con onclick del canal; los enlaces se neutralizan
        // para que el navegador no abandone la página.
        await page.evaluate(`(() => {
          const root = document.getElementById('tab-${tab}')
          for (const a of root.querySelectorAll('a[href]')) a.addEventListener('click', e => e.preventDefault())
          for (const el of [...root.querySelectorAll('[onclick]')]) { try { el.click() } catch {} }
          window.closeModal?.()
        })()`)
        await assertLimpio(t, page, `clics en ${tab}`)
      }
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'JSON de data/ con contenido hostil no ejecuta código',
    async run(t) {
      const server = await t.server()
      const fetchRoutes = [
        { match: 'data/comunidades\\.json', json: [{ id: 'c1', nombre: P('com-nombre'), plataforma: P('com-plat'), link: JS_URL('com-link'),
          pais: P('com-pais'), descripcion: P('com-desc'), idioma: P('com-idioma'), logo: JS_URL('com-logo'), aprobado: true },
        { id: 'c2', nombre: 'Logo con comillas', link: 'https://ejemplo.test', logo: `https://ejemplo.test/l.png" onerror="__xss.push('com-logo-attr')`, aprobado: true }] },
        { match: 'data/herramientas\\.json', json: [{ id: 'h1', nombre: P('her-nombre'), categoria: 'p2p', descripcion: P('her-desc'),
          link: JS_URL('her-link'), logo: `https://ejemplo.test/l.png" onerror="__xss.push('her-logo-attr')`, plataforma: P('her-plat'), aprobado: true }] },
        { match: 'data/multimedia\\.json', json: [{ id: 'm1', nombre: P('med-nombre'), tipo: P('med-tipo'), descripcion: P('med-desc'),
          idioma: P('med-idioma'), enlaces: [{ tipo: P('med-etipo'), label: P('med-label'), url: JS_URL('med-url') }], aprobado: true }] },
        { match: 'data/eventos\\.json', json: [{ id: 'e1', title: P('sev-titulo'), summary: P('sev-resumen'), location: P('sev-lugar'),
          start: '2099-01-01T10:00:00', links: [JS_URL('sev-link')], recurrente: true, aprobado: true }] },
        { match: 'data/mantenimiento\\.json', json: { ln_address: P('ln'), btc_address: P('btc'), mensaje: P('msg'), mensaje_gracias: P('gracias') } },
        { match: 'data/ratings\\.json', json: { v: 1, sellers: { [PK1]: { avg: P('avg'), n: 3, aspects: { [P('asp')]: 5 } } } } },
      ]
      const page = await t.open({ scenario: { events: [listing()], fetch: fetchRoutes } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-comunidades .community-card').length === 2`)
      const tabs = await page.evaluate(`[...document.querySelectorAll('.nav-tab')].map(b => b.dataset.tab)`)
      for (const tab of tabs) {
        await page.click(`.nav-tab[data-tab="${tab}"]`)
        await page.sleep(40)
        await assertLimpio(t, page, `pestaña ${tab}`)
      }
      await page.evaluate(`window.openDonarModal()`)
      await page.evaluate(`document.querySelectorAll('.btn-copy').forEach(b => { try { b.click() } catch {} })`)
      await assertLimpio(t, page, 'donación')
      // El anuncio del vendedor con índice estático hostil: tarjeta y modal.
      await page.evaluate(`window.closeDonarModal()`)
      await page.click('.nav-tab[data-tab="mercado"]')
      await page.click('#channel-mercado .listing-card')
      await assertLimpio(t, page, 'modal con índice de reputación hostil')
      await page.click('.nav-tab[data-tab="vendedores"]')
      await page.evaluate(`window.openReputacionModal(${JSON.stringify(PK1)})`)
      await page.sleep(400)
      await assertLimpio(t, page, 'reputación con índice hostil')
    },
  },
  {
    name: 'config.json hostil (relays y etiquetas) no ejecuta código',
    async run(t) {
      const server = await t.server()
      const cfg = {
        community_tags: [P('tag')],
        relays: [`wss://relay.test/');__xss.push('relay-js');//`, `wss://r2.test/"><img src=x onerror="__xss.push('relay-img')">`],
        channels: [{ id: 'mercado', kinds: [30402], label: P('ch-label'), icon: P('ch-icono') }],
        refresh_interval_ms: 300000, categories: [], publish_clients: [], nostr_clients: [], wallets: [],
      }
      const page = await t.open({ scenario: { fetch: [{ match: 'data/config\\.json', json: cfg }] } })
      await page.goto(server.origin + '/index.html')
      await page.sleep(500)
      await page.click('.nav-tab[data-tab="relays"]')
      await page.evaluate(`document.querySelectorAll('#relay-status-list .btn-copy').forEach(b => b.click())`)
      await assertLimpio(t, page, 'lista de relays')
      await page.click('.nav-tab[data-tab="mercado"]')
      await page.sleep(300)
      await assertLimpio(t, page, 'mercado vacío con etiqueta hostil')
    },
  },
  {
    name: 'una caché local manipulada no ejecuta código al pintarse',
    async run(t) {
      const server = await t.server()
      const item = {
        kind: 30402, title: P('c-titulo'), summary: P('c-resumen'), location: P('c-zona'), category: P('c-cat'),
        payment: [P('c-pago')], price: P('c-precio'), currency: P('c-moneda'), publishedAt: now(), status: 'active',
        naddr: `naddr1x');__xss.push('c-naddr');//`, npub: `npub1x"><img src=x onerror="__xss.push('c-npub')">`,
        pubkeyHex: `ab');__xss.push('c-hex');//`, created_at: now(),
      }
      const cache = { ts: Date.now(), data: {
        mercado: [['k1', item]],
        feed: [['k2', { kind: 1, content: P('c-nota'), npub: P('c-npub2'), note: `note1x');__xss.push('c-note');//`, publishedAt: now(), created_at: now() }]],
        articulos: [['k3', { kind: 30023, title: P('c-art'), summary: P('c-art-res'), image: JS_URL('c-art-img'), naddr: `naddr1y');__xss.push('c-art-naddr');//`, npub: 'npub1z', publishedAt: now(), created_at: now() }]],
        directorio: [['k4', { ...item, naddr: `naddr1d');__xss.push('c-dir-naddr');//` }]],
      } }
      const page = await t.open({ scenario: { relays: { '*': { mode: 'silent' } }, localStorage: { plazap2p_v3: cache } } })
      await page.goto(server.origin + '/index.html')
      await page.sleep(500)
      for (const tab of ['mercado', 'feed', 'articulos', 'directorio', 'vendedores']) {
        await page.click(`.nav-tab[data-tab="${tab}"]`)
        await page.sleep(60)
        await page.evaluate(`(() => {
          const root = document.getElementById('tab-${tab}')
          for (const a of root.querySelectorAll('a[href]')) a.addEventListener('click', e => e.preventDefault())
          for (const el of [...root.querySelectorAll('[onclick]')]) { try { el.click() } catch {} }
          for (const el of [...document.querySelectorAll('#listing-modal [onclick]')]) { try { el.click() } catch {} }
        })()`)
        await assertLimpio(t, page, `caché manipulada en ${tab}`)
      }
    },
  },
  {
    name: 'la imagen de un artículo no se pide a su servidor hasta que el usuario la pide',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [listing(), article({ image: 'https://servidor-ajeno.test/a.png' })] } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 1`)
      await page.click('.nav-tab[data-tab="articulos"]')
      await page.waitFor(`document.querySelectorAll('#channel-articulos .article-card').length === 1`)
      t.assert.equal(await page.count('#channel-articulos img'), 0, 'ninguna imagen ajena se carga al pintar el canal')
      await page.click('#channel-articulos .article-img-load')
      t.assert.equal(await page.evaluate(`document.querySelector('#channel-articulos img.article-img')?.getAttribute('src')`), 'https://servidor-ajeno.test/a.png')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'al abrir un anuncio se piden las valoraciones de su autor, sin pasar por «Vendedores»',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [listing(), historial(SK2), rating({ sk: SK2, stars: 4 })] } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 1`)
      await page.click('#channel-mercado .listing-card')
      await page.waitFor(`document.querySelector('#listing-modal .star-count-full')`, { timeout: 9000, label: 'estrellas del vendedor en la ficha' })
      t.assert.match(await page.text('#listing-modal .star-count-full'), /^4\.0 · 1 valoración$/)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'un valorador no puede inflar ni romper la reputación con etiquetas mal formadas',
    async run(t) {
      const server = await t.server()
      const NS = 'plazap2p.reputation'
      const events = [
        listing(),
        historial(SK2),
        rating({ sk: SK2, stars: 5 }),
        // Mismo autor, más reciente, con puntuación fuera de rango y aspectos absurdos.
        signWith(SK2, { kind: 1985, created_at: now() - 5, content: 'x',
          tags: [['L', NS], ['l', 'rating:999', NS], ['l', 'comunicacion:999', NS], ['p', PK1]] }),
        // Auto-valoración del propio vendedor.
        rating({ sk: SK1, ratee: PK1, stars: 5, comment: 'me valoro yo' }),
      ]
      const page = await t.open({ scenario: { events } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 1`)
      await page.evaluate(`window.openReputacionModal(${JSON.stringify(PK1)})`)
      await page.waitFor(`document.querySelector('#listing-modal .star-count-full')`, { timeout: 9000 })
      const resumen = await page.text('#listing-modal .star-count-full')
      t.assert.match(resumen, /^5\.0 · 1 valoración$/, `resumen mostrado: ${resumen}`)
      const anchos = await page.evaluate(`[...document.querySelectorAll('#listing-modal .aspect-bar-fill')].map(el => parseFloat(el.style.width))`)
      t.assert.ok(anchos.every(w => w >= 0 && w <= 100), `barras fuera de rango: ${anchos}`)
    },
  },
  {
    name: 'valoraciones de cuentas recién creadas no mueven la nota, y se dice cuántas hay',
    async run(t) {
      const server = await t.server()
      const SK3 = Uint8Array.from({ length: 32 }, (_, i) => i + 7)
      const SK4 = Uint8Array.from({ length: 32 }, (_, i) => i + 9)
      const events = [
        listing(), historial(SK2),
        rating({ sk: SK2, stars: 2, comment: 'Tardó mucho' }),      // cuenta con historial
        rating({ sk: SK3, stars: 5, comment: 'Genial' }),            // dos cuentas creadas hoy
        rating({ sk: SK4, stars: 5, comment: 'Perfecto' }),
      ]
      const page = await t.open({ scenario: { events } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 1`)
      await page.evaluate(`window.openReputacionModal(${JSON.stringify(PK1)})`)
      await page.waitFor(`document.querySelector('#listing-modal .star-count-full')`, { timeout: 9000 })
      t.assert.match(await page.text('#listing-modal .star-count-full'), /^2.0 · 1 valoración$/)
      t.assert.match(await page.text('#rep-excluded-note'), /^2 valoraciones de cuentas con menos de 30 días .* no se cuentan\. Es un filtro orientativo/)
      const comentarios = await page.evaluate(`[...document.querySelectorAll('#listing-modal .modal-notice')].map(e => e.innerText)`)
      t.assert.ok(comentarios.some(c => c.includes('Tardó mucho')) && !comentarios.some(c => c.includes('Genial')), 'solo se muestran los comentarios que cuentan')
      t.assert.ok(PK2)
    },
  },
]
