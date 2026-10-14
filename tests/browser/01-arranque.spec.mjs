// Arranque y navegación: las dos páginas cargan sin errores y cada pestaña
// enseña exactamente su panel.

import { listing, note, article, calendar, order, PK1 } from './fixtures.mjs'

const mundo = () => [
  listing({ d: 'a1', title: 'Bicicleta de montaña' }),
  listing({ d: 'a2', title: 'Clases de guitarra', t: ['plazap2p', 'plazap2p-servicio'], location: 'Sevilla' }),
  note(), article(), calendar(), order(),
]

export const tests = [
  {
    name: 'las tipografías se cargan desde la propia web, sin pedir nada a Google',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: mundo() } })
      for (const html of ['/index.html', '/publicar.html']) {
        await page.goto(server.origin + html)
        await page.evaluate(`Promise.all([document.fonts.load('700 16px Orbitron'), document.fonts.load('400 16px Inter'), document.fonts.load('16px "Share Tech Mono"')])`)
        const cargadas = await page.evaluate(`[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, ''))`)
        for (const familia of ['Orbitron', 'Inter', 'Share Tech Mono']) t.assert.ok(cargadas.includes(familia), `${html}: ${familia} no cargó (${cargadas})`)
        t.assert.equal(server.hits.some(h => h.startsWith('/fonts/')), true, 'los archivos salen de /fonts/')
      }
    },
  },
  {
    name: 'index.html arranca sin errores y pinta lo que entregan los relays',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: mundo() } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 2`)
      t.assert.deepEqual(t.appErrors(page), [])
      t.assert.equal(await page.text('#tab-count-mercado'), '2')
      await t.shot(page, 'index-escritorio')
    },
  },
  {
    name: 'cada pestaña activa su panel y solo el suyo, sin errores',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: mundo() } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 2`)
      const tabs = await page.evaluate(`[...document.querySelectorAll('.nav-tab')].map(b => b.dataset.tab)`)
      t.assert.equal(tabs.length, 17)
      for (const tab of tabs) {
        await page.click(`.nav-tab[data-tab="${tab}"]`)
        const active = await page.evaluate(`[...document.querySelectorAll('.section-panel.active')].map(p => p.id)`)
        t.assert.deepEqual(active, [`tab-${tab}`], `pestaña ${tab}`)
        const vacio = await page.evaluate(`document.getElementById('tab-${tab}').innerText.trim().length`)
        t.assert.ok(vacio > 0, `el panel ${tab} no puede quedar en blanco`)
      }
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'sin ningún relay disponible se avisa en vez de quedarse cargando',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { relays: { '*': { mode: 'down' } } } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelector('#channel-mercado .empty-title')?.textContent.includes('Sin conexión')`, { timeout: 9000 })
      t.assert.equal(await page.count('#channel-mercado .skeleton'), 0)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'relays que contestan vacío: estado "sin contenido" y sin esqueletos colgados',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [] } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelector('#channel-mercado .empty-title')?.textContent.includes('Sin contenido')`)
      t.assert.equal(await page.count('#channel-mercado .skeleton'), 0)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'publicar.html arranca sin errores',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: {} })
      await page.goto(server.origin + '/publicar.html')
      await page.sleep(600)
      t.assert.deepEqual(t.appErrors(page), [])
      await t.shot(page, 'publicar-escritorio')
    },
  },
  {
    name: 'móvil (375 px): barra inferior operativa y sin desbordamiento horizontal',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: mundo() }, viewport: { width: 375, height: 800, mobile: true } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 2`)
      const visible = await page.evaluate(`getComputedStyle(document.getElementById('mobile-bottom-nav')).display !== 'none'`)
      t.assert.ok(visible, 'la barra inferior debe verse en móvil')
      for (const dest of ['explorar', 'perfil', 'plaza']) {
        await page.click(`.mbn-btn[data-dest="${dest}"]`)
        t.assert.equal(await page.count('.section-panel.active'), 1, `destino ${dest}`)
        t.assert.equal(await page.evaluate(`document.querySelector('.mbn-btn.active')?.dataset.dest`), dest)
        const over = await page.evaluate(`document.documentElement.scrollWidth - window.innerWidth`)
        t.assert.ok(over <= 1, `desbordamiento horizontal de ${over}px en ${dest}`)
      }
      await t.shot(page, 'index-movil')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'móvil (375 y 600 px): una sola barra de navegación, cabecera dentro y "Volver arriba" sin tapar la barra',
    async run(t) {
      const server = await t.server()
      for (const width of [375, 600]) {
        const page = await t.open({ scenario: { events: mundo() }, viewport: { width, height: 800, mobile: true } })
        await page.goto(server.origin + '/index.html')
        await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 2`)
        const topNav = await page.evaluate(`getComputedStyle(document.querySelector('.main-nav')).display`)
        t.assert.equal(topNav, 'none', `${width}px: la barra de arriba no se apila con la de abajo`)
        const header = await page.evaluate(`(() => {
          const r = document.querySelector('.header-inner').getBoundingClientRect()
          return Math.round(r.right - window.innerWidth)
        })()`)
        t.assert.ok(header <= 1, `${width}px: la cabecera se sale ${header}px`)
        // Se fuerza a la vista: aparece al desplazarse más de 300 px.
        await page.evaluate(`document.getElementById('btn-scroll-top').classList.add('visible')`)
        const overlap = await page.evaluate(`(() => {
          const a = document.getElementById('btn-scroll-top').getBoundingClientRect()
          const bars = [...document.querySelectorAll('#mobile-bottom-nav, #mbn-chips:not([hidden])')]
          return bars.some(b => { const r = b.getBoundingClientRect(); return a.bottom > r.top && a.top < r.bottom })
        })()`)
        t.assert.equal(overlap, false, `${width}px: "Volver arriba" tapa la barra inferior`)
        await page.close()
      }
    },
  },
  {
    name: 'enlaces ?tab= y rutas hash abren la sección pedida; Atrás vuelve a la anterior',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: mundo() } })
      await page.goto(server.origin + '/index.html?tab=eventos')
      await page.waitFor(`document.querySelector('.section-panel.active')?.id === 'tab-eventos'`)
      await page.waitFor(`document.querySelectorAll('#channel-eventos .event-card').length === 1`)

      await page.goto(server.origin + '/index.html#/explorar/articulos')
      await page.waitFor(`document.querySelector('.section-panel.active')?.id === 'tab-articulos'`)

      await page.click('.nav-tab[data-tab="feed"]')
      await page.click('.nav-tab[data-tab="mercado"]')
      await page.evaluate(`history.back()`)
      await page.waitFor(`document.querySelector('.section-panel.active')?.id === 'tab-feed'`)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'la sección App Android es alcanzable por ?tab= igual que por el menú móvil',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: {} })
      await page.goto(server.origin + '/index.html?tab=app-android')
      await page.sleep(500)
      const panel = await page.evaluate(`document.querySelector('.section-panel.active')?.id`)
      const dest = await page.evaluate(`document.querySelector('.mbn-btn.active')?.dataset.dest`)
      // El shell y el contenido tienen que estar de acuerdo sobre dónde se está.
      t.assert.equal(panel === 'tab-app-android', dest === 'perfil', `panel=${panel} destino=${dest}`)
    },
  },
  {
    name: 'con la configuración tardando en llegar, las pestañas ya responden',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: mundo(), fetch: [{ match: 'data/config\\.json', delayMs: 1500, json: JSON.parse((await import('node:fs')).readFileSync(new URL('../../data/config.json', import.meta.url), 'utf8')) }] } })
      await page.goto(server.origin + '/index.html')
      await page.click('.nav-tab[data-tab="bitcoin"]')
      t.assert.equal(await page.evaluate(`document.querySelector('.section-panel.active')?.id`), 'tab-bitcoin', 'antes de cargar la configuración')
      await page.click('.nav-tab[data-tab="feed"]')
      await page.waitFor(`document.querySelectorAll('#channel-feed .feed-card').length === 1`, { label: 'el feed se pinta al llegar la configuración' })
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'una pestaña que aún está cargando enseña esqueletos, no "sin resultados"',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: mundo(), relays: { '*': { delayMs: 1200 } } } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.getElementById('relay-status-list').children.length > 0`)
      for (const tab of ['feed', 'articulos', 'directorio', 'mercado']) {
        await page.click(`.nav-tab[data-tab="${tab}"]`)
        t.assert.ok(await page.count(`#channel-${tab} .skeleton`) > 0, `${tab} debe mostrar que está cargando`)
        t.assert.equal(await page.count(`#channel-${tab} .empty-state`), 0, `${tab} no puede decir que está vacío todavía`)
      }
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 2`)
      await page.click('.nav-tab[data-tab="feed"]')
      t.assert.equal(await page.count('#channel-feed .skeleton'), 0)
      t.assert.equal(await page.count('#channel-feed .feed-card'), 1)
    },
  },
  {
    name: 'un canal de verdad vacío dice "sin contenido", también si se entra después de cargar',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [listing()] } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 1`)
      await page.sleep(300)
      await page.click('.nav-tab[data-tab="articulos"]')
      t.assert.match(await page.text('#channel-articulos .empty-title'), /Sin contenido/)
      // Con un filtro que no casa con nada sí es "sin resultados".
      await page.click('.nav-tab[data-tab="mercado"]')
      await page.fill("#tab-mercado .tab-search", "zzzz-no-existe")
      t.assert.match(await page.text('#channel-mercado .empty-title'), /Sin resultados/)
    },
  },
  {
    name: 'eventos curados: un meetup recurrente no aparece como "Pasado" con una fecha vieja',
    async run(t) {
      const server = await t.server()
      const eventos = [
        { id: 'r', title: 'Meetup mensual', location: 'Valencia', start: '2020-01-10T19:00:00', links: ['https://ejemplo.test/m'], recurrente: true, aprobado: true },
        { id: 'p', title: 'Encuentro de verano', location: 'Canarias', start: '2020-08-14T18:30:00', recurrente: false, aprobado: true },
        { id: 'f', title: 'Congreso futuro', location: 'Madrid', start: '2099-11-18T09:00:00', recurrente: true, aprobado: true },
        { id: 'x', title: 'Sin aprobar', start: '2099-01-01T00:00:00', aprobado: false },
      ]
      const page = await t.open({ scenario: { events: [], fetch: [{ match: 'data/eventos\\.json', json: eventos }] } })
      await page.goto(server.origin + '/index.html?tab=eventos')
      await page.waitFor(`document.querySelectorAll('#channel-eventos .event-card').length === 3`)
      const tarjetas = await page.evaluate(`[...document.querySelectorAll('#channel-eventos .event-card')].map(c => ({
        titulo: c.querySelector('.event-title').textContent, pasado: c.classList.contains('event-past'), texto: c.innerText.replace(/\\s+/g, ' ') }))`)
      const de = titulo => tarjetas.find(x => x.titulo === titulo)
      t.assert.equal(de('Meetup mensual').pasado, false, 'un evento recurrente sigue vigente')
      t.assert.doesNotMatch(de('Meetup mensual').texto, /2020/, 'no se enseña la fecha vieja como si fuera la próxima')
      t.assert.match(de('Meetup mensual').texto, /Se repite/)
      t.assert.equal(de('Encuentro de verano').pasado, true, 'un evento puntual ya celebrado sí es pasado')
      t.assert.match(de('Congreso futuro').texto, /2099/)
      t.assert.deepEqual(tarjetas.map(x => x.titulo), ['Congreso futuro', 'Meetup mensual', 'Encuentro de verano'], 'orden: con fecha próxima, recurrentes, anteriores')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'un anuncio se abre, muestra sus datos y se cierra con Escape',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: mundo() } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 2`)
      await page.click('#channel-mercado .listing-card')
      await page.waitFor(`!document.getElementById('listing-modal').classList.contains('hidden')`)
      t.assert.match(await page.evaluate(`location.hash`), /^#\/anuncio\/naddr1/)
      await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await page.waitFor(`document.getElementById('listing-modal').classList.contains('hidden')`)
      t.assert.deepEqual(t.appErrors(page), [])
      t.assert.ok(PK1)
    },
  },
]
