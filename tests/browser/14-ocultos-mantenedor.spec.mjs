// Ocultos por el mantenedor (config.json → hidden_pubkeys): los anuncios de una
// clave de prueba que ya no se puede borrar no salen en el Mercado ni en el Inicio,
// y los del resto de vendedores sí.
import { readFileSync } from 'node:fs'
import { listing, SK3, PK3, SK4 } from './fixtures.mjs'

const CONFIG = JSON.parse(readFileSync(new URL('../../data/config.json', import.meta.url), 'utf8'))

export const tests = [
  {
    name: 'Ocultos por el mantenedor: un autor de hidden_pubkeys no aparece en el Mercado',
    async run(t) {
      const config = { ...CONFIG, hidden_pubkeys: [...(CONFIG.hidden_pubkeys || []), PK3] }
      const server = await t.server({
        '/data/config.json': { body: JSON.stringify(config), type: 'application/json' },
      })
      const oculto = listing({ sk: SK3, d: 'prueba-1', title: '[TEST] Anuncio de prueba', summary: 'No es real', t: ['plazap2p', 'plazap2p-venta'] })
      const real = listing({ sk: SK4, d: 'bici', title: 'Bicicleta de paseo', summary: 'Buen estado', t: ['plazap2p', 'plazap2p-venta'] })
      const page = await t.open({ scenario: { events: [oculto, real] } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.getElementById('channel-mercado').textContent.includes('Bicicleta de paseo')`, { label: 'anuncio real en el Mercado' })
      const mercado = await page.text('#channel-mercado')
      t.assert.doesNotMatch(mercado, /Anuncio de prueba/, 'el anuncio de la clave oculta no debe salir')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
]
