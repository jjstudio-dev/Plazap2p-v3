// .github/publish-list.txt — lo que se publica en GitHub Pages.
//
// Antes se publicaba el repositorio entero: tests, datos de prueba, README y
// cualquier documento interno quedaban accesibles en la web pública. Ahora se
// publica solo una lista, y aquí se comprueban las dos direcciones: que todo
// lo que la web pide está en ella, y que lo interno no.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8')

const published = read('.github/publish-list.txt')
  .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))

const isPublished = file => published.some(p => file === p || file.startsWith(p + '/'))

function neededFiles() {
  const needed = new Set(['index.html'])
  const sw = read('sw.js').match(/STATICS\s*=\s*\[([\s\S]*?)\];/)[1]
  for (const m of sw.matchAll(/'([^']+)'/g)) needed.add(m[1])
  for (const page of ['index.html', 'publicar.html']) {
    for (const m of read(page).matchAll(/(?:href|src)=["']([^"'#][^"']*)["']/g)) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(m[1])) needed.add(m[1])
    }
  }
  const manifest = JSON.parse(read('manifest.json'))
  for (const icon of manifest.icons ?? []) needed.add(icon.src)
  return [...needed].map(u => u.replace(/^\.\//, '').split('?')[0].split('#')[0]).filter(Boolean)
}

test('todo lo que la web pide está en la lista de publicación', () => {
  const needed = neededFiles()
  assert.ok(needed.length > 40, 'se encontraron muy pocos recursos — regex rota o archivos movidos')
  const missing = [...new Set(needed.filter(f => !isPublished(f)))]
  assert.deepEqual(missing, [], `la web los pide y no se publicarían: ${missing.join(', ')}`)
})

test('cada entrada de la lista existe', () => {
  const missing = published.filter(p => !existsSync(path.join(ROOT, p)))
  assert.deepEqual(missing, [], `en la lista y no en el repositorio: ${missing.join(', ')}`)
})

test('lo interno no se publica', () => {
  for (const file of ['tests/fixtures/events.mjs', 'tests/browser/run.mjs', 'docs/auditoria-2026-10/HALLAZGOS.md',
    'README.md', '.github/workflows/app.yml', '.gitignore']) {
    assert.ok(!isPublished(file), `${file} quedaría accesible en la web pública`)
  }
  assert.ok(!published.includes('.') && !published.includes('docs') && !published.includes('tests'))
})

test('el flujo publica la carpeta reunida con la lista, no la raíz', () => {
  const deploy = read('.github/workflows/app.yml').split(/^  deploy:/m)[1] ?? ''
  assert.match(deploy, /publish-list\.txt/, 'el trabajo deploy debe copiar la lista')
  assert.match(deploy, /path: '_site'/, 'el trabajo deploy debe subir _site')
  assert.doesNotMatch(deploy, /path: '\.'/, 'el trabajo deploy no puede subir la raíz')
})
