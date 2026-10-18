// Consultas puntuales a relays (reputación, perfil, recibos de zap) contra un
// pool simulado de VARIOS relays. Fija el fallo de auditoría: terminaban con
// el primer EOSE, así que bastaba que el relay más rápido no tuviera el dato
// para responder "sin valoraciones" / "sin lightning address" / 0 zaps.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchReputacion, fetchReputacionBatch, _clearReputacionCache, RATINGS_PER_SELLER } from '../js/reputacion.js'
import { fetchProfileMeta } from '../js/profile.js'
import { fetchZapReceipts } from '../js/zaps.js'
import { fakePool, flush, answerRaterAge } from './fixtures/fake-pool.mjs'
import { SK1, SK2, PK1, PK2, signWith } from './fixtures/events.mjs'
import { buildInvoice } from './fixtures/bolt11.mjs'

const NS = 'plazap2p.reputation'
const hex = c => c.repeat(64)
const rating = (author, ratee, stars, { ts = 1_700_000_000, withRating = true } = {}) => ({
  kind: 1985, pubkey: author, created_at: ts, content: '',
  tags: [['L', NS], ...(withRating ? [['l', `rating:${stars}`, NS]] : []), ['p', ratee]],
})

// ── Reputación ────────────────────────────────────────────────────────────────

test('fetchReputacion: el relay rápido vacío no produce "sin valoraciones"', async () => {
  _clearReputacionCache()
  const pool = answerRaterAge(fakePool(['wss://rapido', 'wss://lento']))
  const ratee = hex('a')
  const p = fetchReputacion(pool, ratee, 2000, { trustedRaters: new Set([hex('1'), hex('2')]) })
  pool.eose('wss://rapido')                              // contesta primero y no tiene nada
  await flush()
  pool.emit(rating(hex('1'), ratee, 5), 'wss://lento')
  pool.emit(rating(hex('2'), ratee, 3), 'wss://lento')
  pool.eose('wss://lento')
  const rep = await p
  assert.equal(rep.count, 2)
  assert.equal(rep.avg, 4)
})

test('fetchReputacionBatch: reparte por valorado, una valoración por autor, sin auto-valoración', async () => {
  _clearReputacionCache()
  const pool = answerRaterAge(fakePool(['wss://a']))
  const [r1, r2] = [hex('b'), hex('c')]
  const p = fetchReputacionBatch(pool, [r1, r2], 2000, { trustedRaters: new Set([hex('1'), hex('2')]) })
  pool.emit(rating(hex('1'), r1, 2, { ts: 100 }), 'wss://a')
  pool.emit(rating(hex('1'), r1, 5, { ts: 200 }), 'wss://a')   // mismo autor, más reciente: gana
  pool.emit(rating(r2, r2, 5), 'wss://a')                      // auto-valoración: fuera
  pool.emit(rating(hex('2'), hex('f'), 5), 'wss://a')          // valorado no pedido: fuera
  pool.eose('wss://a')
  const out = await p
  assert.equal(out[r1].count, 1)
  assert.equal(out[r1].avg, 5)
  assert.equal(out[r2].count, 0)
})

test('fetchReputacionBatch: un evento sin puntuación no desplaza la valoración real del mismo autor', async () => {
  _clearReputacionCache()
  const pool = answerRaterAge(fakePool(['wss://a']))
  const ratee = hex('d')
  const p = fetchReputacionBatch(pool, [ratee], 2000, { trustedRaters: new Set([hex('1')]) })
  pool.emit(rating(hex('1'), ratee, 4, { ts: 100 }), 'wss://a')
  pool.emit(rating(hex('1'), ratee, 0, { ts: 999, withRating: false }), 'wss://a')
  pool.eose('wss://a')
  const out = await p
  assert.equal(out[ratee].count, 1)
  assert.equal(out[ratee].avg, 4)
})

