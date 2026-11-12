#!/usr/bin/env node
// Genera data/comunidades-2140.json con las comunidades Bitcoin de España del
// directorio 2140meetups.com, usando su API pública (página /developers/).
//
//   node tools/build-comunidades-2140.mjs            # descarga y escribe
//   node tools/build-comunidades-2140.mjs --check    # solo dice qué cambiaría
//
// El navegador no puede leer esa API directamente (no permite CORS), por eso
// se copia aquí y se vuelve a ejecutar de vez en cuando. No se guarda el email
// de contacto de las comunidades: no hace falta para el mapa ni el listado.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanCommunity } from '../js/comunidades-2140.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'data', 'comunidades-2140.json')
const FIELDS = 'id,title,link,modified,direccion,ciudad,pais,telegram,enlace,lightning_address,lat,lon,nostr,status,featured_media'
const MEDIA = 'https://2140meetups.com/wp-json/wp/v2/media?per_page=100&_fields=id,source_url,mime_type&include='
// Comunidades que salen primero en el listado (por su id en 2140meetups).
const DESTACADAS = new Set(['5541'])   // Valencia Bitcoin Plebs
const API = `https://2140meetups.com/wp-json/wp/v2/community?per_page=100&_fields=${FIELDS}`

async function fetchAll() {
  const out = []
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${API}&page=${page}`, { headers: { 'User-Agent': 'PlazaP2P-directorio/1.0' } })
    if (res.status === 400) break // pasada la última página
    if (!res.ok) throw new Error(`HTTP ${res.status} en la página ${page}`)
    const items = await res.json()
    out.push(...items)
    if (items.length < 100) break
  }
  return out
}

/** Foto de cada comunidad: el API de la comunidad solo da el número de su imagen. */
async function fetchPhotos(mediaIds) {
  const photos = new Map()
  const ids = [...new Set(mediaIds.filter(n => Number.isInteger(n) && n > 0))]
  for (let i = 0; i < ids.length; i += 100) {
    const res = await fetch(MEDIA + ids.slice(i, i + 100).join(','), { headers: { 'User-Agent': 'PlazaP2P-directorio/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status} al pedir las fotos`)
    for (const m of await res.json()) {
      if (/^image\/(png|jpeg|webp)$/.test(m.mime_type)) photos.set(m.id, m.source_url)
    }
  }
  return photos
}

const raw = (await fetchAll()).filter(c => c.status === 'publish' && /^espa(ñ|n)a$/i.test(String(c.pais || '').trim()))
const photos = await fetchPhotos(raw.map(c => c.featured_media))
const items = raw
  .map(c => cleanCommunity({ ...c, foto: photos.get(c.featured_media), destacada: DESTACADAS.has(String(c.id)) }))
  .filter(Boolean)
  .sort((a, b) => (b.destacada - a.destacada) || a.nombre.localeCompare(b.nombre, 'es'))

const doc = {
  fuente: 'https://2140meetups.com/comunidades/',
  generado: new Date().toISOString().slice(0, 10),
  comunidades: items,
}
const next = JSON.stringify(doc, null, 2) + '\n'
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
const strip = s => s.replace(/"generado": "[^"]*",?\n/, '')
console.log(`${items.length} comunidades de España (${items.filter(c => c.npub).length} con Nostr, ${items.filter(c => c.foto).length} con foto).`)
if (strip(prev) === strip(next)) {
  console.log('Sin cambios.')
} else if (process.argv.includes('--check')) {
  console.log('Hay cambios: ejecuta sin --check para escribirlos.')
  process.exitCode = 1
} else {
  fs.writeFileSync(OUT, next)
  console.log(`Escrito ${path.relative(process.cwd(), OUT)}.`)
}
