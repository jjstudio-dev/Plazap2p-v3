// Perfil del vendedor: se abre desde el anuncio y desde «Vendedores»; enseña su
// perfil Nostr, sus anuncios activos (no los de otros), vendidos y reputación.
// Un perfil hostil (nombre con HTML, foto javascript:) no ejecuta nada.
import { listing, profile, SK1, SK2 } from './fixtures.mjs'

const P = campo => `<img src=x onerror="__xss.push('${campo}')">'");__xss.push('${campo}-js');//`

export const tests = [
  {
    name: 'Perfil del vendedor: perfil, sus anuncios activos, vendidos y reputación',
    async run(t) {
      const server = await t.server()
      const events = [
        profile({ sk: SK1, meta: { name: 'Bebop', display_name: 'Bebop Tienda', nip05: 'bebop@ejemplo.test', lud16: 'bebop@ejemplo.test' } }),
        listing({ sk: SK1, d: 'a1', title: 'Portátil del vendedor' }),
        listing({ sk: SK1, d: 'a2', title: 'Silla del vendedor', price: ['30', 'EUR'] }),
        listing({ sk: SK1, d: 'a3', title: 'Mesa vendida', status: 'sold' }),
        listing({ sk: SK2, d: 'b1', title: 'Anuncio de otra persona' }),
      ]
      const page = await t.open({ scenario: { events } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.getElementById('channel-mercado').textContent.includes('Silla del vendedor')`)
      await page.evaluate(`[...document.querySelectorAll('#channel-mercado .listing-card')].find(c => c.textContent.includes('Silla del vendedor')).click()`)
      await page.waitFor(`!document.getElementById('listing-modal').classList.contains('hidden')`)
      await page.evaluate(`[...document.querySelectorAll('#listing-modal button')].find(b => b.textContent.includes('Ver perfil del vendedor')).click()`)
      await page.waitFor(`document.querySelector('#listing-modal .seller-profile')?.textContent.includes('Bebop Tienda')`, { timeout: 10000, label: 'perfil cargado' })
      const txt = await page.text('#listing-modal')
      t.assert.match(txt, /2 anuncios activos/)
      t.assert.match(txt, /1 vendido/)
      t.assert.match(txt, /bebop@ejemplo\.test/)
      t.assert.match(txt, /Portátil del vendedor/)
      t.assert.doesNotMatch(txt, /Anuncio de otra persona/)
      t.assert.doesNotMatch(txt, /Mesa vendida/, 'lo vendido se cuenta, no se lista')
      t.assert.ok(await page.evaluate(`!!document.querySelector('#listing-modal a[href^="publicar.html?zap=npub1"]')`), 'zap si tiene lud16')
      // Desde la lista se abre el anuncio.
      await page.evaluate(`[...document.querySelectorAll('#listing-modal .seller-listing-row')].find(b => b.textContent.includes('Portátil')).click()`)
      await page.waitFor(`document.getElementById('modal-title')?.textContent.includes('Portátil del vendedor')`)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'Perfil del vendedor: un perfil hostil no ejecuta código',
    async run(t) {
      const server = await t.server()
      const events = [
        profile({ sk: SK1, meta: { name: P('nombre'), display_name: P('display'), nip05: P('nip05'), picture: "javascript:__xss.push('foto')", lud16: 'x@ejemplo.test' } }),
        listing({ sk: SK1, d: 'a1', title: 'Anuncio normal' }),
      ]
      const page = await t.open({ scenario: { events } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.getElementById('channel-mercado').textContent.includes('Anuncio normal')`)
      await page.click('.nav-tab[data-tab="vendedores"]')
      await page.waitFor(`document.querySelector('.seller-check-btn')`)
      await page.evaluate(`document.querySelector('.seller-check-btn').click()`)
      await page.waitFor(`document.querySelector('#listing-modal .seller-profile')?.textContent.includes('__xss')`, { timeout: 10000, label: 'perfil hostil pintado como texto' })
      await page.sleep(300)
      t.assert.deepEqual(await page.evaluate('window.__xss'), [])
      t.assert.equal(await page.evaluate(`document.querySelectorAll('#listing-modal img[src="x"], #listing-modal img[src^="javascript"]').length`), 0)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
]