test('fetchReputacionBatch: un resultado cortado por timeout NO se cachea; uno completo sí', async () => {
  _clearReputacionCache()
  const ratee = hex('e')

  const mudo = fakePool(['wss://mudo'])
  const red = { trustedRaters: new Set([hex('1')]) }
  const parcial = await fetchReputacionBatch(mudo, [ratee], 50, red)     // nadie contesta → timeout
  assert.equal(parcial[ratee].count, 0)
  assert.equal(parcial[ratee].complete, false, 'y se dice que el resultado no es completo (VW4-07)')

  const pool = answerRaterAge(fakePool(['wss://a']))
  const p = fetchReputacionBatch(pool, [ratee], 2000, red)
  assert.equal(pool.subs.size, 1, 'vuelve a consultar: el vacío por timeout no quedó en caché')
  pool.emit(rating(hex('1'), ratee, 5), 'wss://a')
  pool.eose('wss://a')
  const completo = await p
  assert.equal(completo[ratee].count, 1)
  assert.equal(completo[ratee].complete, true)

  const otra = fakePool(['wss://a'])
  const again = await fetchReputacionBatch(otra, [ratee], 2000, red)
  assert.equal(otra.subs.size, 0, 'el resultado completo sí se sirve de caché')
  assert.equal(again[ratee].count, 1)
})

/**
 * Relay que respeta `limit` como uno real: por cada filtro de valoraciones
 * entrega como mucho `limit` eventos, los más recientes de los que casan.
 */
function limitHonouringPool(ratings) {
  const pool = answerRaterAge(fakePool(['wss://a']))
  const age = pool.onSubscribe
  pool.consultas = []
  pool.onSubscribe = (id, filters, h) => {
    if (!filters.every(f => f.kinds?.[0] === 1985)) return age(id, filters, h)
    pool.consultas.push(filters)
    queueMicrotask(() => {
      for (const f of filters) {
        const hits = ratings
          .filter(ev => ev.tags.some(t => t[0] === 'p' && f['#p'].includes(t[1])))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, f.limit)
        for (const ev of hits) h.onEvent?.(ev, 'wss://a')
      }
      h.onEose?.('wss://a')
    })
  }
  return pool
}

test('reputación: una avalancha de valoraciones sobre un vendedor no deja sin las suyas a los demás (VW4-06)', async () => {
  _clearReputacionCache()
  const [inundado, normal] = [hex('3'), hex('4')]
  const autor = i => (i + 16).toString(16).padStart(4, '0').repeat(16)
  const basura = Array.from({ length: 500 }, (_, i) => rating(autor(i), inundado, 1, { ts: 2_000_000_000 + i }))
  const reales = [rating(hex('1'), normal, 5, { ts: 100 }), rating(hex('2'), normal, 4, { ts: 101 })]
  const pool = limitHonouringPool([...basura, ...reales])

  const out = await fetchReputacionBatch(pool, [inundado, normal], 2000, { trustedRaters: new Set([hex('1'), hex('2')]) })

  assert.equal(out[normal].count, 2, 'las valoraciones reales del otro vendedor siguen ahí')
  assert.equal(out[normal].avg, 4.5)
  // PZ-F8-01: la basura es de cuentas fuera de la red: no hace media, se cuenta aparte.
  assert.equal(out[inundado].count, 0)
  assert.equal(out[inundado].unknownCount, RATINGS_PER_SELLER)
  for (const f of pool.consultas.flat()) assert.equal(f['#p'].length, 1, 'un filtro por vendedor')
})

test('reputación: muchos vendedores se preguntan en lotes de 10 filtros, uno por vendedor', async () => {
  _clearReputacionCache()
  const vendedores = Array.from({ length: 23 }, (_, i) => (i + 1).toString(16).padStart(2, '0').repeat(32))
  const pool = limitHonouringPool([])

  const out = await fetchReputacionBatch(pool, [...vendedores, vendedores[0]], 2000, { trustedRaters: new Set() })

  assert.deepEqual(pool.consultas.map(c => c.length), [10, 10, 3])
  assert.deepEqual(pool.consultas.flat().map(f => f['#p'][0]), vendedores)
  assert.ok(pool.consultas.flat().every(f => f.limit === RATINGS_PER_SELLER))
  assert.equal(Object.keys(out).length, 23)
})

// ── Antigüedad del valorador (ronda 2: misma regla que la app Android) ────────

