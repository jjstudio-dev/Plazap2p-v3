// Mercasats y derivados: sus anuncios (kind 30402 con `t mercasats`) se ven en
// el Mercado marcados «vía Mercasats», con el aviso de que los vendidos no se
// reflejan en Nostr y el enlace a su web.
import { listing, SK3, PK1, SK1 } from './fixtures.mjs'

export const tests = [
  {
    name: 'Mercasats: sus anuncios salen en el Mercado con su marca, aviso y enlace',
    async run(t) {
      const server = await t.server()
      // Anuncio de Telegram que firma la cuenta de Mercasats en nombre de otro vendedor.
      const telegram = listing({
        sk: SK3, d: 'mercasats-412', title: 'Portátil de Mercasats', summary: 'Casi nuevo',
        location: 'Barcelona', t: ['mercasats', 'p2p', 'bitcoin', 'informatica'], price: ['120', 'EUR'],
        extraTags: [['r', 'https://mercasats.kilombino.com/?p=412'], ['p', PK1, '', 'seller']],
        content: 'Portátil\n\n🔗 https://mercasats.kilombino.com/?p=412',
      })
      // Anuncio que firma el propio vendedor desde la web de Mercasats, precio en SAT.
      const propio = listing({
        sk: SK1, d: 'abc', title: 'Clases de guitarra', summary: 'Una hora',
        t: ['mercasats', 'serveis'], price: ['5000', 'SAT'],
        content: 'Clases\n\n🔗 https://mercasats.kilombino.com/?p=413',
      })
      const page = await t.open({ scenario: { events: [telegram, propio] } })
      await page.goto(server.origin + '/index.html')
      await page.waitFor(`document.getElementById('channel-mercado').textContent.includes('Portátil de Mercasats')`, { label: 'anuncio de Mercasats en el Mercado' })
      await page.waitFor(`document.getElementById('channel-mercado').textContent.includes('Clases de guitarra')`, { label: 'segundo anuncio' })

      const badges = await page.evaluate(`[...document.querySelectorAll('#channel-mercado .card-market-badge')].map(b => b.textContent.trim())`)
      t.assert.deepEqual(badges, ['vía Mercasats', 'vía Mercasats'])
      const cats = await page.evaluate(`[...document.querySelectorAll('#channel-mercado .listing-card')].map(c => c.querySelector('.card-title').textContent + '=' + c.querySelector('.card-badge').textContent)`)
      t.assert.ok(cats.includes('Portátil de Mercasats=VENTA'), cats.join(' | '))
      t.assert.ok(cats.includes('Clases de guitarra=SERVICIO'), cats.join(' | '))

      // Ficha del de Telegram: aviso, enlace a su web y sin valoraciones para la cuenta del mercado.
      await page.evaluate(`[...document.querySelectorAll('#channel-mercado .listing-card')].find(c => c.textContent.includes('Portátil de Mercasats')).click()`)
      await page.waitFor(`!document.getElementById('listing-modal').classList.contains('hidden')`)
      const ficha = await page.text('#listing-modal')
      t.assert.match(ficha, /marca los vendidos en su web, no en Nostr/)
      t.assert.match(ficha, /en nombre de otro vendedor/)
      t.assert.doesNotMatch(ficha, /Ser el primero en valorar/)
      t.assert.doesNotMatch(ficha, /Enviar zap|Pagar/, 'ni zap ni pago a la cuenta del mercado')
      t.assert.equal(await page.evaluate(`document.querySelector('#listing-modal .modal-market-notice a')?.getAttribute('href')`), 'https://mercasats.kilombino.com/?p=412')
      await page.evaluate(`closeModal()`)

      // Ficha del firmado por el vendedor: se puede valorar y el precio sale en SATS.
      await page.evaluate(`[...document.querySelectorAll('#channel-mercado .listing-card')].find(c => c.textContent.includes('Clases de guitarra')).click()`)
      await page.waitFor(`document.getElementById('listing-modal').textContent.includes('Clases de guitarra')`)
      const ficha2 = await page.text('#listing-modal')
      t.assert.match(ficha2, /5000 SATS/)
      t.assert.match(ficha2, /valorar/i)
      t.assert.match(ficha2, /Enviar zap/)
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
]
