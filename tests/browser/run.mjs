// Batería de pruebas en navegador real.
//
//   node tests/browser/run.mjs                 todas las pruebas
//   node tests/browser/run.mjs inyeccion       solo los archivos/pruebas cuyo nombre contenga "inyeccion"
//   node tests/browser/run.mjs --shots <dir>   dónde guardar capturas (por defecto, carpeta temporal)
//
// Requiere Chrome o Edge instalado (o CHROME_PATH). No usa la red.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startServer, launchBrowser, openPage, appErrors } from './harness.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const shotsIdx = args.indexOf('--shots')
const shotsDir = shotsIdx >= 0 ? path.resolve(args[shotsIdx + 1]) : path.join(os.tmpdir(), 'pz-shots')
const filters = args.filter((a, i) => !a.startsWith('--') && !(shotsIdx >= 0 && i === shotsIdx + 1))

const specFiles = fs.readdirSync(here).filter(f => f.endsWith('.spec.mjs')).sort()
const browser = await launchBrowser()
let passed = 0
const failures = []
const started = Date.now()

try {
  for (const file of specFiles) {
    const { tests } = await import(pathToFileURL(path.join(here, file)).href)
    const selected = tests.filter(t => filters.length === 0 || filters.some(f => file.includes(f) || t.name.includes(f)))
    if (selected.length === 0) continue
    console.log(`\n${file}`)
    for (const test of selected) {
      const pages = []
      const servers = []
      const t = {
        assert, appErrors, shotsDir,
        /** Servidor del repo (uno por prueba, con sus propias sustituciones). */
        async server(overrides) { const s = await startServer(overrides); servers.push(s); return s },
        /** Página aislada; se cierra sola al terminar la prueba. */
        async open(opts) { const p = await openPage(browser, opts); pages.push(p); return p },
        shot: (page, name) => page.screenshot(path.join(shotsDir, `${name}.png`)),
      }
      const t0 = Date.now()
      try {
        await test.run(t)
        passed++
        console.log(`  ✔ ${test.name} (${Date.now() - t0} ms)`)
      } catch (err) {
        failures.push({ file, name: test.name, err })
        console.log(`  ✖ ${test.name} (${Date.now() - t0} ms)`)
        console.log('      ' + String(err?.message ?? err).split('\n').join('\n      '))
      } finally {
        for (const p of pages) await p.close()
        for (const s of servers) await s.close()
      }
    }
  }
} finally {
  await browser.close()
}

console.log(`\n${passed} correctas, ${failures.length} con fallo — ${((Date.now() - started) / 1000).toFixed(1)} s`)
if (failures.length) {
  console.log('Fallos:')
  for (const f of failures) console.log(`  - ${f.file} › ${f.name}`)
  process.exitCode = 1
}
