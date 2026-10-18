// Lo que la web y los README dicen tiene que ser verdad. Cada bloque fija un
// desfase real encontrado en auditoría: la página decía "descarga
// próximamente" con el APK ya publicado, citaba como vigente una regla del
// bot retirado, y el README anunciaba una función que ninguna pantalla ofrece.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8')
const index = read('index.html')

test('el APK que enlaza la web existe y su SHA-256 publicado es el real', () => {
  const href = index.match(/id="apk-download"[^>]*href="([^"]+)"/)?.[1] ?? index.match(/href="([^"]+\.apk)"/)?.[1]
  assert.ok(href, 'index.html debe enlazar el APK')
  assert.ok(existsSync(path.join(ROOT, href)), `no existe ${href}`)

  const real = createHash('sha256').update(readFileSync(path.join(ROOT, href))).digest('hex').toUpperCase()
  const enPagina = index.match(/id="apk-sha256"[^>]*>([0-9A-Fa-f]{64})</)?.[1]?.toUpperCase()
  assert.equal(enPagina, real, 'la huella mostrada en la página no coincide con el archivo')

  const enArchivo = read(`${href}.sha256`).trim().split(/\s+/)[0].toUpperCase()
  assert.equal(enArchivo, real, 'el .sha256 no coincide con el archivo')
  assert.ok(read('app/README.md').toUpperCase().includes(real), 'app/README.md debe llevar la misma huella')
})

test('ningún texto dice que no hay descarga ni binarios publicados', () => {
  for (const file of ['index.html', 'README.md', 'app/README.md']) {
    assert.doesNotMatch(read(file), /Descarga próximamente|sin binarios publicados|no hay ningún binario publicado/i, file)
  }
})

test('la web no presenta como vigente el bot de Telegram retirado', () => {
  const visible = index.replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(visible, /el bot de PlazaP2P (exige|pide|requiere|permite)/i)
  assert.doesNotMatch(visible, /t\.me\/plazap2pbot/i)
})

test('el README no anuncia como disponible lo que ninguna página carga', () => {
  // Módulos escritos y probados pero sin conectar a index.html / publicar.html.
  const cargados = new Set()
  const visitar = file => {
    if (cargados.has(file) || !existsSync(path.join(ROOT, 'js', file))) return
    cargados.add(file)
    for (const m of read(`js/${file}`).matchAll(/from\s+['"]\.\/([\w.-]+\.js)/g)) visitar(m[1])
  }
  for (const page of ['index.html', 'publicar.html']) {
    for (const m of read(page).matchAll(/js\/([\w.-]+\.js)/g)) visitar(m[1])
  }
  const readme = read('README.md')
  if (!cargados.has('backup.js')) {
    const frase = readme.split('\n').find(l => /copia de seguridad local/i.test(l)) ?? ''
    assert.ok(frase === '' || /todavía no|aún no|sin conectar/i.test(frase),
      'backup.js no lo carga ninguna página: el README no puede listarlo como función disponible')
  }
})

test('la web no presenta el filtro de 30 días como una protección de la reputación', () => {
  // La fecha de un evento Nostr la escribe quien lo firma: una clave creada hoy
  // pasa el filtro con una nota de fecha atrasada (auditoría 2026-10, W4-01).
  const visible = index.replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(visible, /solo cuenta en la reputación/i)
  const nota = read('js/app.js').split('\n').find(l => l.includes('rep-excluded-note')) ?? ''
  // PZ-F8-01: la media ya no depende de esa fecha, sino de la red de confianza; el aviso lo dice.
  assert.match(nota, /red de confianza/, 'el aviso de valoraciones excluidas debe explicar la red de confianza')
})
