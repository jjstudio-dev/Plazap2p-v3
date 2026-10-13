// Publicar, ida y vuelta: lo que el asistente firma y manda a los relays tiene
// que (1) ser un evento válido del NIP que dice ser y (2) aparecer, al leerlo
// index.html, en la pestaña y categoría que el usuario eligió.

import { verifyEvent } from '../../js/vendor/nostr-crypto.js'
import { SK1, PK1, skHex, listing, calendar, now } from './fixtures.mjs'

const identidad = { localStorage: { plazap2p_pubkey: PK1 }, nip07: { sk: skHex(SK1) } }
const DESC = 'Descripción suficientemente larga para pasar la validación del formulario.'

/** Qué rellenar por tipo, y dónde tiene que acabar viéndose. */
const TIPOS = {
  servicio: {
    campos: { 's-title': 'Clases de guitarra', 's-desc': DESC, 's-price': '25', 's-currency': 'EUR', 's-contact': '@profe' },
    pills: { 'pills-s-cat': 'educacion' },
    kind: 30402, tTag: 'plazap2p-servicio', categoria: 'servicio', tabs: ['mercado', 'directorio'],
  },
  evento: {
    campos: { 'e-title': 'Meetup Bitcoin Valencia', 'e-desc': DESC, 'e-date': '2099-05-01T18:30', 'e-date-end': '2099-05-01T21:00', 'e-location': 'Valencia' },
    kind: 31923, tTag: 'plazap2p-evento', tabs: ['eventos'],
  },
  comunidad: {
    campos: { 'c-title': 'Bitcoin Sevilla', 'c-desc': DESC, 'c-access': 'https://t.me/bitcoinsevilla' },
    pills: { 'pills-c-plat': 'telegram' },
    kind: 30402, tTag: 'plazap2p-comunidad', categoria: 'comunidad', tabs: ['mercado'],
  },
  herramienta: {
    campos: { 'h-title': 'Mi wallet', 'h-desc': DESC, 'h-url': 'https://ejemplo.test/wallet' },
    pills: { 'pills-h-cat': 'wallet' }, checks: ['input[name="h-platform"][value="android"]'],
    kind: 30402, tTag: 'plazap2p-herramienta', categoria: 'herramienta', tabs: ['mercado'],
  },
  venta: {
    campos: { 'tx-title': 'Vendo bicicleta', 'tx-desc': DESC, 'tx-price': '120.50', 'tx-currency': 'EUR', 'tx-contact': '@vendedor' },
    pills: { 'pills-tx-alcance': 'local' },
    kind: 30402, tTag: 'plazap2p-venta', categoria: 'venta', tabs: ['mercado'],
  },
  compra: {
    campos: { 'tx-title': 'Busco portátil', 'tx-desc': DESC, 'tx-price': '300', 'tx-currency': 'USD' },
    pills: { 'pills-tx-alcance': 'nacional' },
    kind: 30402, tTag: 'plazap2p-compra', categoria: 'compra', tabs: ['mercado'],
  },
  intercambio: {
    campos: { 'tx-title': 'Cambio libros por sats', 'tx-desc': DESC },
    pills: { 'pills-tx-alcance': 'online' }, checks: ['#tx-negociar'],
    kind: 30402, tTag: 'plazap2p-intercambio', categoria: 'trueque', tabs: ['mercado'],
  },
}

async function rellenar(page, def) {
  for (const [id, valor] of Object.entries(def.campos || {})) await page.fill(`#${id}`, valor)
  for (const [grupo, valor] of Object.entries(def.pills || {})) await page.click(`#${grupo} .pill[data-value="${valor}"]`)
  for (const sel of def.checks || []) await page.fill(sel, true)
}

/** Pulsa Publicar → Confirmar y firmar, y espera el resultado. */
async function publicar(page) {
  await page.click('#btn-publicar')
  await page.waitFor(`document.querySelector('#res-box .res-title')?.textContent.includes('Revisa antes de firmar')`, { label: 'pantalla de revisión' })
  await page.click('#res-box .res-actions .btn-primary')
  await page.waitFor(`document.querySelector('#res-box .res-card.ok, #res-box .res-card.err')`, { timeout: 12000, label: 'resultado de la publicación' })
  return page.evaluate(`({ ok: !!document.querySelector('#res-box .res-card.ok'), titulo: document.querySelector('#res-box .res-title').textContent, sub: document.querySelector('#res-box .res-sub').textContent })`)
}