test('reputación: fuera de la red de confianza no hacen media; se cuentan aparte las de cuentas con historia', async () => {
  _clearReputacionCache()
  const ratee = hex('7')
  const [veterano, recien] = [hex('1'), hex('2')]
  const pool = answerRaterAge(fakePool(['wss://a']), [veterano])
  const p = fetchReputacionBatch(pool, [ratee], 2000, { trustedRaters: new Set() })
  pool.emit(rating(veterano, ratee, 2), 'wss://a')
  pool.emit(rating(recien, ratee, 5), 'wss://a')      // cuenta creada para inflar la nota
  pool.eose('wss://a')
  const rep = (await p)[ratee]
  assert.equal(rep.count, 0, 'ninguna está en la red de confianza')
  assert.equal(rep.unknownCount, 1, 'solo el veterano cuenta como desconocido con historia')
  assert.equal(rep.excludedRecent, 2, 'y se sabe cuántas se han dejado fuera de la media')
})

test('reputación: la antigüedad se pregunta con un filtro por autor, hasta el corte de 30 días', async () => {
  _clearReputacionCache()
  const ratee = hex('8')
  const raters = Array.from({ length: 12 }, (_, i) => (i + 1).toString(16).padStart(2, '0').repeat(32))
  const pool = fakePool(['wss://a'])
  const consultas = []
  answerRaterAge(pool)
  const responder = pool.onSubscribe
  pool.onSubscribe = (id, filters, h) => { if (filters[0].authors) consultas.push(filters); responder(id, filters, h) }
  const p = fetchReputacionBatch(pool, [ratee], 2000, { trustedRaters: new Set() })
  for (const r of raters) pool.emit(rating(r, ratee, 4), 'wss://a')
  pool.eose('wss://a')
  assert.equal((await p)[ratee].unknownCount, 12)
  assert.deepEqual(consultas.map(c => c.length), [10, 2], 'lotes de 10 filtros')
  const corte = Math.floor(Date.now() / 1000) - 30 * 86400
  for (const f of consultas.flat()) {
    assert.equal(f.authors.length, 1)
    assert.equal(f.limit, 1)
    assert.ok(Math.abs(f.until - corte) < 5, 'corte a 30 días')
  }
})

test('reputación: un evento posterior al corte no acredita antigüedad aunque el relay lo entregue', async () => {
  _clearReputacionCache()
  const ratee = hex('9')
  const pool = fakePool(['wss://a'])
  pool.onSubscribe = (_id, filters, h) => {
    if (!filters[0].authors) return
    queueMicrotask(() => {      // relay que ignora `until` y devuelve un evento de hoy
      h.onEvent({ kind: 1, pubkey: filters[0].authors[0], created_at: Math.floor(Date.now() / 1000), content: '', tags: [] }, 'wss://a')
      h.onEose('wss://a')
    })
  }
  const p = fetchReputacionBatch(pool, [ratee], 2000, { trustedRaters: new Set() })
  pool.emit(rating(hex('1'), ratee, 5), 'wss://a')
  pool.eose('wss://a')
  const rep = (await p)[ratee]
  assert.equal(rep.unknownCount, 0)
  assert.equal(rep.excludedRecent, 1)
})

test('reputación: si ningún relay contesta sobre la antigüedad, se falla cerrado (y no se cachea)', async () => {
  _clearReputacionCache()
  const ratee = hex('6')
  const sinRed = { trustedRaters: new Set() }
  const pool = fakePool(['wss://a'])      // sin answerRaterAge: la segunda consulta queda sin respuesta
  const p = fetchReputacionBatch(pool, [ratee], 80, sinRed)
  pool.emit(rating(hex('1'), ratee, 5), 'wss://a')
  pool.eose('wss://a')
  const rep = (await p)[ratee]
  assert.equal(rep.unknownCount, 0, 'PZ-F8-01: un fallo de red ya no cuenta a nadie como veterano')
  assert.equal(rep.complete, false, 'y se dice que el resultado no es completo')
  // No quedó en caché: la siguiente consulta vuelve a preguntar.
  const otra = answerRaterAge(fakePool(['wss://a']), [hex('1')])
  const p2 = fetchReputacionBatch(otra, [ratee], 2000, sinRed)
  assert.equal(otra.subs.size, 1)
  otra.emit(rating(hex('1'), ratee, 5), 'wss://a')
  otra.eose('wss://a')
  assert.equal((await p2)[ratee].unknownCount, 1, 'ahora los relays sí contestan')
})

// ── Perfil ────────────────────────────────────────────────────────────────────

const profileEv = (pubkey, meta, ts) => ({ kind: 0, pubkey, created_at: ts, content: JSON.stringify(meta), tags: [] })

