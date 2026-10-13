// Wallet (NWC / NIP-47) y zaps (NIP-57) contra una wallet simulada que cifra y
// firma de verdad. Aquí se mueve dinero: lo que se comprueba es que la app
// nunca paga algo distinto de lo que enseña, nunca paga dos veces por un
// clic repetido, y nunca dice "no se ha pagado" cuando no lo sabe.

import { getPublicKey } from '../../js/vendor/nostr-crypto.js'
import { buildInvoice } from '../fixtures/bolt11.mjs'
import { SK1, SK2, PK1, PK2, skHex, profile, listing } from './fixtures.mjs'
import { hexToNpub } from '../../js/nostr.js'

const SKW = Uint8Array.from({ length: 32 }, (_, i) => i + 50)     // clave de la wallet
const SKC = Uint8Array.from({ length: 32 }, (_, i) => i + 150)    // secret de la conexión (cliente)
const WALLET_PUB = getPublicKey(SKW)
const RELAY = 'wss://wallet.relay.test'
const CONN_STRING = `nostr+walletconnect://${WALLET_PUB}?relay=${encodeURIComponent(RELAY)}&secret=${skHex(SKC)}`
const SESSION = { plazap2p_nwc_session: { walletPubkey: WALLET_PUB, relay: RELAY, secret: skHex(SKC), lud16: null, encryption: 'nip04', methods: ['get_balance', 'pay_invoice'] } }

const OK = { get_balance: { result: { balance: 1_234_567 } } }
const base = (wallet, extra = {}) => ({
  localStorage: { plazap2p_pubkey: PK1 }, nip07: { sk: skHex(SK1) },
  wallet: { sk: skHex(SKW), ...wallet }, ...extra,
})
const calls = page => page.evaluate(`window.__walletCalls.map(c => c.method)`)
const visible = id => `!document.getElementById('${id}').classList.contains('hidden')`
const errText = id => `document.getElementById('${id}').textContent`

async function abrirWallet(t, scenario) {
  const server = await t.server()
  const page = await t.open({ scenario })
  await page.goto(server.origin + '/publicar.html')
  await page.click('#nav-perfil')
  await page.click('.pub-chip[data-chip="wallet"]')
  return page
}

/** Pega la factura, la revisa y devuelve lo que la pantalla de confirmación enseña. */
async function revisar(page, invoice) {
  await page.fill('#w-pay-invoice', invoice)
  await page.click('#w-btn-decode')
  return page.evaluate(`({ caja: ${visible('w-confirm-box')}, importe: document.getElementById('w-confirm-amount').textContent, error: ${errText('err-w-pay')} })`)
}

