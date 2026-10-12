// Tipografías servidas desde la propia web (auditoría 2026-10, W4-06): cargar
// la página no debe pedir nada a Google, y lo que css/fonts.css referencia
// tiene que existir, publicarse y estar disponible sin red.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8')

test('ninguna de las dos páginas pide tipografías a Google ni lo permite su política', () => {
  for (const page of ['index.html', 'publicar.html']) {
    assert.doesNotMatch(read(page), /fonts\.(googleapis|gstatic)\.com/, page)
    assert.match(read(page), /href="css\/fonts\.css\?v=\d+"/, `${page} debe cargar css/fonts.css`)
  }
})

test('cada archivo de css/fonts.css existe, está en la caché del service worker y lleva su licencia', () => {
  const files = [...read('css/fonts.css').matchAll(/url\(\.\.\/(fonts\/[^)]+)\)/g)].map(m => m[1])
  assert.ok(files.length >= 4, 'css/fonts.css no referencia ninguna tipografía')
  const sw = read('sw.js')
  for (const file of new Set(files)) {
    assert.ok(existsSync(path.join(ROOT, file)), `falta ${file}`)
    assert.ok(sw.includes(`'./${file}'`), `${file} no está en STATICS de sw.js`)
  }
  for (const family of ['Inter', 'Orbitron', 'ShareTechMono']) {
    assert.ok(existsSync(path.join(ROOT, `fonts/OFL-${family}.txt`)), `falta la licencia de ${family}`)
  }
  assert.ok(read('.github/publish-list.txt').split(/\r?\n/).includes('fonts'), 'la carpeta fonts debe publicarse')
})