test('fetchProfileMeta: encuentra el perfil aunque el primer relay no lo tenga', async () => {
  const pool = fakePool(['wss://rapido', 'wss://lento'])
  const p = fetchProfileMeta(pool, PK1, 2000)
  pool.eose('wss://rapido')
  await flush()
  pool.emit(profileEv(PK1, { name: 'ana', lud16: 'ana@example.com' }, 500), 'wss://lento')
  pool.eose('wss://lento')
  const profile = await p
  assert.equal(profile.lud16, 'ana@example.com')
})

test('fetchProfileMeta: gana el perfil más reciente entre relays; ignora otros autores', async () => {
  const pool = fakePool(['wss://a', 'wss://b'])
  const p = fetchProfileMeta(pool, PK1, 2000)
  pool.emit(profileEv(PK1, { name: 'nuevo', lud16: 'nuevo@example.com' }, 900), 'wss://a')
  pool.emit(profileEv(PK2, { name: 'intruso', lud16: 'intruso@example.com' }, 9999), 'wss://a')
  pool.eose('wss://a')
  pool.emit(profileEv(PK1, { name: 'viejo', lud16: 'viejo@example.com' }, 100), 'wss://b')
  pool.eose('wss://b')
  const profile = await p
  assert.equal(profile.name, 'nuevo')
  assert.equal(profile.lud16, 'nuevo@example.com')
})

test('fetchProfileMeta: sin perfil → null, nunca lanza', async () => {
  const pool = fakePool(['wss://a'])
  const p = fetchProfileMeta(pool, PK1, 2000)
  pool.eose('wss://a')
  assert.equal(await p, null)
  assert.equal(await fetchProfileMeta(null, PK1), null)
})

// ── Recibos de zap ────────────────────────────────────────────────────────────

/** Recibo 9735 completo: zap request firmado por el remitente + bolt11 por `invoiceHrp`. */
function zapReceipt({ senderSk = SK1, recipient = PK2, providerSk = SK2, amountMsats = 2_100_000, invoiceHrp = 'lnbc21u', requestP = recipient } = {}) {
  const zapRequest = signWith(senderSk, {
    kind: 9734, content: 'gracias',
    tags: [['relays', 'wss://r.example'], ['amount', String(amountMsats)], ['p', requestP]],
  })
  return signWith(providerSk, {
    kind: 9735, content: '',
    tags: [['p', recipient], ['bolt11', buildInvoice({ hrp: invoiceHrp })], ['description', JSON.stringify(zapRequest)]],
  })
}

test('fetchZapReceipts: junta recibos de todos los relays, sin duplicar el mismo recibo', async () => {
  const pool = fakePool(['wss://rapido', 'wss://lento'])
  const p = fetchZapReceipts(pool, PK2, 2000)
  pool.eose('wss://rapido')
  await flush()
  const r1 = zapReceipt()
  const r2 = zapReceipt({ amountMsats: 21_000, invoiceHrp: 'lnbc210n' })
  pool.emit(r1, 'wss://lento')
  pool.emit(r1, 'wss://lento')         // duplicado
  pool.emit(r2, 'wss://lento')
  pool.eose('wss://lento')
  const result = await p
  assert.equal(result.receipts.length, 2)
  // Nadie comprueba quién firma el recibo: el propio vendedor puede publicar
  // uno con la factura que quiera. No se ofrece ninguna suma de dinero.
  assert.equal('totalMsats' in result, false)
})

test('fetchZapReceipts: descarta recibos que no se pueden contar', async () => {
  const pool = fakePool(['wss://a'])
  const p = fetchZapReceipts(pool, PK2, 2000)
  // importe declarado (1.000.000 sats) que no coincide con la factura (2.100 sats)
  pool.emit(zapReceipt({ amountMsats: 1_000_000_000 }), 'wss://a')
  // zap request dirigido a OTRA persona, reutilizado en un recibo hacia PK2
  pool.emit(zapReceipt({ requestP: PK1 }), 'wss://a')
  // sin zap request incrustado: no se sabe ni quién ni cuánto
  pool.emit(signWith(SK2, { kind: 9735, content: '', tags: [['p', PK2], ['bolt11', buildInvoice()]] }), 'wss://a')
  // factura sin importe
  pool.emit(zapReceipt({ invoiceHrp: 'lnbc' }), 'wss://a')
  pool.eose('wss://a')
  const { receipts } = await p
  assert.equal(receipts.length, 0)
})
