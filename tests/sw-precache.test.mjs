// sw.js — todo lo que el navegador pide para arrancar debe estar en STATICS.
//
// El CI ya comprobaba que cada entrada de STATICS existe en disco, pero no lo
// contrario: que cada URL que las páginas piden de verdad esté precacheada.
// Así se colaron './js/router.js' y './js/app-shell.js' (app.js los importa
// SIN query; solo estaban las variantes '?v='), y la app no arrancaba offline.
//
// Aquí se recorre el grafo real: <script>/<link> de cada página, los import
// del bloque inline y los import/@import de cada archivo, y se compara con
// STATICS como URLs EXACTAS (con su query): para la caché, 'a.js' y
// 'a.js?v=42' son recursos distintos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8')

function staticsOfSw() {
  const block = read('sw.js').match(/STATICS\s*=\s*\[([\s\S]*?)\];/)[1]
  return new Set([...block.matchAll(/'([^']+)'/g)].map(m => m[1].replace(/^\.\//, '')))
}

function requestedUrls() {
  const requested = new Set()
  const walk = url => {
    if (requested.has(url)) return
    requested.add(url)
    const file = url.split('?')[0]
    if (!existsSync(path.join(ROOT, file))) return
    const src = read(file)
    const dir = path.posix.dirname(file)
    if (file.endsWith('.js')) {
      for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1] || m[2]
        if (spec.startsWith('.')) walk(path.posix.join(dir, spec))
      }
    }
    if (file.endsWith('.css')) {
      for (const m of src.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) walk(path.posix.join(dir, m[1]))
    }
  }
  for (const page of ['index.html', 'publicar.html']) {
    const html = read(page)
    for (const m of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
      const u = m[1]
      if (/^(https?:|data:|mailto:)/.test(u)) continue
      if (/\.(js|css)(\?|$)/.test(u)) walk(u.replace(/^\.\//, ''))
    }
    for (const m of html.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) walk(m[1])   // bloque <script type="module"> inline
  }
  return requested
}

test('toda URL de JS/CSS que piden las páginas está precacheada en sw.js', () => {
  const statics = staticsOfSw()
  const requested = requestedUrls()
  assert.ok(requested.size > 20, 'el recorrido del grafo de imports no encontró casi nada — regex rota o archivos movidos')
  const missing = [...requested].filter(u => !statics.has(u))
  assert.deepEqual(missing, [], `pedidas pero NO precacheadas (rompen el arranque offline): ${missing.join(', ')}`)
})

// Ronda 2: lo mismo para los datos que el código pide con fetch(). Se
// reconocen las dos formas que usa la app: fetch('data/x.json') literal y
// versioned('data/x.json') (que añade ?v=<ASSET_VERSION>).
test('todo JSON local que el código pide con fetch() está precacheado', () => {
  const statics = staticsOfSw()
  const version = read('js/app.js').match(/ASSET_VERSION\s*=\s*'(\d+)'/)[1]
  const wanted = new Set()
  for (const url of requestedUrls()) {
    const file = url.split('?')[0]
    if (!file.endsWith('.js') || !existsSync(path.join(ROOT, file))) continue
    const src = read(file)
    for (const m of src.matchAll(/versioned\(\s*['"]([^'"]+)['"]\s*\)/g)) wanted.add(`${m[1]}?v=${version}`)
    for (const m of src.matchAll(/fetch(?:WithTimeout)?\(\s*['"]((?!https?:)[^'"]+)['"]/g)) wanted.add(m[1])
  }
  assert.ok(wanted.has('data/config.json'), 'publicar-app.js pide data/config.json sin query')
  assert.ok(wanted.has(`data/config.json?v=${version}`), 'app.js lo pide versionado')
  const missing = [...wanted].filter(u => !statics.has(u))
  assert.deepEqual(missing, [], `datos pedidos pero NO precacheados (faltan sin red): ${missing.join(', ')}`)
})

test('el recorrido detecta el caso que motivó el test (import sin query desde app.js)', () => {
  const requested = requestedUrls()
  assert.ok(requested.has('js/router.js'), 'app.js importa ./router.js sin query')
  assert.ok(requested.has('js/app-shell.js'), 'router.js importa ./app-shell.js sin query')
})
