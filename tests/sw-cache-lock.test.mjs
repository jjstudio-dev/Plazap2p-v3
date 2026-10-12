// sw.js — si cambia un archivo de STATICS, el nombre de la caché también.
//
// El Service Worker sirve primero lo guardado. Si se corrige un módulo y no
// se sube `CACHE`, quien ya tiene la web instalada sigue con el archivo viejo
// indefinidamente. El CI comprobaba que el número `?v=` coincide en todas
// partes, pero no esto.
//
// tests/fixtures/sw-cache-lock.json guarda el nombre de la caché y la huella
// de cada archivo de STATICS tal como estaban la última vez que se subió el
// nombre. Tras subir `CACHE` en sw.js, se regenera con:
//
//   node tests/sw-cache-lock.test.mjs --update
//
// (se niega a regenerar si el contenido cambió y el nombre no).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = path.join(ROOT, 'tests/fixtures/sw-cache-lock.json')
const TEXT = /\.(html|js|css|json|svg)$/

function current() {
  const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8')
  const cache = sw.match(/const CACHE\s*=\s*'([^']+)'/)[1]
  const urls = [...sw.match(/STATICS\s*=\s*\[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  const files = {}
  for (const url of urls) {
    const file = url.replace(/^\.\//, '').split('?')[0] || 'index.html'
    let body = readFileSync(path.join(ROOT, file))
    // Los finales de línea dependen del sistema donde se clona; el contenido no.
    if (TEXT.test(file)) body = Buffer.from(body.toString('utf8').replace(/\r\n/g, '\n'))
    files[url] = createHash('sha256').update(body).digest('hex').slice(0, 16)
  }
  return { cache, files }
}

function changed(lock, now) {
  const urls = new Set([...Object.keys(lock.files), ...Object.keys(now.files)])
  return [...urls].filter(u => lock.files[u] !== now.files[u]).sort()
}

const readLock = () => JSON.parse(readFileSync(LOCK, 'utf8'))

if (process.argv.includes('--update')) {
  const now = current()
  let lock = null
  try { lock = readLock() } catch { /* primera vez */ }
  const diff = lock ? changed(lock, now) : []
  if (lock && diff.length && lock.cache === now.cache) {
    console.error(`No se regenera: cambió ${diff.join(', ')} y CACHE sigue siendo '${now.cache}'. Sube antes el nombre en sw.js.`)
    process.exit(1)
  }
  writeFileSync(LOCK, JSON.stringify(now, null, 2) + '\n')
  console.log(`sw-cache-lock.json regenerado para '${now.cache}' (${Object.keys(now.files).length} recursos)`)
}

test('si cambia un archivo de STATICS, cambia el nombre de la caché', () => {
  const lock = readLock()
  const now = current()
  const diff = changed(lock, now)
  if (diff.length && lock.cache === now.cache) {
    assert.fail(`cambió ${diff.join(', ')} y CACHE sigue siendo '${now.cache}': quien tenga la web instalada no recibiría el cambio. ` +
      'Sube CACHE en sw.js y ejecuta: node tests/sw-cache-lock.test.mjs --update')
  }
  assert.ok(diff.length === 0 && lock.cache === now.cache,
    `sw-cache-lock.json está desfasado (registrado '${lock.cache}', sw.js dice '${now.cache}'). Ejecuta: node tests/sw-cache-lock.test.mjs --update`)
})

test('el control detecta un cambio de contenido sin cambio de nombre', () => {
  const now = current()
  const url = Object.keys(now.files).find(u => u.includes('js/nostr.js'))
  const lock = { cache: now.cache, files: { ...now.files, [url]: '0000000000000000' } }
  assert.deepEqual(changed(lock, now), [url])
})
