// Relays que mienten, se caen o contestan a medias. El filtro REQ es una
// petición, no una garantía: la app tiene que sostenerse sola.

import { listing, calendar, order, signWith, SK1, SK2, RELAYS, now } from './fixtures.mjs'

const cards = `document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length`
const titulos = `[...document.querySelectorAll('#channel-mercado .card-title')].map(e => e.textContent)`

export const tests = [
  {
    name: 'eventos con firma falsa, del futuro o de otro tipo se descartan',
    async run(t) {
      const server = await t.server()
      const bueno = listing({ d: 'bueno', title: 'Anuncio legítimo' })
      const adulterado = { ...listing({ d: 'malo', title: 'Original' }) }
      adulterado.tags = adulterado.tags.map(x => x[0] === 'title' ? ['title', 'Título cambiado por el relay'] : x)
      const futuro = listing({ d: 'futuro', title: 'Del futuro', created_at: now() + 3600 })
      const otroKind = signWith(SK1, { kind: 4, tags: [['t', 'plazap2p']], content: 'cifrado' })
      const sinTag = listing({ d: 'ajeno', title: 'Sin etiqueta de la comunidad', t: ['otra-cosa'] })
      const page = await t.open({ scenario: {
        events: [bueno],
        relays: { '*': { rawEvents: [adulterado, futuro, otroKind, sinTag, null, 'texto', { id: 1 }, []] } },
      } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 1`)
      await page.sleep(300)
      t.assert.deepEqual(await page.evaluate(titulos), ['Anuncio legítimo'])
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'tramas basura del relay no rompen la página',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: {
        events: [listing()],
        relays: { '*': { rawFrames: [
          'no es json', '{}', '[]', 'null', '42', '["EVENT"]', '["EVENT","$SUB"]', '["EVENT","$SUB",null]',
          '["EOSE"]', '["OK"]', '["NOTICE"]', '["CLOSED","$SUB","rate-limited"]', '["AUTH","reto"]',
          '["EVENT","$SUB",{"id":"x","pubkey":"y","sig":"z","kind":"30402","created_at":"hoy","tags":"no","content":5}]',
          '["EVENT","$SUB",{"__proto__":{"polluted":true}}]',
        ] } },
      } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 1`)
      t.assert.equal(await page.evaluate(`({}).polluted`), undefined)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'un anuncio retirado no reaparece si un relay atrasado entrega después la versión antigua',
    async run(t) {
      const server = await t.server()
      const viejo = listing({ d: 'bici', title: 'Bicicleta (activa)', created_at: now() - 5000 })
      const retirado = listing({ d: 'bici', title: 'Bicicleta (retirada)', status: 'inactive', created_at: now() - 100 })
      const otro = listing({ d: 'otro', title: 'Otro anuncio' })
      const [rapido, lento] = RELAYS
      const page = await t.open({ scenario: {
        events: [viejo, retirado, otro],
        relays: {
          [rapido]: { without: [viejo.id] },                       // al día: solo conoce la retirada
          [lento]: { without: [retirado.id], delayMs: 400 },        // atrasado: aún sirve la versión activa
          '*': { without: [viejo.id] },
        },
      } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} >= 1`)
      await page.sleep(900)
      t.assert.deepEqual(await page.evaluate(titulos), ['Otro anuncio'])
    },
  },
  {
    name: 'vendido, borrado y caducado no se listan; republicado más reciente sí',
    async run(t) {
      const server = await t.server()
      const events = [
        listing({ d: 'v', title: 'Vendido', status: 'sold' }),
        listing({ d: 'b', title: 'Borrado', status: 'deleted' }),
        listing({ d: 'c', title: 'Caducado', extraTags: [['expiration', String(now() - 10)]] }),
        listing({ d: 'r', title: 'Retirado y republicado (viejo)', status: 'inactive', created_at: now() - 500 }),
        listing({ d: 'r', title: 'Republicado', created_at: now() - 50 }),
        listing({ d: 'f', title: 'Caduca en el futuro', extraTags: [['expiration', String(now() + 3600)]] }),
        listing({ d: 'x', title: 'Caducidad mal formada', extraTags: [['expiration', 'mañana']] }),
      ]
      const page = await t.open({ scenario: { events } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 3`)
      t.assert.deepEqual((await page.evaluate(titulos)).sort(), ['Caduca en el futuro', 'Caducidad mal formada', 'Republicado'])
    },
  },
  {
    name: 'un anuncio no puede fijarse arriba declarando una fecha de publicación futura',
    async run(t) {
      const server = await t.server()
      const events = [
        listing({ d: 'tramposo', title: 'Tramposo', created_at: now() - 86400 * 20, extraTags: [['published_at', String(now() + 86400 * 365 * 5)]] }),
        listing({ d: 'reciente', title: 'Reciente', created_at: now() - 60 }),
        listing({ d: 'medio', title: 'De ayer', created_at: now() - 86400 }),
      ]
      const page = await t.open({ scenario: { events } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 3`)
      const orden = await page.evaluate(titulos)
      t.assert.equal(orden[0], 'Reciente', `orden mostrado: ${orden.join(' | ')}`)
      const nuevos = await page.evaluate(`[...document.querySelectorAll('#channel-mercado .listing-card')]
        .filter(c => c.querySelector('.card-new-badge')).map(c => c.querySelector('.card-title').textContent)`)
      t.assert.deepEqual(nuevos, ['Reciente'], 'solo lo publicado en la última hora lleva la marca "nuevo"')
    },
  },
  {
    name: 'un relay que nunca manda EOSE no deja la pestaña cargando para siempre',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [listing()], relays: { '*': { noEose: true } } } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 1`)
      await page.click('.nav-tab[data-tab="feed"]')
      await page.waitFor(`document.querySelector('#channel-feed .empty-title')`, { timeout: 9000, label: 'estado vacío del feed' })
      t.assert.equal(await page.count('#channel-feed .skeleton'), 0)
    },
  },
  {
    name: 'relays que rechazan la consulta (CLOSED) no retrasan la carga más allá del margen',
    async run(t) {
      const server = await t.server()
      const [uno, dos] = RELAYS
      const page = await t.open({ scenario: {
        events: [listing()],
        relays: { [uno]: { closed: 'auth-required: hay que identificarse' }, [dos]: { closed: 'rate-limited: despacio' }, '*': {} },
      } })
      const t0 = Date.now()
      await page.goto(server.origin + '/index.html')
      await page.click('.nav-tab[data-tab="feed"]')
      await page.waitFor(`document.querySelector('#channel-feed .empty-title')`, { timeout: 9000, label: 'estado vacío del feed' })
      const ms = Date.now() - t0
      t.assert.ok(ms < 3000, `el feed vacío tardó ${ms} ms en resolverse con 2 de ${RELAYS.length} relays rechazando`)
    },
  },
  {
    name: 'la reputación no espera el margen completo cuando un relay rechaza la consulta',
    async run(t) {
      const server = await t.server()
      const [uno] = RELAYS
      const page = await t.open({ scenario: {
        events: [listing()],
        relays: { [uno]: { closed: 'auth-required: hay que identificarse' }, '*': {} },
      } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 1`)
      const t0 = Date.now()
      await page.evaluate(`window.openReputacionModal(${JSON.stringify((await import('./fixtures.mjs')).PK1)})`)
      await page.waitFor(`document.querySelector('#listing-modal .no-rating-text')?.textContent.includes('Sin valoraciones')`, { timeout: 9000 })
      const ms = Date.now() - t0
      t.assert.ok(ms < 3000, `la reputación tardó ${ms} ms con 1 de ${RELAYS.length} relays rechazando`)
    },
  },
  {
    name: 'todos los relays se caen a mitad de sesión y vuelven: la página sigue viva',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [listing()] } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 1`)
      await page.evaluate(`window.__relay.dropAll()`)
      await page.waitFor(`document.getElementById('relay-label').textContent.includes('conectando')`)
      t.assert.equal(await page.evaluate(cards), 1, 'lo ya cargado sigue en pantalla')
      await page.waitFor(`/[1-9]\\/${RELAYS.length} relays/.test(document.getElementById('relay-label').textContent)`, { timeout: 9000, label: 'reconexión' })
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'órdenes Mostro: rango de importe y varios medios de pago van en una sola etiqueta (NIP-69)',
    async run(t) {
      const server = await t.server()
      const events = [
        order({ d: 'rango', k: 'sell', fa: ['100', '500'], pm: ['Bizum', 'SEPA', 'Revolut'] }),
        order({ d: 'mayus', k: 'BUY', fa: ['50'], pm: ['Efectivo'] }),
        order({ d: 'cerrada', k: 'sell', s: 'success' }),
      ]
      const page = await t.open({ scenario: { events } })
      await page.goto(server.origin + '/index.html?tab=intercambio')
      await page.waitFor(`document.querySelectorAll('#channel-intercambio .order-card').length >= 1`)
      await page.sleep(200)
      const textos = await page.evaluate(`[...document.querySelectorAll('#channel-intercambio .order-card')].map(c => c.innerText.replace(/\\s+/g, ' '))`)
      t.assert.equal(textos.length, 2, `órdenes pintadas: ${JSON.stringify(textos)}`)
      const rango = textos.find(x => x.includes('VENDE'))
      t.assert.match(rango, /100.{1,3}500 EUR/, `el rango debe verse completo: ${rango}`)
      t.assert.match(rango, /Bizum · SEPA · Revolut/, `los tres medios de pago: ${rango}`)
      t.assert.ok(textos.some(x => x.includes('COMPRA')), 'una orden con el tipo en mayúsculas también se lista')
    },
  },
  {
    name: 'eventos de calendario con fechas imposibles no rompen la pestaña',
    async run(t) {
      const server = await t.server()
      const events = [
        calendar({ d: 'ok', title: 'Válido' }),
        calendar({ d: 'e1', title: 'Sin inicio', start: '' }),
        calendar({ d: 'e2', title: 'Inicio texto', start: 'pronto' }),
        calendar({ d: 'e3', title: 'Inicio enorme', start: '99999999999999999999' }),
        calendar({ d: 'e4', title: 'Negativo', start: '-5' }),
        calendar({ d: 'e5', kind: 31922, title: 'Día inválido', start: '2026-13-45' }),
        calendar({ d: 'e6', kind: 31922, title: 'Día válido', start: '2099-05-01', end: '2099-05-03' }),
        calendar({ d: 'e7', title: 'Fin antes que inicio', start: String(now() + 5000), end: String(now() + 10) }),
      ]
      const page = await t.open({ scenario: { events } })
      await page.goto(server.origin + '/index.html?tab=eventos')
      await page.waitFor(`document.querySelectorAll('#channel-eventos .event-card').length >= 2`)
      await page.sleep(200)
      const html = await page.evaluate(`document.getElementById('channel-eventos').innerText`)
      t.assert.doesNotMatch(html, /Invalid Date|NaN|undefined/, 'ninguna fecha rota a la vista')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'una avalancha de eventos nuevos no inunda la pantalla de avisos',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [listing()] } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`${cards} === 1`)
      await page.sleep(6300)   // fin de la "carga inicial": a partir de aquí cada evento nuevo avisa
      const muchos = Array.from({ length: 40 }, (_, i) => listing({ sk: SK2, d: `spam-${i}`, title: `Spam ${i}` }))
      await page.evaluate(`(${JSON.stringify(muchos)}).forEach(ev => window.__relay.add(ev))`)
      await page.sleep(300)
      const avisos = await page.count('#toast-container .toast')
      t.assert.ok(avisos <= 3, `${avisos} avisos simultáneos en pantalla`)
    },
  },
]