export const tests = [
  {
    name: 'conectar: verifica la wallet de extremo a extremo y muestra el saldo',
    async run(t) {
      const page = await abrirWallet(t, base({ behaviors: OK }))
      await page.fill('#w-conn-string', CONN_STRING)
      await page.click('#w-btn-connect')
      await page.waitFor(visible('w-connected'), { label: 'wallet conectada' })
      await page.waitFor(`document.getElementById('w-balance').textContent.includes('1234 sats')`, { label: 'saldo' })
      t.assert.equal(await page.evaluate(`document.getElementById('w-conn-string').value`), '', 'el secret no queda a la vista')
      t.assert.equal(await page.evaluate(`!!sessionStorage.getItem('plazap2p_nwc_session')`), true)
      t.assert.equal(await page.evaluate(`localStorage.getItem('plazap2p_nwc_persist')`), null, 'sin "recordar", el secret no va a localStorage')
      t.assert.equal(await page.evaluate(`localStorage.getItem('plazap2p_nwc_meta')`), null, 'sin "recordar", tampoco se guarda qué wallet es')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'conectar: string inválido, wallet que no publica su info, e info falsificada',
    async run(t) {
      for (const [caso, wallet, cadena, esperado] of [
        ['formato', { behaviors: OK }, 'https://no-es-nwc', /formato inválido/],
        ['sin secret', { behaviors: OK }, `nostr+walletconnect://${WALLET_PUB}?relay=${encodeURIComponent(RELAY)}`, /secret válido/],
        ['sin info', { behaviors: OK, noInfo: true }, CONN_STRING, /no publicó su evento info/],
        ['info falsificada', { behaviors: OK, forgedInfo: true }, CONN_STRING, /no publicó su evento info/],
        ['wallet muda', { behaviors: { get_balance: 'silent' } }, CONN_STRING, /timeout/],
      ]) {
        const page = await abrirWallet(t, base(wallet))
        await page.fill('#w-conn-string', cadena)
        await page.click('#w-btn-connect')
        await page.waitFor(`${errText('err-w-connect')}.length > 0`, { timeout: 13000, label: `error de conexión (${caso})` })
        t.assert.match(await page.evaluate(errText('err-w-connect')), esperado, caso)
        t.assert.equal(await page.evaluate(visible('w-connected')), false, caso)
        t.assert.equal(await page.evaluate(`sessionStorage.getItem('plazap2p_nwc_session')`), null, `${caso}: nada guardado`)
        await page.close()
      }
    },
  },
  {
    name: 'recibir: genera la factura y su QR',
    async run(t) {
      const factura = buildInvoice({ hrp: 'lnbc10u' })   // 1000 sats
      const page = await abrirWallet(t, base({ behaviors: { ...OK, make_invoice: { result: { invoice: factura } } } }, { sessionStorage: SESSION }))
      await page.waitFor(visible('w-connected'))
      await page.fill('#w-rcv-amount', '1000')
      await page.fill('#w-rcv-desc', 'Bicicleta')
      await page.click('#w-btn-invoice')
      await page.waitFor(visible('w-invoice-box'))
      t.assert.equal(await page.text('#w-invoice-text'), factura)
      t.assert.match(await page.evaluate(`document.querySelector('#w-qr img')?.src ?? ''`), /^data:image\//)
      const peticion = await page.evaluate(`window.__walletCalls.find(c => c.method === 'make_invoice').params`)
      t.assert.deepEqual(peticion, { amount: 1_000_000, description: 'Bicicleta' })
      // Importe inválido: no se llama a la wallet
      await page.fill('#w-rcv-amount', '0')
      await page.click('#w-btn-invoice')
      t.assert.match(await page.evaluate(errText('err-w-receive')), /Importe inválido/)
    },
  },
  {
    name: 'pagar: se paga exactamente la factura revisada, una sola vez aunque se pulse dos',
    async run(t) {
      const factura = buildInvoice({ hrp: 'lnbc21u', description: 'Café' })   // 2100 sats
      const page = await abrirWallet(t, base({ behaviors: { ...OK, pay_invoice: { result: { preimage: 'ab'.repeat(32) }, delayMs: 300 } } }, { sessionStorage: SESSION }))
      await page.waitFor(visible('w-connected'))
      // Como llega de un QR: con prefijo y en mayúsculas
      const vista = await revisar(page, 'LIGHTNING:' + factura.toUpperCase())
      t.assert.ok(vista.caja, vista.error)
      t.assert.equal(vista.importe, '2100 sats')   // en español los millares no se separan hasta 10.000
      t.assert.equal(await page.text('#w-confirm-desc'), 'Café')
      await page.evaluate(`(() => { const b = document.getElementById('w-btn-pay'); b.click(); b.click(); b.click() })()`)
      await page.waitFor(visible('w-pay-result'), { label: 'resultado del pago' })
      t.assert.match(await page.text('#w-pay-result'), /Pago enviado \(2100 sats\)/)
      const pagos = await page.evaluate(`window.__walletCalls.filter(c => c.method === 'pay_invoice').map(c => c.params.invoice)`)
      t.assert.deepEqual(pagos, [factura], 'una sola orden de pago, con la factura normalizada')
      t.assert.deepEqual(t.appErrors(page), [])
    },
  },
  {
    name: 'pagar: factura caducada, sin importe o ilegible no llega a la wallet',
    async run(t) {
      const page = await abrirWallet(t, base({ behaviors: { ...OK, pay_invoice: { result: { preimage: 'x' } } } }, { sessionStorage: SESSION }))
      await page.waitFor(visible('w-connected'))
      for (const [caso, factura, esperado] of [
        ['caducada', buildInvoice({ hrp: 'lnbc21u', timestamp: 1_600_000_000 }), /expirado/],
        ['sin importe', buildInvoice({ hrp: 'lnbc' }), /sin importe/i],
        ['basura', 'lnbc1noesunafactura', /./],
        ['otra red', 'lnxx' + buildInvoice({ hrp: 'lnbc21u' }).slice(4), /./],
      ]) {
        const vista = await revisar(page, factura)
        t.assert.equal(vista.caja, false, `${caso}: no debe ofrecer confirmar`)
        t.assert.match(vista.error, esperado, caso)
      }
      t.assert.ok(!(await calls(page)).includes('pay_invoice'))
    },
  },
  {
    name: 'pagar: un rechazo explícito de la wallet se dice tal cual',
    async run(t) {
      const page = await abrirWallet(t, base({ behaviors: { ...OK, pay_invoice: { error: { code: 'INSUFFICIENT_BALANCE', message: 'x' } } } }, { sessionStorage: SESSION }))
      await page.waitFor(visible('w-connected'))
      await revisar(page, buildInvoice({ hrp: 'lnbc21u' }))
      await page.click('#w-btn-pay')
      await page.waitFor(`${errText('err-w-pay')}.length > 0`)
      t.assert.match(await page.evaluate(errText('err-w-pay')), /Saldo insuficiente/)
      t.assert.equal(await page.evaluate(visible('w-pay-result')), false)
      t.assert.equal(await page.evaluate(visible('w-confirm-box')), false, 'no queda un botón de confirmar muerto')
    },
  },
  {
    name: 'pagar: respuestas falsificadas se ignoran; si el resultado no se conoce, se avisa de verificar',
    async run(t) {
      for (const [caso, pago] of [
        ['firmada por otra clave', { result: { preimage: 'ff'.repeat(32) }, forged: true }],
        ['referida a otra petición', { result: { preimage: 'ff'.repeat(32) }, wrongRef: true }],
        ['sin respuesta', 'silent'],
      ]) {
        const page = await abrirWallet(t, base({ behaviors: { ...OK, pay_invoice: pago, lookup_invoice: { result: { state: 'pending' } } } }, { sessionStorage: SESSION }))
        await page.waitFor(visible('w-connected'))
        await page.waitFor(`document.getElementById('w-balance').textContent.includes('sats')`)
        await revisar(page, buildInvoice({ hrp: 'lnbc21u' }))
        await page.click('#w-btn-pay')
        await page.waitFor(`window.__walletCalls.some(c => c.method === 'pay_invoice')`)
        await page.sleep(250)
        t.assert.equal(await page.evaluate(visible('w-pay-result')), false, `${caso}: no puede darse por pagado`)
        await page.evaluate(`window.__relay.dropAll()`)   // el relay de la wallet corta la conexión
        await page.waitFor(`${errText('err-w-pay')}.length > 0`, { timeout: 9000, label: `aviso (${caso})` })
        const aviso = await page.evaluate(errText('err-w-pay'))
        t.assert.match(aviso, /VERIFICA EN TU WALLET/, caso)
        t.assert.doesNotMatch(aviso, /intactos/, caso)
        t.assert.ok((await calls(page)).includes('lookup_invoice'), `${caso}: se consulta el estado antes de avisar`)
        await page.close()
      }
    },
  },
  {
    name: 'pagar: si la respuesta se pierde pero el pago se hizo, se confirma consultando a la wallet',
    async run(t) {
      const page = await abrirWallet(t, base({ behaviors: { ...OK, pay_invoice: 'silent', lookup_invoice: { result: { state: 'settled', preimage: 'cd'.repeat(32) } } } }, { sessionStorage: SESSION }))
      await page.waitFor(visible('w-connected'))
      await page.waitFor(`document.getElementById('w-balance').textContent.includes('sats')`)
      await revisar(page, buildInvoice({ hrp: 'lnbc21u' }))
      await page.click('#w-btn-pay')
      await page.waitFor(`window.__walletCalls.some(c => c.method === 'pay_invoice')`)
      await page.evaluate(`window.__relay.dropAll()`)
      await page.waitFor(visible('w-pay-result'), { timeout: 9000 })
      t.assert.match(await page.text('#w-pay-result'), /SÍ se completó/)
      t.assert.equal((await calls(page)).filter(m => m === 'pay_invoice').length, 1, 'no se reintenta el pago')
    },
  },
  {
    name: 'la sesión de wallet no sobrevive al cierre de pestaña, y ya no se ofrece recordarla',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: base({ behaviors: OK }) })
      await page.goto(server.origin + '/publicar.html')
      await page.click('#nav-perfil'); await page.click('.pub-chip[data-chip="wallet"]')
      t.assert.equal(await page.count('#w-remember'), 0, 'no se ofrece "recordar" mientras la web comparta dominio')
      await page.fill('#w-conn-string', CONN_STRING)
      await page.click('#w-btn-connect')
      await page.waitFor(visible('w-connected'))
      t.assert.deepEqual(await page.evaluate(`['plazap2p_nwc_persist', 'plazap2p_nwc_meta'].map(k => localStorage.getItem(k))`), [null, null])
      // "Cerrar la pestaña": se pierde sessionStorage, queda localStorage.
      await page.evaluate(`sessionStorage.removeItem('plazap2p_nwc_session')`)
      await page.reload()
      await page.click('#nav-perfil'); await page.click('.pub-chip[data-chip="wallet"]')
      t.assert.equal(await page.evaluate(visible('w-connected')), false)
      t.assert.doesNotMatch(await page.evaluate(errText('err-w-connect')), /Wallet conocida/)
    },
  },
  {
    name: 'una conexión recordada en una visita anterior se saca del almacenamiento permanente',
    async run(t) {
      const recordada = SESSION.plazap2p_nwc_session
      const { secret, ...meta } = recordada
      const page = await abrirWallet(t, base({ behaviors: OK }, { localStorage: { plazap2p_pubkey: PK1, plazap2p_nwc_persist: recordada, plazap2p_nwc_meta: meta } }))
      await page.waitFor(visible('w-connected'), { label: 'sigue conectada en esta pestaña' })
      t.assert.deepEqual(await page.evaluate(`['plazap2p_nwc_persist', 'plazap2p_nwc_meta'].map(k => localStorage.getItem(k))`), [null, null], 'la credencial ya no queda escrita')
      t.assert.equal(await page.evaluate(`!!sessionStorage.getItem('plazap2p_nwc_session')`), true)
    },
  },

  {
    name: 'en la página de la wallet, un script colado dentro del HTML no se ejecuta',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: base({ behaviors: OK }) })
      await page.goto(server.origin + '/publicar.html')
      await page.waitFor(`!!document.getElementById('nav-perfil')`)
      await page.evaluate(`(() => {
        const d = document.createElement('div')
        d.innerHTML = '<img src="x" onerror="window.__colado = 1"><a id="colado-a" onclick="window.__colado = 2">x</a>'
        document.body.append(d)
        document.getElementById('colado-a').click()
        const s = document.createElement('script'); s.textContent = 'window.__colado = 3'; document.body.append(s)
      })()`)
      await new Promise(r => setTimeout(r, 400))
      t.assert.equal(await page.evaluate(`window.__colado ?? null`), null, 'la política de la página debe bloquear los scripts en línea')
      // La página sigue funcionando: se puede conectar la wallet.
      await page.click('#nav-perfil'); await page.click('.pub-chip[data-chip="wallet"]')
      await page.fill('#w-conn-string', CONN_STRING)
      await page.click('#w-btn-connect')
      await page.waitFor(visible('w-connected'), { label: 'wallet conectada' })
    },
  },

  // ── Zaps ────────────────────────────────────────────────────────────────
  ...(() => {
    const vendedor = profile({ sk: SK2, meta: { name: 'Vendedora', lud16: 'vendedora@pagos.test' } })
    const lnurl = factura => [
      { match: 'pagos\\.test/\\.well-known/lnurlp/vendedora', json: { tag: 'payRequest', callback: 'https://pagos.test/cb', minSendable: 1000, maxSendable: 100_000_000, allowsNostr: true, nostrPubkey: PK2 } },
      { match: 'pagos\\.test/cb', json: { pr: factura } },
    ]
    const abrirZap = async (t, scenario) => {
      const server = await t.server()
      const page = await t.open({ scenario })
      await page.goto(`${server.origin}/publicar.html?zap=${hexToNpub(PK2)}`)
      return page
    }
    const enviar = async (page, sats) => {
      await page.waitFor(visible('zap-form-fields'), { label: 'formulario de zap' })
      await page.fill('#z-amount', String(sats))
      await page.fill('#z-comment', '¡Gracias!')
      await page.click('#btn-send-zap')
    }
    const buena = buildInvoice({ hrp: 'lnbc210n' })   // 21 sats

    return [
      {
        name: 'zap: firma la petición con la identidad, paga la factura exacta y lo confirma',
        async run(t) {
          const page = await abrirZap(t, base({ behaviors: { ...OK, pay_invoice: { result: { preimage: 'ab'.repeat(32) } } } },
            { sessionStorage: SESSION, events: [vendedor], fetch: lnurl(buena) }))
          await enviar(page, 21)
          await page.waitFor(visible('zap-result'), { timeout: 9000, label: 'zap enviado' })
          t.assert.match(await page.text('#zap-result'), /Zap de 21 sats enviado/)
          const peticion = (await page.evaluate('window.__signed')).find(e => e.kind === 9734)
          t.assert.ok(peticion, 'la petición de zap (9734) la firma la identidad del usuario')
          t.assert.equal(peticion.pubkey, PK1)
          t.assert.deepEqual(peticion.tags.find(x => x[0] === 'p'), ['p', PK2])
          t.assert.deepEqual(peticion.tags.find(x => x[0] === 'amount'), ['amount', '21000'])
          t.assert.deepEqual(await page.evaluate(`window.__walletCalls.filter(c => c.method === 'pay_invoice').map(c => c.params.invoice)`), [buena])
          const cb = (await page.evaluate('window.__fetchLog')).find(f => f.url.includes('/cb'))
          t.assert.match(cb.url, /amount=21000/)
          t.assert.deepEqual(t.appErrors(page), [])
        },
      },
      {
        name: 'zap: si el servidor del receptor devuelve otra factura (mayor, sin importe, caducada), no se paga',
        async run(t) {
          for (const [caso, factura, esperado] of [
            ['mayor', buildInvoice({ hrp: 'lnbc10m' }), /1\.000\.000 sats en vez de los 21/],
            ['sin importe', buildInvoice({ hrp: 'lnbc' }), /sin importe/],
            ['caducada', buildInvoice({ hrp: 'lnbc210n', timestamp: 1_600_000_000 }), /caducada/],
            ['ilegible', 'lnbc1basura', /ilegible/],
          ]) {
            const page = await abrirZap(t, base({ behaviors: { ...OK, pay_invoice: { result: { preimage: 'x' } } } },
              { sessionStorage: SESSION, events: [vendedor], fetch: lnurl(factura) }))
            await enviar(page, 21)
            await page.waitFor(`${errText('err-zap')}.length > 0`, { timeout: 9000, label: `error (${caso})` })
            t.assert.match(await page.evaluate(errText('err-zap')), esperado, caso)
            t.assert.ok(!(await calls(page)).includes('pay_invoice'), `${caso}: la wallet no recibe orden de pago`)
            await page.close()
          }
        },
      },
      {
        name: 'zap: si no se sabe si se pagó, no se dice "fondos intactos" ni se invita a repetir',
        async run(t) {
          const page = await abrirZap(t, base({ behaviors: { ...OK, pay_invoice: 'silent', lookup_invoice: 'silent' } },
            { sessionStorage: SESSION, events: [vendedor], fetch: lnurl(buena) }))
          await enviar(page, 21)
          await page.waitFor(`window.__walletCalls.some(c => c.method === 'pay_invoice')`, { timeout: 9000 })
          await page.evaluate(`window.__relay.dropAll()`)
          await page.waitFor(`window.__walletCalls.some(c => c.method === 'lookup_invoice')`, { timeout: 9000 })
          await page.evaluate(`window.__relay.dropAll()`)
          await page.waitFor(`${errText('err-zap')}.length > 0`, { timeout: 9000 })
          const aviso = await page.evaluate(errText('err-zap'))
          t.assert.match(aviso, /VERIFICA EN TU WALLET/)
          t.assert.doesNotMatch(aviso, /intactos/)
          t.assert.equal(await page.evaluate(visible('zap-result')), false)
        },
      },
      {
        name: 'zap: doble pulsación no pide ni paga dos facturas',
        async run(t) {
          const page = await abrirZap(t, base({ behaviors: { ...OK, pay_invoice: { result: { preimage: 'ab'.repeat(32) }, delayMs: 300 } } },
            { sessionStorage: SESSION, events: [vendedor], fetch: lnurl(buena) }))
          await page.waitFor(visible('zap-form-fields'))
          await page.fill('#z-amount', '21')
          await page.evaluate(`(() => { const b = document.getElementById('btn-send-zap'); b.click(); b.click(); b.click() })()`)
          await page.waitFor(visible('zap-result'), { timeout: 9000 })
          t.assert.equal((await calls(page)).filter(m => m === 'pay_invoice').length, 1)
          t.assert.equal((await page.evaluate('window.__fetchLog')).filter(f => f.url.includes('/cb')).length, 1)
        },
      },
      {
        name: 'zap: sin wallet, sin dirección Lightning del receptor o con importe inválido, no hay pago',
        async run(t) {
          // Sin wallet conectada
          let page = await abrirZap(t, base({ behaviors: OK }, { events: [vendedor] }))
          await page.waitFor(visible('zap-no-wallet'))
          t.assert.equal(await page.evaluate(visible('zap-form-fields')), false)
          await page.close()
          // Receptor sin lud16
          page = await abrirZap(t, base({ behaviors: OK }, { sessionStorage: SESSION, events: [profile({ sk: SK2, meta: { name: 'Sin LN' } })] }))
          await page.waitFor(visible('zap-no-lud16'), { timeout: 9000 })
          t.assert.equal(await page.evaluate(visible('zap-form-fields')), false)
          await page.close()
          // Importes inválidos
          page = await abrirZap(t, base({ behaviors: { ...OK, pay_invoice: { result: {} } } }, { sessionStorage: SESSION, events: [vendedor], fetch: lnurl(buena) }))
          await page.waitFor(visible('zap-form-fields'))
          for (const malo of ['', '0', '-5', '1.5']) {
            await page.fill('#z-amount', malo)
            await page.click('#btn-send-zap')
            t.assert.match(await page.evaluate(errText('err-z-amount')), /Importe inválido/, `importe "${malo}"`)
          }
          t.assert.ok(!(await calls(page)).includes('pay_invoice'))
          // Al corregir el importe y enviar, el aviso anterior desaparece.
          await page.fill('#z-amount', '21')
          await page.click('#btn-send-zap')
          await page.sleep(150)
          t.assert.equal(await page.evaluate(errText('err-z-amount')), '', 'el aviso de importe inválido se borra')
        },
      },
      {
        name: 'el enlace "Enviar zap" de un anuncio lleva al vendedor correcto',
        async run(t) {
          const server = await t.server()
          const page = await t.open({ scenario: { events: [listing({ sk: SK2, d: 'bici' })] } })
          await page.goto(server.origin + '/index.html')
          await page.waitFor(`document.querySelectorAll('#channel-mercado .listing-card:not(.skeleton)').length === 1`)
          await page.click('#channel-mercado .listing-card')
          const enlaces = await page.evaluate(`[...document.querySelectorAll('#listing-modal a[href^="publicar.html"]')].map(a => a.getAttribute('href'))`)
          const npub = hexToNpub(PK2)
          t.assert.ok(enlaces.some(h => h.startsWith(`publicar.html?zap=${npub}&ref=naddr1`)), enlaces.join(' | '))
          t.assert.ok(enlaces.some(h => h.startsWith(`publicar.html?valorar=${npub}&ref=naddr1`)))
          t.assert.ok(enlaces.some(h => h.startsWith(`publicar.html?report=${npub}&ref=naddr1`)))
          t.assert.ok(enlaces.some(h => h.startsWith('publicar.html?pagar=naddr1')))
        },
      },
    ]
  })(),
]
