// W-04: las propuestas de comunidad/herramienta publicadas desde la app se
// enseñan en su pestaña marcadas como «sin revisar», no en Mercado.
import { listing } from './fixtures.mjs'

export const tests = [
  {
    name: 'comunidades y herramientas propuestas aparecen en su pestaña y no en Mercado',
    async run(t) {
      const server = await t.server()
      const comunidad = listing({
        d: 'com-1', title: 'Comunidad de prueba', summary: 'Un grupo para probar',
        t: ['plazap2p', 'plazap2p-comunidad', 'telegram'],
        extraTags: [['r', 'https://t.me/comunidadprueba']], price: null,
      })
      const herramienta = listing({
        d: 'her-1', title: 'Herramienta de prueba', summary: 'Una herramienta para probar',
        t: ['plazap2p', 'plazap2p-herramienta', 'wallet'],
        extraTags: [['r', 'https://herramienta.test'], ['platform', 'web']], price: null,
      })
      const page = await t.open({ scenario: { events: [comunidad, herramienta] } })
      await page.goto(server.origin + '/index.html')

      await page.click('.nav-tab[data-tab="comunidades"]')
      await page.waitFor(`document.getElementById('channel-comunidades').textContent.includes('Comunidad de prueba')`, { label: 'propuesta de comunidad' })
      const com = await page.evaluate(`document.getElementById('channel-comunidades').textContent`)
      t.assert.match(com, /sin revisar/i)
      t.assert.match(await page.evaluate(`document.querySelector('#channel-comunidades a[href="https://t.me/comunidadprueba"]')?.textContent || ''`), /Abrir propuesta/)

      await page.click('.nav-tab[data-tab="herramientas"]')
      await page.waitFor(`document.getElementById('channel-herramientas').textContent.includes('Herramienta de prueba')`, { label: 'propuesta de herramienta' })
      const her = await page.evaluate(`document.getElementById('channel-herramientas').textContent`)
      t.assert.match(her, /sin revisar/i)

      await page.click('.nav-tab[data-tab="mercado"]')
      await page.sleep(200)
      const mercado = await page.evaluate(`document.getElementById('channel-mercado').textContent`)
      t.assert.doesNotMatch(mercado, /Comunidad de prueba|Herramienta de prueba/, 'las propuestas no se mezclan con los anuncios')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
]