const publicados = page => page.evaluate(`[...new Map(window.__published.map(p => [p.event.id, p.event])).values()]`)
const tag = (ev, name) => ev.tags.find(x => x[0] === name)
const tTags = ev => ev.tags.filter(x => x[0] === 't').map(x => x[1])

export const tests = [
  {
    name: 'los 7 tipos del asistente: evento válido y visible donde corresponde',
    async run(t) {
      const server = await t.server()
      const eventos = {}
      for (const [tipo, def] of Object.entries(TIPOS)) {
        const page = await t.open({ scenario: identidad })
        await page.goto(`${server.origin}/publicar.html?type=${tipo}`)
        await page.waitFor(`!document.getElementById('publish-bar').classList.contains('hidden')`, { label: `formulario de ${tipo}` })
        await rellenar(page, def)
        const res = await publicar(page)
        t.assert.ok(res.ok, `${tipo}: ${res.titulo} — ${res.sub}`)
        const evs = await publicados(page)
        t.assert.equal(evs.length, 1, `${tipo}: un solo evento enviado`)
        const ev = evs[0]
        eventos[tipo] = ev

        // ── El evento en sí ──
        t.assert.equal(verifyEvent(ev), true, `${tipo}: firma válida`)
        t.assert.equal(ev.pubkey, PK1)
        t.assert.equal(ev.kind, def.kind, `${tipo}: kind`)
        t.assert.ok(tag(ev, 'd')?.[1], `${tipo}: tag d`)
        t.assert.ok(tag(ev, 'title')?.[1], `${tipo}: tag title`)
        t.assert.ok(tTags(ev).includes('plazap2p') && tTags(ev).includes(def.tTag), `${tipo}: tags t ${tTags(ev)}`)
        t.assert.ok(ev.tags.every(x => x.every(v => typeof v === 'string' && v !== '')), `${tipo}: ningún valor vacío en los tags`)
        t.assert.match(tag(ev, 'published_at')[1], /^\d{10}$/, `${tipo}: published_at`)
        t.assert.deepEqual(t.appErrors(page), [], tipo)
        await page.close()
      }

      // NIP-99: precio como [importe, moneda ISO], importe con punto decimal
      t.assert.deepEqual(tag(eventos.venta, 'price'), ['price', '120.50', 'EUR'])
      t.assert.deepEqual(tag(eventos.servicio, 'price'), ['price', '25', 'EUR'])
      t.assert.equal(tag(eventos.intercambio, 'price'), undefined, '"A negociar" no publica precio')
      // NIP-52: evento con hora → 31923, start/end Unix y zona horaria
      t.assert.match(tag(eventos.evento, 'start')[1], /^\d{10}$/)
      t.assert.ok(Number(tag(eventos.evento, 'end')[1]) > Number(tag(eventos.evento, 'start')[1]))
      t.assert.ok(tag(eventos.evento, 'start_tzid')?.[1], 'zona horaria del evento')
      // NIP-40: los anuncios de mercado caducan; el directorio curado no
      for (const tipo of ['venta', 'compra', 'intercambio', 'servicio']) t.assert.ok(tag(eventos[tipo], 'expiration'), `${tipo} caduca`)
      for (const tipo of ['comunidad', 'herramienta', 'evento']) t.assert.equal(tag(eventos[tipo], 'expiration'), undefined, `${tipo} no caduca`)

      // ── Lectura: cada uno aparece donde el usuario espera ──
      const lector = await t.open({ scenario: { events: Object.values(eventos) } })
      await lector.goto(server.origin + '/index.html')
      await lector.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 6`, { label: '6 publicaciones en Mercado' })
      for (const [tipo, def] of Object.entries(TIPOS)) {
        const titulo = tag(eventos[tipo], 'title')[1]
        for (const tab of def.tabs) {
          await lector.click(`.nav-tab[data-tab="${tab}"]`)
          const visto = await lector.evaluate(`document.getElementById('channel-${tab}').innerText.includes(${JSON.stringify(titulo)})`)
          t.assert.ok(visto, `"${titulo}" (${tipo}) debe verse en ${tab}`)
        }
        if (def.categoria && ['venta', 'compra', 'servicio', 'trueque'].includes(def.categoria)) {
          await lector.click('.nav-tab[data-tab="mercado"]')
          await lector.click(`.filter-btn[data-filter="${def.categoria}"]`)
          const filtrados = await lector.evaluate(`[...document.querySelectorAll('#channel-mercado .card-title')].map(e => e.textContent)`)
          t.assert.deepEqual(filtrados, [titulo], `filtro ${def.categoria}`)
          await lector.click('.filter-btn[data-filter="all"]')
        }
      }
      // Comunidad y herramienta no son ofertas: sin "medio de pago"
      const sinPago = await lector.evaluate(`[...document.querySelectorAll('#channel-mercado .listing-card')]
        .filter(c => /COMUNIDAD|HERRAMIENTA/.test(c.querySelector('.card-badge').textContent))
        .map(c => !!c.querySelector('.card-payment'))`)
      t.assert.deepEqual(sinPago, [false, false])
      t.assert.deepEqual(t.appErrors(lector), [])
    },
  },
  {
    name: 'evento de día completo → kind 31922 con fechas AAAA-MM-DD',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: identidad })
      await page.goto(`${server.origin}/publicar.html?type=evento`)
      await page.waitFor(`!document.getElementById('publish-bar').classList.contains('hidden')`)
      await rellenar(page, { campos: { 'e-title': 'Feria de dos días', 'e-desc': DESC, 'e-date': '2099-05-01T00:00', 'e-date-end': '2099-05-03T00:00' }, checks: ['#e-allday'] })
      t.assert.ok((await publicar(page)).ok)
      const [ev] = await publicados(page)
      t.assert.equal(ev.kind, 31922)
      t.assert.deepEqual([tag(ev, 'start')[1], tag(ev, 'end')[1]], ['2099-05-01', '2099-05-03'])
      t.assert.equal(tag(ev, 'start_tzid'), undefined)
    },
  },
  {
    name: 'validación: no se firma nada con campos inválidos, y los errores se ven',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: identidad })
      await page.goto(`${server.origin}/publicar.html?type=venta`)
      await page.waitFor(`!document.getElementById('publish-bar').classList.contains('hidden')`)
      await rellenar(page, { campos: { 'tx-title': 'ab', 'tx-desc': 'corta', 'tx-image': 'http://sin-tls.test/a.png', 'tx-contact': 'https://t.me/estafa' } })
      // Tecleado de verdad: en un campo numérico el navegador no entrega este texto en .value
      await page.type('#tx-price', '12e')
      t.assert.equal(await page.evaluate(`document.getElementById('tx-price').value`), '', 'el navegador oculta el texto no numérico')
      await page.click('#btn-publicar')
      await page.sleep(200)
      const errores = await page.evaluate(`[...document.querySelectorAll('.f-error.show')].map(e => e.id)`)
      t.assert.deepEqual(errores.sort(), ['err-tx-contact', 'err-tx-desc', 'err-tx-image', 'err-tx-price', 'err-tx-title'])
      t.assert.deepEqual(await page.evaluate('window.__signed'), [])
      t.assert.deepEqual(await page.evaluate('window.__published'), [])
    },
  },
  {
    name: 'tras publicar con "A negociar", el formulario siguiente acepta precio',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: identidad })
      await page.goto(`${server.origin}/publicar.html?type=intercambio`)
      await page.waitFor(`!document.getElementById('publish-bar').classList.contains('hidden')`)
      await rellenar(page, TIPOS.intercambio)
      t.assert.ok((await publicar(page)).ok)
      await page.click('#res-box .res-actions button.btn-secondary:last-child')   // ← Volver
      await page.click('.type-card[data-type="venta"]')
      t.assert.equal(await page.evaluate(`document.getElementById('tx-price').disabled`), false)
      await rellenar(page, TIPOS.venta)
      t.assert.ok((await publicar(page)).ok)
      const evs = await publicados(page)
      t.assert.deepEqual(tag(evs[1], 'price'), ['price', '120.50', 'EUR'])
      t.assert.notEqual(tag(evs[0], 'd')[1], tag(evs[1], 'd')[1], 'cada publicación nueva lleva su propio identificador')
    },
  },
  {
    name: 'el firmador rechaza, altera el evento o los relays lo rechazan: nunca se da por publicado',
    async run(t) {
      const server = await t.server()
      for (const [caso, scenario, esperado] of [
        ['rechazo del usuario', { ...identidad, nip07: { sk: skHex(SK1), behavior: 'reject' } }, /Firma cancelada/],
        ['evento alterado por el firmador', { ...identidad, nip07: { sk: skHex(SK1), behavior: 'tamper' } }, /rechazado/],
        ['relays que rechazan', { ...identidad, relays: { '*': { rejectPublish: 'blocked: no admitido' } } }, /Ningún relay aceptó/],
        ['sin relays', { ...identidad, relays: { '*': { mode: 'down' } } }, /Sin conexión con los relays/],
      ]) {
        const page = await t.open({ scenario })
        await page.goto(`${server.origin}/publicar.html?type=venta`)
        await page.waitFor(`!document.getElementById('publish-bar').classList.contains('hidden')`)
        await rellenar(page, TIPOS.venta)
        const res = await publicar(page)
        t.assert.equal(res.ok, false, caso)
        t.assert.match(res.titulo, esperado, caso)
        if (caso !== 'relays que rechazan') t.assert.deepEqual(await page.evaluate('window.__published'), [], caso)
        // El formulario conserva lo escrito para reintentar.
        t.assert.equal(await page.evaluate(`document.getElementById('tx-title').value`), 'Vendo bicicleta', caso)
        await page.close()
      }
    },
  },
  {
    name: 'almacenamiento lleno o bloqueado: se puede publicar igualmente con extensión',
    async run(t) {
      const server = await t.server()
      for (const storage of ['quota', 'denied']) {
        const page = await t.open({ scenario: { nip07: { sk: skHex(SK1) }, storage } })
        await page.goto(`${server.origin}/publicar.html`)
        await page.waitFor(`!document.getElementById('sec-identidad').classList.contains('hidden')`)
        await page.click('#btn-connect')
        await page.waitFor(`!document.getElementById('sec-home').classList.contains('hidden')`, { label: `identidad conectada (${storage})` })
        await page.click('.type-card[data-type="venta"]')
        await rellenar(page, TIPOS.venta)
        const res = await publicar(page)
        t.assert.ok(res.ok, `${storage}: ${res.titulo} — ${res.sub}`)
        t.assert.deepEqual(t.appErrors(page), [], storage)
        await page.close()
      }
    },
  },
  {
    name: 'Mis anuncios: editar conserva identificador y fecha; duplicar crea uno nuevo; vendido y retirar lo quitan del Mercado',
    async run(t) {
      const server = await t.server()
      const original = listing({ d: 'mio-1', title: 'Vendo bicicleta', summary: DESC, location: 'local', price: ['100', 'EUR'],
        created_at: now() - 5000, extraTags: [['published_at', String(now() - 9000)], ['contact', '@vendedor'], ['image', 'https://ejemplo.test/bici.png']] })
      const page = await t.open({ scenario: { ...identidad, events: [original] } })
      await page.goto(`${server.origin}/publicar.html`)
      await page.click('#nav-actividad')
      await page.waitFor(`document.querySelectorAll('#ma-list .ma-item').length === 1`)
      const boton = texto => `[...document.querySelectorAll('#ma-list .ma-item button')].find(b => b.textContent.includes(${JSON.stringify(texto)}))`

      // Editar
      await page.evaluate(`${boton('Editar')}.click()`)
      t.assert.equal(await page.evaluate(`document.getElementById('tx-title').value`), 'Vendo bicicleta')
      t.assert.equal(await page.evaluate(`document.getElementById('tx-image').value`), 'https://ejemplo.test/bici.png')
      t.assert.equal(await page.evaluate(`document.querySelector('#pills-tx-alcance .pill.active')?.dataset.value`), 'local')
      await page.fill('#tx-title', 'Vendo bicicleta (rebajada)')
      await page.fill('#tx-price', '80')
      let res = await publicar(page)
      t.assert.ok(res.ok, res.titulo)
      t.assert.match(res.titulo, /actualizado/)
      let evs = await publicados(page)
      const editado = evs.at(-1)
      t.assert.equal(tag(editado, 'd')[1], 'mio-1', 'editar no cambia el identificador')
      t.assert.equal(tag(editado, 'published_at')[1], tag(original, 'published_at')[1], 'conserva la fecha de publicación')
      t.assert.deepEqual(tag(editado, 'price'), ['price', '80', 'EUR'])
      t.assert.ok(editado.created_at > original.created_at, 'la versión editada es posterior a la original')

      /** Botón `texto` del anuncio cuyo título contiene `titulo`. */
      const botonDe = (titulo, texto) => `[...[...document.querySelectorAll('#ma-list .ma-item')]
        .find(i => i.querySelector('.ma-title').textContent.includes(${JSON.stringify(titulo)})).querySelectorAll('button')]
        .find(b => b.textContent.includes(${JSON.stringify(texto)}))`

      // Duplicar
      await page.click('#nav-actividad')
      await page.waitFor(`document.querySelectorAll('#ma-list .ma-item').length === 1`)
      await page.evaluate(`${boton('Duplicar')}.click()`)
      await page.fill('#tx-title', 'Copia del anuncio')
      res = await publicar(page)
      t.assert.ok(res.ok, res.titulo)
      t.assert.match(res.titulo, /Publicado/, 'duplicar es una publicación nueva, no una edición')
      evs = await publicados(page)
      const copia = evs.at(-1)
      t.assert.notEqual(tag(copia, 'd')[1], 'mio-1', 'duplicar genera otro identificador')
      t.assert.deepEqual(tag(copia, 'price'), ['price', '80', 'EUR'], 'la copia hereda los datos del anuncio')

      // Marcar vendido el original (la versión editada, en el mismo segundo que la edición)
      await page.click('#nav-actividad')
      await page.waitFor(`document.querySelectorAll('#ma-list .ma-item').length === 2`)
      await page.evaluate(`${botonDe('rebajada', 'Vendido')}.click()`)
      await page.waitFor(`document.querySelector('#res-box .res-card.ok, #res-box .res-card.err')`, { timeout: 12000 })
      evs = await publicados(page)
      const vendido = evs.at(-1)
      t.assert.equal(tag(vendido, 'status')[1], 'sold')
      t.assert.equal(tag(vendido, 'd')[1], 'mio-1')
      t.assert.ok(vendido.created_at > editado.created_at, 'el "vendido" tiene que ganar a la edición aunque se haga en el mismo segundo')

      // Retirar la copia: inactive + solicitud de borrado (dos firmas)
      await page.click('#nav-actividad')
      await page.waitFor(`document.querySelectorAll('#ma-list .ma-item.inactive').length === 1`, { label: 'el vendido aparece como inactivo' })
      await page.evaluate(`${botonDe('Copia', 'Retirar')}.click()`)
      await page.waitFor(`document.querySelector('#res-box .res-title')?.textContent.includes('Paso 1 de 2')`, { timeout: 12000 })
      await page.evaluate(`[...document.querySelectorAll('#res-box button')].find(b => b.textContent.includes('Firmar paso')).click()`)
      await page.waitFor(`document.querySelector('#res-box .res-title')?.textContent.includes('borrado')`, { timeout: 12000 })
      evs = await publicados(page)
      t.assert.equal(tag(evs.at(-2), 'status')[1], 'inactive')
      t.assert.equal(evs.at(-1).kind, 5)
      t.assert.equal(tag(evs.at(-1), 'a')[1], `30402:${PK1}:${tag(copia, 'd')[1]}`)
      t.assert.ok(evs.every(e => verifyEvent(e) === true), 'todos los eventos enviados van firmados')

      // Y el Mercado, con todo lo publicado, no enseña ni el vendido ni el retirado.
      const lector = await t.open({ scenario: { events: [original, ...evs] } })
      await lector.goto(server.origin + '/index.html')
      await lector.waitFor(`document.getElementById('relay-status-list').children.length > 0`)
      await lector.sleep(700)
      t.assert.equal(await lector.count('#channel-mercado .listing-card:not(.skeleton)'), 0)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'editar un evento cambiando "todo el día" no deja el evento antiguo huérfano',
    async run(t) {
      const server = await t.server()
      const conHora = calendar({ d: 'ev-mio', title: 'Meetup con hora', summary: DESC, start: String(now() + 86400 * 30), created_at: now() - 500 })
      conHora.tags.push()   // (el evento ya va firmado; no se toca)
      const page = await t.open({ scenario: { ...identidad, events: [conHora] } })
      await page.goto(`${server.origin}/publicar.html`)
      await page.click('#nav-actividad')
      await page.waitFor(`document.querySelectorAll('#ma-list .ma-item').length === 1`)
      await page.evaluate(`[...document.querySelectorAll('#ma-list .ma-item button')].find(b => b.textContent.includes('Editar')).click()`)
      await page.fill('#e-allday', true)
      await page.click('#btn-publicar')
      await page.waitFor(`document.querySelector('#res-box .res-title')?.textContent.includes('Revisa antes de firmar')`)
      await page.click('#res-box .res-actions .btn-primary')
      // Firma los pasos que la app pida hasta terminar.
      for (let i = 0; i < 4; i++) {
        await page.waitFor(`document.querySelector('#res-box .res-card.ok, #res-box .res-card.err')`, { timeout: 12000 })
        const siguiente = await page.evaluate(`!![...document.querySelectorAll('#res-box button')].find(b => b.textContent.includes('Firmar paso'))`)
        if (!siguiente) break
        const antes = (await publicados(page)).length
        await page.evaluate(`[...document.querySelectorAll('#res-box button')].find(b => b.textContent.includes('Firmar paso')).click()`)
        await page.waitFor(`new Set(window.__published.map(p => p.event.id)).size > ${antes}`, { timeout: 12000 })
        await page.sleep(100)
      }
      const evs = await publicados(page)
      t.assert.equal(evs[0].kind, 31922, 'la nueva versión es de día completo')
      t.assert.equal(tag(evs[0], 'd')[1], 'ev-mio')

      // Quien lea la red después debe ver UN evento, no dos.
      const lector = await t.open({ scenario: { events: [conHora, ...evs] } })
      await lector.goto(server.origin + '/index.html?tab=eventos')
      await lector.waitFor(`document.querySelectorAll('#channel-eventos .event-card').length >= 1`)
      await lector.sleep(400)
      t.assert.equal(await lector.count('#channel-eventos .event-card'), 1, 'un solo evento en la pestaña Eventos')
      // Y en Mis anuncios, uno solo activo.
      await page.click('#nav-actividad')
      await page.sleep(500)
      t.assert.equal(await page.count('#ma-list .ma-item:not(.inactive)'), 1, 'un solo evento activo en Mis anuncios')
    },
  },
  {
    name: 'un enlace de retorno de Amber no cambia la identidad si no se había pedido conectar',
    async run(t) {
      const server = await t.server()
      const ajena = 'c'.repeat(64)
      const page = await t.open({ scenario: identidad })
      await page.goto(`${server.origin}/publicar.html`)
      await page.sleep(300)
      const antes = await page.evaluate(`localStorage.getItem('plazap2p_pubkey')`)
      await page.goto(`${server.origin}/publicar.html?amber=pubkey&res=${ajena}`)
      await page.waitFor(`document.getElementById('res-box').textContent.includes('no solicitada')`, { label: 'aviso de conexión no solicitada' })
      t.assert.equal(await page.evaluate(`localStorage.getItem('plazap2p_pubkey')`), antes, 'la identidad guardada no cambia')
      t.assert.equal(await page.evaluate(`location.search`), '', 'la dirección queda limpia')

      // Con la petición pendiente en esta pestaña, el mismo retorno sí conecta.
      await page.evaluate(`sessionStorage.setItem('plazap2p_pending_sign', JSON.stringify({ step: 'pubkey', ts: Date.now() }))`)
      await page.goto(`${server.origin}/publicar.html?amber=pubkey&res=${ajena}`)
      await page.waitFor(`localStorage.getItem('plazap2p_pubkey') === '${ajena}'`, { label: 'identidad conectada tras pedirlo' })
      t.assert.equal(await page.evaluate(`sessionStorage.getItem('plazap2p_pending_sign')`), null, 'el pendiente se consume')
    },
  },
  {
    name: 'publicar nada más cargar la página espera a los relays que aún están conectando',
    async run(t) {
      const server = await t.server()
      // Como al volver de Amber: un relay conecta enseguida y el resto tarda.
      const page = await t.open({ scenario: { ...identidad, relays: { '*': { connectMs: 2000 }, 'wss://nos.lol': { connectMs: 5 } } } })
      await page.goto(`${server.origin}/publicar.html?type=venta`)
      await page.waitFor(`!document.getElementById('publish-bar').classList.contains('hidden')`)
      await rellenar(page, TIPOS.venta)
      const res = await publicar(page)
      t.assert.equal(res.ok, true, res.titulo + ' — ' + res.sub)
      const destinos = await page.evaluate(`new Set(window.__published.map(p => p.url)).size`)
      t.assert.ok(destinos > 1, `el anuncio fue a ${destinos} relay(s): ${res.sub}`)
      t.assert.doesNotMatch(res.sub, /no estaba|no estaban/, 'no queda ningún relay sin intentar')
    },
  },
  {
    name: 'el modo de pruebas (?dev=1) se anuncia en pantalla; sin él no hay aviso',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: identidad })
      await page.goto(`${server.origin}/publicar.html?dev=1`)
      await page.waitFor(`!!document.getElementById('dev-banner')`, { label: 'aviso de modo de pruebas' })
      t.assert.match(await page.text('#dev-banner'), /NO aparecerá en el mercado/)
      await page.goto(`${server.origin}/publicar.html`)
      await page.sleep(300)
      t.assert.equal(await page.evaluate(`!!document.getElementById('dev-banner')`), false)
    },
  },
  {
    name: 'una firma pendiente con la instantánea del formulario dañada no impide arrancar',
    async run(t) {
      const server = await t.server()
      const pendiente = {
        step: 'sign', ts: Date.now(),
        unsignedEvent: { kind: 30402, pubkey: PK1, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'x']], content: '' },
        formSnapshot: {
          fields: { 'tx-title': 'Título bueno', 'no-existe': 'x', 'tx-desc': { raro: 1 }, 'tx-negociar': 'on' },
          checks: 'no-lista', pills: { 'pills tx[': 'local', 'pills-tx-alcance': 7 }, platforms: { a: 1 }, selectedType: 'venta',
        },
      }
      const page = await t.open({ scenario: { ...identidad, sessionStorage: { plazap2p_pending_sign: pendiente } } })
      await page.goto(`${server.origin}/publicar.html`)
      await page.waitFor(`!document.getElementById('sec-paste-event').classList.contains('hidden')`, { label: 'pantalla de firma pendiente' })
      t.assert.equal(await page.evaluate(`document.getElementById('tx-title').value`), 'Título bueno', 'lo válido se restaura')
      t.assert.equal(await page.evaluate(`document.getElementById('tx-desc').value`), '', 'lo que no es texto se ignora')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'borrador: lo escrito se recupera al volver y no hereda una edición anterior',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: identidad })
      await page.goto(`${server.origin}/publicar.html?type=venta`)
      await page.waitFor(`!document.getElementById('publish-bar').classList.contains('hidden')`)
      await page.fill('#tx-title', 'Borrador a medias')
      await page.fill('#tx-negociar', true)
      await page.sleep(1100)   // autoguardado diferido
      await page.reload()
      await page.waitFor(`!document.getElementById('publish-bar').classList.contains('hidden')`)
      t.assert.equal(await page.evaluate(`document.getElementById('tx-title').value`), 'Borrador a medias')
      t.assert.equal(await page.evaluate(`document.getElementById('tx-price').disabled`), true, '"A negociar" restaurado con su efecto')
      t.assert.equal(await page.evaluate(`document.getElementById('btn-discard-draft').classList.contains('hidden')`), false)
      await page.click('#btn-discard-draft')
      t.assert.equal(await page.evaluate(`document.getElementById('tx-title').value`), '')
      t.assert.equal(await page.evaluate(`document.getElementById('tx-price').disabled`), false)
    },
  },
]
