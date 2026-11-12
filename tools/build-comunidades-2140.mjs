#!/usr/bin/env node
// Genera data/comunidades-2140.json con las comunidades Bitcoin de España de
// dos directorios públicos, juntadas sin repetir (el nombre del archivo es
// histórico: al principio solo venían de 2140meetups), y con el directorio
// curado de PlazaP2P (data/comunidades.json), en una sola lista:
//   - 2140meetups.com (API pública de su página /developers/): el sitio donde
//     quedan, su foto y contactos.
//   - BTC Map (api.btcmap.org, «áreas» de tipo comunidad): la zona de la
//     comunidad, su foto y contactos. Solo las que caen dentro de España,
//     según el contorno del país que publica el propio BTC Map.
//
//   node tools/build-comunidades-2140.mjs            # descarga y escribe
//   node tools/build-comunidades-2140.mjs --check    # solo dice si cambiaría
//
// El navegador no puede leer el API de 2140meetups (no permite CORS), por eso
// se copia aquí y se vuelve a ejecutar de vez en cuando. No se guarda el email
// de contacto de las comunidades: no hace falta para el mapa ni el listado.
// Después hay que copiar el archivo a la app Android
// (app/src/main/assets/mapa/comunidades-2140.json).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanCommunity, sameCommunityName, samePlaceWords, mergeCommunities } from '../js/comunidades-2140.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'data', 'comunidades-2140.json')
const UA = { 'User-Agent': 'PlazaP2P-directorio/1.0' }
const FIELDS = 'id,title,link,modified,direccion,ciudad,pais,telegram,enlace,lightning_address,lat,lon,nostr,status,featured_media'
const API_2140 = `https://2140meetups.com/wp-json/wp/v2/community?per_page=100&_fields=${FIELDS}`
const MEDIA_2140 = 'https://2140meetups.com/wp-json/wp/v2/media?per_page=100&_fields=id,source_url,mime_type&include='
const BTCMAP_AREAS = 'https://api.btcmap.org/v2/areas'
// Comunidades que salen primero en el listado (por su id en 2140meetups).
const DESTACADAS = new Set(['5541'])   // Valencia Bitcoin Plebs

async function getJson(url) {
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url.slice(0, 80)}`)
  return res.json()
}

// ── 2140meetups ───────────────────────────────────────────────────────────────

async function fetch2140() {
  const out = []
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${API_2140}&page=${page}`, { headers: UA })
    if (res.status === 400) break // pasada la última página
    if (!res.ok) throw new Error(`HTTP ${res.status} en la página ${page}`)
    const items = await res.json()
    out.push(...items)
    if (items.length < 100) break
  }
  return out.filter(c => c.status === 'publish' && /^espa(ñ|n)a$/i.test(String(c.pais || '').trim()))
}

/** Foto de cada comunidad: el API de la comunidad solo da el número de su imagen. */
async function fetchPhotos2140(mediaIds) {
  const photos = new Map()
  const ids = [...new Set(mediaIds.filter(n => Number.isInteger(n) && n > 0))]
  for (let i = 0; i < ids.length; i += 100) {
    for (const m of await getJson(MEDIA_2140 + ids.slice(i, i + 100).join(','))) {
      if (/^image\/(png|jpeg|webp)$/.test(m.mime_type)) photos.set(m.id, m.source_url)
    }
  }
  return photos
}

// ── BTC Map ───────────────────────────────────────────────────────────────────

/** Anillos [lon, lat] de un Polygon o MultiPolygon GeoJSON. */
function rings(geo) {
  if (!geo) return []
  if (geo.type === 'Polygon') return geo.coordinates
  if (geo.type === 'MultiPolygon') return geo.coordinates.flat()
  return []
}

function insideRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Dentro del país si cae en un número impar de anillos (exteriores menos huecos). */
function insideGeo(point, geo) {
  return rings(geo).reduce((n, r) => n + (insideRing(point, r) ? 1 : 0), 0) % 2 === 1
}

