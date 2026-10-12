// Service Worker: la app instalada tiene que abrirse sin red, actualizarse
// limpiamente y no acumular basura en la caché del dispositivo.

import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './harness.mjs'
import { listing, PK1 } from './fixtures.mjs'
import { hexToNpub } from '../../js/nostr.js'

/** Espera a que el SW esté activo y controlando la página. */
const swListo = page => page.evaluate(`navigator.serviceWorker.ready.then(() => new Promise(resolve => {
  if (navigator.serviceWorker.controller) return resolve(true)
  navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true))
}))`)
const cachesInfo = page => page.evaluate(`(async () => {
  const names = await caches.keys()
  const out = {}
  for (const n of names) out[n] = (await (await caches.open(n)).keys()).map(r => r.url.replace(location.origin, ''))
  return out
})()`)
const CACHE_ACTUAL = /const CACHE\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8'))[1]

export const tests = [
  {
    name: 'instalada y sin red: index.html y publicar.html arrancan desde la caché',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: { events: [listing()] }, serviceWorker: true })
      await page.goto(server.origin + '/index.html')
      await swListo(page)
      await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 1`)
      await page.sleep(400)
      await server.close()   // a partir de aquí, el origen no responde: solo queda la caché

      for (const url of ['/index.html', '/', '/index.html?tab=eventos', '/index.html#/explorar/feed']) {
        page.errors.length = 0; page.failed.length = 0
        await page.goto(server.origin + url)
        await page.waitFor(`document.querySelectorAll('.nav-tab').length === 17 && document.getElementById('relay-status-list').children.length > 0`,
          { label: `arranque sin red de ${url}` })
        t.assert.deepEqual(t.appErrors(page).filter(e => !/ratings\.json/.test(e)), [], `sin red: ${url}`)
      }
      t.assert.equal(await page.evaluate(`document.querySelector('.section-panel.active')?.id`), 'tab-feed')

      page.errors.length = 0; page.failed.length = 0
      await page.goto(server.origin + '/publicar.html')
      await page.waitFor(`!document.getElementById('sec-identidad').classList.contains('hidden')`, { label: 'publicar.html sin red' })
      await page.click('#nav-perfil')
      // (ratings.json?t= es de la página anterior: su fallo sin red es esperado y puede anotarse tarde)
      t.assert.deepEqual(t.appErrors(page).filter(e => !/ratings\.json/.test(e)), [], 'publicar.html sin red')

      // Los enlaces con parámetros (los que genera la propia app) también abren.
      await page.goto(`${server.origin}/publicar.html?valorar=${hexToNpub(PK1)}`)
      await page.waitFor(`document.getElementById('v-npub').value.startsWith('npub1')`, { label: 'publicar.html?valorar= sin red' })
    },
  },
  {
    name: 'la caché no crece con cada enlace distinto que se visita',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: {}, serviceWorker: true })
      await page.goto(server.origin + '/index.html')
      await swListo(page)
      await page.sleep(300)
      const antes = (await cachesInfo(page))[CACHE_ACTUAL].length
      const visitas = [
        '/index.html?tab=feed', '/index.html?tab=eventos', '/index.html?tab=acerca',
        `/publicar.html?valorar=${hexToNpub(PK1)}&ref=naddr1aaa`, `/publicar.html?zap=${hexToNpub(PK1)}&ref=naddr1bbb`,
        `/publicar.html?report=${hexToNpub(PK1)}&ref=naddr1ccc`, '/publicar.html?pagar=naddr1ddd', '/publicar.html?type=venta',
      ]
      for (const v of visitas) { await page.goto(server.origin + v); await page.sleep(150) }
      const despues = (await cachesInfo(page))[CACHE_ACTUAL]
      const conConsulta = despues.filter(u => /\.html\?/.test(u))
      t.assert.deepEqual(conConsulta, [], 'ninguna página con parámetros debe quedar guardada (crece sin límite y deja rastro de a quién se valoró o pagó)')
      t.assert.equal(despues.length, antes, 'mismo número de entradas que al instalar')
    },
  },
  {
    name: 'al publicarse una versión nueva, la caché de la anterior se elimina',
    async run(t) {
      const swNuevo = fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8')
      const swViejo = swNuevo.replace(CACHE_ACTUAL, 'plazap2p-v3-r00')
      const server = await t.server({ '/sw.js': { body: swViejo, type: 'text/javascript' } })
      const page = await t.open({ scenario: {}, serviceWorker: true })
      await page.goto(server.origin + '/index.html')
      await swListo(page)
      await page.sleep(300)
      t.assert.deepEqual(Object.keys(await cachesInfo(page)), ['plazap2p-v3-r00'])

      delete server.overrides['/sw.js']   // "despliegue": el servidor pasa a dar el sw.js actual
      await page.evaluate(`navigator.serviceWorker.getRegistration().then(r => r.update())`)
      await page.waitFor(`(async () => (await caches.keys()).join() === ${JSON.stringify(CACHE_ACTUAL)})()`, { timeout: 12000, label: 'solo queda la caché nueva' })
      await page.reload()
      await page.waitFor(`document.querySelectorAll('.nav-tab').length === 17`)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'todo lo que la app carga al arrancar está en la lista de precarga',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: {}, serviceWorker: true })
      await page.goto(server.origin + '/index.html')
      await swListo(page)
      await page.goto(server.origin + '/publicar.html')
      await page.sleep(500)
      const precargado = new Set((await cachesInfo(page))[CACHE_ACTUAL])
      // Lo que el servidor sirvió DESPUÉS de instalarse el SW y no estaba precargado
      // es algo que faltaría sin red. (ratings.json?t= es dinámico a propósito.)
      const pedidos = [...new Set(server.hits)].filter(h => !/ratings\.json|sw\.js/.test(h))
      const fuera = pedidos.filter(h => !precargado.has(h) && !precargado.has(h.replace(/^\/$/, '/')) )
        .filter(h => !['/', '/index.html', '/publicar.html'].includes(h.split('?')[0]) || !h.includes('?'))
        .filter(h => !precargado.has(h))
      t.assert.deepEqual(fuera, [], 'recursos pedidos al arrancar que no están en STATICS')
    },
  },
]
