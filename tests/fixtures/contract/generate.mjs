// Contrato web ↔ Android: para la MISMA entrada, los builders de la web
// (js/publish-builders.js) y los de la app Android (core-builders) tienen que
// producir el mismo evento, y los dos lectores tienen que clasificarlo igual.
//
// Este archivo define los casos y genera `builders.json`. El JSON se guarda
// en los dos repos:
//   - Plazap2p-v3/tests/fixtures/contract/builders.json          (este)
//   - Plazap2p-android/core/core-builders/src/test/resources/contract/builders.json
// tests/contract.test.mjs comprueba que el JSON guardado es el que el código
// web genera hoy; BuildersContractTest.kt, que Android produce lo mismo.
//
// Regenerar tras cambiar un builder:  node tests/fixtures/contract/generate.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildServicio, buildEvento, buildComunidad, buildHerramienta, buildTransaccion, buildValoracion, buildRetirada, buildAvisoMuro,
} from '../../../js/publish-builders.js'
import { detectCategory } from '../../../js/listing-utils.js'

export const PUBKEY = 'a'.repeat(64)
const RATEE = 'b'.repeat(64)
const DESC = 'Descripción suficientemente larga para pasar la validación del formulario.'

/** [nombre, builder, entrada]. La entrada usa los mismos nombres de campo en JS y en Kotlin. */
export const CASES = [
  ['servicio completo', 'servicio', { title: 'Clases de guitarra', desc: DESC, catId: 'educacion', imageUrl: 'https://ejemplo.test/g.png', price: '25', currency: 'EUR', contact: '@profe' }],
  ['servicio mínimo', 'servicio', { title: 'Diseño web', desc: DESC }],
  ['servicio a negociar', 'servicio', { title: 'Consultoría Lightning', desc: DESC, catId: 'consultoria', contact: 'ana@correo.test' }],
  ['evento con hora', 'evento', { title: 'Meetup Bitcoin', desc: DESC, allDay: false, dateTs: 4081000000, endTs: 4081010000, tzid: 'Europe/Madrid', location: 'Valencia', contact: '@org', imageUrl: 'https://ejemplo.test/e.png' }],
  ['evento con zona y calendario', 'evento', { title: 'Quedada en el parque', desc: DESC, allDay: true, startDate: '2099-06-01', geohash: 'ezjmg', calendarCoord: `31924:${'e'.repeat(64)}:plazap2p-eventos` }],
  ['evento de día completo', 'evento', { title: 'Feria de dos días', desc: DESC, allDay: true, startDate: '2099-05-01', endDate: '2099-05-03', location: 'Madrid' }],
  ['comunidad', 'comunidad', { title: 'Bitcoin Sevilla', desc: DESC, platId: 'telegram', accessUrl: 'https://t.me/bitcoinsevilla', imageUrl: 'https://ejemplo.test/c.png' }],
  ['comunidad mínima', 'comunidad', { title: 'Grupo', desc: DESC }],
  ['herramienta', 'herramienta', { title: 'Mi wallet', desc: DESC, catId: 'wallet', officialUrl: 'https://ejemplo.test/wallet', platforms: ['android', 'IOS', 'inventada'], imageUrl: 'https://ejemplo.test/h.png' }],
  ['venta', 'transaccion', { tipoTag: 'plazap2p-venta', title: 'Vendo bicicleta', desc: DESC, price: '120.50', currency: 'EUR', alcanceId: 'local', contact: '@vendedor', imageUrl: 'https://ejemplo.test/b.png' }],
  ['compra sin moneda', 'transaccion', { tipoTag: 'plazap2p-compra', title: 'Busco portátil', desc: DESC, price: '300', alcanceId: 'nacional' }],
  ['intercambio a negociar', 'transaccion', { tipoTag: 'plazap2p-intercambio', title: 'Cambio libros', desc: DESC, alcanceId: 'online' }],
  ['contacto con enlace (se sanea)', 'transaccion', { tipoTag: 'plazap2p-venta', title: 'Vendo mesa', desc: DESC, contact: 'escribe a https://t.me/estafa o t.me/otra' }],
  ['URL de imagen no válida (se descarta)', 'servicio', { title: 'Servicio con imagen rara', desc: DESC, imageUrl: 'javascript:alert(1)' }],
  ['valoración con aspectos', 'valoracion', { rateeHex: RATEE, rating: 4, comment: 'Todo correcto', aspects: { comunicacion: 5, rapidez: 3 } }],
  ['valoración mínima', 'valoracion', { rateeHex: RATEE, rating: 1 }],
  ['valoración desde un anuncio', 'valoracion', { rateeHex: RATEE, rating: 5, aspects: { comunicacion: 4 }, refTag: `30402:${RATEE}:plazap2p-app-1-abcd` }],
  ['valoración con referencia a un evento', 'valoracion', { rateeHex: RATEE, rating: 3, refTag: 'D'.repeat(64) }],
  ['valoración con referencia rara (se ignora)', 'valoracion', { rateeHex: RATEE, rating: 2, refTag: 'no-es-una-referencia' }],
  ['venta visible un año', 'transaccion', { tipoTag: 'plazap2p-venta', title: 'Vendo sofá', desc: DESC, price: '80', currency: 'EUR', durationDays: 365 }],
  ['servicio sin caducidad', 'servicio', { title: 'Reparación de nodos', desc: DESC, durationDays: 0 }],
  ['aviso en el muro de una venta', 'avisoMuro', { kind: 30402, dTag: 'plazap2p-app-1-abcd', naddr: 'naddr1qqtest', title: 'Vendo bicicleta', price: '120.50', currency: 'EUR' }],
  ['aviso en el muro de un evento', 'avisoMuro', { kind: 31923, dTag: 'plazap2p-app-2-ef01', naddr: 'naddr1qqevento', title: 'Meetup Bitcoin' }],
  ['retirada', 'retirada', { kind: 30402, dTag: 'plazap2p-app-1-abcd', eventId: 'c'.repeat(64) }],
  ['venta de un punto de venta con ubicación exacta', 'transaccion', { tipoTag: 'plazap2p-venta', title: 'Vendo café', desc: DESC, price: '5', currency: 'EUR', geohash: 'ezjmgu4p6', commerce: true }],
  ['servicio de particular con punto exacto (se recorta a zona)', 'servicio', { title: 'Clases de guitarra', desc: DESC, geohash: 'ezjmgu4p6' }],
  ['evento con ubicación exacta', 'evento', { title: 'Meetup en el bar', desc: DESC, allDay: true, startDate: '2099-07-01', geohash: 'ezjmgu4p6' }],
]