/** Centro (de la caja) de la zona de una comunidad: [lon, lat]. */
function centerOf(geo) {
  const pts = rings(geo).flat()
  if (!pts.length) return null
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** contact:nostr puede venir como npub suelto, nostr:npub… o un enlace con el npub. */
function npubFrom(raw) {
  const m = String(raw || '').match(/npub1[02-9ac-hj-np-z]{58}/)
  return m ? m[0] : null
}

async function fetchBtcmap() {
  const areas = (await getJson(BTCMAP_AREAS)).filter(a => !a.deleted_at && a.tags)
  const spain = areas.find(a => a.tags.type === 'country' && a.id === 'es')
  if (!spain) throw new Error('BTC Map no trae el contorno de España')
  const out = []
  for (const a of areas) {
    const t = a.tags
    if (t.type !== 'community') continue
    const c = centerOf(t.geo_json)
    if (!c || !insideGeo(c, spain.tags.geo_json)) continue
    out.push({
      id: `btcmap-${a.id}`,
      nombre: t.name,
      lat: c[1],
      lon: c[0],
      telegram: t['contact:telegram'],
      web: t['contact:website'],
      npub: npubFrom(t['contact:nostr']),
      lightning: t['tips:lightning_address'],
      btcmap: `https://btcmap.org/community/${a.id}`,
      foto: t['icon:square'],
      exacta: false,
      fuentes: ['btcmap'],
    })
  }
  return out
}

// ── Juntar ────────────────────────────────────────────────────────────────────

const raw2140 = await fetch2140()
const photos = await fetchPhotos2140(raw2140.map(c => c.featured_media))
const from2140 = raw2140
  .map(c => cleanCommunity({ ...c, foto: photos.get(c.featured_media), destacada: DESTACADAS.has(String(c.id)), fuentes: ['2140meetups'] }))
  .filter(Boolean)
const fromBtcmap = (await fetchBtcmap()).map(cleanCommunity).filter(Boolean)

// La misma comunidad en los dos: se queda la de 2140meetups (tiene el sitio
// donde quedan) y se completa con lo que solo trae BTC Map.
const items = [...from2140]
let merged = 0
for (const b of fromBtcmap) {
  const own = items.filter(c => c.fuentes.includes('2140meetups'))
  const byPlace = own.filter(c => samePlaceWords(c.nombre, b.nombre))
  const twin = own.find(c => sameCommunityName(c.nombre, b.nombre)) ?? (byPlace.length === 1 ? byPlace[0] : null)
  if (!twin) { items.push(b); continue }
  merged++
  for (const k of ['telegram', 'web', 'npub', 'lightning', 'foto']) twin[k] = twin[k] || b[k]
  twin.btcmap = b.btcmap
  twin.fuentes = ['2140meetups', 'btcmap']
}
// Y con el directorio curado de PlazaP2P (data/comunidades.json): una sola
// lista, una entrada por comunidad, con la información de todas las fuentes.
const curated = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'comunidades.json'), 'utf8'))
const unified = mergeCommunities(curated, items)

const doc = {
  fuente: 'Directorio de PlazaP2P (data/comunidades.json), https://2140meetups.com/comunidades/ y https://btcmap.org/communities',
  generado: new Date().toISOString().slice(0, 10),
  comunidades: unified,
}
const next = JSON.stringify(doc, null, 2) + '\n'
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
const strip = s => s.replace(/"generado": "[^"]*",?\n/, '')
console.log(`2140meetups: ${from2140.length} · BTC Map: ${fromBtcmap.length} (${merged} ya estaban) · directorio: ${curated.filter(c => c.aprobado).length} · ` +
  `total ${unified.length} comunidades, una por entrada (${unified.filter(c => c.npub).length} con Nostr, ${unified.filter(c => c.foto).length} con foto, ` +
  `${unified.filter(c => c.lat == null).length} sin sitio en el mapa).`)
if (strip(prev) === strip(next)) {
  console.log('Sin cambios.')
} else if (process.argv.includes('--check')) {
  console.log('Hay cambios: ejecuta sin --check para escribirlos.')
  process.exitCode = 1
} else {
  fs.writeFileSync(OUT, next)
  console.log(`Escrito ${path.relative(process.cwd(), OUT)}.`)
}
