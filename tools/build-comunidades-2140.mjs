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
const FIELDS = 'id,title,link,modified,direccion,ciudad,pais,telegram,enlace,lightning_address,lat,lon,nostr,status'
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

const raw = await fetchAll()
const items = raw
  .filter(c => c.status === 'publish' && /^espa(ñ|n)a$/i.test(String(c.pais || '').trim()))
  .map(cleanCommunity)
  .filter(Boolean)
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

const doc = {
  fuente: 'https://2140meetups.com/comunidades/',
  generado: new Date().toISOString().slice(0, 10),
  comunidades: items,
}
const next = JSON.stringify(doc, null, 2) + '\n'
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
const strip = s => s.replace(/"generado": "[^"]*",?\n/, '')
console.log(`${raw.length} comunidades en 2140meetups; ${items.length} de España (${items.filter(c => c.npub).length} con Nostr).`)
if (strip(prev) === strip(next)) {
  console.log('Sin cambios.')
} else if (process.argv.includes('--check')) {
  console.log('Hay cambios: ejecuta sin --check para escribirlos.')
  process.exitCode = 1
} else {
  fs.writeFileSync(OUT, next)
  console.log(`Escrito ${path.relative(process.cwd(), OUT)}.`)
}