const BUILDERS = {
  servicio: buildServicio, evento: buildEvento, comunidad: buildComunidad, herramienta: buildHerramienta,
  transaccion: buildTransaccion, valoracion: buildValoracion, retirada: buildRetirada, avisoMuro: buildAvisoMuro,
}

/** Valores que dependen del momento o del azar: se sustituyen por un marcador.
 * La caducidad conserva los días elegidos (`<ahora+90d>`), relativos a created_at. */
const VOLATILE = { d: '<d>', published_at: '<ahora>' }
export const normalizeTags = (tags, createdAt) => tags.map(t => {
  if (t[0] === 'expiration' && t.length >= 2) return [t[0], `<ahora+${Math.round((Number(t[1]) - createdAt) / 86400)}d>`]
  return (t[0] in VOLATILE && t.length >= 2) ? [t[0], VOLATILE[t[0]]] : t
})

export function generate() {
  return CASES.map(([name, builder, input]) => {
    const built = BUILDERS[builder](input, PUBKEY)
    if (!built.ok) throw new Error(`${name}: ${built.error}`)
    const ev = built.unsignedEvent
    const tTags = ev.tags.filter(t => t[0] === 't').map(t => t[1].toLowerCase())
    return {
      name, builder, input,
      expected: {
        kind: ev.kind,
        tags: normalizeTags(ev.tags, ev.created_at),
        content: ev.content,
        // Cómo lo clasifica el lector (pestaña/categoría del Mercado); solo para anuncios.
        category: ev.kind === 30402 ? detectCategory(tTags) : null,
      },
    }
  })
}

export const serialize = cases => JSON.stringify({ pubkey: PUBKEY, cases }, null, 2) + '\n'

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = new URL('./builders.json', import.meta.url)
  writeFileSync(out, serialize(generate()))
  console.log('escrito', fileURLToPath(out))
}
